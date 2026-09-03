//! Spatial queries.

use crate::scene::{Scene, Slot, FLAG_HIDDEN, FLAG_LOCKED, FLAG_NO_FILL};
use crate::Handle;
use mocanvas_geo::hit::{dist2_point_segment, hit_test_path, point_in_polygon};
use mocanvas_geo::{Box2d, Vec2};
use rstar::AABB;

/// Which shapes a hit test may return.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct HitFilter {
    /// Include locked shapes.
    pub include_locked: bool,
    /// Include hidden shapes.
    pub include_hidden: bool,
    /// Treat every shape as hollow (outline only), e.g. for the eraser vs. select tool differences.
    pub hollow_only: bool,
}

impl HitFilter {
    /// Decode from bit flags used at the WASM boundary.
    pub fn from_bits(bits: u32) -> Self {
        Self {
            include_locked: bits & 1 != 0,
            include_hidden: bits & 2 != 0,
            hollow_only: bits & 4 != 0,
        }
    }
}

/// Box query semantics.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BoxQueryMode {
    /// Shape outline intersects or lies within the box.
    Intersects,
    /// Shape's page bounds lie fully within the box.
    Contains,
}

impl BoxQueryMode {
    /// Decode from the WASM boundary.
    pub fn from_u32(v: u32) -> Self {
        if v == 1 {
            Self::Contains
        } else {
            Self::Intersects
        }
    }
}

impl Scene {
    fn passes(&self, slot: Slot, f: &HitFilter) -> bool {
        let flags = self.shape_at(slot).flags;
        (f.include_hidden || flags & FLAG_HIDDEN == 0) && (f.include_locked || flags & FLAG_LOCKED == 0)
    }

    /// Topmost shape under a page point. `tolerance` is in page units.
    pub fn hit_test(&mut self, p: Vec2, tolerance: f32, filter: HitFilter) -> Handle {
        self.draw_order(); // ensure z ranks
        let env = AABB::from_corners([p.x - tolerance, p.y - tolerance], [p.x + tolerance, p.y + tolerance]);
        let mut best: Option<(u32, Handle)> = None;
        let candidates: Vec<Handle> = self.tree().locate_in_envelope_intersecting(&env).map(|g| g.data).collect();
        for h in candidates {
            let Some(slot) = self.slot(h) else { continue };
            if !self.passes(slot, &filter) {
                continue;
            }
            let rank = self.z_rank_of(slot);
            if let Some((br, _)) = best {
                if rank < br {
                    continue;
                }
            }
            let sh = self.shape_at(slot);
            let Some(local) = self.page_to_local(slot, p) else { continue };
            // Tolerance in local units (assumes uniform scale).
            let scale = sh.page_transform.scale_factors().x.max(1e-6);
            let tol_local = tolerance / scale + sh.style.stroke_width * 0.5;
            let filled = !filter.hollow_only && sh.flags & FLAG_NO_FILL == 0 && sh.style.has_fill();
            let hit = if sh.path.is_empty() {
                // No geometry: use nominal box.
                let b = Box2d::from_xywh(0.0, 0.0, sh.w, sh.h);
                filled && b.contains_point(local) || b.expand(tol_local).contains_point(local) && !b.expand(-tol_local).contains_point(local)
            } else {
                let r = hit_test_path(sh.path, local);
                (filled && r.inside) || r.dist2_to_outline <= tol_local * tol_local
            };
            if hit {
                best = Some((rank, h));
            }
        }
        best.map(|(_, h)| h).unwrap_or(0)
    }

    /// Shapes matching a page-space box, in draw order.
    pub fn query_box(&mut self, b: &Box2d, mode: BoxQueryMode, filter: HitFilter) -> Vec<Handle> {
        self.draw_order();
        let env = AABB::from_corners([b.min.x, b.min.y], [b.max.x, b.max.y]);
        let mut hits: Vec<(u32, Handle)> = Vec::new();
        let candidates: Vec<Handle> = self.tree().locate_in_envelope_intersecting(&env).map(|g| g.data).collect();
        for h in candidates {
            let Some(slot) = self.slot(h) else { continue };
            if !self.passes(slot, &filter) {
                continue;
            }
            let sh = self.shape_at(slot);
            let ok = match mode {
                BoxQueryMode::Contains => b.contains_box(sh.page_bounds),
                BoxQueryMode::Intersects => {
                    if b.contains_box(sh.page_bounds) {
                        true
                    } else {
                        outline_intersects_box(self, slot, b)
                    }
                }
            };
            if ok {
                hits.push((self.z_rank_of(slot), h));
            }
        }
        hits.sort_unstable_by_key(|&(r, _)| r);
        hits.into_iter().map(|(_, h)| h).collect()
    }

    /// Slots whose page bounds intersect the viewport, in draw order.
    pub fn visible_slots(&mut self, viewport: &Box2d, out: &mut Vec<Slot>) {
        self.draw_order();
        out.clear();
        let env = AABB::from_corners([viewport.min.x, viewport.min.y], [viewport.max.x, viewport.max.y]);
        for g in self.tree().locate_in_envelope_intersecting(&env) {
            if let Some(slot) = self.slot(g.data) {
                if self.shape_at(slot).flags & FLAG_HIDDEN == 0 {
                    out.push(slot);
                }
            }
        }
        out.sort_unstable_by_key(|&s| self.z_rank_of(s));
    }
}

/// Does the shape's flattened page-space outline touch the box?
fn outline_intersects_box(scene: &Scene, slot: Slot, b: &Box2d) -> bool {
    let sh = scene.shape_at(slot);
    let xf = *sh.page_transform;
    if sh.path.is_empty() {
        return Box2d::from_xywh(0.0, 0.0, sh.w, sh.h).transformed(&xf).intersects(b);
    }
    let corners = b.corners();
    let mut pts: Vec<Vec2> = Vec::with_capacity(64);
    let mut hit = false;
    let mut sub_start = 0usize;
    let check_sub = |pts: &[Vec2], closed: bool| -> bool {
        if pts.iter().any(|p| b.contains_point(*p)) {
            return true;
        }
        // Any segment crossing a box edge?
        for w in pts.windows(2) {
            for k in 0..4 {
                if segments_intersect(w[0], w[1], corners[k], corners[(k + 1) % 4]) {
                    return true;
                }
            }
        }
        // Box fully inside a closed filled outline?
        closed && sh.style.has_fill() && point_in_polygon(b.center(), pts)
    };
    sh.path.flatten(0.5, |p, new_sub| {
        if new_sub && pts.len() > sub_start {
            let s = &pts[sub_start..];
            if !hit && check_sub(s, s.len() > 2 && s.first() == s.last()) {
                hit = true;
            }
            sub_start = pts.len();
        }
        pts.push(xf.apply(p));
    });
    if !hit && pts.len() > sub_start {
        let s = &pts[sub_start..];
        if check_sub(s, s.len() > 2 && s.first() == s.last()) {
            hit = true;
        }
    }
    let _ = dist2_point_segment; // keep import for future tolerance-based variant
    hit
}

/// Proper segment intersection test (touching counts).
fn segments_intersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2) -> bool {
    fn orient(p: Vec2, q: Vec2, r: Vec2) -> f32 {
        (q - p).cross(r - p)
    }
    let d1 = orient(c, d, a);
    let d2 = orient(c, d, b);
    let d3 = orient(a, b, c);
    let d4 = orient(a, b, d);
    if ((d1 > 0.0) != (d2 > 0.0) || d1 == 0.0 || d2 == 0.0) && ((d3 > 0.0) != (d4 > 0.0) || d3 == 0.0 || d4 == 0.0) {
        // Collinear degenerate cases: check bounding overlap.
        if d1 == 0.0 && d2 == 0.0 && d3 == 0.0 && d4 == 0.0 {
            return Box2d::new(a, b).intersects(&Box2d::new(c, d));
        }
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Style, ZKey};
    use mocanvas_geo::Path;

    fn scene() -> Scene {
        let mut sc = Scene::new();
        sc.upsert(1, 1, 0, ZKey(1), 0, 0.0, 0.0, 0.0, 100.0, 100.0);
        sc.set_geometry(1, Path::rect(&Box2d::from_xywh(0.0, 0.0, 100.0, 100.0)));
        sc.set_style(1, Style { fill: 0xff0000ff, ..Style::default() });
        sc.upsert(2, 1, 0, ZKey(2), 0, 50.0, 50.0, 0.0, 100.0, 100.0);
        sc.set_geometry(2, Path::ellipse(&Box2d::from_xywh(0.0, 0.0, 100.0, 100.0)));
        sc.set_style(2, Style { fill: 0, ..Style::default() }); // hollow
        sc
    }

    #[test]
    fn hit_prefers_topmost_and_respects_hollow() {
        let mut sc = scene();
        // center of the ellipse (hollow) over rect 1 → rect 1 is hit (ellipse interior ignored)
        assert_eq!(sc.hit_test(Vec2::new(90.0, 90.0), 2.0, HitFilter::default()), 1);
        // ellipse outline at its leftmost point (50,100)
        assert_eq!(sc.hit_test(Vec2::new(50.5, 100.0), 2.0, HitFilter::default()), 2);
        // nothing
        assert_eq!(sc.hit_test(Vec2::new(300.0, 300.0), 2.0, HitFilter::default()), 0);
    }

    #[test]
    fn locked_and_hidden() {
        let mut sc = scene();
        sc.upsert(1, 1, 0, ZKey(1), FLAG_LOCKED, 0.0, 0.0, 0.0, 100.0, 100.0);
        assert_eq!(sc.hit_test(Vec2::new(10.0, 10.0), 1.0, HitFilter::default()), 0);
        assert_eq!(sc.hit_test(Vec2::new(10.0, 10.0), 1.0, HitFilter { include_locked: true, ..Default::default() }), 1);
        sc.upsert(1, 1, 0, ZKey(1), FLAG_HIDDEN, 0.0, 0.0, 0.0, 100.0, 100.0);
        let mut vis = Vec::new();
        sc.visible_slots(&Box2d::from_xywh(-1000.0, -1000.0, 2000.0, 2000.0), &mut vis);
        assert_eq!(vis.len(), 1);
    }

    #[test]
    fn box_query_modes() {
        let mut sc = scene();
        let partial = Box2d::from_xywh(-10.0, -10.0, 30.0, 30.0);
        assert_eq!(sc.query_box(&partial, BoxQueryMode::Intersects, HitFilter::default()), vec![1]);
        assert!(sc.query_box(&partial, BoxQueryMode::Contains, HitFilter::default()).is_empty());
        let all = Box2d::from_xywh(-10.0, -10.0, 300.0, 300.0);
        assert_eq!(sc.query_box(&all, BoxQueryMode::Contains, HitFilter::default()), vec![1, 2]);
        // box inside hollow ellipse touching no outline → not selected
        let inside_hollow = Box2d::from_xywh(95.0, 95.0, 10.0, 10.0);
        assert_eq!(sc.query_box(&inside_hollow, BoxQueryMode::Intersects, HitFilter::default()), vec![1]);
    }

    #[test]
    fn visible_in_draw_order() {
        let mut sc = scene();
        let mut vis = Vec::new();
        sc.visible_slots(&Box2d::from_xywh(0.0, 0.0, 500.0, 500.0), &mut vis);
        let handles: Vec<Handle> = vis.iter().map(|&s| sc.handle_at(s)).collect();
        assert_eq!(handles, vec![1, 2]);
        sc.visible_slots(&Box2d::from_xywh(120.0, 120.0, 10.0, 10.0), &mut vis);
        assert_eq!(vis.len(), 1);
    }
}
