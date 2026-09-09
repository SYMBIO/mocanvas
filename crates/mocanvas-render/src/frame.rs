//! Per-frame assembly of GPU buffers.

use crate::tess::{tessellate, MeshCache, MeshPart};
use mocanvas_geo::{Box2d, Mat2d};
use mocanvas_scene::{unpack_rgba, Scene, ShapeRef, Slot, FLAG_LABEL, FLAG_OVERLAY};

/// Floats per vertex: `x y u v r g b a`.
pub const VERTEX_FLOATS: usize = 8;
/// `u32` words per batch: `first_index index_count texture clip_minx clip_miny
/// clip_maxx clip_maxy isolate`.
pub const BATCH_WORDS: usize = 8;
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
    /// clip_miny, clip_maxx, clip_maxy, isolate` (clip words are f32 bits; all four zero
    /// = no clip). Texture 0 = solid color. `isolate` is 0 for an ordinary batch and
    /// otherwise the group id described on [`Batcher`]. A new batch starts whenever the
    /// texture, the clip rect or the group changes.
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
    /// 0 for an ordinary batch; otherwise the shape's isolation group, which the
    /// backend paints once per pixel. See [`isolation_group`].
    isolate: u32,
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
            let key = self.key.unwrap_or(BatchKey { texture: 0, clip: [0; 4], isolate: 0 });
            out.batches.extend_from_slice(&[self.start, total - self.start, key.texture]);
            out.batches.extend_from_slice(&key.clip);
            out.batches.push(key.isolate);
            self.start = total;
        }
    }
}

/// What the last build was valid for. The vertex buffer holds page-space
/// geometry, so the camera does not appear here: only the scene contents, the
/// padded viewport the visible set was gathered for, and the zoom bucket that
/// decided level of detail.
#[derive(Clone, Copy, Debug)]
struct Built {
    epoch: u64,
    padded: Box2d,
    zoom_bucket: i32,
    /// Area of the live viewport when this was built, so a camera that has since
    /// zoomed in far enough to make the build wasteful can be spotted.
    viewport_area: f32,
}

/// Owns the mesh cache and frame output.
#[derive(Default)]
pub struct Renderer {
    meshes: Vec<Option<MeshCache>>,
    /// Per-slot level-of-detail state (`true` = currently drawn as a quad), so the
    /// threshold can have hysteresis instead of flipping every frame at the boundary.
    lod_quad: Vec<bool>,
    visible: Vec<Slot>,
    /// Frame output.
    pub out: FrameOutput,
    batcher: Batcher,
    built: Option<Built>,
    version: u64,
    dirty: bool,
    pending: bool,
    viewport_pad: f32,
}

impl Renderer {
    /// New renderer.
    pub fn new() -> Self {
        Self { viewport_pad: DEFAULT_VIEWPORT_PAD, ..Self::default() }
    }

    /// Grow the box each frame is built for by `pad` (a fraction of the viewport size)
    /// on every side, so a camera panning inside that margin can reuse the build
    /// instead of re-tessellating and re-uploading.
    ///
    /// It defaults to `0` because the pad is not free: `(1 + 2 * pad)²` more geometry
    /// is submitted on *every* frame in exchange for skipping the upload on some of
    /// them. Whether that pays depends on the ratio of the host's per-triangle cost to
    /// its per-byte upload cost. Measured in headless Chromium on SwiftShader (see
    /// `docs/BENCHMARK.md` for that environment): uploading a 5.4 MB frame costs
    /// 0.4 ms while drawing its 50k triangles costs 36 ms, so there any pad is a large
    /// net loss. On hardware, where the upload is the expensive half, values around
    /// 0.25 are worth it. Reuse is additionally capped by the area the build covers
    /// relative to the live viewport, so a pad above ~0.05 only helps panning, not
    /// zooming.
    pub fn set_viewport_pad(&mut self, pad: f32) {
        let pad = if pad.is_finite() { pad.max(0.0) } else { 0.0 };
        if pad != self.viewport_pad {
            self.viewport_pad = pad;
            self.built = None;
        }
    }

    /// The current viewport pad.
    pub fn viewport_pad(&self) -> f32 {
        self.viewport_pad
    }

    /// Drop the cached mesh for a slot (call on remove).
    pub fn invalidate(&mut self, slot: Slot) {
        if let Some(m) = self.meshes.get_mut(slot as usize) {
            *m = None;
        }
        if let Some(q) = self.lod_quad.get_mut(slot as usize) {
            *q = false;
        }
        self.built = None;
    }

    /// Drop every cached mesh.
    pub fn clear(&mut self) {
        self.meshes.clear();
        self.lod_quad.clear();
        self.built = None;
    }

    /// Monotonically increasing counter, bumped every time the buffers are rebuilt.
    /// A host that has already uploaded version `v` can skip the upload while this
    /// still reads `v`.
    pub fn frame_version(&self) -> u64 {
        self.version
    }

    /// Whether the last [`Renderer::frame`] call rebuilt the buffers.
    pub fn frame_dirty(&self) -> bool {
        self.dirty
    }

    /// Whether shapes were deferred by the tessellation budget and are still drawn as
    /// placeholder quads. The host should keep scheduling frames until this is false.
    pub fn tessellation_pending(&self) -> bool {
        self.pending
    }

    /// Build the frame for a page-space viewport at a camera zoom (screen px per page unit).
    ///
    /// The buffers are camera-independent (the shader applies the camera), so this
    /// reuses the previous build whenever the scene has not changed, the viewport is
    /// still inside the padded box the last build covered, and the zoom is in the same
    /// √2 bucket. In that case the output is returned untouched and
    /// [`Renderer::frame_dirty`] reports `false`.
    ///
    /// `tess_budget` caps how many shapes may be tessellated in this call; shapes past
    /// the cap are drawn as level-of-detail quads and picked up by a later frame, with
    /// [`Renderer::tessellation_pending`] set meanwhile. Pass [`usize::MAX`] for no cap.
    pub fn frame(&mut self, scene: &mut Scene, viewport: &Box2d, zoom: f32, tess_budget: usize) -> &FrameOutput {
        let zoom = zoom.max(1e-6);
        let bucket = zoom_bucket(zoom);
        if !self.pending {
            if let Some(b) = self.built {
                if b.epoch == scene.epoch() && b.zoom_bucket == bucket && b.padded.contains_box(viewport) && viewport.area() >= b.viewport_area * REUSE_MIN_VIEWPORT_FRACTION {
                    self.dirty = false;
                    return &self.out;
                }
            }
        }
        self.build(scene, viewport, zoom, bucket, tess_budget);
        &self.out
    }

    fn build(&mut self, scene: &mut Scene, viewport: &Box2d, zoom: f32, bucket: i32, tess_budget: usize) {
        let padded = padded_viewport(viewport, self.viewport_pad);
        self.out.clear();
        self.batcher.reset();
        scene.visible_slots(&padded, &mut self.visible);
        self.out.culled = (scene.len() as u32).saturating_sub(self.visible.len() as u32);
        let cap = scene_capacity(scene);
        if self.meshes.len() < cap {
            self.meshes.resize_with(cap, || None);
        }
        if self.lod_quad.len() < cap {
            self.lod_quad.resize(cap, false);
        }
        let mut tess_used = 0usize;
        // Isolation groups are numbered from 1 within the frame; see `isolation_group`.
        let mut isolate_next = 0u32;
        let mut deferred = 0usize;

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
            // single quad in their dominant color instead of a full mesh. The threshold
            // has hysteresis (enter below `LOD_QUAD_PX`, leave above `LOD_MESH_PX`) so a
            // shape hovering at the boundary does not flip on every zoom step. Entering
            // or leaving quad mode never touches the cached mesh.
            let i = slot as usize;
            let screen_size = pb.width().max(pb.height()) * zoom;
            let quad = if self.lod_quad[i] { screen_size < LOD_MESH_PX } else { screen_size < LOD_QUAD_PX };
            self.lod_quad[i] = quad;
            if quad {
                if screen_size >= LOD_MIN_PX {
                    lod_quad_for(&mut self.batcher, &mut self.out, &sh, pb, clip_bits);
                } else {
                    self.out.culled += 1;
                }
                continue;
            }
            // Re-tessellate when the geometry changed OR when the camera has moved
            // into a different zoom bucket: curves are flattened to a screen-space
            // tolerance, so a mesh built for one bucket is visibly faceted in a
            // closer one.
            let needs = match &self.meshes[i] {
                Some(m) => m.geom_version != sh.geom_version || m.zoom_bucket != bucket,
                None => true,
            };
            if needs {
                // Over the per-frame tessellation budget: stand in with a quad and pick
                // this shape up on a later frame, keeping the frame marked pending.
                if tess_used >= tess_budget {
                    deferred += 1;
                    if screen_size >= LOD_MIN_PX {
                        lod_quad_for(&mut self.batcher, &mut self.out, &sh, pb, clip_bits);
                    } else {
                        self.out.culled += 1;
                    }
                    continue;
                }
                self.meshes[i] = Some(tessellate(sh.path, sh.style, sh.geom_version, bucket_zoom(bucket), bucket));
                tess_used += 1;
            }
            let mesh = self.meshes[i].as_ref().unwrap();
            let xf = *sh.page_transform;
            let op = sh.style.opacity;
            if sh.style.has_texture() {
                self.batcher.begin(&mut self.out, BatchKey { texture: sh.style.texture, clip: clip_bits, isolate: 0 });
                append_textured_quad(&mut self.out, &sh, &xf, [1.0, 1.0, 1.0, op]);
            } else if !mesh.fill.is_empty() {
                self.batcher.begin(&mut self.out, BatchKey { texture: 0, clip: clip_bits, isolate: 0 });
                append(&mut self.out, &mesh.fill, &xf, unpack_rgba(sh.style.fill, op));
            }
            if !mesh.stroke.is_empty() {
                let isolate = if isolation_group(&sh, mesh) {
                    isolate_next += 1;
                    isolate_next
                } else {
                    0
                };
                self.batcher.begin(&mut self.out, BatchKey { texture: 0, clip: clip_bits, isolate });
                append(&mut self.out, &mesh.stroke, &xf, unpack_rgba(sh.style.stroke, op));
            }
            self.out.drawn += 1;
        }
        self.batcher.flush(&mut self.out);
        self.built = Some(Built { epoch: scene.epoch(), padded, zoom_bucket: bucket, viewport_area: viewport.area() });
        self.version = self.version.wrapping_add(1);
        self.dirty = true;
        self.pending = deferred > 0;
    }
}

/// A shape enters quad level of detail below this screen size (px)…
pub const LOD_QUAD_PX: f32 = 4.0;
/// …and leaves it again only above this one. The gap is the hysteresis band.
pub const LOD_MESH_PX: f32 = 6.0;
/// Below this screen size (px) a shape is not drawn at all.
pub const LOD_MIN_PX: f32 = 0.75;
/// Shapes tessellated per frame by default before the rest are deferred.
pub const DEFAULT_TESS_BUDGET: usize = 256;
/// Default fraction of the viewport added on each side when a frame is built — see
/// [`Renderer::set_viewport_pad`] for why it is zero.
pub const DEFAULT_VIEWPORT_PAD: f32 = 0.0;
/// A build is dropped once the viewport has shrunk to less than this fraction of what
/// it covered when the build was made. Without it a zoom-in keeps re-drawing a buffer
/// built for the whole zoomed-out page: correct, but far more geometry than the camera
/// can see, and geometry is the expensive half of a frame.
const REUSE_MIN_VIEWPORT_FRACTION: f32 = 0.66;

/// The viewport grown by `pad` (a fraction of its size) on every side.
fn padded_viewport(vp: &Box2d, pad: f32) -> Box2d {
    if pad <= 0.0 {
        return *vp;
    }
    let px = vp.width() * pad;
    let py = vp.height() * pad;
    Box2d::from_min_max(vp.min.x - px, vp.min.y - py, vp.max.x + px, vp.max.y + py)
}

/// Zoom bucketed in √2 steps: level of detail only has to be revisited when this changes.
fn zoom_bucket(zoom: f32) -> i32 {
    (zoom.log2() * 2.0).floor() as i32
}

/// The zoom a bucket is tessellated for: its upper end, so the mesh is fine
/// enough everywhere inside the bucket rather than only at its coarse edge.
fn bucket_zoom(bucket: i32) -> f32 {
    2f32.powf((bucket + 1) as f32 / 2.0)
}

/// Whether this shape's stroke has to be painted once per pixel rather than
/// blended per triangle.
///
/// Every other renderer treats a shape's opacity as a *group*: the mark is
/// rasterized whole, then made see-through. We bake the alpha into the vertices
/// instead, so wherever a stroke ribbon crosses itself the pixel is blended
/// twice and the crossing comes out darker than the stroke around it. On a
/// 3.5-unit pen nobody notices; on a highlighter, whose whole job is a wide even
/// wash, every kink in the stroke shows as a dark knot.
///
/// Only a mark that is a *single* colour can be fixed this way, which is what
/// the conditions below come to: painting each pixel once is the same as
/// compositing the group exactly when the group has one member. A stroke over a
/// fill is a group of two, and painting once would drop the stroke wherever it
/// covers its own fill instead of laying it on top — so a filled shape keeps the
/// per-triangle blend, and its overlaps stay as they were.
#[inline]
fn isolation_group(sh: &ShapeRef<'_>, mesh: &MeshCache) -> bool {
    sh.style.opacity < 1.0 && mesh.fill.is_empty() && !sh.style.has_texture()
}

/// Append one flat quad over the shape's page bounds in its dominant color.
#[inline]
fn lod_quad_for(batcher: &mut Batcher, out: &mut FrameOutput, sh: &ShapeRef<'_>, pb: &Box2d, clip_bits: [u32; 4]) {
    let color = if sh.style.has_fill() { sh.style.fill } else { sh.style.stroke };
    let rgba = unpack_rgba(color, sh.style.opacity);
    batcher.begin(out, BatchKey { texture: 0, clip: clip_bits, isolate: 0 });
    append_quad(out, pb, rgba);
    out.drawn += 1;
}

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
        batch_in_group(first, count, texture, clip, 0)
    }

    fn batch_in_group(first: u32, count: u32, texture: u32, clip: [u32; 4], isolate: u32) -> Vec<u32> {
        let mut v = vec![first, count, texture];
        v.extend_from_slice(&clip);
        v.push(isolate);
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
        let out = r.frame(&mut sc, &Box2d::from_xywh(900.0, -10.0, 2200.0, 200.0), 1.0, usize::MAX);
        assert_eq!(out.drawn, 3);
        assert_eq!(out.culled, 7);
        assert_eq!(out.indices.len(), 18);
        assert_eq!(out.vertices.len(), 12 * VERTEX_FLOATS);
        assert_eq!(out.batches, batch(0, 18, 0, NO_CLIP));
        // solid geometry carries u = v = 0
        assert_eq!(&out.vertices[2..4], &[0.0, 0.0]);
        // second frame reuses meshes (no panic, same output)
        let out2 = r.frame(&mut sc, &Box2d::from_xywh(900.0, -10.0, 2200.0, 200.0), 1.0, usize::MAX);
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
        let full = r.frame(&mut sc, &vp, 1.0, usize::MAX).indices.len();
        assert!(full > 6);
        // 100 page units * 0.02 zoom = 2 px → quad
        let quad = r.frame(&mut sc, &vp, 0.02, usize::MAX);
        assert_eq!(quad.indices.len(), 6);
        assert_eq!(quad.drawn, 1);
        // 0.005 zoom = 0.5 px → dropped
        let gone = r.frame(&mut sc, &vp, 0.005, usize::MAX);
        assert_eq!(gone.indices.len(), 0);
        assert_eq!(gone.culled, 1);
    }

    #[test]
    fn overlay_shapes_skip_gpu() {
        let mut sc = Scene::new();
        sc.upsert(1, 1, 0, ZKey(1), FLAG_OVERLAY, 10.0, 20.0, 0.0, 100.0, 50.0);
        let mut r = Renderer::new();
        let out = r.frame(&mut sc, &Box2d::from_xywh(0.0, 0.0, 500.0, 500.0), 1.0, usize::MAX);
        assert_eq!(out.drawn, 0);
        assert_eq!(out.overlay.len(), OVERLAY_WORDS);
        assert_eq!(out.overlay[0], 1);
        assert_eq!(f32::from_bits(out.overlay[1]), 10.0);
        assert_eq!(f32::from_bits(out.overlay[3]), 100.0);
        assert_eq!(&out.overlay[6..10], &NO_CLIP);
    }

    #[test]
    fn a_translucent_stroke_is_given_its_own_isolation_group() {
        // Three stroke-only shapes: opaque, translucent, translucent. Only the two
        // translucent ones ask to be painted once per pixel, and they ask under
        // different group numbers so the backend keeps them apart.
        let mut sc = Scene::new();
        for h in 1..=3u32 {
            sc.upsert(h, 1, 0, ZKey(h as u64), 0, h as f32 * 200.0, 50.0, 0.0, 100.0, 100.0);
            sc.set_geometry(h, Path::rect(&Box2d::from_xywh(0.0, 0.0, 100.0, 100.0)));
            let opacity = if h == 1 { 1.0 } else { 0.5 };
            sc.set_style(h, Style { fill: 0, stroke: 0x000000ff, stroke_width: 4.0, opacity, ..Style::default() });
        }
        let mut r = Renderer::new();
        let out = r.frame(&mut sc, &Box2d::from_xywh(0.0, 0.0, 1000.0, 1000.0), 1.0, usize::MAX);
        assert_eq!(out.drawn, 3);
        let groups: Vec<u32> = out.batches.chunks(BATCH_WORDS).map(|b| b[BATCH_WORDS - 1]).collect();
        assert_eq!(groups, vec![0, 1, 2]);
    }

    #[test]
    fn a_filled_shape_keeps_the_per_triangle_blend() {
        // A stroke over a fill is a group of two; painting each pixel once would
        // drop the stroke wherever it covers its own fill.
        let mut sc = Scene::new();
        sc.upsert(1, 1, 0, ZKey(1), 0, 0.0, 0.0, 0.0, 100.0, 100.0);
        sc.set_geometry(1, Path::rect(&Box2d::from_xywh(0.0, 0.0, 100.0, 100.0)));
        sc.set_style(1, Style { fill: 0xff0000ff, stroke: 0x000000ff, stroke_width: 4.0, opacity: 0.5, ..Style::default() });
        let mut r = Renderer::new();
        let out = r.frame(&mut sc, &Box2d::from_xywh(0.0, 0.0, 1000.0, 1000.0), 1.0, usize::MAX);
        for b in out.batches.chunks(BATCH_WORDS) {
            assert_eq!(b[BATCH_WORDS - 1], 0);
        }
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
        let out = r.frame(&mut sc, &Box2d::from_xywh(0.0, 0.0, 1000.0, 1000.0), 1.0, usize::MAX);
        assert_eq!(out.drawn, 3);
        // batches: solid(1) | textured quad(2) | stroke(2) + solid(3)
        assert_eq!(out.batches.len(), 3 * BATCH_WORDS);
        assert_eq!(&out.batches[0..8], &batch(0, 6, 0, NO_CLIP)[..]);
        assert_eq!(&out.batches[8..16], &batch(6, 6, 42, NO_CLIP)[..]);
        assert_eq!(out.batches[16], 12);
        assert_eq!(out.batches[18], 0);
        let total = out.indices.len() as u32;
        assert_eq!(out.batches[16] + out.batches[17], total);
        // A textured shape is never isolated, translucent or not: the quad and the
        // stroke are two members, so painting once would drop one of them.
        assert_eq!(out.batches[7], 0);
        assert_eq!(out.batches[15], 0);
        assert_eq!(out.batches[23], 0);
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
        let out = r.frame(&mut sc, &Box2d::from_xywh(0.0, 0.0, 1000.0, 1000.0), 1.0, usize::MAX);
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
        let out = r.frame(&mut sc, &Box2d::from_xywh(-500.0, -500.0, 1000.0, 1000.0), 1.0, usize::MAX);
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
        let out = r.frame(&mut sc, &Box2d::from_xywh(-100.0, -100.0, 3000.0, 3000.0), 1.0, usize::MAX);
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

    /// A grid of `n` filled rects, 100×100 page units, 200 apart on x.
    fn grid(n: u32) -> Scene {
        let mut sc = Scene::new();
        for h in 1..=n {
            sc.upsert(h, 1, 0, ZKey(h as u64), 0, h as f32 * 200.0, 0.0, 0.0, 100.0, 100.0);
            sc.set_geometry(h, Path::rect(&Box2d::from_xywh(0.0, 0.0, 100.0, 100.0)));
            sc.set_style(h, Style { fill: 0xff0000ff, stroke: 0, ..Style::default() });
        }
        sc
    }

    #[test]
    fn unchanged_scene_and_camera_reuse_the_buffers() {
        let mut sc = grid(6);
        let mut r = Renderer::new();
        let vp = Box2d::from_xywh(0.0, 0.0, 1400.0, 400.0);
        let first = r.frame(&mut sc, &vp, 1.0, usize::MAX);
        let (v, i, b) = (first.vertices.clone(), first.indices.clone(), first.batches.clone());
        assert!(r.frame_dirty());
        let version = r.frame_version();

        let again = r.frame(&mut sc, &vp, 1.0, usize::MAX);
        assert_eq!(again.vertices, v);
        assert_eq!(again.indices, i);
        assert_eq!(again.batches, b);
        assert!(!r.frame_dirty(), "second frame must report the buffers unchanged");
        assert_eq!(r.frame_version(), version, "version must not move without a rebuild");

        // Any scene mutation invalidates it again.
        sc.set_style(1, Style { fill: 0x00ff00ff, stroke: 0, ..Style::default() });
        r.frame(&mut sc, &vp, 1.0, usize::MAX);
        assert!(r.frame_dirty());
        assert_eq!(r.frame_version(), version + 1);
    }

    #[test]
    fn small_pan_reuses_the_padded_build_and_a_large_one_rebuilds() {
        let mut sc = grid(20);
        let mut r = Renderer::new();
        // A hardware-GPU style configuration: pad the build so panning can reuse it.
        r.set_viewport_pad(0.25);
        let vp = Box2d::from_xywh(0.0, 0.0, 1000.0, 400.0);
        r.frame(&mut sc, &vp, 1.0, usize::MAX);
        let version = r.frame_version();

        // Well inside the 25% pad (250 page units on each side of a 1000-wide viewport).
        r.frame(&mut sc, &Box2d::from_xywh(100.0, 0.0, 1000.0, 400.0), 1.0, usize::MAX);
        assert!(!r.frame_dirty(), "a small pan must reuse the padded build");
        assert_eq!(r.frame_version(), version);

        // Past the pad: rebuild.
        r.frame(&mut sc, &Box2d::from_xywh(400.0, 0.0, 1000.0, 400.0), 1.0, usize::MAX);
        assert!(r.frame_dirty(), "a pan past the padded box must rebuild");
        assert_eq!(r.frame_version(), version + 1);

        // A zoom change of more than a √2 bucket rebuilds too, even in place.
        let version = r.frame_version();
        r.frame(&mut sc, &Box2d::from_xywh(400.0, 0.0, 1000.0, 400.0), 1.05, usize::MAX);
        assert!(!r.frame_dirty(), "a zoom nudge inside the bucket must reuse");
        r.frame(&mut sc, &Box2d::from_xywh(400.0, 0.0, 900.0, 360.0), 2.0, usize::MAX);
        assert!(r.frame_dirty(), "crossing a zoom bucket must rebuild");
        assert_eq!(r.frame_version(), version + 1);
    }

    #[test]
    fn tessellation_budget_defers_shapes_to_later_frames() {
        let mut sc = grid(4);
        let mut r = Renderer::new();
        let vp = Box2d::from_xywh(0.0, 0.0, 1400.0, 400.0);
        let full = {
            let mut r2 = Renderer::new();
            r2.frame(&mut sc, &vp, 1.0, usize::MAX).indices.len()
        };
        // 4 rects: each mesh is 2 triangles, so a quad stand-in has the same index
        // count — compare vertex counts, where a mesh and a quad differ, plus the
        // pending flag.
        let first = r.frame(&mut sc, &vp, 1.0, 1);
        assert_eq!(first.drawn, 4, "deferred shapes are still drawn, as quads");
        assert!(r.tessellation_pending(), "three shapes are still waiting");

        let mut frames = 1;
        while r.tessellation_pending() {
            r.frame(&mut sc, &vp, 1.0, 1);
            frames += 1;
            assert!(frames < 16, "budget backlog never cleared");
        }
        assert_eq!(frames, 4, "one shape per frame with a budget of 1");
        let done = r.frame(&mut sc, &vp, 1.0, 1);
        assert_eq!(done.indices.len(), full, "the backlog resolves to the full mesh frame");
        assert!(!r.frame_dirty(), "with the backlog cleared the frame is cacheable again");
    }

    #[test]
    fn pending_frames_are_always_rebuilt() {
        let mut sc = grid(3);
        let mut r = Renderer::new();
        let vp = Box2d::from_xywh(0.0, 0.0, 1400.0, 400.0);
        r.frame(&mut sc, &vp, 1.0, 1);
        let v = r.frame_version();
        r.frame(&mut sc, &vp, 1.0, 1);
        assert!(r.frame_dirty(), "a pending backlog must beat the reuse fast path");
        assert_eq!(r.frame_version(), v + 1);
    }

    #[test]
    fn lod_threshold_has_hysteresis() {
        // An ellipse, so its mesh is clearly more than the 2 triangles of a quad.
        let mut sc = Scene::new();
        sc.upsert(1, 1, 0, ZKey(1), 0, 0.0, 0.0, 0.0, 100.0, 100.0);
        sc.set_geometry(1, Path::ellipse(&Box2d::from_xywh(0.0, 0.0, 100.0, 100.0)));
        sc.set_style(1, Style { fill: 0xff0000ff, stroke: 0, ..Style::default() });
        let mut r = Renderer::new();
        let vp = Box2d::from_xywh(0.0, 0.0, 100_000.0, 100_000.0);
        // 100 page units: 5 px at zoom 0.05 — between the two thresholds.
        // Coming from a mesh (large) state it stays a mesh…
        // Index counts are compared against the 6 of a quad rather than against each
        // other: meshes are flattened per zoom bucket now, so two mesh states at
        // different zooms legitimately differ in triangle count. What this test is
        // about is which *state* the shape is in, not how finely it was tessellated.
        let mesh = r.frame(&mut sc, &vp, 1.0, usize::MAX).indices.len();
        assert!(mesh > 6);
        assert!(r.frame(&mut sc, &vp, 0.05, usize::MAX).indices.len() > 6, "5 px must not enter quad LOD");
        // …but once below 4 px it becomes a quad and stays one at 5 px.
        assert_eq!(r.frame(&mut sc, &vp, 0.03, usize::MAX).indices.len(), 6);
        assert_eq!(r.frame(&mut sc, &vp, 0.05, usize::MAX).indices.len(), 6, "5 px must not leave quad LOD");
        // Above 6 px it goes back to being a mesh…
        let reborn = r.frame(&mut sc, &vp, 0.08, usize::MAX).indices.len();
        assert!(reborn > 6);
        assert!(!r.tessellation_pending());
        // …and staying at that zoom reuses it: the second frame is not dirty and
        // draws the same triangles. (It is not compared to `mesh`, which was built
        // for a different zoom bucket and is legitimately a different size.)
        assert_eq!(r.frame(&mut sc, &vp, 0.08, usize::MAX).indices.len(), reborn);
        assert!(!r.frame_dirty());
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
        let out = r.frame(&mut sc, &vp, 0.02, usize::MAX);
        let clip = Box2d::from_xywh(0.0, 0.0, 300.0, 300.0);
        assert_eq!(out.indices.len(), 6);
        assert_eq!(out.batches, batch(0, 6, 0, bits(&clip)));
    }
}
