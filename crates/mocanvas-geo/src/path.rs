//! Path commands and a compact path representation.
//!
//! The wire encoding used across the WASM boundary is a flat `f32` buffer where
//! each command is its opcode (as `f32`) followed by its arguments. This makes
//! a path a single typed-array copy from JS.

use crate::{Box2d, Vec2};

/// Opcode for path commands (stored as `f32` bit patterns in the wire buffer).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PathCmd {
    /// Start a new subpath at a point.
    MoveTo(Vec2),
    /// Straight segment.
    LineTo(Vec2),
    /// Quadratic bézier: control, end.
    QuadTo(Vec2, Vec2),
    /// Cubic bézier: control1, control2, end.
    CubicTo(Vec2, Vec2, Vec2),
    /// Close the current subpath.
    Close,
}

impl PathCmd {
    /// Opcode values.
    pub const OP_MOVE: u32 = 0;
    /// See [`PathCmd::OP_MOVE`].
    pub const OP_LINE: u32 = 1;
    /// See [`PathCmd::OP_MOVE`].
    pub const OP_QUAD: u32 = 2;
    /// See [`PathCmd::OP_MOVE`].
    pub const OP_CUBIC: u32 = 3;
    /// See [`PathCmd::OP_MOVE`].
    pub const OP_CLOSE: u32 = 4;

    /// Number of `f32` argument words following the opcode.
    #[inline]
    pub fn arg_count(op: u32) -> Option<usize> {
        Some(match op {
            Self::OP_MOVE | Self::OP_LINE => 2,
            Self::OP_QUAD => 4,
            Self::OP_CUBIC => 6,
            Self::OP_CLOSE => 0,
            _ => return None,
        })
    }
}

/// A path: a list of commands, plus a lazily computed bounding box.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Path {
    cmds: Vec<PathCmd>,
    /// True if the last subpath was closed (used to decide fill vs. open stroke hit tests).
    closed: bool,
}

impl Path {
    /// Empty path.
    pub fn new() -> Self {
        Self::default()
    }

    /// With capacity.
    pub fn with_capacity(n: usize) -> Self {
        Self { cmds: Vec::with_capacity(n), closed: false }
    }

    /// Axis-aligned rectangle.
    pub fn rect(b: &Box2d) -> Self {
        let c = b.corners();
        let mut p = Self::with_capacity(5);
        p.move_to(c[0]);
        p.line_to(c[1]);
        p.line_to(c[2]);
        p.line_to(c[3]);
        p.close();
        p
    }

    /// Rounded rectangle with radius clamped to half the shorter side.
    pub fn rounded_rect(b: &Box2d, radius: f32) -> Self {
        let r = radius.min(b.width() * 0.5).min(b.height() * 0.5).max(0.0);
        if r <= crate::EPS {
            return Self::rect(b);
        }
        // Cubic approximation of a quarter circle.
        let k = 0.552_284_8 * r;
        let (x0, y0, x1, y1) = (b.min.x, b.min.y, b.max.x, b.max.y);
        let mut p = Self::with_capacity(10);
        p.move_to(Vec2::new(x0 + r, y0));
        p.line_to(Vec2::new(x1 - r, y0));
        p.cubic_to(Vec2::new(x1 - r + k, y0), Vec2::new(x1, y0 + r - k), Vec2::new(x1, y0 + r));
        p.line_to(Vec2::new(x1, y1 - r));
        p.cubic_to(Vec2::new(x1, y1 - r + k), Vec2::new(x1 - r + k, y1), Vec2::new(x1 - r, y1));
        p.line_to(Vec2::new(x0 + r, y1));
        p.cubic_to(Vec2::new(x0 + r - k, y1), Vec2::new(x0, y1 - r + k), Vec2::new(x0, y1 - r));
        p.line_to(Vec2::new(x0, y0 + r));
        p.cubic_to(Vec2::new(x0, y0 + r - k), Vec2::new(x0 + r - k, y0), Vec2::new(x0 + r, y0));
        p.close();
        p
    }

    /// Ellipse inscribed in a box (4 cubics).
    pub fn ellipse(b: &Box2d) -> Self {
        let c = b.center();
        let rx = b.width() * 0.5;
        let ry = b.height() * 0.5;
        let kx = 0.552_284_8 * rx;
        let ky = 0.552_284_8 * ry;
        let mut p = Self::with_capacity(6);
        p.move_to(Vec2::new(c.x + rx, c.y));
        p.cubic_to(Vec2::new(c.x + rx, c.y + ky), Vec2::new(c.x + kx, c.y + ry), Vec2::new(c.x, c.y + ry));
        p.cubic_to(Vec2::new(c.x - kx, c.y + ry), Vec2::new(c.x - rx, c.y + ky), Vec2::new(c.x - rx, c.y));
        p.cubic_to(Vec2::new(c.x - rx, c.y - ky), Vec2::new(c.x - kx, c.y - ry), Vec2::new(c.x, c.y - ry));
        p.cubic_to(Vec2::new(c.x + kx, c.y - ry), Vec2::new(c.x + rx, c.y - ky), Vec2::new(c.x + rx, c.y));
        p.close();
        p
    }

    /// Closed polygon from points.
    pub fn polygon(pts: &[Vec2]) -> Self {
        let mut p = Self::with_capacity(pts.len() + 1);
        let mut it = pts.iter();
        if let Some(&first) = it.next() {
            p.move_to(first);
            for &q in it {
                p.line_to(q);
            }
            p.close();
        }
        p
    }

    /// Open polyline from points.
    pub fn polyline(pts: &[Vec2]) -> Self {
        let mut p = Self::with_capacity(pts.len());
        let mut it = pts.iter();
        if let Some(&first) = it.next() {
            p.move_to(first);
            for &q in it {
                p.line_to(q);
            }
        }
        p
    }

    /// Decode from the flat `f32` wire buffer. Returns `None` on malformed input.
    pub fn from_wire(words: &[f32]) -> Option<Self> {
        let mut p = Self::with_capacity(words.len() / 3);
        let mut i = 0;
        while i < words.len() {
            let op = words[i] as u32;
            let n = PathCmd::arg_count(op)?;
            i += 1;
            if i + n > words.len() {
                return None;
            }
            let a = &words[i..i + n];
            match op {
                PathCmd::OP_MOVE => p.move_to(Vec2::new(a[0], a[1])),
                PathCmd::OP_LINE => p.line_to(Vec2::new(a[0], a[1])),
                PathCmd::OP_QUAD => p.quad_to(Vec2::new(a[0], a[1]), Vec2::new(a[2], a[3])),
                PathCmd::OP_CUBIC => p.cubic_to(
                    Vec2::new(a[0], a[1]),
                    Vec2::new(a[2], a[3]),
                    Vec2::new(a[4], a[5]),
                ),
                PathCmd::OP_CLOSE => p.close(),
                _ => return None,
            }
            i += n;
        }
        Some(p)
    }

    /// Encode to the flat `f32` wire buffer.
    pub fn to_wire(&self) -> Vec<f32> {
        let mut out = Vec::with_capacity(self.cmds.len() * 3);
        for c in &self.cmds {
            match *c {
                PathCmd::MoveTo(p) => out.extend_from_slice(&[PathCmd::OP_MOVE as f32, p.x, p.y]),
                PathCmd::LineTo(p) => out.extend_from_slice(&[PathCmd::OP_LINE as f32, p.x, p.y]),
                PathCmd::QuadTo(c1, p) => {
                    out.extend_from_slice(&[PathCmd::OP_QUAD as f32, c1.x, c1.y, p.x, p.y])
                }
                PathCmd::CubicTo(c1, c2, p) => out.extend_from_slice(&[
                    PathCmd::OP_CUBIC as f32,
                    c1.x,
                    c1.y,
                    c2.x,
                    c2.y,
                    p.x,
                    p.y,
                ]),
                PathCmd::Close => out.push(PathCmd::OP_CLOSE as f32),
            }
        }
        out
    }

    /// Append a move.
    #[inline]
    pub fn move_to(&mut self, p: Vec2) {
        self.cmds.push(PathCmd::MoveTo(p));
        self.closed = false;
    }
    /// Append a line.
    #[inline]
    pub fn line_to(&mut self, p: Vec2) {
        self.cmds.push(PathCmd::LineTo(p));
    }
    /// Append a quadratic.
    #[inline]
    pub fn quad_to(&mut self, c: Vec2, p: Vec2) {
        self.cmds.push(PathCmd::QuadTo(c, p));
    }
    /// Append a cubic.
    #[inline]
    pub fn cubic_to(&mut self, c1: Vec2, c2: Vec2, p: Vec2) {
        self.cmds.push(PathCmd::CubicTo(c1, c2, p));
    }
    /// Close the current subpath.
    #[inline]
    pub fn close(&mut self) {
        self.cmds.push(PathCmd::Close);
        self.closed = true;
    }

    /// Commands.
    #[inline]
    pub fn cmds(&self) -> &[PathCmd] {
        &self.cmds
    }

    /// Whether the path ends with a closed subpath.
    #[inline]
    pub fn is_closed(&self) -> bool {
        self.closed
    }

    /// No commands.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.cmds.is_empty()
    }

    /// Bounding box of control points (a conservative bound; exact for polylines).
    pub fn control_bounds(&self) -> Box2d {
        let mut b = Box2d::EMPTY;
        for c in &self.cmds {
            match *c {
                PathCmd::MoveTo(p) | PathCmd::LineTo(p) => b.expand_to_point(p),
                PathCmd::QuadTo(c1, p) => {
                    b.expand_to_point(c1);
                    b.expand_to_point(p);
                }
                PathCmd::CubicTo(c1, c2, p) => {
                    b.expand_to_point(c1);
                    b.expand_to_point(c2);
                    b.expand_to_point(p);
                }
                PathCmd::Close => {}
            }
        }
        b
    }

    /// Tight bounding box computed from the flattened outline.
    pub fn bounds(&self, tolerance: f32) -> Box2d {
        let mut b = Box2d::EMPTY;
        self.flatten(tolerance, |p, _| b.expand_to_point(p));
        b
    }

    /// Flatten curves into line segments. `f(point, starts_new_subpath)` is
    /// called for every vertex in order.
    pub fn flatten(&self, tolerance: f32, mut f: impl FnMut(Vec2, bool)) {
        let tol = tolerance.max(1e-3);
        let mut cur = Vec2::ZERO;
        let mut start = Vec2::ZERO;
        for c in &self.cmds {
            match *c {
                PathCmd::MoveTo(p) => {
                    cur = p;
                    start = p;
                    f(p, true);
                }
                PathCmd::LineTo(p) => {
                    cur = p;
                    f(p, false);
                }
                PathCmd::QuadTo(c1, p) => {
                    let n = quad_segments(cur, c1, p, tol);
                    for i in 1..=n {
                        let t = i as f32 / n as f32;
                        f(quad_at(cur, c1, p, t), false);
                    }
                    cur = p;
                }
                PathCmd::CubicTo(c1, c2, p) => {
                    let n = cubic_segments(cur, c1, c2, p, tol);
                    for i in 1..=n {
                        let t = i as f32 / n as f32;
                        f(cubic_at(cur, c1, c2, p, t), false);
                    }
                    cur = p;
                }
                PathCmd::Close => {
                    if cur != start {
                        f(start, false);
                    }
                    cur = start;
                }
            }
        }
    }

    /// Iterate commands.
    pub fn iter(&self) -> PathIter<'_> {
        PathIter { inner: self.cmds.iter() }
    }
}

/// Iterator over path commands.
pub struct PathIter<'a> {
    inner: core::slice::Iter<'a, PathCmd>,
}

impl<'a> Iterator for PathIter<'a> {
    type Item = &'a PathCmd;
    #[inline]
    fn next(&mut self) -> Option<Self::Item> {
        self.inner.next()
    }
}

/// Point on a quadratic bézier.
#[inline]
pub fn quad_at(p0: Vec2, c: Vec2, p1: Vec2, t: f32) -> Vec2 {
    let u = 1.0 - t;
    p0 * (u * u) + c * (2.0 * u * t) + p1 * (t * t)
}

/// Point on a cubic bézier.
#[inline]
pub fn cubic_at(p0: Vec2, c1: Vec2, c2: Vec2, p1: Vec2, t: f32) -> Vec2 {
    let u = 1.0 - t;
    p0 * (u * u * u) + c1 * (3.0 * u * u * t) + c2 * (3.0 * u * t * t) + p1 * (t * t * t)
}

/// Segment count for flattening a quadratic within `tol` (Wang's formula).
#[inline]
pub fn quad_segments(p0: Vec2, c: Vec2, p1: Vec2, tol: f32) -> usize {
    let dd = (p0 - c * 2.0 + p1).len();
    let n = (dd / (8.0 * tol)).sqrt().ceil();
    (n as usize).clamp(1, 256)
}

/// Segment count for flattening a cubic within `tol` (Wang's formula).
#[inline]
pub fn cubic_segments(p0: Vec2, c1: Vec2, c2: Vec2, p1: Vec2, tol: f32) -> usize {
    let d1 = (p0 - c1 * 2.0 + c2).len();
    let d2 = (c1 - c2 * 2.0 + p1).len();
    let dd = d1.max(d2);
    let n = (0.75 * dd / tol).sqrt().ceil();
    (n as usize).clamp(1, 256)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_round_trip() {
        let b = Box2d::from_xywh(1.0, 2.0, 30.0, 40.0);
        let p = Path::rounded_rect(&b, 5.0);
        let w = p.to_wire();
        let q = Path::from_wire(&w).unwrap();
        assert_eq!(p, q);
        assert!(Path::from_wire(&[9.0]).is_none());
        assert!(Path::from_wire(&[1.0, 0.0]).is_none());
    }

    #[test]
    fn ellipse_bounds_tight() {
        let b = Box2d::from_xywh(10.0, 20.0, 100.0, 50.0);
        let e = Path::ellipse(&b);
        let eb = e.bounds(0.01);
        assert!((eb.min.x - 10.0).abs() < 0.05);
        assert!((eb.max.x - 110.0).abs() < 0.05);
        assert!((eb.min.y - 20.0).abs() < 0.05);
        assert!((eb.max.y - 70.0).abs() < 0.05);
        assert!(e.is_closed());
    }

    #[test]
    fn flatten_counts_scale_with_tolerance() {
        let b = Box2d::from_xywh(0.0, 0.0, 200.0, 200.0);
        let e = Path::ellipse(&b);
        let mut coarse = 0;
        e.flatten(2.0, |_, _| coarse += 1);
        let mut fine = 0;
        e.flatten(0.05, |_, _| fine += 1);
        assert!(fine > coarse * 2, "fine={fine} coarse={coarse}");
    }

    #[test]
    fn polyline_is_open() {
        let p = Path::polyline(&[Vec2::ZERO, Vec2::new(1.0, 1.0)]);
        assert!(!p.is_closed());
        assert_eq!(p.cmds().len(), 2);
    }
}
