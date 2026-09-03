//! 2D affine transform (3x2 matrix, column-major like the DOM `matrix(a,b,c,d,e,f)`).

use crate::Vec2;

/// Affine transform `[a c e; b d f; 0 0 1]`.
///
/// `point' = (a*x + c*y + e, b*x + d*y + f)`.
#[derive(Clone, Copy, Debug, PartialEq)]
#[repr(C)]
pub struct Mat2d {
    /// x scale / cos.
    pub a: f32,
    /// y skew / sin.
    pub b: f32,
    /// x skew / -sin.
    pub c: f32,
    /// y scale / cos.
    pub d: f32,
    /// x translation.
    pub e: f32,
    /// y translation.
    pub f: f32,
}

impl Default for Mat2d {
    fn default() -> Self {
        Self::IDENTITY
    }
}

impl Mat2d {
    /// Identity transform.
    pub const IDENTITY: Mat2d = Mat2d { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 };

    /// Construct from components.
    #[inline]
    pub const fn new(a: f32, b: f32, c: f32, d: f32, e: f32, f: f32) -> Self {
        Self { a, b, c, d, e, f }
    }

    /// Translation.
    #[inline]
    pub const fn translate(x: f32, y: f32) -> Self {
        Self::new(1.0, 0.0, 0.0, 1.0, x, y)
    }

    /// Uniform or non-uniform scale about origin.
    #[inline]
    pub const fn scale(sx: f32, sy: f32) -> Self {
        Self::new(sx, 0.0, 0.0, sy, 0.0, 0.0)
    }

    /// Rotation about origin by `angle` radians.
    #[inline]
    pub fn rotate(angle: f32) -> Self {
        let (s, c) = angle.sin_cos();
        Self::new(c, s, -s, c, 0.0, 0.0)
    }

    /// Translate-then-rotate: the transform of a shape at `(x, y)` rotated by `rot`
    /// around its own origin. Equivalent to `translate(x,y) * rotate(rot)`.
    #[inline]
    pub fn from_trs(x: f32, y: f32, rot: f32) -> Self {
        if rot == 0.0 {
            return Self::translate(x, y);
        }
        let (s, c) = rot.sin_cos();
        Self::new(c, s, -s, c, x, y)
    }

    /// Camera transform: page → screen for a camera at page `(cx, cy)` with zoom `z`.
    /// `screen = (page + cam) * zoom`.
    #[inline]
    pub fn camera(cx: f32, cy: f32, z: f32) -> Self {
        Self::new(z, 0.0, 0.0, z, cx * z, cy * z)
    }

    /// `self * other` — apply `other` first, then `self`.
    #[inline]
    pub fn mul(&self, o: &Mat2d) -> Mat2d {
        Mat2d {
            a: self.a * o.a + self.c * o.b,
            b: self.b * o.a + self.d * o.b,
            c: self.a * o.c + self.c * o.d,
            d: self.b * o.c + self.d * o.d,
            e: self.a * o.e + self.c * o.f + self.e,
            f: self.b * o.e + self.d * o.f + self.f,
        }
    }

    /// Determinant of the linear part.
    #[inline]
    pub fn det(&self) -> f32 {
        self.a * self.d - self.b * self.c
    }

    /// Inverse, or `None` if singular.
    pub fn inverse(&self) -> Option<Mat2d> {
        let det = self.det();
        if det.abs() < 1e-12 {
            return None;
        }
        let inv = 1.0 / det;
        let a = self.d * inv;
        let b = -self.b * inv;
        let c = -self.c * inv;
        let d = self.a * inv;
        Some(Mat2d {
            a,
            b,
            c,
            d,
            e: -(a * self.e + c * self.f),
            f: -(b * self.e + d * self.f),
        })
    }

    /// Transform a point.
    #[inline]
    pub fn apply(&self, p: Vec2) -> Vec2 {
        Vec2::new(self.a * p.x + self.c * p.y + self.e, self.b * p.x + self.d * p.y + self.f)
    }

    /// Transform a direction vector (ignores translation).
    #[inline]
    pub fn apply_vec(&self, v: Vec2) -> Vec2 {
        Vec2::new(self.a * v.x + self.c * v.y, self.b * v.x + self.d * v.y)
    }

    /// Rotation angle of the linear part.
    #[inline]
    pub fn rotation(&self) -> f32 {
        self.b.atan2(self.a)
    }

    /// Translation component.
    #[inline]
    pub fn translation(&self) -> Vec2 {
        Vec2::new(self.e, self.f)
    }

    /// Scale factors along x and y (lengths of the basis vectors).
    #[inline]
    pub fn scale_factors(&self) -> Vec2 {
        Vec2::new(Vec2::new(self.a, self.b).len(), Vec2::new(self.c, self.d).len())
    }

    /// Whether this is a pure translation (no rotation, unit scale).
    #[inline]
    pub fn is_translation_only(&self) -> bool {
        self.a == 1.0 && self.b == 0.0 && self.c == 0.0 && self.d == 1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: Vec2, b: Vec2) -> bool {
        (a.x - b.x).abs() < 1e-4 && (a.y - b.y).abs() < 1e-4
    }

    #[test]
    fn compose_and_inverse() {
        let m = Mat2d::translate(10.0, 5.0).mul(&Mat2d::rotate(0.7)).mul(&Mat2d::scale(2.0, 3.0));
        let p = Vec2::new(1.5, -2.0);
        let q = m.apply(p);
        let back = m.inverse().unwrap().apply(q);
        assert!(approx(p, back));
    }

    #[test]
    fn trs_matches_manual() {
        let m = Mat2d::from_trs(3.0, 4.0, 1.1);
        let p = Vec2::new(2.0, 1.0);
        let expected = p.rotate(1.1) + Vec2::new(3.0, 4.0);
        assert!(approx(m.apply(p), expected));
        assert!((m.rotation() - 1.1).abs() < 1e-5);
    }

    #[test]
    fn camera_round_trip() {
        let cam = Mat2d::camera(-100.0, 50.0, 2.0);
        let page = Vec2::new(300.0, 20.0);
        let screen = cam.apply(page);
        assert!(approx(screen, Vec2::new(400.0, 140.0)));
        assert!(approx(cam.inverse().unwrap().apply(screen), page));
    }

    #[test]
    fn singular() {
        assert!(Mat2d::scale(0.0, 1.0).inverse().is_none());
    }
}
