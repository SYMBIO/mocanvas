//! 2D vector.

use core::ops::{Add, AddAssign, Div, Mul, Neg, Sub, SubAssign};

/// A 2D point or vector.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[repr(C)]
pub struct Vec2 {
    /// X component.
    pub x: f32,
    /// Y component.
    pub y: f32,
}

impl Vec2 {
    /// Origin.
    pub const ZERO: Vec2 = Vec2 { x: 0.0, y: 0.0 };
    /// Unit vector along X.
    pub const X: Vec2 = Vec2 { x: 1.0, y: 0.0 };
    /// Unit vector along Y.
    pub const Y: Vec2 = Vec2 { x: 0.0, y: 1.0 };

    /// Construct.
    #[inline]
    pub const fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }

    /// Dot product.
    #[inline]
    pub fn dot(self, o: Vec2) -> f32 {
        self.x * o.x + self.y * o.y
    }

    /// 2D cross product (z component of the 3D cross).
    #[inline]
    pub fn cross(self, o: Vec2) -> f32 {
        self.x * o.y - self.y * o.x
    }

    /// Squared length.
    #[inline]
    pub fn len2(self) -> f32 {
        self.dot(self)
    }

    /// Length.
    #[inline]
    pub fn len(self) -> f32 {
        self.len2().sqrt()
    }

    /// Squared distance to another point.
    #[inline]
    pub fn dist2(self, o: Vec2) -> f32 {
        (self - o).len2()
    }

    /// Distance to another point.
    #[inline]
    pub fn dist(self, o: Vec2) -> f32 {
        self.dist2(o).sqrt()
    }

    /// Unit vector, or zero if degenerate.
    #[inline]
    pub fn normalize(self) -> Vec2 {
        let l = self.len();
        if l <= crate::EPS {
            Vec2::ZERO
        } else {
            self / l
        }
    }

    /// Rotated 90° counter-clockwise.
    #[inline]
    pub fn perp(self) -> Vec2 {
        Vec2::new(-self.y, self.x)
    }

    /// Linear interpolation.
    #[inline]
    pub fn lerp(self, o: Vec2, t: f32) -> Vec2 {
        self + (o - self) * t
    }

    /// Rotate around origin by `angle` radians.
    #[inline]
    pub fn rotate(self, angle: f32) -> Vec2 {
        let (s, c) = angle.sin_cos();
        Vec2::new(self.x * c - self.y * s, self.x * s + self.y * c)
    }

    /// Rotate around `center` by `angle` radians.
    #[inline]
    pub fn rotate_around(self, center: Vec2, angle: f32) -> Vec2 {
        (self - center).rotate(angle) + center
    }

    /// Angle of this vector in radians.
    #[inline]
    pub fn angle(self) -> f32 {
        self.y.atan2(self.x)
    }

    /// Component-wise min.
    #[inline]
    pub fn min(self, o: Vec2) -> Vec2 {
        Vec2::new(self.x.min(o.x), self.y.min(o.y))
    }

    /// Component-wise max.
    #[inline]
    pub fn max(self, o: Vec2) -> Vec2 {
        Vec2::new(self.x.max(o.x), self.y.max(o.y))
    }

    /// Component-wise absolute value.
    #[inline]
    pub fn abs(self) -> Vec2 {
        Vec2::new(self.x.abs(), self.y.abs())
    }

    /// True if both components are finite.
    #[inline]
    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }
}

impl Add for Vec2 {
    type Output = Vec2;
    #[inline]
    fn add(self, o: Vec2) -> Vec2 {
        Vec2::new(self.x + o.x, self.y + o.y)
    }
}
impl AddAssign for Vec2 {
    #[inline]
    fn add_assign(&mut self, o: Vec2) {
        self.x += o.x;
        self.y += o.y;
    }
}
impl Sub for Vec2 {
    type Output = Vec2;
    #[inline]
    fn sub(self, o: Vec2) -> Vec2 {
        Vec2::new(self.x - o.x, self.y - o.y)
    }
}
impl SubAssign for Vec2 {
    #[inline]
    fn sub_assign(&mut self, o: Vec2) {
        self.x -= o.x;
        self.y -= o.y;
    }
}
impl Mul<f32> for Vec2 {
    type Output = Vec2;
    #[inline]
    fn mul(self, s: f32) -> Vec2 {
        Vec2::new(self.x * s, self.y * s)
    }
}
impl Mul<Vec2> for Vec2 {
    type Output = Vec2;
    #[inline]
    fn mul(self, o: Vec2) -> Vec2 {
        Vec2::new(self.x * o.x, self.y * o.y)
    }
}
impl Div<f32> for Vec2 {
    type Output = Vec2;
    #[inline]
    fn div(self, s: f32) -> Vec2 {
        Vec2::new(self.x / s, self.y / s)
    }
}
impl Neg for Vec2 {
    type Output = Vec2;
    #[inline]
    fn neg(self) -> Vec2 {
        Vec2::new(-self.x, -self.y)
    }
}
impl From<(f32, f32)> for Vec2 {
    #[inline]
    fn from((x, y): (f32, f32)) -> Self {
        Vec2::new(x, y)
    }
}
impl From<[f32; 2]> for Vec2 {
    #[inline]
    fn from([x, y]: [f32; 2]) -> Self {
        Vec2::new(x, y)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_ops() {
        let a = Vec2::new(1.0, 2.0);
        let b = Vec2::new(3.0, -1.0);
        assert_eq!(a + b, Vec2::new(4.0, 1.0));
        assert_eq!(a - b, Vec2::new(-2.0, 3.0));
        assert_eq!(a * 2.0, Vec2::new(2.0, 4.0));
        assert_eq!(a.dot(b), 1.0);
        assert_eq!(a.cross(b), -7.0);
        assert!((Vec2::new(3.0, 4.0).len() - 5.0).abs() < 1e-6);
    }

    #[test]
    fn rotation() {
        let r = Vec2::X.rotate(core::f32::consts::FRAC_PI_2);
        assert!((r.x).abs() < 1e-6 && (r.y - 1.0).abs() < 1e-6);
        let p = Vec2::new(2.0, 0.0).rotate_around(Vec2::new(1.0, 0.0), core::f32::consts::PI);
        assert!((p.x).abs() < 1e-5 && p.y.abs() < 1e-5);
    }

    #[test]
    fn normalize_degenerate() {
        assert_eq!(Vec2::ZERO.normalize(), Vec2::ZERO);
        let n = Vec2::new(0.0, 5.0).normalize();
        assert!((n.y - 1.0).abs() < 1e-6);
    }
}
