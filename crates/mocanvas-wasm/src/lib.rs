//! WebAssembly facade for the mocanvas engine.
//!
//! The host (TypeScript) talks to the engine through a command buffer that
//! lives in WASM memory (see `docs/ARCHITECTURE.md` → Bridge ABI) and reads
//! results through pointer/length pairs into that same memory. There is no
//! per-shape JS↔WASM call.

#![warn(missing_docs)]

use mocanvas_geo::shapes::{catmull_rom_path, geo_path, polyline_path, smooth_freehand, GeoKind};
use mocanvas_geo::{Box2d, Path, Vec2};
use mocanvas_render::Renderer;
use mocanvas_scene::{BoxQueryMode, Handle, HitFilter, Scene, Style, ZKey};
use wasm_bindgen::prelude::*;

/// Command opcodes (first word of each command).
pub mod op {
    /// `handle kind parent zkey_lo zkey_hi flags x y rot w h` (12 words incl. opcode).
    pub const UPSERT_SHAPE: u32 = 1;
    /// `handle` (2 words).
    pub const REMOVE_SHAPE: u32 = 2;
    /// `handle nwords [f32 path words...]` (3 + n words).
    pub const SET_GEOMETRY: u32 = 3;
    /// `handle fill stroke stroke_w(f32) dash opacity(f32) seed` (8 words). Keeps the texture.
    pub const SET_STYLE: u32 = 4;
    /// Remove everything (1 word).
    pub const CLEAR: u32 = 5;
    /// `handle texture` (3 words). Texture 0 = solid fill.
    pub const SET_TEXTURE: u32 = 6;
    /// `handle kind flags w(f32) h(f32)` (6 words). Builds a built-in geo
    /// silhouette here instead of shipping its vertices; see [`geo_flag`].
    pub const SET_GEO: u32 = 7;
    /// `handle flags npoints [x y(f32)]...` (4 + 2n words). Smooth cubic spline
    /// through the points (Catmull-Rom). `flags` bit 0 closes the curve.
    pub const SET_SPLINE: u32 = 8;
    /// `handle flags npoints [x y(f32)]...` (4 + 2n words). Polyline, or polygon
    /// when `flags` bit 0 is set.
    pub const SET_POLY: u32 = 9;
    /// `handle flags nsegments [segflags npoints (x y(f32))...]...`. A freehand
    /// stroke: each segment is smoothed here when its `segflags` bit 0 is set,
    /// then all of them are concatenated into one outline. `flags` bit 0 closes it.
    pub const SET_DRAW: u32 = 10;
}

/// Flag bits shared by the parametric geometry commands.
pub mod geo_flag {
    /// [`super::op::SET_GEO`]: mirror the silhouette left-to-right in its box.
    pub const FLIP_X: u32 = 1 << 0;
    /// [`super::op::SET_GEO`]: mirror the silhouette top-to-bottom in its box.
    pub const FLIP_Y: u32 = 1 << 1;
    /// [`super::op::SET_SPLINE`], [`super::op::SET_POLY`], [`super::op::SET_DRAW`]:
    /// close the outline.
    pub const CLOSED: u32 = 1 << 0;
    /// [`super::op::SET_DRAW`], per segment: this run came from a pen rather than
    /// a straight-line tool, so smooth it.
    pub const FREEHAND: u32 = 1 << 0;
}

/// The engine: one scene (the current page) and one renderer.
#[wasm_bindgen]
pub struct Engine {
    scene: Scene,
    renderer: Renderer,
    cmd: Vec<u32>,
    handles_out: Vec<u32>,
    f32_out: Vec<f32>,
    last_error: Option<String>,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl Engine {
    /// Create an empty engine.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine {
        Engine {
            scene: Scene::new(),
            renderer: Renderer::new(),
            cmd: Vec::with_capacity(1 << 16),
            handles_out: Vec::new(),
            f32_out: vec![0.0; 4],
            last_error: None,
        }
    }

    /// Reserve the command buffer for at least `words` u32 words and return its pointer.
    /// The host writes commands into a `Uint32Array(memory.buffer, ptr, words)` view
    /// (bit-casting floats) and then calls [`Engine::apply`].
    pub fn cmd_ptr(&mut self, words: usize) -> *mut u32 {
        if self.cmd.len() < words {
            self.cmd.resize(words, 0);
        }
        self.cmd.as_mut_ptr()
    }

    /// Current capacity of the command buffer in words.
    pub fn cmd_capacity(&self) -> usize {
        self.cmd.len()
    }

    /// Apply `len` words of commands from the command buffer. Returns the number of
    /// commands applied; on a malformed stream applies what it can and records an error.
    pub fn apply(&mut self, len: usize) -> u32 {
        let len = len.min(self.cmd.len());
        let mut i = 0usize;
        let mut count = 0u32;
        while i < len {
            let opcode = self.cmd[i];
            match opcode {
                op::UPSERT_SHAPE => {
                    if i + 12 > len {
                        return self.fail(count, "truncated UPSERT_SHAPE");
                    }
                    let c = &self.cmd[i..i + 12];
                    self.scene.upsert(
                        c[1],
                        c[2] as u16,
                        c[3],
                        ZKey::from_words(c[4], c[5]),
                        c[6],
                        f32::from_bits(c[7]),
                        f32::from_bits(c[8]),
                        f32::from_bits(c[9]),
                        f32::from_bits(c[10]),
                        f32::from_bits(c[11]),
                    );
                    i += 12;
                }
                op::REMOVE_SHAPE => {
                    if i + 2 > len {
                        return self.fail(count, "truncated REMOVE_SHAPE");
                    }
                    let h = self.cmd[i + 1];
                    if let Some(slot) = self.scene.slot(h) {
                        self.renderer.invalidate(slot);
                    }
                    self.scene.remove(h);
                    i += 2;
                }
                op::SET_GEOMETRY => {
                    if i + 3 > len {
                        return self.fail(count, "truncated SET_GEOMETRY");
                    }
                    let h = self.cmd[i + 1];
                    let n = self.cmd[i + 2] as usize;
                    if i + 3 + n > len {
                        return self.fail(count, "truncated SET_GEOMETRY payload");
                    }
                    let words: Vec<f32> = self.cmd[i + 3..i + 3 + n].iter().map(|w| f32::from_bits(*w)).collect();
                    match Path::from_wire(&words) {
                        Some(p) => {
                            self.scene.set_geometry(h, p);
                        }
                        None => {
                            self.last_error = Some(format!("malformed path for handle {h}"));
                        }
                    }
                    i += 3 + n;
                }
                op::SET_STYLE => {
                    if i + 8 > len {
                        return self.fail(count, "truncated SET_STYLE");
                    }
                    let c = &self.cmd[i..i + 8];
                    let texture = self.scene.get(c[1]).map_or(0, |s| s.style.texture);
                    let style = Style {
                        fill: c[2],
                        stroke: c[3],
                        stroke_width: f32::from_bits(c[4]),
                        dash: c[5],
                        opacity: f32::from_bits(c[6]),
                        texture,
                        seed: c[7],
                    };
                    self.scene.set_style(c[1], style);
                    i += 8;
                }
                op::SET_GEO => {
                    if i + 6 > len {
                        return self.fail(count, "truncated SET_GEO");
                    }
                    let c = &self.cmd[i..i + 6];
                    match GeoKind::from_u32(c[2]) {
                        Some(kind) => {
                            let path = geo_path(
                                kind,
                                f32::from_bits(c[4]),
                                f32::from_bits(c[5]),
                                c[3] & geo_flag::FLIP_X != 0,
                                c[3] & geo_flag::FLIP_Y != 0,
                            );
                            self.scene.set_geometry(c[1], path);
                        }
                        // A kind this build has no generator for. The host falls
                        // back to SET_GEOMETRY for its own shapes, so this only
                        // happens on a corrupt stream or a newer host; say so and
                        // leave the shape's previous outline alone.
                        None => self.last_error = Some(format!("unknown geo kind {} for handle {}", c[2], c[1])),
                    }
                    i += 6;
                }
                op::SET_SPLINE | op::SET_POLY => {
                    if i + 4 > len {
                        return self.fail(count, "truncated SET_SPLINE/SET_POLY");
                    }
                    let h = self.cmd[i + 1];
                    let closed = self.cmd[i + 2] & geo_flag::CLOSED != 0;
                    let n = self.cmd[i + 3] as usize;
                    if i + 4 + n * 2 > len {
                        return self.fail(count, "truncated SET_SPLINE/SET_POLY payload");
                    }
                    let points = read_points(&self.cmd[i + 4..i + 4 + n * 2]);
                    let path = if opcode == op::SET_SPLINE {
                        catmull_rom_path(&points, closed)
                    } else {
                        polyline_path(&points, closed)
                    };
                    self.scene.set_geometry(h, path);
                    i += 4 + n * 2;
                }
                op::SET_DRAW => {
                    if i + 4 > len {
                        return self.fail(count, "truncated SET_DRAW");
                    }
                    let h = self.cmd[i + 1];
                    let closed = self.cmd[i + 2] & geo_flag::CLOSED != 0;
                    let segments = self.cmd[i + 3] as usize;
                    let mut at = i + 4;
                    let mut points: Vec<Vec2> = Vec::new();
                    let mut truncated = false;
                    for _ in 0..segments {
                        if at + 2 > len {
                            truncated = true;
                            break;
                        }
                        let seg_flags = self.cmd[at];
                        let n = self.cmd[at + 1] as usize;
                        if at + 2 + n * 2 > len {
                            truncated = true;
                            break;
                        }
                        let run = read_points(&self.cmd[at + 2..at + 2 + n * 2]);
                        if seg_flags & geo_flag::FREEHAND != 0 {
                            smooth_freehand(&run, &mut points);
                        } else {
                            points.extend_from_slice(&run);
                        }
                        at += 2 + n * 2;
                    }
                    if truncated {
                        return self.fail(count, "truncated SET_DRAW payload");
                    }
                    // A stroke with nothing in it still has to be *somewhere*, or
                    // the scene would fall back to the shape's box for its bounds.
                    if points.is_empty() {
                        points.push(Vec2::ZERO);
                    }
                    self.scene.set_geometry(h, polyline_path(&points, closed && points.len() > 2));
                    i = at;
                }
                op::SET_TEXTURE => {
                    if i + 3 > len {
                        return self.fail(count, "truncated SET_TEXTURE");
                    }
                    self.scene.set_texture(self.cmd[i + 1], self.cmd[i + 2]);
                    i += 3;
                }
                op::CLEAR => {
                    self.scene.clear();
                    self.renderer.clear();
                    i += 1;
                }
                _ => return self.fail(count, "unknown opcode"),
            }
            count += 1;
        }
        count
    }

    fn fail(&mut self, count: u32, msg: &str) -> u32 {
        self.last_error = Some(msg.to_string());
        count
    }

    /// Take the last error message, if any.
    pub fn take_error(&mut self) -> Option<String> {
        self.last_error.take()
    }

    /// Number of shapes in the scene.
    pub fn shape_count(&self) -> u32 {
        self.scene.len() as u32
    }

    /// Change counter.
    pub fn epoch(&self) -> f64 {
        self.scene.epoch() as f64
    }

    // ---- frame ------------------------------------------------------------

    /// Build the frame for a camera (`cx, cy` page offset, `zoom`) and viewport size in
    /// screen pixels. Afterwards read the buffers through the `*_ptr`/`*_len` getters.
    ///
    /// The buffers are page-space, so they do not depend on the camera: when the scene
    /// is unchanged and the camera has only moved a little, this reuses the previous
    /// build, leaves the buffers alone and reports [`Engine::frame_dirty`] `false` — the
    /// host can then skip re-uploading them and just redraw with the new camera uniform.
    ///
    /// `tess_budget` caps how many shapes may be tessellated in this call (0 = no cap);
    /// the rest are drawn as level-of-detail quads until a later frame catches up, with
    /// [`Engine::frame_pending`] set meanwhile.
    pub fn frame(&mut self, cam_x: f32, cam_y: f32, zoom: f32, vp_w: f32, vp_h: f32, tess_budget: usize) {
        let z = zoom.max(1e-6);
        // screen = (page + cam) * zoom  →  page = screen / zoom - cam
        let min = Vec2::new(-cam_x, -cam_y);
        let max = Vec2::new(vp_w / z - cam_x, vp_h / z - cam_y);
        let vp = Box2d::new(min, max).expand(1.0 / z);
        let budget = if tess_budget == 0 { usize::MAX } else { tess_budget };
        self.renderer.frame(&mut self.scene, &vp, z, budget);
    }

    /// Whether the last [`Engine::frame`] rebuilt the buffers. When false the pointers,
    /// lengths and contents are exactly what the previous frame produced.
    pub fn frame_dirty(&self) -> bool {
        self.renderer.frame_dirty()
    }

    /// Counter bumped on every rebuild. A host that has uploaded version `v` can skip
    /// the upload for as long as this still reads `v`.
    pub fn frame_version(&self) -> f64 {
        self.renderer.frame_version() as f64
    }

    /// Whether shapes are still waiting on the tessellation budget and are meanwhile
    /// drawn as quads. The host should keep scheduling frames while this is true.
    pub fn frame_pending(&self) -> bool {
        self.renderer.tessellation_pending()
    }

    /// The default per-frame tessellation budget.
    pub fn default_tess_budget() -> usize {
        mocanvas_render::DEFAULT_TESS_BUDGET
    }

    /// Grow the box each frame is built for by `pad` (a fraction of the viewport size)
    /// on every side, so a camera panning inside that margin reuses the build instead
    /// of re-tessellating and re-uploading. Defaults to
    /// `mocanvas_render::DEFAULT_VIEWPORT_PAD` — see `Renderer::set_viewport_pad` for
    /// the trade-off, which depends on how expensive the host's rasteriser makes
    /// geometry relative to uploads.
    pub fn set_viewport_pad(&mut self, pad: f32) {
        self.renderer.set_viewport_pad(pad);
    }

    /// The current viewport pad.
    pub fn viewport_pad(&self) -> f32 {
        self.renderer.viewport_pad()
    }

    /// Pointer to interleaved `x y u v r g b a` f32 vertices (8 per vertex).
    pub fn vertices_ptr(&self) -> *const f32 {
        self.renderer.out.vertices.as_ptr()
    }
    /// Number of f32 in the vertex buffer.
    pub fn vertices_len(&self) -> usize {
        self.renderer.out.vertices.len()
    }
    /// Pointer to u32 indices.
    pub fn indices_ptr(&self) -> *const u32 {
        self.renderer.out.indices.as_ptr()
    }
    /// Number of indices.
    pub fn indices_len(&self) -> usize {
        self.renderer.out.indices.len()
    }
    /// Pointer to batch records: `first_index count texture clip_minx clip_miny clip_maxx
    /// clip_maxy` (clip as f32 bits; all four zero = no clip).
    pub fn batches_ptr(&self) -> *const u32 {
        self.renderer.out.batches.as_ptr()
    }
    /// Number of u32 in the batch buffer (7 per batch).
    pub fn batches_len(&self) -> usize {
        self.renderer.out.batches.len()
    }
    /// Pointer to overlay entries (`handle x y w h rot clip_minx clip_miny clip_maxx
    /// clip_maxy`, floats as bits; clip all zero = unclipped).
    pub fn overlay_ptr(&self) -> *const u32 {
        self.renderer.out.overlay.as_ptr()
    }
    /// Number of u32 in the overlay buffer (10 per entry).
    pub fn overlay_len(&self) -> usize {
        self.renderer.out.overlay.len()
    }
    /// Shapes drawn last frame.
    pub fn drawn_count(&self) -> u32 {
        self.renderer.out.drawn
    }
    /// Shapes culled last frame.
    pub fn culled_count(&self) -> u32 {
        self.renderer.out.culled
    }

    // ---- queries ----------------------------------------------------------

    /// Topmost shape at a page point, or 0. `filter` bits: 1 include locked, 2 include hidden, 4 hollow only.
    pub fn hit_test(&mut self, x: f32, y: f32, tolerance: f32, filter: u32) -> u32 {
        self.scene.hit_test(Vec2::new(x, y), tolerance, HitFilter::from_bits(filter))
    }

    /// Shapes in a page box. `mode` 0 = intersects, 1 = contains. Returns count; read via `handles_ptr`.
    pub fn query_box(&mut self, minx: f32, miny: f32, maxx: f32, maxy: f32, mode: u32, filter: u32) -> usize {
        let b = Box2d::from_min_max(minx, miny, maxx, maxy);
        self.handles_out = self.scene.query_box(&b, BoxQueryMode::from_u32(mode), HitFilter::from_bits(filter));
        self.handles_out.len()
    }

    /// Pointer to the handle result buffer.
    pub fn handles_ptr(&self) -> *const u32 {
        self.handles_out.as_ptr()
    }

    /// Page bounds of a shape → `f32_ptr()` holds `minx miny maxx maxy`. Returns false if missing.
    pub fn bounds(&mut self, handle: Handle) -> bool {
        match self.scene.get(handle) {
            Some(s) => {
                self.f32_out[..4].copy_from_slice(&s.page_bounds.to_array());
                true
            }
            None => false,
        }
    }

    /// Union of page bounds for `len` handles read from the command buffer → `f32_ptr()`.
    /// Returns false if the union is empty.
    pub fn union_bounds(&mut self, len: usize) -> bool {
        let len = len.min(self.cmd.len());
        let b = self.scene.union_bounds(&self.cmd[..len]);
        self.f32_out[..4].copy_from_slice(&b.to_array());
        !b.is_empty()
    }

    /// Union of all page bounds → `f32_ptr()`. Returns false if the scene is empty.
    pub fn all_bounds(&mut self) -> bool {
        let b = self.scene.all_bounds();
        self.f32_out[..4].copy_from_slice(&b.to_array());
        !b.is_empty()
    }

    /// Geometry-only page bounds of a shape → `f32_ptr()` holds `minx miny maxx maxy`.
    /// Same box as `bounds` without the half-stroke pad. Returns false if missing.
    pub fn geometry_bounds(&mut self, handle: Handle) -> bool {
        match self.scene.geometry_bounds(handle) {
            Some(b) => {
                self.f32_out[..4].copy_from_slice(&b.to_array());
                true
            }
            None => false,
        }
    }

    /// Union of all geometry bounds → `f32_ptr()`. Returns false if the scene is empty.
    pub fn all_geometry_bounds(&mut self) -> bool {
        let b = self.scene.all_geometry_bounds();
        self.f32_out[..4].copy_from_slice(&b.to_array());
        !b.is_empty()
    }

    /// Page transform of a shape → `f32_ptr()` holds `a b c d e f`. Returns false if missing.
    pub fn page_transform(&mut self, handle: Handle) -> bool {
        match self.scene.get(handle) {
            Some(s) => {
                let m = s.page_transform;
                if self.f32_out.len() < 6 {
                    self.f32_out.resize(6, 0.0);
                }
                self.f32_out[..6].copy_from_slice(&[m.a, m.b, m.c, m.d, m.e, m.f]);
                true
            }
            None => false,
        }
    }

    /// Pointer to the small f32 result buffer.
    pub fn f32_ptr(&self) -> *const f32 {
        self.f32_out.as_ptr()
    }
}

/// Decode interleaved `x y` f32 bit patterns into points.
fn read_points(words: &[u32]) -> Vec<Vec2> {
    words.chunks_exact(2).map(|c| Vec2::new(f32::from_bits(c[0]), f32::from_bits(c[1]))).collect()
}

/// Library version.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use mocanvas_geo::PathCmd;

    /// Bit-cast, the way the host writes floats into the u32 command stream.
    fn b(v: f32) -> u32 {
        v.to_bits()
    }

    fn engine_with_one_shape() -> Engine {
        let mut e = Engine::new();
        let cmd = [
            op::UPSERT_SHAPE,
            1,
            0,
            0,
            0,
            0,
            0,
            b(0.0),
            b(0.0),
            b(0.0),
            b(100.0),
            b(60.0),
        ];
        write_and_apply(&mut e, &cmd);
        e
    }

    fn write_and_apply(e: &mut Engine, words: &[u32]) -> u32 {
        let ptr = e.cmd_ptr(words.len());
        // Safety: `cmd_ptr` just guaranteed `words.len()` writable u32 words.
        unsafe { std::ptr::copy_nonoverlapping(words.as_ptr(), ptr, words.len()) };
        e.apply(words.len())
    }

    #[test]
    fn set_geo_builds_the_same_outline_as_an_uploaded_path() {
        let mut e = engine_with_one_shape();
        let applied = write_and_apply(&mut e, &[op::SET_GEO, 1, GeoKind::Hexagon as u32, 0, b(100.0), b(60.0)]);
        assert_eq!(applied, 1);
        assert_eq!(e.take_error(), None);
        let bounds = e.bounds(1);
        assert!(bounds);
        let got: Vec<f32> = unsafe { std::slice::from_raw_parts(e.f32_ptr(), 4) }.to_vec();

        // The same shape, uploaded the old way.
        let mut reference = engine_with_one_shape();
        let words = geo_path(GeoKind::Hexagon, 100.0, 60.0, false, false).to_wire();
        let mut cmd = vec![op::SET_GEOMETRY, 1, words.len() as u32];
        cmd.extend(words.iter().map(|w| w.to_bits()));
        write_and_apply(&mut reference, &cmd);
        assert!(reference.bounds(1));
        let want: Vec<f32> = unsafe { std::slice::from_raw_parts(reference.f32_ptr(), 4) }.to_vec();
        assert_eq!(got, want);
    }

    #[test]
    fn set_geo_flips_are_read_from_the_flag_word() {
        let mut e = engine_with_one_shape();
        write_and_apply(
            &mut e,
            &[op::SET_GEO, 1, GeoKind::Triangle as u32, geo_flag::FLIP_Y, b(100.0), b(60.0)],
        );
        assert_eq!(e.take_error(), None);
        let path = e.scene.get(1).map(|s| s.path.clone()).unwrap();
        // Flipped top-to-bottom, the apex sits on the bottom edge.
        assert_eq!(path.cmds()[0], PathCmd::MoveTo(Vec2::new(50.0, 60.0)));
    }

    #[test]
    fn an_unknown_geo_kind_is_reported_and_skipped() {
        let mut e = engine_with_one_shape();
        let applied = write_and_apply(&mut e, &[op::SET_GEO, 1, 999, 0, b(100.0), b(60.0)]);
        // The command is consumed — one bad kind must not desynchronise the stream.
        assert_eq!(applied, 1);
        assert!(e.take_error().unwrap().contains("unknown geo kind 999"));
    }

    #[test]
    fn set_poly_closes_only_when_asked() {
        let mut e = engine_with_one_shape();
        write_and_apply(
            &mut e,
            &[op::SET_POLY, 1, 0, 3, b(0.0), b(0.0), b(10.0), b(0.0), b(10.0), b(10.0)],
        );
        assert!(!e.scene.get(1).unwrap().path.is_closed());
        write_and_apply(
            &mut e,
            &[op::SET_POLY, 1, geo_flag::CLOSED, 3, b(0.0), b(0.0), b(10.0), b(0.0), b(10.0), b(10.0)],
        );
        assert!(e.scene.get(1).unwrap().path.is_closed());
    }

    #[test]
    fn set_spline_produces_one_cubic_per_span() {
        let mut e = engine_with_one_shape();
        write_and_apply(
            &mut e,
            &[op::SET_SPLINE, 1, 0, 4, b(0.0), b(0.0), b(10.0), b(20.0), b(30.0), b(5.0), b(50.0), b(40.0)],
        );
        assert_eq!(e.take_error(), None);
        let path = e.scene.get(1).unwrap().path.clone();
        // MoveTo plus three cubics for four points.
        assert_eq!(path.cmds().len(), 4);
    }

    #[test]
    fn set_draw_smooths_only_the_freehand_runs() {
        let raw = [b(0.0), b(0.0), b(10.0), b(4.0), b(22.0), b(1.0), b(33.0), b(12.0)];
        let mut smoothed_engine = engine_with_one_shape();
        let mut cmd = vec![op::SET_DRAW, 1, 0, 1, geo_flag::FREEHAND, 4];
        cmd.extend_from_slice(&raw);
        write_and_apply(&mut smoothed_engine, &cmd);
        let smoothed = smoothed_engine.scene.get(1).unwrap().path.clone();

        let mut straight_engine = engine_with_one_shape();
        let mut cmd = vec![op::SET_DRAW, 1, 0, 1, 0, 4];
        cmd.extend_from_slice(&raw);
        write_and_apply(&mut straight_engine, &cmd);
        let straight = straight_engine.scene.get(1).unwrap().path.clone();

        assert_ne!(smoothed, straight, "the freehand flag must actually smooth");
        // Both keep the pen's first and last point.
        assert_eq!(smoothed.cmds().first(), straight.cmds().first());
        assert_eq!(smoothed.cmds().last(), straight.cmds().last());
    }

    #[test]
    fn set_draw_concatenates_segments() {
        let mut e = engine_with_one_shape();
        let cmd = vec![
            op::SET_DRAW, 1, 0, 2,
            0, 2, b(0.0), b(0.0), b(10.0), b(0.0),
            0, 2, b(10.0), b(10.0), b(20.0), b(10.0),
        ];
        write_and_apply(&mut e, &cmd);
        assert_eq!(e.take_error(), None);
        assert_eq!(e.scene.get(1).unwrap().path.cmds().len(), 4);
    }

    #[test]
    fn an_empty_draw_still_lands_somewhere() {
        let mut e = engine_with_one_shape();
        write_and_apply(&mut e, &[op::SET_DRAW, 1, 0, 0]);
        assert_eq!(e.take_error(), None);
        assert_eq!(e.scene.get(1).unwrap().path.cmds().len(), 1);
    }

    #[test]
    fn truncated_parametric_commands_are_reported() {
        for cmd in [
            vec![op::SET_GEO, 1, 0, 0],
            vec![op::SET_POLY, 1, 0, 4, b(0.0), b(0.0)],
            vec![op::SET_SPLINE, 1, 0, 4, b(0.0), b(0.0)],
            vec![op::SET_DRAW, 1, 0, 1, 0, 8, b(0.0), b(0.0)],
        ] {
            let mut e = engine_with_one_shape();
            write_and_apply(&mut e, &cmd);
            assert!(e.take_error().is_some(), "no error for {cmd:?}");
        }
    }
}
