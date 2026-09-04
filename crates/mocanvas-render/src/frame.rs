//! Per-frame assembly of GPU buffers.

use crate::tess::{tessellate, MeshCache, MeshPart};
use mocanvas_geo::{Box2d, Mat2d};
use mocanvas_scene::{unpack_rgba, Scene, ShapeRef, Slot, FLAG_LABEL, FLAG_OVERLAY};

/// Floats per vertex: `x y u v r g b a`.
pub const VERTEX_FLOATS: usize = 8;
/// `u32` words per batch: `first_index index_count texture clip_minx clip_miny clip_maxx clip_maxy`.
pub const BATCH_WORDS: usize = 7;
/// `u32` words per overlay entry: `handle x y w h rot clip_minx clip_miny clip_maxx clip_maxy`.
pub const OVERLAY_WORDS: usize = 10;

/// Buffers produced by [`Renderer::frame`]. All slices are valid until the next frame.
#[derive(Default, Debug)]
pub struct FrameOutput {
    /// Interleaved `x y u v r g b a` vertices, page space, premultiplied alpha not
    /// applied (shader does it). Solid geometry has `u = v = 0`.
    pub vertices: Vec<f32>,
    /// Triangle indices.
    pub indices: Vec<u32>,
    /// [`BATCH_WORDS`] words per batch: `first_index, index_count, texture, clip_minx,
    /// clip_miny, clip_maxx, clip_maxy` (clip words are f32 bits; all four zero = no clip).
    /// Texture 0 = solid color. A new batch starts whenever texture or clip changes.
    pub batches: Vec<u32>,
    /// Overlay shapes, [`OVERLAY_WORDS`] words per entry in draw order:
    /// `handle, x, y, w, h, rot, clip_minx, clip_miny, clip_maxx, clip_maxy` (floats as
    /// bits), with `x y w h` the page-space bounds, `rot` the page rotation and the clip
    /// rect as in `batches`.
    pub overlay: Vec<u32>,
    /// Number of shapes drawn to the GPU this frame.
    pub drawn: u32,
    /// Number of shapes culled this frame.
    pub culled: u32,
}

impl FrameOutput {
    fn clear(&mut self) {
        self.vertices.clear();
        self.indices.clear();
        self.batches.clear();
        self.overlay.clear();
        self.drawn = 0;
        self.culled = 0;
    }
}

/// What separates one draw call from the next.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct BatchKey {
    texture: u32,
    clip: [u32; 4],
}

/// Clip rect as four f32-bit words; all zero when unclipped.
#[inline]
fn clip_words(clip: Option<&Box2d>) -> [u32; 4] {
    match clip {
        Some(c) => [c.min.x.to_bits(), c.min.y.to_bits(), c.max.x.to_bits(), c.max.y.to_bits()],
        None => [0; 4],
    }
}

/// Tracks the open batch while geometry is appended to a [`FrameOutput`].
#[derive(Default)]
struct Batcher {
    start: u32,
    key: Option<BatchKey>,
}

impl Batcher {
    fn reset(&mut self) {
        self.start = 0;
        self.key = None;
    }

    /// Make sure the geometry appended next lands in a batch with `key`.
    #[inline]
    fn begin(&mut self, out: &mut FrameOutput, key: BatchKey) {
        if self.key != Some(key) {
            self.flush(out);
            self.key = Some(key);
        }
    }

    /// Close the current batch if it has any indices.
    fn flush(&mut self, out: &mut FrameOutput) {
        let total = out.indices.len() as u32;
        if total > self.start {
            let key = self.key.unwrap_or(BatchKey { texture: 0, clip: [0; 4] });
            out.batches.extend_from_slice(&[self.start, total - self.start, key.texture]);
            out.batches.extend_from_slice(&key.clip);
            self.start = total;
        }
    }
}

/// Owns the mesh cache and frame output.
#[derive(Default)]
pub struct Renderer {
    meshes: Vec<Option<MeshCache>>,
    visible: Vec<Slot>,
    /// Frame output.
    pub out: FrameOutput,
    batcher: Batcher,
}

impl Renderer {
    /// New renderer.
    pub fn new() -> Self {
        Self::default()
    }

    /// Drop the cached mesh for a slot (call on remove).
    pub fn invalidate(&mut self, slot: Slot) {
        if let Some(m) = self.meshes.get_mut(slot as usize) {
            *m = None;
        }
    }

    /// Drop every cached mesh.
    pub fn clear(&mut self) {
        self.meshes.clear();
    }

    /// Build the frame for a page-space viewport at a camera zoom (screen px per page unit).
    pub fn frame(&mut self, scene: &mut Scene, viewport: &Box2d, zoom: f32) -> &FrameOutput {
        let zoom = zoom.max(1e-6);
        self.out.clear();
        self.batcher.reset();
        scene.visible_slots(viewport, &mut self.visible);
        self.out.culled = (scene.len() as u32).saturating_sub(self.visible.len() as u32);
        if self.meshes.len() < scene_capacity(scene) {
            self.meshes.resize_with(scene_capacity(scene), || None);
        }

        for &slot in &self.visible {
            let sh = scene.shape_at(slot);
            let pb = sh.page_bounds;
            let clip = sh.clip.as_ref();
            // Fully outside its clip rect (or an empty clip): nothing to draw or overlay.
            if let Some(c) = clip {
                if c.is_empty() || !c.intersects(pb) {
                    self.out.culled += 1;
                    continue;
                }
            }
            let clip_bits = clip_words(clip);
            if sh.flags & (FLAG_OVERLAY | FLAG_LABEL) != 0 {
                self.out.overlay.push(sh.handle);
                self.out.overlay.push(pb.min.x.to_bits());
                self.out.overlay.push(pb.min.y.to_bits());
                self.out.overlay.push(pb.width().to_bits());
                self.out.overlay.push(pb.height().to_bits());
                self.out.overlay.push(sh.page_transform.rotation().to_bits());
                self.out.overlay.extend_from_slice(&clip_bits);
                if sh.flags & FLAG_OVERLAY != 0 {
                    continue;
                }
            }
            // Level of detail: shapes smaller than a few pixels on screen are drawn as a
            // single quad in their dominant color instead of a full mesh.
            let screen_size = pb.width().max(pb.height()) * zoom;
            if screen_size < LOD_QUAD_PX {
                if screen_size >= LOD_MIN_PX {
                    let color = if sh.style.has_fill() { sh.style.fill } else { sh.style.stroke };
                    let rgba = unpack_rgba(color, sh.style.opacity);
                    self.batcher.begin(&mut self.out, BatchKey { texture: 0, clip: clip_bits });
                    append_quad(&mut self.out, pb, rgba);
                    self.out.drawn += 1;
                } else {
                    self.out.culled += 1;
                }
                continue;
            }
            let i = slot as usize;
            let needs = match &self.meshes[i] {
                Some(m) => m.geom_version != sh.geom_version,
                None => true,
            };
            if needs {
                self.meshes[i] = Some(tessellate(sh.path, sh.style, sh.geom_version));
            }
            let mesh = self.meshes[i].as_ref().unwrap();
            let xf = *sh.page_transform;
            let op = sh.style.opacity;
            if sh.style.has_texture() {
                self.batcher.begin(&mut self.out, BatchKey { texture: sh.style.texture, clip: clip_bits });
                append_textured_quad(&mut self.out, &sh, &xf, [1.0, 1.0, 1.0, op]);
            } else if !mesh.fill.is_empty() {
                self.batcher.begin(&mut self.out, BatchKey { texture: 0, clip: clip_bits });
                append(&mut self.out, &mesh.fill, &xf, unpack_rgba(sh.style.fill, op));
            }
            if !mesh.stroke.is_empty() {
                self.batcher.begin(&mut self.out, BatchKey { texture: 0, clip: clip_bits });
                append(&mut self.out, &mesh.stroke, &xf, unpack_rgba(sh.style.stroke, op));
            }
            self.out.drawn += 1;
        }
        self.batcher.flush(&mut self.out);
        &self.out
    }
}

/// Below this screen size (px) a shape is drawn as a quad.
pub const LOD_QUAD_PX: f32 = 4.0;
/// Below this screen size (px) a shape is not drawn at all.
pub const LOD_MIN_PX: f32 = 0.75;

#[inline]
fn push_vertex(out: &mut FrameOutput, x: f32, y: f32, u: f32, v: f32, rgba: [f32; 4]) {
    out.vertices.extend_from_slice(&[x, y, u, v, rgba[0], rgba[1], rgba[2], rgba[3]]);
}

#[inline]
fn push_quad_indices(out: &mut FrameOutput, base: u32) {
    out.indices.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
}

#[inline]
fn append_quad(out: &mut FrameOutput, b: &Box2d, rgba: [f32; 4]) {
    let base = (out.vertices.len() / VERTEX_FLOATS) as u32;
    for c in b.corners() {
        push_vertex(out, c.x, c.y, 0.0, 0.0, rgba);
    }
    push_quad_indices(out, base);
}

/// One quad over the shape's local geometry bounds (nominal size if it has no
/// geometry), transformed to page space, with uv (0,0) at the bounds' min corner
/// and (1,1) at the max corner.
#[inline]
fn append_textured_quad(out: &mut FrameOutput, sh: &ShapeRef<'_>, xf: &Mat2d, rgba: [f32; 4]) {
    let lb = if sh.local_bounds.is_empty() { Box2d::from_xywh(0.0, 0.0, sh.w, sh.h) } else { *sh.local_bounds };
    let base = (out.vertices.len() / VERTEX_FLOATS) as u32;
    const UV: [[f32; 2]; 4] = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
    for (c, uv) in lb.corners().into_iter().zip(UV) {
        let p = xf.apply(c);
        push_vertex(out, p.x, p.y, uv[0], uv[1], rgba);
    }
    push_quad_indices(out, base);
}

fn scene_capacity(scene: &Scene) -> usize {
    scene.slots().map(|s| s as usize + 1).max().unwrap_or(0)
}

#[inline]
fn append(out: &mut FrameOutput, part: &MeshPart, xf: &Mat2d, rgba: [f32; 4]) {
    let base = (out.vertices.len() / VERTEX_FLOATS) as u32;
    out.vertices.reserve(part.positions.len() / 2 * VERTEX_FLOATS);
    for xy in part.positions.as_chunks::<2>().0 {
        let (x, y) = (xy[0], xy[1]);
        let px = xf.a * x + xf.c * y + xf.e;
        let py = xf.b * x + xf.d * y + xf.f;
        push_vertex(out, px, py, 0.0, 0.0, rgba);
    }
    out.indices.extend(part.indices.iter().map(|&i| i + base));
}

#[cfg(test)]
mod tests {
    use super::*;
    use mocanvas_geo::Path;
    use mocanvas_scene::{Style, ZKey, FLAG_CLIP};

    const NO_CLIP: [u32; 4] = [0; 4];

    fn bits(b: &Box2d) -> [u32; 4] {
        clip_words(Some(b))
    }

    fn batch(first: u32, count: u32, texture: u32, clip: [u32; 4]) -> Vec<u32> {
        let mut v = vec![first, count, texture];
        v.extend_from_slice(&clip);
        v
    }

    #[test]
    fn frame_culls_and_batches() {
        let mut sc = Scene::new();
        for h in 1..=10u32 {
            sc.upsert(h, 1, 0, ZKey(h as u64), 0, h as f32 * 1000.0, 0.0, 0.0, 100.0, 100.0);
            sc.set_geometry(h, Path::rect(&Box2d::from_xywh(0.0, 0.0, 100.0, 100.0)));
            sc.set_style(h, Style { fill: 0xff0000ff, stroke: 0, ..Style::default() });
        }
        let mut r = Renderer::new();
        let out = r.frame(&mut sc, &Box2d::from_xywh(900.0, -10.0, 2200.0, 200.0), 1.0);
        assert_eq!(out.drawn, 3);
        assert_eq!(out.culled, 7);
        assert_eq!(out.indices.len(), 18);
        assert_eq!(out.vertices.len(), 12 * VERTEX_FLOATS);
        assert_eq!(out.batches, batch(0, 18, 0, NO_CLIP));
        // solid geometry carries u = v = 0
        assert_eq!(&out.vertices[2..4], &[0.0, 0.0]);
        // second frame reuses meshes (no panic, same output)
        let out2 = r.frame(&mut sc, &Box2d::from_xywh(900.0, -10.0, 2200.0, 200.0), 1.0);
        assert_eq!(out2.indices.len(), 18);
    }

    #[test]
    fn tiny_shapes_become_quads_or_vanish() {
        let mut sc = Scene::new();
        sc.upsert(1, 1, 0, ZKey(1), 0, 0.0, 0.0, 0.0, 100.0, 100.0);
        sc.set_geometry(1, Path::ellipse(&Box2d::from_xywh(0.0, 0.0, 100.0, 100.0)));
        sc.set_style(1, Style { fill: 0xff0000ff, stroke: 0x000000ff, stroke_width: 2.0, ..Style::default() });
        let mut r = Renderer::new();
        let vp = Box2d::from_xywh(-1000.0, -1000.0, 3000.0, 3000.0);
        let full = r.frame(&mut sc, &vp, 1.0).indices.len();
        assert!(full > 6);
        // 100 page units * 0.02 zoom = 2 px → quad
        let quad = r.frame(&mut sc, &vp, 0.02);
        assert_eq!(quad.indices.len(), 6);
        assert_eq!(quad.drawn, 1);
        // 0.005 zoom = 0.5 px → dropped
        let gone = r.frame(&mut sc, &vp, 0.005);
        assert_eq!(gone.indices.len(), 0);
        assert_eq!(gone.culled, 1);
    }

    #[test]
    fn overlay_shapes_skip_gpu() {
        let mut sc = Scene::new();
        sc.upsert(1, 1, 0, ZKey(1), FLAG_OVERLAY, 10.0, 20.0, 0.0, 100.0, 50.0);
        let mut r = Renderer::new();
        let out = r.frame(&mut sc, &Box2d::from_xywh(0.0, 0.0, 500.0, 500.0), 1.0);
        assert_eq!(out.drawn, 0);
        assert_eq!(out.overlay.len(), OVERLAY_WORDS);
        assert_eq!(out.overlay[0], 1);
        assert_eq!(f32::from_bits(out.overlay[1]), 10.0);
        assert_eq!(f32::from_bits(out.overlay[3]), 100.0);
        assert_eq!(&out.overlay[6..10], &NO_CLIP);
    }

    #[test]
    fn textured_shape_emits_uv_quad_and_splits_batches() {
        let mut sc = Scene::new();
        // solid, textured (with stroke), solid — in draw order
        for h in 1..=3u32 {
            sc.upsert(h, 1, 0, ZKey(h as u64), 0, h as f32 * 200.0, 50.0, 0.0, 100.0, 100.0);
            sc.set_geometry(h, Path::rect(&Box2d::from_xywh(0.0, 0.0, 100.0, 100.0)));
            sc.set_style(h, Style { fill: 0xff0000ff, stroke: 0, ..Style::default() });
        }
        sc.set_style(2, Style { fill: 0xff0000ff, stroke: 0x000000ff, stroke_width: 2.0, opacity: 0.5, texture: 42, ..Style::default() });
        let mut r = Renderer::new();
        let out = r.frame(&mut sc, &Box2d::from_xywh(0.0, 0.0, 1000.0, 1000.0), 1.0);
        assert_eq!(out.drawn, 3);
        // batches: solid(1) | textured quad(2) | stroke(2) + solid(3)
        assert_eq!(out.batches.len(), 3 * BATCH_WORDS);
        assert_eq!(&out.batches[0..7], &batch(0, 6, 0, NO_CLIP)[..]);
        assert_eq!(&out.batches[7..14], &batch(6, 6, 42, NO_CLIP)[..]);
        assert_eq!(out.batches[14], 12);
        assert_eq!(out.batches[16], 0);
        let total = out.indices.len() as u32;
        assert_eq!(out.batches[14] + out.batches[15], total);
        // the textured quad: 4 vertices with uv corners, white × opacity
        let quad = &out.vertices[4 * VERTEX_FLOATS..8 * VERTEX_FLOATS];
        let v = |k: usize| &quad[k * VERTEX_FLOATS..(k + 1) * VERTEX_FLOATS];
        assert_eq!(v(0), &[400.0, 50.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.5]);
        assert_eq!(v(1), &[500.0, 50.0, 1.0, 0.0, 1.0, 1.0, 1.0, 0.5]);
        assert_eq!(v(2), &[500.0, 150.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.5]);
        assert_eq!(v(3), &[400.0, 150.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.5]);
        assert_eq!(&out.indices[6..12], &[4, 5, 6, 4, 6, 7]);
    }

    #[test]
    fn consecutive_same_texture_shapes_share_a_batch() {
        let mut sc = Scene::new();
        for h in 1..=2u32 {
            sc.upsert(h, 1, 0, ZKey(h as u64), 0, h as f32 * 200.0, 0.0, 0.0, 100.0, 100.0);
            sc.set_geometry(h, Path::rect(&Box2d::from_xywh(0.0, 0.0, 100.0, 100.0)));
            sc.set_style(h, Style { fill: 0, stroke: 0, texture: 9, ..Style::default() });
        }
        let mut r = Renderer::new();
        let out = r.frame(&mut sc, &Box2d::from_xywh(0.0, 0.0, 1000.0, 1000.0), 1.0);
        assert_eq!(out.batches, batch(0, 12, 9, NO_CLIP));
        assert_eq!(out.vertices.len(), 8 * VERTEX_FLOATS);
    }

    #[test]
    fn textured_quad_follows_rotation() {
        let mut sc = Scene::new();
        sc.upsert(1, 1, 0, ZKey(1), 0, 0.0, 0.0, core::f32::consts::FRAC_PI_2, 100.0, 50.0);
        sc.set_geometry(1, Path::rect(&Box2d::from_xywh(0.0, 0.0, 100.0, 50.0)));
        sc.set_style(1, Style { stroke: 0, texture: 1, ..Style::default() });
        let mut r = Renderer::new();
        let out = r.frame(&mut sc, &Box2d::from_xywh(-500.0, -500.0, 1000.0, 1000.0), 1.0);
        // local (100, 0) rotates to page (0, 100)
        assert!((out.vertices[VERTEX_FLOATS] - 0.0).abs() < 1e-4);
        assert!((out.vertices[VERTEX_FLOATS + 1] - 100.0).abs() < 1e-4);
        assert_eq!(&out.vertices[VERTEX_FLOATS + 2..VERTEX_FLOATS + 4], &[1.0, 0.0]);
    }

    #[test]
    fn clipped_children_get_clip_words_and_split_batches() {
        let mut sc = Scene::new();
        let rect = Path::rect(&Box2d::from_xywh(0.0, 0.0, 100.0, 100.0));
        let solid = Style { fill: 0xff0000ff, stroke: 0, ..Style::default() };
        // unclipped root shape
        sc.upsert(1, 1, 0, ZKey(1), 0, 0.0, 0.0, 0.0, 100.0, 100.0);
        sc.set_geometry(1, rect.clone());
        sc.set_style(1, solid);
        // frame with clip at (200, 0) 300x300 — it is not clipped itself
        sc.upsert(2, 1, 0, ZKey(2), FLAG_CLIP, 200.0, 0.0, 0.0, 300.0, 300.0);
        sc.set_geometry(2, Path::rect(&Box2d::from_xywh(0.0, 0.0, 300.0, 300.0)));
        sc.set_style(2, solid);
        // child of the frame, half outside → still drawn, with the frame's clip
        sc.upsert(3, 1, 2, ZKey(1), 0, 250.0, 0.0, 0.0, 100.0, 100.0);
        sc.set_geometry(3, rect.clone());
        sc.set_style(3, solid);
        // child fully outside the frame → culled
        sc.upsert(4, 1, 2, ZKey(2), 0, 1000.0, 0.0, 0.0, 100.0, 100.0);
        sc.set_geometry(4, rect.clone());
        sc.set_style(4, solid);
        // overlay child carries the clip too
        sc.upsert(5, 1, 2, ZKey(3), FLAG_OVERLAY, 10.0, 10.0, 0.0, 20.0, 20.0);
        let mut r = Renderer::new();
        let out = r.frame(&mut sc, &Box2d::from_xywh(-100.0, -100.0, 3000.0, 3000.0), 1.0);
        let frame_rect = Box2d::from_xywh(200.0, 0.0, 300.0, 300.0);
        assert_eq!(out.drawn, 3);
        assert_eq!(out.culled, 1);
        let mut expect = batch(0, 12, 0, NO_CLIP);
        expect.extend(batch(12, 6, 0, bits(&frame_rect)));
        assert_eq!(out.batches, expect);
        assert_eq!(out.overlay.len(), OVERLAY_WORDS);
        assert_eq!(out.overlay[0], 5);
        assert_eq!(&out.overlay[6..10], &bits(&frame_rect));
    }

    #[test]
    fn lod_quads_respect_clip() {
        let mut sc = Scene::new();
        sc.upsert(1, 1, 0, ZKey(1), FLAG_CLIP, 0.0, 0.0, 0.0, 300.0, 300.0);
        sc.upsert(2, 1, 1, ZKey(1), 0, 10.0, 10.0, 0.0, 100.0, 100.0);
        sc.set_geometry(2, Path::rect(&Box2d::from_xywh(0.0, 0.0, 100.0, 100.0)));
        sc.set_style(2, Style { fill: 0xff0000ff, stroke: 0, ..Style::default() });
        let mut r = Renderer::new();
        let vp = Box2d::from_xywh(-1000.0, -1000.0, 3000.0, 3000.0);
        // the frame itself has no geometry (empty path → no mesh); child is a 2 px quad
        let out = r.frame(&mut sc, &vp, 0.02);
        let clip = Box2d::from_xywh(0.0, 0.0, 300.0, 300.0);
        assert_eq!(out.indices.len(), 6);
        assert_eq!(out.batches, batch(0, 6, 0, bits(&clip)));
    }
}
