//! Per-frame assembly of GPU buffers.

use crate::tess::{tessellate, MeshCache, MeshPart};
use mocanvas_geo::{Box2d, Mat2d};
use mocanvas_scene::{unpack_rgba, Scene, Slot, FLAG_LABEL, FLAG_OVERLAY};

/// Floats per vertex: `x y r g b a`.
pub const VERTEX_FLOATS: usize = 6;

/// Buffers produced by [`Renderer::frame`]. All slices are valid until the next frame.
#[derive(Default, Debug)]
pub struct FrameOutput {
    /// Interleaved vertices, page space, premultiplied alpha not applied (shader does it).
    pub vertices: Vec<f32>,
    /// Triangle indices.
    pub indices: Vec<u32>,
    /// `(first_index, index_count, texture)` triples. Texture 0 = solid color.
    pub batches: Vec<u32>,
    /// Overlay shapes: `handle, x, y, w, h, rot` per entry (floats as bits) in draw order,
    /// with `x y w h` the page-space bounds and `rot` the page rotation.
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

/// Owns the mesh cache and frame output.
#[derive(Default)]
pub struct Renderer {
    meshes: Vec<Option<MeshCache>>,
    visible: Vec<Slot>,
    /// Frame output.
    pub out: FrameOutput,
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

    /// Build the frame for a page-space viewport.
    pub fn frame(&mut self, scene: &mut Scene, viewport: &Box2d) -> &FrameOutput {
        self.out.clear();
        scene.visible_slots(viewport, &mut self.visible);
        self.out.culled = (scene.len() as u32).saturating_sub(self.visible.len() as u32);
        if self.meshes.len() < scene_capacity(scene) {
            self.meshes.resize_with(scene_capacity(scene), || None);
        }

        let mut batch_start = 0u32;
        for &slot in &self.visible {
            let sh = scene.shape_at(slot);
            if sh.flags & (FLAG_OVERLAY | FLAG_LABEL) != 0 {
                let b = sh.page_bounds;
                self.out.overlay.push(sh.handle);
                self.out.overlay.push(b.min.x.to_bits());
                self.out.overlay.push(b.min.y.to_bits());
                self.out.overlay.push(b.width().to_bits());
                self.out.overlay.push(b.height().to_bits());
                self.out.overlay.push(sh.page_transform.rotation().to_bits());
                if sh.flags & FLAG_OVERLAY != 0 {
                    continue;
                }
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
            if !mesh.fill.is_empty() {
                append(&mut self.out, &mesh.fill, &xf, unpack_rgba(sh.style.fill, op));
            }
            if !mesh.stroke.is_empty() {
                append(&mut self.out, &mesh.stroke, &xf, unpack_rgba(sh.style.stroke, op));
            }
            self.out.drawn += 1;
        }
        let total = self.out.indices.len() as u32;
        if total > batch_start {
            self.out.batches.extend_from_slice(&[batch_start, total - batch_start, 0]);
            batch_start = total;
        }
        let _ = batch_start;
        &self.out
    }
}

fn scene_capacity(scene: &Scene) -> usize {
    scene.slots().map(|s| s as usize + 1).max().unwrap_or(0)
}

#[inline]
fn append(out: &mut FrameOutput, part: &MeshPart, xf: &Mat2d, rgba: [f32; 4]) {
    let base = (out.vertices.len() / VERTEX_FLOATS) as u32;
    out.vertices.reserve(part.positions.len() * 3);
    for xy in part.positions.as_chunks::<2>().0 {
        let (x, y) = (xy[0], xy[1]);
        let px = xf.a * x + xf.c * y + xf.e;
        let py = xf.b * x + xf.d * y + xf.f;
        out.vertices.extend_from_slice(&[px, py, rgba[0], rgba[1], rgba[2], rgba[3]]);
    }
    out.indices.extend(part.indices.iter().map(|&i| i + base));
}

#[cfg(test)]
mod tests {
    use super::*;
    use mocanvas_geo::Path;
    use mocanvas_scene::{Style, ZKey};

    #[test]
    fn frame_culls_and_batches() {
        let mut sc = Scene::new();
        for h in 1..=10u32 {
            sc.upsert(h, 1, 0, ZKey(h as u64), 0, h as f32 * 1000.0, 0.0, 0.0, 100.0, 100.0);
            sc.set_geometry(h, Path::rect(&Box2d::from_xywh(0.0, 0.0, 100.0, 100.0)));
            sc.set_style(h, Style { fill: 0xff0000ff, stroke: 0, ..Style::default() });
        }
        let mut r = Renderer::new();
        let out = r.frame(&mut sc, &Box2d::from_xywh(900.0, -10.0, 2200.0, 200.0));
        assert_eq!(out.drawn, 3);
        assert_eq!(out.culled, 7);
        assert_eq!(out.indices.len(), 18);
        assert_eq!(out.vertices.len(), 12 * VERTEX_FLOATS);
        assert_eq!(out.batches, vec![0, 18, 0]);
        // second frame reuses meshes (no panic, same output)
        let out2 = r.frame(&mut sc, &Box2d::from_xywh(900.0, -10.0, 2200.0, 200.0));
        assert_eq!(out2.indices.len(), 18);
    }

    #[test]
    fn overlay_shapes_skip_gpu() {
        let mut sc = Scene::new();
        sc.upsert(1, 1, 0, ZKey(1), FLAG_OVERLAY, 10.0, 20.0, 0.0, 100.0, 50.0);
        let mut r = Renderer::new();
        let out = r.frame(&mut sc, &Box2d::from_xywh(0.0, 0.0, 500.0, 500.0));
        assert_eq!(out.drawn, 0);
        assert_eq!(out.overlay.len(), 6);
        assert_eq!(out.overlay[0], 1);
        assert_eq!(f32::from_bits(out.overlay[1]), 10.0);
        assert_eq!(f32::from_bits(out.overlay[3]), 100.0);
    }
}
