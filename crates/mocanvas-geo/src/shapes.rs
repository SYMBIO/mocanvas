//! Parametric outlines for the built-in shape kinds.
//!
//! The host used to build every outline in JavaScript and upload the finished
//! vertices; these generators take the handful of numbers that *describe* an
//! outline instead — a geo kind and a box, a run of spline points, a freehand
//! stroke — and build the [`Path`] here. One command carries five words instead
//! of a few hundred, and the trigonometry runs once, in WebAssembly.
//!
//! # Precision
//!
//! The maths is done in `f64` and narrowed to `f32` only when a coordinate is
//! written into the path. That is not a stylistic choice: the TypeScript these
//! generators replace computes in doubles and its output is rounded to `f32` by
//! the wire format, so working the same way makes the two byte-identical.
//! `tests/ts_parity.rs` pins that against output captured from the TypeScript.
//!
//! The one place they can still differ is the *input*: the box arrives here as
//! `f32` (the command stream carries no doubles, and the scene already stores
//! a shape's size as `f32`), so a width that is not exactly representable is
//! rounded before the outline is built rather than after. The difference is
//! about one part in 10^7 of a coordinate.

use crate::{Path, Vec2};

/// A built-in geo silhouette.
///
/// The discriminants are the index of the kind in the host's `GEO_SHAPE_KINDS`
/// table, which is what the command stream carries. That table is part of the
/// file format, so the numbering only ever grows at the end.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum GeoKind {
    /// The box itself.
    Rectangle = 0,
    /// Ellipse inscribed in the box.
    Ellipse = 1,
    /// Apex at the top edge's midpoint.
    Triangle = 2,
    /// Vertices at the four edge midpoints.
    Diamond = 3,
    /// Regular pentagon, apex up.
    Pentagon = 4,
    /// Regular hexagon with vertical left and right sides.
    Hexagon = 5,
    /// Regular octagon.
    Octagon = 6,
    /// Five-pointed star.
    Star = 7,
    /// Parallelogram leaning right.
    Rhombus = 8,
    /// Parallelogram leaning left.
    Rhombus2 = 9,
    /// Stadium / capsule.
    Oval = 10,
    /// Trapezoid, narrow edge up.
    Trapezoid = 11,
    /// Block arrow pointing right.
    ArrowRight = 12,
    /// Block arrow pointing left.
    ArrowLeft = 13,
    /// Block arrow pointing up.
    ArrowUp = 14,
    /// Block arrow pointing down.
    ArrowDown = 15,
    /// Rectangle with both diagonals drawn.
    XBox = 16,
    /// Rectangle with a tick drawn inside.
    CheckBox = 17,
    /// A ring of bumps.
    Cloud = 18,
    /// Two-lobed heart.
    Heart = 19,
}

impl GeoKind {
    /// The kind with this index, or `None` when the host sent one this build
    /// does not know — a newer table, or a corrupt stream.
    pub fn from_u32(v: u32) -> Option<GeoKind> {
        use GeoKind::*;
        Some(match v {
            0 => Rectangle,
            1 => Ellipse,
            2 => Triangle,
            3 => Diamond,
            4 => Pentagon,
            5 => Hexagon,
            6 => Octagon,
            7 => Star,
            8 => Rhombus,
            9 => Rhombus2,
            10 => Oval,
            11 => Trapezoid,
            12 => ArrowRight,
            13 => ArrowLeft,
            14 => ArrowUp,
            15 => ArrowDown,
            16 => XBox,
            17 => CheckBox,
            18 => Cloud,
            19 => Heart,
            _ => return None,
        })
    }
}

/// Inner radius of the five-pointed star as a fraction of the outer radius.
pub const STAR_INNER_RATIO: f64 = 0.5;

/// Cubic handle length for a quarter circle of unit radius.
const KAPPA: f64 = 0.5522848;

const TAU: f64 = std::f64::consts::TAU;

/// A point in the working (double) precision of these generators.
#[derive(Clone, Copy, Debug, PartialEq)]
struct P {
    x: f64,
    y: f64,
}

const fn p(x: f64, y: f64) -> P {
    P { x, y }
}

impl P {
    fn add(self, o: P) -> P {
        p(self.x + o.x, self.y + o.y)
    }
    fn sub(self, o: P) -> P {
        p(self.x - o.x, self.y - o.y)
    }
    fn mul(self, s: f64) -> P {
        p(self.x * s, self.y * s)
    }
    fn dot(self, o: P) -> f64 {
        self.x * o.x + self.y * o.y
    }
    fn len(self) -> f64 {
        self.x.hypot(self.y)
    }
    /// Rotated 90° counter-clockwise.
    fn perp(self) -> P {
        p(-self.y, self.x)
    }
    fn unit(self) -> P {
        let l = self.len();
        if l == 0.0 {
            p(0.0, 0.0)
        } else {
            p(self.x / l, self.y / l)
        }
    }
    fn lrp(self, o: P, t: f64) -> P {
        p(self.x + (o.x - self.x) * t, self.y + (o.y - self.y) * t)
    }
    fn to_vec2(self) -> Vec2 {
        Vec2::new(self.x as f32, self.y as f32)
    }
}

/// One cubic of a spline, in working precision.
#[derive(Clone, Copy, Debug)]
struct Seg {
    p0: P,
    c1: P,
    c2: P,
    p1: P,
}

/// A straight run expressed as a cubic, control points at 1/3 and 2/3.
fn line_segment(a: P, b: P) -> Seg {
    Seg { p0: a, c1: a.lrp(b, 1.0 / 3.0), c2: a.lrp(b, 2.0 / 3.0), p1: b }
}

/// Approximate a circular arc with `count` cubics.
///
/// `sweep` is signed: positive sweeps toward increasing angle, which is
/// clockwise on screen because +y points down.
fn arc_to_cubics(center: P, radius: f64, start_angle: f64, sweep: f64, count: usize, out: &mut Vec<Seg>) {
    let n = count.max(1);
    let step = sweep / n as f64;
    // Tangent handle length for a cubic spanning `step` radians.
    let k = (4.0 / 3.0) * (step / 4.0).tan() * radius;
    for i in 0..n {
        let a0 = start_angle + step * i as f64;
        let a1 = a0 + step;
        let p0 = p(center.x + radius * a0.cos(), center.y + radius * a0.sin());
        let p1 = p(center.x + radius * a1.cos(), center.y + radius * a1.sin());
        out.push(Seg {
            p0,
            c1: p(p0.x - k * a0.sin(), p0.y + k * a0.cos()),
            c2: p(p1.x + k * a1.sin(), p1.y - k * a1.cos()),
            p1,
        });
    }
}

/// Affinely stretch points so their bounding box becomes exactly `[0,w]×[0,h]`.
fn fit_points_to_box(points: &mut [P], w: f64, h: f64) {
    if points.is_empty() {
        return;
    }
    let (mut min_x, mut min_y) = (f64::INFINITY, f64::INFINITY);
    let (mut max_x, mut max_y) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
    for q in points.iter() {
        min_x = min_x.min(q.x);
        min_y = min_y.min(q.y);
        max_x = max_x.max(q.x);
        max_y = max_y.max(q.y);
    }
    let sx = if max_x - min_x > 0.0 { w / (max_x - min_x) } else { 0.0 };
    let sy = if max_y - min_y > 0.0 { h / (max_y - min_y) } else { 0.0 };
    for q in points.iter_mut() {
        *q = p((q.x - min_x) * sx, (q.y - min_y) * sy);
    }
}

/// Regular polygon (or star, when `inner_ratio` is given) with `sides` outer
/// vertices, first vertex at `start_angle`, stretched to fill the box.
fn regular_polygon(sides: usize, start_angle: f64, w: f64, h: f64, inner_ratio: Option<f64>) -> Vec<P> {
    let count = match inner_ratio {
        None => sides,
        Some(_) => sides * 2,
    };
    let mut raw = Vec::with_capacity(count);
    for i in 0..count {
        let a = start_angle + (i as f64 / count as f64) * TAU;
        let r = match inner_ratio {
            Some(r) if i % 2 == 1 => r,
            _ => 1.0,
        };
        raw.push(p(a.cos() * r, a.sin() * r));
    }
    fit_points_to_box(&mut raw, w, h);
    raw
}

/// Block arrow pointing +x inside a `w × h` box (7 vertices).
fn block_arrow_right(w: f64, h: f64) -> Vec<P> {
    let head_len = (w / 2.0).min(h / 2.0);
    let shaft_top = h / 4.0;
    let shaft_bottom = (3.0 * h) / 4.0;
    vec![
        p(0.0, shaft_top),
        p(w - head_len, shaft_top),
        p(w - head_len, 0.0),
        p(w, h / 2.0),
        p(w - head_len, h),
        p(w - head_len, shaft_bottom),
        p(0.0, shaft_bottom),
    ]
}

/// Outline vertices for the polygonal kinds, or `None` for the curved ones
/// (ellipse, oval, cloud, heart). `x-box` and `check-box` return their frame;
/// the marks inside come from [`geo_decorations`].
fn geo_polygon_points(kind: GeoKind, w: f64, h: f64) -> Option<Vec<P>> {
    use GeoKind::*;
    Some(match kind {
        Rectangle | XBox | CheckBox => vec![p(0.0, 0.0), p(w, 0.0), p(w, h), p(0.0, h)],
        Triangle => vec![p(w / 2.0, 0.0), p(w, h), p(0.0, h)],
        Diamond => vec![p(w / 2.0, 0.0), p(w, h / 2.0), p(w / 2.0, h), p(0.0, h / 2.0)],
        Pentagon => regular_polygon(5, -std::f64::consts::FRAC_PI_2, w, h, None),
        // A vertex at the top and one at the bottom, which leaves the left and
        // right sides vertical and running the full width of the box.
        Hexagon => regular_polygon(6, -std::f64::consts::FRAC_PI_2, w, h, None),
        Octagon => regular_polygon(8, std::f64::consts::FRAC_PI_8, w, h, None),
        Star => regular_polygon(5, -std::f64::consts::FRAC_PI_2, w, h, Some(STAR_INNER_RATIO)),
        Rhombus => {
            let off = (w / 3.0).min(h);
            vec![p(off, 0.0), p(w, 0.0), p(w - off, h), p(0.0, h)]
        }
        Rhombus2 => {
            let off = (w / 3.0).min(h);
            vec![p(0.0, 0.0), p(w - off, 0.0), p(w, h), p(off, h)]
        }
        Trapezoid => {
            let off = (w / 4.0).min(h / 2.0);
            vec![p(off, 0.0), p(w - off, 0.0), p(w, h), p(0.0, h)]
        }
        ArrowRight => block_arrow_right(w, h),
        ArrowLeft => block_arrow_right(w, h).into_iter().map(|q| p(w - q.x, q.y)).collect(),
        // The up/down arrows are the right-pointing one built in a transposed
        // box and then turned, so all four share one set of proportions.
        ArrowDown => block_arrow_right(h, w).into_iter().map(|q| p(q.y, q.x)).collect(),
        ArrowUp => block_arrow_right(h, w).into_iter().map(|q| p(q.y, h - q.x)).collect(),
        Ellipse | Oval | Cloud | Heart => return None,
    })
}

/// Open polylines drawn inside the outline: the X of an x-box, the tick of a
/// check-box. Empty for every other kind.
fn geo_decorations(kind: GeoKind, w: f64, h: f64) -> Vec<Vec<P>> {
    match kind {
        GeoKind::XBox => vec![vec![p(0.0, 0.0), p(w, h)], vec![p(w, 0.0), p(0.0, h)]],
        GeoKind::CheckBox => vec![vec![p(w * 0.25, h * 0.52), p(w * 0.43, h * 0.72), p(w * 0.76, h * 0.3)]],
        _ => Vec::new(),
    }
}

/// Stadium / capsule: two semicircles joined by straight sides.
fn stadium_segments(w: f64, h: f64) -> Vec<Seg> {
    let mut out = Vec::with_capacity(6);
    let half_pi = std::f64::consts::FRAC_PI_2;
    let pi = std::f64::consts::PI;
    if w >= h {
        let r = h / 2.0;
        out.push(line_segment(p(r, 0.0), p(w - r, 0.0)));
        arc_to_cubics(p(w - r, r), r, -half_pi, pi, 2, &mut out);
        out.push(line_segment(p(w - r, h), p(r, h)));
        arc_to_cubics(p(r, r), r, half_pi, pi, 2, &mut out);
    } else {
        let r = w / 2.0;
        arc_to_cubics(p(r, r), r, pi, pi, 2, &mut out);
        out.push(line_segment(p(w, r), p(w, h - r)));
        arc_to_cubics(p(r, h - r), r, 0.0, pi, 2, &mut out);
        out.push(line_segment(p(0.0, h - r), p(0.0, r)));
    }
    out
}

/// Samples per cubic when measuring a closed spline's bounds.
///
/// The host's `CubicSpline2d` flattens each segment into this many vertices and
/// takes the bounding box of the result, so the box a cloud is fitted into is a
/// property of *that* sampling. Anything finer would fit a slightly different
/// cloud.
const SPLINE_BOUNDS_SAMPLES: usize = 12;

/// Bounding box `(min_x, min_y, w, h)` of a closed spline, sampled the way the
/// host samples it — see [`SPLINE_BOUNDS_SAMPLES`].
fn spline_bounds(segments: &[Seg]) -> (f64, f64, f64, f64) {
    let (mut min_x, mut min_y) = (f64::INFINITY, f64::INFINITY);
    let (mut max_x, mut max_y) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
    let mut visit = |q: P| {
        min_x = min_x.min(q.x);
        min_y = min_y.min(q.y);
        max_x = max_x.max(q.x);
        max_y = max_y.max(q.y);
    };
    for s in segments {
        for i in 0..SPLINE_BOUNDS_SAMPLES {
            let t = i as f64 / SPLINE_BOUNDS_SAMPLES as f64;
            let u = 1.0 - t;
            visit(p(
                u * u * u * s.p0.x + 3.0 * u * u * t * s.c1.x + 3.0 * u * t * t * s.c2.x + t * t * t * s.p1.x,
                u * u * u * s.p0.y + 3.0 * u * u * t * s.c1.y + 3.0 * u * t * t * s.c2.y + t * t * t * s.p1.y,
            ));
        }
    }
    if let Some(last) = segments.last() {
        visit(last.p1);
    }
    if segments.is_empty() {
        return (0.0, 0.0, 0.0, 0.0);
    }
    (min_x, min_y, max_x - min_x, max_y - min_y)
}

/// Stretch closed spline control points so the sampled outline fills `[0,w]×[0,h]`.
fn fit_segments_to_box(segments: &mut [Seg], w: f64, h: f64) {
    let (bx, by, bw, bh) = spline_bounds(segments);
    let sx = if bw > 0.0 { w / bw } else { 0.0 };
    let sy = if bh > 0.0 { h / bh } else { 0.0 };
    let map = |q: P| p((q.x - bx) * sx, (q.y - by) * sy);
    for s in segments.iter_mut() {
        *s = Seg { p0: map(s.p0), c1: map(s.c1), c2: map(s.c2), p1: map(s.p1) };
    }
}

/// A ring of round bumps around an inner ellipse, fitted to the box.
fn cloud_segments(w: f64, h: f64) -> Vec<Seg> {
    let bumps = (((w + h) / 40.0).round() as i64).clamp(5, 12) as usize;
    let center = p(w / 2.0, h / 2.0);
    let rx = (w / 2.0) * 0.75;
    let ry = (h / 2.0) * 0.7;
    let mut anchors = Vec::with_capacity(bumps);
    for i in 0..bumps {
        let a = -std::f64::consts::FRAC_PI_2 + (i as f64 / bumps as f64) * TAU;
        anchors.push(p(center.x + rx * a.cos(), center.y + ry * a.sin()));
    }
    let mut segments = Vec::with_capacity(bumps);
    for i in 0..bumps {
        let a = anchors[i];
        let b = anchors[(i + 1) % bumps];
        let chord = b.sub(a);
        let len = chord.len();
        let mid = a.lrp(b, 0.5);
        let mut outward = chord.unit().perp();
        if outward.dot(mid.sub(center)) < 0.0 {
            outward = outward.mul(-1.0);
        }
        let k = len * 0.55;
        segments.push(Seg { p0: a, c1: a.add(outward.mul(k)), c2: b.add(outward.mul(k)), p1: b });
    }
    fit_segments_to_box(&mut segments, w, h);
    segments
}

/// Classic two-lobed heart, six cubics, bounds exactly `w × h`.
fn heart_segments(w: f64, h: f64) -> Vec<Seg> {
    let q = |x: f64, y: f64| p(x * w, y * h);
    vec![
        Seg { p0: q(0.5, 0.25), c1: q(0.5, 0.1), c2: q(0.35, 0.0), p1: q(0.25, 0.0) },
        Seg { p0: q(0.25, 0.0), c1: q(0.1, 0.0), c2: q(0.0, 0.15), p1: q(0.0, 0.3) },
        Seg { p0: q(0.0, 0.3), c1: q(0.0, 0.55), c2: q(0.25, 0.75), p1: q(0.5, 1.0) },
        Seg { p0: q(0.5, 1.0), c1: q(0.75, 0.75), c2: q(1.0, 0.55), p1: q(1.0, 0.3) },
        Seg { p0: q(1.0, 0.3), c1: q(1.0, 0.15), c2: q(0.9, 0.0), p1: q(0.75, 0.0) },
        Seg { p0: q(0.75, 0.0), c1: q(0.65, 0.0), c2: q(0.5, 0.1), p1: q(0.5, 0.25) },
    ]
}

/// Mirror a point about the centre of the box on the requested axes.
///
/// A flip is a property of the *outline*, not of the shape's transform: the
/// box and the label stay where they are and only the drawing inside them
/// turns over, which is what keeps a flipped triangle inside its own bounds.
fn mirror(q: P, w: f64, h: f64, flip_x: bool, flip_y: bool) -> P {
    p(if flip_x { w - q.x } else { q.x }, if flip_y { h - q.y } else { q.y })
}

fn push_polygon(path: &mut Path, points: &[P], close: bool) {
    let mut it = points.iter();
    let Some(first) = it.next() else { return };
    path.move_to(first.to_vec2());
    for q in it {
        path.line_to(q.to_vec2());
    }
    if close {
        path.close();
    }
}

fn push_spline(path: &mut Path, segments: &[Seg], close: bool) {
    let Some(first) = segments.first() else { return };
    path.move_to(first.p0.to_vec2());
    for s in segments {
        path.cubic_to(s.c1.to_vec2(), s.c2.to_vec2(), s.p1.to_vec2());
    }
    if close {
        path.close();
    }
}

/// The outline of a geo kind inside a `w × h` box.
///
/// `flip_x` / `flip_y` mirror the silhouette in place; they are applied to the
/// source points and control points rather than to the finished outline, so a
/// curved shape keeps its curves instead of being flattened into a mirrored
/// polygon. An ellipse ignores them, being its own mirror image on both axes.
pub fn geo_path(kind: GeoKind, w: f32, h: f32, flip_x: bool, flip_y: bool) -> Path {
    let (wd, hd) = (w as f64, h as f64);
    let mut path = Path::with_capacity(16);
    match kind {
        GeoKind::Ellipse => {
            let (rx, ry) = (wd / 2.0, hd / 2.0);
            let (cx, cy) = (rx, ry);
            let (kx, ky) = (KAPPA * rx, KAPPA * ry);
            path.move_to(p(cx + rx, cy).to_vec2());
            path.cubic_to(p(cx + rx, cy + ky).to_vec2(), p(cx + kx, cy + ry).to_vec2(), p(cx, cy + ry).to_vec2());
            path.cubic_to(p(cx - kx, cy + ry).to_vec2(), p(cx - rx, cy + ky).to_vec2(), p(cx - rx, cy).to_vec2());
            path.cubic_to(p(cx - rx, cy - ky).to_vec2(), p(cx - kx, cy - ry).to_vec2(), p(cx, cy - ry).to_vec2());
            path.cubic_to(p(cx + kx, cy - ry).to_vec2(), p(cx + rx, cy - ky).to_vec2(), p(cx + rx, cy).to_vec2());
            path.close();
        }
        GeoKind::Oval | GeoKind::Cloud | GeoKind::Heart => {
            let mut segments = match kind {
                GeoKind::Oval => stadium_segments(wd, hd),
                GeoKind::Cloud => cloud_segments(wd, hd),
                _ => heart_segments(wd, hd),
            };
            if flip_x || flip_y {
                for s in segments.iter_mut() {
                    *s = Seg {
                        p0: mirror(s.p0, wd, hd, flip_x, flip_y),
                        c1: mirror(s.c1, wd, hd, flip_x, flip_y),
                        c2: mirror(s.c2, wd, hd, flip_x, flip_y),
                        p1: mirror(s.p1, wd, hd, flip_x, flip_y),
                    };
                }
            }
            push_spline(&mut path, &segments, true);
        }
        _ => {
            let mut points = geo_polygon_points(kind, wd, hd).unwrap_or_default();
            for q in points.iter_mut() {
                *q = mirror(*q, wd, hd, flip_x, flip_y);
            }
            push_polygon(&mut path, &points, true);
            for line in geo_decorations(kind, wd, hd) {
                let marks: Vec<P> = line.into_iter().map(|q| mirror(q, wd, hd, flip_x, flip_y)).collect();
                push_polygon(&mut path, &marks, false);
            }
        }
    }
    path
}

/// Cubic segments of a smooth curve through every point (uniform Catmull-Rom,
/// tension 0.5, converted to bézier handles).
///
/// Endpoints are clamped so an open curve starts and ends exactly on the first
/// and last point. Returns `(p0, c1, c2, p1)` quads in order.
fn catmull_rom_segments(points: &[Vec2], closed: bool) -> Vec<Seg> {
    let n = points.len();
    if n < 2 {
        return Vec::new();
    }
    let at = |i: isize| -> P {
        let idx = if closed {
            (i.rem_euclid(n as isize)) as usize
        } else {
            i.clamp(0, n as isize - 1) as usize
        };
        p(points[idx].x as f64, points[idx].y as f64)
    };
    let seg_count = if closed { n } else { n - 1 };
    let mut out = Vec::with_capacity(seg_count);
    for i in 0..seg_count as isize {
        let p0 = at(i - 1);
        let p1 = at(i);
        let p2 = at(i + 1);
        let p3 = at(i + 2);
        out.push(Seg {
            p0: p1,
            c1: p(p1.x + (p2.x - p0.x) / 6.0, p1.y + (p2.y - p0.y) / 6.0),
            c2: p(p2.x - (p3.x - p1.x) / 6.0, p2.y - (p3.y - p1.y) / 6.0),
            p1: p2,
        });
    }
    out
}

/// A smooth cubic spline through `points`; see [`catmull_rom_segments`].
///
/// With fewer than two points there is no curve, and the caller gets an empty
/// path rather than a degenerate one.
pub fn catmull_rom_path(points: &[Vec2], closed: bool) -> Path {
    let segments = catmull_rom_segments(points, closed);
    let mut path = Path::with_capacity(segments.len() + 2);
    push_spline(&mut path, &segments, closed);
    path
}

/// A closed polygon or an open polyline through `points`.
pub fn polyline_path(points: &[Vec2], closed: bool) -> Path {
    if closed {
        Path::polygon(points)
    } else {
        Path::polyline(points)
    }
}

/// One pass of a light 1-2-1 moving average over a freehand stroke.
///
/// Endpoints are kept fixed so the stroke still starts and ends where the pen
/// did. Runs shorter than four points are left alone: there is nothing there to
/// average that would not just blunt the stroke.
pub fn smooth_freehand(points: &[Vec2], out: &mut Vec<Vec2>) {
    let n = points.len();
    if n < 4 {
        out.extend_from_slice(points);
        return;
    }
    out.push(points[0]);
    for i in 1..n - 1 {
        let prev = points[i - 1];
        let q = points[i];
        let next = points[i + 1];
        out.push(Vec2::new(
            ((prev.x as f64 + 2.0 * q.x as f64 + next.x as f64) / 4.0) as f32,
            ((prev.y as f64 + 2.0 * q.y as f64 + next.y as f64) / 4.0) as f32,
        ));
    }
    out.push(points[n - 1]);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PathCmd;

    #[test]
    fn rectangle_is_the_box() {
        let path = geo_path(GeoKind::Rectangle, 100.0, 60.0, false, false);
        assert_eq!(
            path.cmds(),
            &[
                PathCmd::MoveTo(Vec2::new(0.0, 0.0)),
                PathCmd::LineTo(Vec2::new(100.0, 0.0)),
                PathCmd::LineTo(Vec2::new(100.0, 60.0)),
                PathCmd::LineTo(Vec2::new(0.0, 60.0)),
                PathCmd::Close,
            ]
        );
    }

    #[test]
    fn every_kind_fills_its_box() {
        for i in 0..20 {
            let kind = GeoKind::from_u32(i).unwrap();
            let path = geo_path(kind, 120.0, 80.0, false, false);
            let b = path.bounds(0.01);
            assert!((b.min.x).abs() < 0.2, "{kind:?} min.x {}", b.min.x);
            assert!((b.min.y).abs() < 0.2, "{kind:?} min.y {}", b.min.y);
            assert!((b.max.x - 120.0).abs() < 0.2, "{kind:?} max.x {}", b.max.x);
            assert!((b.max.y - 80.0).abs() < 0.2, "{kind:?} max.y {}", b.max.y);
        }
    }

    #[test]
    fn flips_stay_inside_the_box() {
        for i in 0..20 {
            let kind = GeoKind::from_u32(i).unwrap();
            for (fx, fy) in [(true, false), (false, true), (true, true)] {
                let b = geo_path(kind, 120.0, 80.0, fx, fy).bounds(0.01);
                assert!(b.min.x > -0.2 && b.max.x < 120.2, "{kind:?} {fx} {fy}");
                assert!(b.min.y > -0.2 && b.max.y < 80.2, "{kind:?} {fx} {fy}");
            }
        }
    }

    #[test]
    fn unknown_kind_is_rejected() {
        assert!(GeoKind::from_u32(20).is_none());
    }

    #[test]
    fn degenerate_boxes_do_not_panic() {
        for kind in [GeoKind::Star, GeoKind::Cloud, GeoKind::Oval, GeoKind::Heart, GeoKind::Hexagon] {
            for (w, h) in [(0.0, 0.0), (0.0, 50.0), (50.0, 0.0)] {
                let path = geo_path(kind, w, h, false, false);
                assert!(!path.is_empty(), "{kind:?} {w}x{h}");
                for c in path.cmds() {
                    if let PathCmd::MoveTo(v) | PathCmd::LineTo(v) = *c {
                        assert!(v.x.is_finite() && v.y.is_finite(), "{kind:?} {w}x{h}");
                    }
                }
            }
        }
    }

    #[test]
    fn catmull_rom_needs_two_points() {
        assert!(catmull_rom_path(&[Vec2::new(1.0, 2.0)], false).is_empty());
        let path = catmull_rom_path(&[Vec2::ZERO, Vec2::new(10.0, 0.0), Vec2::new(20.0, 10.0)], false);
        assert_eq!(path.cmds().len(), 3);
        assert!(!path.is_closed());
    }

    #[test]
    fn short_freehand_runs_are_left_alone() {
        let pts = [Vec2::ZERO, Vec2::new(4.0, 0.0), Vec2::new(8.0, 3.0)];
        let mut out = Vec::new();
        smooth_freehand(&pts, &mut out);
        assert_eq!(out, pts);
    }
}
