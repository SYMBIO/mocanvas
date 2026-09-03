//! Axis-aligned bounding box.

use crate::{Mat2d, Vec2};

/// Axis-aligned box stored as min/max corners.
#[derive(Clone, Copy, Debug, PartialEq)]
#[repr(C)]
pub struct Box2d {
    /// Minimum corner.
    pub min: Vec2,
    /// Maximum corner.
    pub max: Vec2,
}

impl Default for Box2d {
    fn default() -> Self {
        Self::EMPTY
    }
}

impl Box2d {
    /// The empty box: min = +inf, max = -inf. Union with anything yields the other.
    pub const EMPTY: Box2d = Box2d {
        min: Vec2 { x: f32::INFINITY, y: f32::INFINITY },
        max: Vec2 { x: f32::NEG_INFINITY, y: f32::NEG_INFINITY },
    };

    /// From corners (normalizes ordering).
    #[inline]
    pub fn new(a: Vec2, b: Vec2) -> Self {
        Self { min: a.min(b), max: a.max(b) }
    }

    /// From origin and size.
    #[inline]
    pub fn from_xywh(x: f32, y: f32, w: f32, h: f32) -> Self {
        Self::new(Vec2::new(x, y), Vec2::new(x + w, y + h))
    }

    /// From min/max components.
    #[inline]
    pub const fn from_min_max(minx: f32, miny: f32, maxx: f32, maxy: f32) -> Self {
        Self { min: Vec2::new(minx, miny), max: Vec2::new(maxx, maxy) }
    }

    /// Bounding box of a set of points.
    pub fn from_points(pts: impl IntoIterator<Item = Vec2>) -> Self {
        let mut b = Self::EMPTY;
        for p in pts {
            b.expand_to_point(p);
        }
        b
    }

    /// True if no point has been added.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.min.x > self.max.x || self.min.y > self.max.y
    }

    /// Width (0 for empty).
    #[inline]
    pub fn width(&self) -> f32 {
        (self.max.x - self.min.x).max(0.0)
    }

    /// Height (0 for empty).
    #[inline]
    pub fn height(&self) -> f32 {
        (self.max.y - self.min.y).max(0.0)
    }

    /// Size vector.
    #[inline]
    pub fn size(&self) -> Vec2 {
        Vec2::new(self.width(), self.height())
    }

    /// Center.
    #[inline]
    pub fn center(&self) -> Vec2 {
        (self.min + self.max) * 0.5
    }

    /// Area.
    #[inline]
    pub fn area(&self) -> f32 {
        self.width() * self.height()
    }

    /// Grow to include a point.
    #[inline]
    pub fn expand_to_point(&mut self, p: Vec2) {
        self.min = self.min.min(p);
        self.max = self.max.max(p);
    }

    /// Union.
    #[inline]
    pub fn union(&self, o: &Box2d) -> Box2d {
        Box2d { min: self.min.min(o.min), max: self.max.max(o.max) }
    }

    /// Intersection (may be empty).
    #[inline]
    pub fn intersection(&self, o: &Box2d) -> Box2d {
        Box2d { min: self.min.max(o.min), max: self.max.min(o.max) }
    }

    /// Outset by `d` on all sides (negative to inset).
    #[inline]
    pub fn expand(&self, d: f32) -> Box2d {
        Box2d { min: self.min - Vec2::new(d, d), max: self.max + Vec2::new(d, d) }
    }

    /// Contains point (inclusive).
    #[inline]
    pub fn contains_point(&self, p: Vec2) -> bool {
        p.x >= self.min.x && p.x <= self.max.x && p.y >= self.min.y && p.y <= self.max.y
    }

    /// Fully contains another box.
    #[inline]
    pub fn contains_box(&self, o: &Box2d) -> bool {
        o.min.x >= self.min.x && o.min.y >= self.min.y && o.max.x <= self.max.x && o.max.y <= self.max.y
    }

    /// Overlaps another box (touching counts).
    #[inline]
    pub fn intersects(&self, o: &Box2d) -> bool {
        self.min.x <= o.max.x && self.max.x >= o.min.x && self.min.y <= o.max.y && self.max.y >= o.min.y
    }

    /// The four corners in order: min, (max.x,min.y), max, (min.x,max.y).
    #[inline]
    pub fn corners(&self) -> [Vec2; 4] {
        [
            self.min,
            Vec2::new(self.max.x, self.min.y),
            self.max,
            Vec2::new(self.min.x, self.max.y),
        ]
    }

    /// Axis-aligned bounds of this box after an affine transform.
    pub fn transformed(&self, m: &Mat2d) -> Box2d {
        if m.is_translation_only() {
            let t = m.translation();
            return Box2d { min: self.min + t, max: self.max + t };
        }
        Box2d::from_points(self.corners().into_iter().map(|c| m.apply(c)))
    }

    /// Squared distance from a point to the box (0 if inside).
    pub fn dist2_to_point(&self, p: Vec2) -> f32 {
        let dx = (self.min.x - p.x).max(0.0).max(p.x - self.max.x);
        let dy = (self.min.y - p.y).max(0.0).max(p.y - self.max.y);
        dx * dx + dy * dy
    }

    /// As `[minx, miny, maxx, maxy]`.
    #[inline]
    pub fn to_array(&self) -> [f32; 4] {
        [self.min.x, self.min.y, self.max.x, self.max.y]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn union_and_intersection() {
        let a = Box2d::from_xywh(0.0, 0.0, 10.0, 10.0);
        let b = Box2d::from_xywh(5.0, 5.0, 10.0, 10.0);
        assert_eq!(a.union(&b), Box2d::from_xywh(0.0, 0.0, 15.0, 15.0));
        assert_eq!(a.intersection(&b), Box2d::from_xywh(5.0, 5.0, 5.0, 5.0));
        assert!(a.intersects(&b));
        let c = Box2d::from_xywh(20.0, 20.0, 1.0, 1.0);
        assert!(!a.intersects(&c));
        assert!(a.intersection(&c).is_empty());
    }

    #[test]
    fn empty_union_identity() {
        let a = Box2d::from_xywh(1.0, 2.0, 3.0, 4.0);
        assert_eq!(Box2d::EMPTY.union(&a), a);
        assert!(Box2d::EMPTY.is_empty());
        assert_eq!(Box2d::EMPTY.width(), 0.0);
    }

    #[test]
    fn transformed_rotated_square() {
        let a = Box2d::from_xywh(-1.0, -1.0, 2.0, 2.0);
        let t = a.transformed(&Mat2d::rotate(core::f32::consts::FRAC_PI_4));
        let s = 2f32.sqrt();
        assert!((t.width() - 2.0 * s).abs() < 1e-4);
        assert!((t.height() - 2.0 * s).abs() < 1e-4);
    }

    #[test]
    fn distance() {
        let a = Box2d::from_xywh(0.0, 0.0, 10.0, 10.0);
        assert_eq!(a.dist2_to_point(Vec2::new(5.0, 5.0)), 0.0);
        assert_eq!(a.dist2_to_point(Vec2::new(13.0, 14.0)), 25.0);
    }
}
