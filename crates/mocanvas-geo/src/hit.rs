//! Hit testing against paths and segments.

use crate::{Path, Vec2};

/// Squared distance from `p` to segment `a`-`b`.
#[inline]
pub fn dist2_point_segment(p: Vec2, a: Vec2, b: Vec2) -> f32 {
    let ab = b - a;
    let l2 = ab.len2();
    if l2 <= crate::EPS {
        return p.dist2(a);
    }
    let t = ((p - a).dot(ab) / l2).clamp(0.0, 1.0);
    p.dist2(a + ab * t)
}

/// Point-in-polygon via even-odd crossing test.
pub fn point_in_polygon(p: Vec2, poly: &[Vec2]) -> bool {
    let n = poly.len();
    if n < 3 {
        return false;
    }
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (a, b) = (poly[i], poly[j]);
        if (a.y > p.y) != (b.y > p.y) {
            let x = a.x + (p.y - a.y) / (b.y - a.y) * (b.x - a.x);
            if p.x < x {
                inside = !inside;
            }
        }
        j = i;
    }
    inside
}

/// Minimum squared distance from `p` to the polyline (open).
pub fn dist2_point_polyline(p: Vec2, pts: &[Vec2]) -> f32 {
    match pts.len() {
        0 => f32::INFINITY,
        1 => p.dist2(pts[0]),
        _ => pts.windows(2).map(|w| dist2_point_segment(p, w[0], w[1])).fold(f32::INFINITY, f32::min),
    }
}

/// Result of a path hit test.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PathHit {
    /// Point is inside a closed subpath (fill hit).
    pub inside: bool,
    /// Squared distance to the nearest outline segment.
    pub dist2_to_outline: f32,
}

/// Flattening tolerance used for hit testing, in path units.
pub const HIT_FLATTEN_TOL: f32 = 0.25;

/// Test a point (in the path's local space) against a path.
///
/// `inside` is computed per closed subpath with even-odd; distance is to any outline segment.
pub fn hit_test_path(path: &Path, p: Vec2) -> PathHit {
    let mut inside = false;
    let mut best = f32::INFINITY;
    let mut sub: Vec<Vec2> = Vec::with_capacity(32);
    let mut closed_flags: Vec<bool> = Vec::new();

    // Collect subpaths from the flattened outline.
    let mut subpaths: Vec<Vec<Vec2>> = Vec::new();
    path.flatten(HIT_FLATTEN_TOL, |pt, new_sub| {
        if new_sub && !sub.is_empty() {
            subpaths.push(core::mem::take(&mut sub));
        }
        sub.push(pt);
    });
    if !sub.is_empty() {
        subpaths.push(sub);
    }
    // Determine closed-ness per subpath: a subpath is treated as closed if the path
    // marks a Close after it. We approximate: if the flattened subpath's last point
    // equals its first, it was closed by `flatten`'s Close handling.
    for s in &subpaths {
        closed_flags.push(s.len() > 2 && s.first() == s.last());
    }

    for (s, &closed) in subpaths.iter().zip(closed_flags.iter()) {
        best = best.min(dist2_point_polyline(p, s));
        if closed && point_in_polygon(p, &s[..s.len() - 1]) {
            inside = !inside;
        }
    }
    PathHit { inside, dist2_to_outline: best }
}

/// Convenience: does the point hit the path, given a tolerance and whether the
/// interior counts (filled) or only the outline (hollow)?
pub fn path_contains(path: &Path, p: Vec2, tolerance: f32, filled: bool) -> bool {
    let h = hit_test_path(path, p);
    (filled && h.inside) || h.dist2_to_outline <= tolerance * tolerance
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Box2d;

    #[test]
    fn segment_distance() {
        let d = dist2_point_segment(Vec2::new(5.0, 3.0), Vec2::ZERO, Vec2::new(10.0, 0.0));
        assert_eq!(d, 9.0);
        let d = dist2_point_segment(Vec2::new(-4.0, 3.0), Vec2::ZERO, Vec2::new(10.0, 0.0));
        assert_eq!(d, 25.0);
    }

    #[test]
    fn polygon_inside() {
        let sq = [Vec2::ZERO, Vec2::new(10.0, 0.0), Vec2::new(10.0, 10.0), Vec2::new(0.0, 10.0)];
        assert!(point_in_polygon(Vec2::new(5.0, 5.0), &sq));
        assert!(!point_in_polygon(Vec2::new(15.0, 5.0), &sq));
    }

    #[test]
    fn rect_path_hit() {
        let r = Path::rect(&Box2d::from_xywh(0.0, 0.0, 100.0, 50.0));
        assert!(path_contains(&r, Vec2::new(50.0, 25.0), 1.0, true));
        assert!(!path_contains(&r, Vec2::new(50.0, 25.0), 1.0, false));
        assert!(path_contains(&r, Vec2::new(50.0, 0.5), 1.0, false));
        assert!(!path_contains(&r, Vec2::new(200.0, 25.0), 1.0, true));
    }

    #[test]
    fn ellipse_hit_vs_corner() {
        let e = Path::ellipse(&Box2d::from_xywh(0.0, 0.0, 100.0, 100.0));
        assert!(path_contains(&e, Vec2::new(50.0, 50.0), 1.0, true));
        // corner of bounding box is outside the ellipse
        assert!(!path_contains(&e, Vec2::new(2.0, 2.0), 1.0, true));
    }

    #[test]
    fn open_polyline_never_inside() {
        let l = Path::polyline(&[Vec2::ZERO, Vec2::new(100.0, 0.0), Vec2::new(100.0, 100.0)]);
        let h = hit_test_path(&l, Vec2::new(50.0, 50.0));
        assert!(!h.inside);
        assert!(path_contains(&l, Vec2::new(100.0, 50.0), 1.0, false));
    }
}
