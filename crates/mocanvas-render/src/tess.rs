//! Path → triangles via lyon.

use lyon::math::point;
use lyon::path::Path as LPath;
use lyon::tessellation::{
    BuffersBuilder, FillOptions, FillRule, FillTessellator, FillVertex, LineCap, LineJoin, StrokeOptions,
    StrokeTessellator, StrokeVertex, VertexBuffers,
};
use mocanvas_geo::{Path, PathCmd};
use mocanvas_scene::Style;

/// Position-only triangle list in shape-local space.
#[derive(Clone, Debug, Default)]
pub struct MeshPart {
    /// `x y` pairs.
    pub positions: Vec<f32>,
    /// Triangle indices into `positions`.
    pub indices: Vec<u32>,
}

impl MeshPart {
    /// Vertex count.
    #[inline]
    pub fn vertex_count(&self) -> usize {
        self.positions.len() / 2
    }
    /// Empty?
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.indices.is_empty()
    }
}

/// Cached tessellation for one shape.
#[derive(Clone, Debug, Default)]
pub struct MeshCache {
    /// Geometry version this mesh was built from.
    pub geom_version: u32,
    /// Fill triangles (empty if the style has no fill).
    pub fill: MeshPart,
    /// Stroke triangles (empty if the style has no stroke).
    pub stroke: MeshPart,
}

/// Tessellation tolerance in page units.
pub const TOLERANCE: f32 = 0.1;

fn to_lyon(path: &Path) -> LPath {
    let mut b = LPath::builder();
    let mut open = false;
    for c in path.iter() {
        match *c {
            PathCmd::MoveTo(p) => {
                if open {
                    b.end(false);
                }
                b.begin(point(p.x, p.y));
                open = true;
            }
            PathCmd::LineTo(p) => {
                if open {
                    b.line_to(point(p.x, p.y));
                }
            }
            PathCmd::QuadTo(c1, p) => {
                if open {
                    b.quadratic_bezier_to(point(c1.x, c1.y), point(p.x, p.y));
                }
            }
            PathCmd::CubicTo(c1, c2, p) => {
                if open {
                    b.cubic_bezier_to(point(c1.x, c1.y), point(c2.x, c2.y), point(p.x, p.y));
                }
            }
            PathCmd::Close => {
                if open {
                    b.end(true);
                    open = false;
                }
            }
        }
    }
    if open {
        b.end(false);
    }
    b.build()
}

fn drain(buf: VertexBuffers<[f32; 2], u32>) -> MeshPart {
    let mut positions = Vec::with_capacity(buf.vertices.len() * 2);
    for v in buf.vertices {
        positions.push(v[0]);
        positions.push(v[1]);
    }
    MeshPart { positions, indices: buf.indices }
}

/// Tessellate a path with a style into a mesh cache entry.
pub fn tessellate(path: &Path, style: &Style, geom_version: u32) -> MeshCache {
    let mut out = MeshCache { geom_version, ..Default::default() };
    if path.is_empty() {
        return out;
    }
    let lp = to_lyon(path);

    if style.has_fill() && path.is_closed() {
        let mut buf: VertexBuffers<[f32; 2], u32> = VertexBuffers::new();
        let mut t = FillTessellator::new();
        let opts = FillOptions::tolerance(TOLERANCE).with_fill_rule(FillRule::NonZero);
        let ok = t.tessellate_path(
            &lp,
            &opts,
            &mut BuffersBuilder::new(&mut buf, |v: FillVertex| v.position().to_array()),
        );
        if ok.is_ok() {
            out.fill = drain(buf);
        }
    }

    if style.has_stroke() {
        // The hand-drawn style replaces the exact outline with a perturbed one (see
        // `draw_passes`); every other dash style strokes the real geometry. Either
        // way the fill above keeps the true shape.
        if style.dash == dash::DRAW {
            let mut buf: VertexBuffers<[f32; 2], u32> = VertexBuffers::new();
            let mut t = StrokeTessellator::new();
            let mut ok = true;
            for (p, line_width) in draw_passes(path, style) {
                let opts = StrokeOptions::tolerance(DRAW_TOLERANCE)
                    .with_line_width(line_width)
                    .with_line_join(LineJoin::MiterClip)
                    .with_miter_limit(2.0)
                    .with_line_cap(LineCap::Round);
                if t
                    .tessellate_path(
                        &to_lyon(&p),
                        &opts,
                        &mut BuffersBuilder::new(&mut buf, |v: StrokeVertex| v.position().to_array()),
                    )
                    .is_err()
                {
                    ok = false;
                    break;
                }
            }
            if ok {
                out.stroke = drain(buf);
            }
            return out;
        }
        let dashed = dash_pattern(style.dash, style.stroke_width).map(|(d, g)| to_lyon(&dash_path(path, d, g, TOLERANCE)));
        let stroke_path = dashed.as_ref().unwrap_or(&lp);
        let mut buf: VertexBuffers<[f32; 2], u32> = VertexBuffers::new();
        let mut t = StrokeTessellator::new();
        let opts = StrokeOptions::tolerance(TOLERANCE)
            .with_line_width(style.stroke_width)
            .with_line_join(LineJoin::Round)
            .with_line_cap(LineCap::Round);
        let ok = t.tessellate_path(
            stroke_path,
            &opts,
            &mut BuffersBuilder::new(&mut buf, |v: StrokeVertex| v.position().to_array()),
        );
        if ok.is_ok() {
            out.stroke = drain(buf);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use mocanvas_geo::Box2d;

    #[test]
    fn rect_fill_is_two_triangles() {
        let p = Path::rect(&Box2d::from_xywh(0.0, 0.0, 10.0, 10.0));
        let m = tessellate(&p, &Style { fill: 0xffffffff, stroke: 0, ..Style::default() }, 1);
        assert_eq!(m.fill.indices.len(), 6);
        assert!(m.stroke.is_empty());
    }

    #[test]
    fn stroke_only_when_requested() {
        let p = Path::ellipse(&Box2d::from_xywh(0.0, 0.0, 100.0, 50.0));
        let m = tessellate(&p, &Style { fill: 0, stroke: 0x000000ff, stroke_width: 4.0, ..Style::default() }, 1);
        assert!(m.fill.is_empty());
        assert!(m.stroke.indices.len() > 100);
        assert_eq!(m.stroke.indices.len() % 3, 0);
    }

    #[test]
    fn open_path_never_filled() {
        let p = Path::polyline(&[(0.0, 0.0).into(), (10.0, 0.0).into(), (10.0, 10.0).into()]);
        let m = tessellate(&p, &Style { fill: 0xff0000ff, ..Style::default() }, 1);
        assert!(m.fill.is_empty());
        assert!(!m.stroke.is_empty());
    }
}

/// Dash pattern ids shared with the host.
pub mod dash {
    /// Continuous stroke.
    pub const SOLID: u32 = 0;
    /// Dashes roughly two stroke widths long with equal gaps.
    pub const DASHED: u32 = 1;
    /// Round dots spaced about two stroke widths apart.
    pub const DOTTED: u32 = 2;
    /// Hand-drawn look: the stroke follows a seeded, wobbly version of the
    /// outline instead of the exact one. See [`super::draw_passes`].
    pub const DRAW: u32 = 3;
}

/// Dash/gap lengths in path units for a pattern and stroke width.
pub fn dash_pattern(dash: u32, width: f32) -> Option<(f32, f32)> {
    let w = width.max(0.5);
    match dash {
        dash::DASHED => Some((w * 2.0, w * 2.0)),
        dash::DOTTED => Some((w * 0.05, w * 2.0)),
        _ => None,
    }
}

/// Split a path's flattened outline into dash segments, producing an open-subpath path.
pub fn dash_path(path: &Path, dash_len: f32, gap_len: f32, tolerance: f32) -> Path {
    use mocanvas_geo::Vec2;
    let mut out = Path::new();
    let mut sub: Vec<Vec2> = Vec::new();
    let period = dash_len + gap_len;
    if period <= 0.0 {
        return path.clone();
    }
    let emit = |pts: &[Vec2], out: &mut Path| {
        if pts.len() < 2 {
            return;
        }
        // Walk the polyline, alternating on/off.
        let mut dist = 0.0f32; // distance along the polyline
        let mut on = true;
        let mut next_switch = dash_len;
        let mut drawing = false;
        for w in pts.windows(2) {
            let (a, b) = (w[0], w[1]);
            let seg_len = a.dist(b);
            if seg_len <= 0.0 {
                continue;
            }
            let mut t0 = 0.0f32;
            let seg_start = dist;
            loop {
                let remaining_to_switch = next_switch - (seg_start + t0 * seg_len);
                let remaining_in_seg = seg_len * (1.0 - t0);
                if on && !drawing {
                    let p = a.lerp(b, t0);
                    out.move_to(p);
                    drawing = true;
                }
                if remaining_to_switch >= remaining_in_seg {
                    if on {
                        out.line_to(b);
                    }
                    break;
                }
                let t1 = t0 + remaining_to_switch / seg_len;
                let p = a.lerp(b, t1);
                if on {
                    out.line_to(p);
                    drawing = false;
                }
                on = !on;
                next_switch += if on { dash_len } else { gap_len };
                t0 = t1;
            }
            dist += seg_len;
        }
    };
    path.flatten(tolerance, |p, new_sub| {
        if new_sub && !sub.is_empty() {
            emit(&sub, &mut out);
            sub.clear();
        }
        sub.push(p);
    });
    if !sub.is_empty() {
        emit(&sub, &mut out);
    }
    out
}

#[cfg(test)]
mod dash_tests {
    use super::*;
    use mocanvas_geo::{Box2d, PathCmd};

    #[test]
    fn dashes_split_a_line_into_alternating_pieces() {
        let line = Path::polyline(&[(0.0, 0.0).into(), (100.0, 0.0).into()]);
        let d = dash_path(&line, 10.0, 10.0, 0.1);
        let moves = d.cmds().iter().filter(|c| matches!(c, PathCmd::MoveTo(_))).count();
        assert_eq!(moves, 5);
        assert!(!d.is_closed());
    }

    #[test]
    fn dashed_rect_stroke_tessellates() {
        let p = Path::rect(&Box2d::from_xywh(0.0, 0.0, 100.0, 50.0));
        let m = tessellate(&p, &Style { fill: 0, stroke: 0x000000ff, stroke_width: 4.0, dash: dash::DASHED, ..Style::default() }, 1);
        assert!(!m.stroke.is_empty());
        let solid = tessellate(&p, &Style { fill: 0, stroke: 0x000000ff, stroke_width: 4.0, dash: dash::SOLID, ..Style::default() }, 1);
        assert!(m.stroke.indices.len() > solid.stroke.indices.len());
    }
}

// ---------------------------------------------------------------------------
// Hand-drawn outlines (`dash::DRAW`)
// ---------------------------------------------------------------------------
//
// A shape styled `dash::DRAW` keeps its exact fill but is stroked along a
// perturbed copy of its outline, so the silhouette reads as drawn by hand rather
// than machined. The pass has three stages, all driven by one deterministic
// integer hash seeded from `Style::seed`:
//
// 1. **Resample.** The path is flattened, split into subpaths, and each subpath is
//    reduced to a handful of *anchors*: every detected corner is kept, and the
//    smooth runs between corners are re-sampled at roughly `DRAW_WOBBLE_PERIODS`
//    pieces per subpath perimeter. This fixes the wobble's wavelength relative to
//    the shape while its amplitude stays tied to the stroke width, and it keeps
//    the vertex count low no matter how finely the original curve was flattened.
// 2. **Perturb.** Each anchor is nudged perpendicular to the local direction, and
//    each segment between anchors is bowed by routing it through a quadratic whose
//    mid-point is displaced sideways. Both amplitudes scale with the stroke width
//    and are capped by a fraction of the adjacent segment lengths, so a short
//    segment is never swamped and a long one never wanders.
// 3. **Round and overshoot.** Every interior anchor is cut back by a radius drawn
//    from the stroke width plus a little of the shorter adjacent segment, clamped
//    to `DRAW_CORNER_MAX_FRACTION` of that shorter segment, and the cut is bridged
//    by a quadratic whose control point sits *past* the true vertex along the
//    outward bisector — the corner bulges instead of turning exactly. A closed
//    subpath is emitted open, starting at its first corner and running a little
//    past it at the end, so the outline overshoots where the pen came back around.
//
// Width variation is approximated with two passes rather than a tapered stroke:
// lyon's stroker takes a single width per call, and tapering it would mean
// tessellating the outline as a filled ribbon by hand. Two passes of different
// widths over slightly different perturbations of the same anchors — the
// perturbations share a base jitter so the passes stay close enough never to open
// a gap — give an apparent width that varies along the line and, unlike a taper,
// also reproduces the doubled-back look of a pen going over a line twice. Long
// outlines (more than `DRAW_SINGLE_PASS_ANCHORS` anchors across all subpaths) drop
// to a single full-width pass; that test is a property of the geometry alone, so
// it can never flip with zoom or shape count and make a shape shimmer.
//
// Cost, measured over a mixed page of rect / ellipse / hexagon / star / rounded
// rect / polyline at a stroke width of 3.5: 2.3x the triangles and 2.3x the time
// of the same page stroked plain — 8.6 us a shape against 3.8 us — so a full
// `DEFAULT_TESS_BUDGET` of 256 shapes costs about 2.2 ms, and 5,000 draw-styled
// shapes about 43 ms spread over the twenty frames the budget takes to work
// through them.

/// Flattening tolerance for the sketched outline. Coarser than [`TOLERANCE`]:
/// the line is deliberately imprecise, so paying for exact curves is waste.
const DRAW_TOLERANCE: f32 = 0.5;
/// Target number of wobble pieces around one subpath.
const DRAW_WOBBLE_PERIODS: f32 = 6.0;
/// Most pieces one corner-to-corner run is split into.
const DRAW_MAX_RUN_PIECES: usize = 8;
/// Turn (radians) above which a flattened vertex counts as a corner.
const DRAW_CORNER_TURN: f32 = 0.35;
/// Perpendicular anchor offset, × stroke width…
const DRAW_VERTEX_AMP: f32 = 0.5;
/// …capped at this fraction of the shorter adjacent segment.
const DRAW_VERTEX_MAX_FRACTION: f32 = 0.25;
/// Sideways bow at a segment's mid-point, × stroke width…
const DRAW_BOW_AMP: f32 = 0.45;
/// …capped at this fraction of the segment's length.
const DRAW_BOW_MAX_FRACTION: f32 = 0.06;
/// Corner cut-back radius, × stroke width…
const DRAW_CORNER_RADIUS: f32 = 1.3;
/// …plus this fraction of the shorter adjacent segment…
const DRAW_CORNER_LEN_FRACTION: f32 = 0.06;
/// …and never more than this fraction of that shorter segment.
const DRAW_CORNER_MAX_FRACTION: f32 = 0.35;
/// How far a corner's control point is pushed past the true vertex, × stroke width.
const DRAW_OVERSHOOT: f32 = 0.55;
/// Line widths of the two sketch passes, × stroke width.
const DRAW_PASS_WIDTHS: [f32; 2] = [0.85, 0.6];
/// Above this many anchors the double pass is dropped for a single full-width one.
const DRAW_SINGLE_PASS_ANCHORS: usize = 64;
/// Share of a pass's jitter that is drawn fresh rather than taken from the shared
/// base. Keeping most of it shared holds the two passes close together.
const DRAW_PASS_JITTER: f32 = 0.3;

/// Bound, in stroke widths, on how far the sketched outline may leave the true
/// one. Hit-testing and bounds still use the exact geometry, so this is what says
/// how wrong they are allowed to look.
pub const DRAW_MAX_DEVIATION: f32 = 3.0;

/// splitmix32: one round of a small integer hash, advancing `state`.
#[inline]
fn splitmix32(state: &mut u32) -> u32 {
    *state = state.wrapping_add(0x9e37_79b9);
    let mut z = *state;
    z = (z ^ (z >> 16)).wrapping_mul(0x21f0_aaad);
    z = (z ^ (z >> 15)).wrapping_mul(0x735a_2d97);
    z ^ (z >> 15)
}

/// Combine two integers into a seed.
#[inline]
fn mix_seed(a: u32, b: u32) -> u32 {
    let mut s = a ^ b.wrapping_mul(0x85eb_ca6b);
    splitmix32(&mut s)
}

/// Deterministic pseudo-random stream. Same seed, same numbers, every run.
struct Rng(u32);

impl Rng {
    #[inline]
    fn new(seed: u32) -> Self {
        Rng(seed)
    }
    /// Uniform in `[0, 1)`.
    #[inline]
    fn unit(&mut self) -> f32 {
        (splitmix32(&mut self.0) >> 8) as f32 * (1.0 / 16_777_216.0)
    }
    /// Uniform in `[-1, 1)`.
    #[inline]
    fn signed(&mut self) -> f32 {
        self.unit() * 2.0 - 1.0
    }
}

/// One flattened subpath.
struct SubPath {
    pts: Vec<mocanvas_geo::Vec2>,
    closed: bool,
}

/// Flatten `path` into subpaths, dropping repeated points and marking the ones
/// whose ends meet as closed (with the duplicated end point removed).
fn flatten_subpaths(path: &Path, tolerance: f32) -> Vec<SubPath> {
    let mut out: Vec<SubPath> = Vec::new();
    path.flatten(tolerance, |p, new_sub| {
        if new_sub {
            out.push(SubPath { pts: Vec::new(), closed: false });
        }
        if let Some(s) = out.last_mut() {
            s.pts.push(p);
        }
    });
    for s in &mut out {
        s.pts.dedup_by(|a, b| a.dist2(*b) <= 1e-10);
        if s.pts.len() >= 4 && s.pts[0].dist2(*s.pts.last().unwrap()) <= 1e-8 {
            s.pts.pop();
            s.closed = true;
        }
    }
    out.retain(|s| s.pts.len() >= 2);
    out
}

/// Turn angle at `cur`, in radians.
#[inline]
fn turn_at(prev: mocanvas_geo::Vec2, cur: mocanvas_geo::Vec2, next: mocanvas_geo::Vec2) -> f32 {
    let a = (cur - prev).normalize();
    let b = (next - cur).normalize();
    if a == mocanvas_geo::Vec2::ZERO || b == mocanvas_geo::Vec2::ZERO {
        return 0.0;
    }
    a.cross(b).atan2(a.dot(b)).abs()
}

/// Point at arc length `s` along a polyline with cumulative lengths `cum`.
fn point_at_arc(pts: &[mocanvas_geo::Vec2], cum: &[f32], s: f32) -> mocanvas_geo::Vec2 {
    let i = cum.partition_point(|&c| c <= s).saturating_sub(1).min(pts.len() - 2);
    let seg = cum[i + 1] - cum[i];
    if seg <= 0.0 {
        return pts[i];
    }
    pts[i].lerp(pts[i + 1], ((s - cum[i]) / seg).clamp(0.0, 1.0))
}

/// Corner radius at a vertex with adjacent segment lengths `l_prev`/`l_next`.
/// Never more than [`DRAW_CORNER_MAX_FRACTION`] of the shorter of the two.
#[inline]
fn corner_radius(width: f32, l_prev: f32, l_next: f32, jitter: f32) -> f32 {
    let shorter = l_prev.min(l_next);
    (DRAW_CORNER_RADIUS * width * jitter + DRAW_CORNER_LEN_FRACTION * shorter).min(DRAW_CORNER_MAX_FRACTION * shorter)
}

/// Anchors of one subpath, plus the true outline point half-way along each of the
/// spans between them. The mid-points are what the sketched quadratics are aimed
/// through, so a curve that was reduced to a handful of anchors is still followed
/// rather than cut across by its chords.
struct Anchors {
    pts: Vec<mocanvas_geo::Vec2>,
    /// One per span, so `pts.len() - 1` entries.
    mids: Vec<mocanvas_geo::Vec2>,
    /// Whether each anchor is a real corner of the outline rather than a point the
    /// resampling happened to drop on a smooth run. Only real corners are rounded
    /// generously and pushed out past the true vertex; treating a resampled point
    /// as a corner would turn a smooth curve into a polygon with bulging joints.
    corner: Vec<bool>,
    closed: bool,
}

/// Reduce a subpath to its wobble anchors: every corner, plus resampled points
/// along the runs between them. A closed subpath is rotated to start at its first
/// corner and its start point repeated at the end, so callers handle one case.
fn draw_anchors(sp: &SubPath, width: f32) -> Anchors {
    let n = sp.pts.len();
    let mut corners: Vec<usize> = Vec::new();
    if sp.closed {
        for i in 0..n {
            if turn_at(sp.pts[(i + n - 1) % n], sp.pts[i], sp.pts[(i + 1) % n]) > DRAW_CORNER_TURN {
                corners.push(i);
            }
        }
    } else {
        corners.push(0);
        for i in 1..n - 1 {
            if turn_at(sp.pts[i - 1], sp.pts[i], sp.pts[i + 1]) > DRAW_CORNER_TURN {
                corners.push(i);
            }
        }
        corners.push(n - 1);
    }

    // Unroll into a plain open polyline plus the cut indices along it.
    let had_corners = !corners.is_empty();
    let (pts, cuts, real) = if sp.closed {
        let start = corners.first().copied().unwrap_or(0);
        let mut pts = Vec::with_capacity(n + 1);
        pts.extend_from_slice(&sp.pts[start..]);
        pts.extend_from_slice(&sp.pts[..start]);
        pts.push(pts[0]);
        let mut cuts: Vec<usize> = corners.iter().map(|&c| (c + n - start) % n).collect();
        cuts.sort_unstable();
        if cuts.first() != Some(&0) {
            cuts.insert(0, 0);
        }
        cuts.push(n);
        cuts.dedup();
        // Index 0 and the seam at n are the same vertex, a real corner only when the
        // subpath had any; every other cut came from the corner scan.
        let real: Vec<bool> = cuts.iter().map(|&c| if c == 0 || c == n { had_corners } else { true }).collect();
        (pts, cuts, real)
    } else {
        let mut cuts = corners;
        cuts.dedup();
        // The two ends of an open subpath are where the pen starts and stops, not corners.
        let last = cuts.len() - 1;
        let real: Vec<bool> = (0..cuts.len()).map(|i| i != 0 && i != last).collect();
        (sp.pts.clone(), cuts, real)
    };

    let mut cum = vec![0.0f32; pts.len()];
    for i in 1..pts.len() {
        cum[i] = cum[i - 1] + pts[i - 1].dist(pts[i]);
    }
    let total = cum[pts.len() - 1];
    if !total.is_finite() || total <= 0.0 {
        return Anchors { pts: Vec::new(), mids: Vec::new(), corner: Vec::new(), closed: sp.closed };
    }
    let step = (total / DRAW_WOBBLE_PERIODS).max(2.0 * width);

    let mut anchors = Vec::with_capacity(cuts.len() * 2);
    let mut mids = Vec::with_capacity(cuts.len() * 2);
    let mut corner = Vec::with_capacity(cuts.len() * 2);
    for (c, w) in cuts.windows(2).enumerate() {
        let (a, b) = (w[0], w[1]);
        let run = cum[b] - cum[a];
        let k = ((run / step).round().max(1.0) as usize).min(DRAW_MAX_RUN_PIECES);
        for j in 0..k {
            let s0 = cum[a] + run * (j as f32 / k as f32);
            let s1 = cum[a] + run * ((j + 1) as f32 / k as f32);
            anchors.push(point_at_arc(&pts, &cum, s0));
            mids.push(point_at_arc(&pts, &cum, 0.5 * (s0 + s1)));
            corner.push(j == 0 && real[c]);
        }
    }
    anchors.push(pts[*cuts.last().unwrap()]);
    corner.push(*real.last().unwrap());
    Anchors { pts: anchors, mids, corner, closed: sp.closed }
}

/// Append one sketched pass over `anchors` to `out`.
///
/// For a closed subpath the first and last anchor are the same point; this emits
/// them apart, the last one running past the first so the outline overshoots at
/// the seam. The result is always an open subpath, stroked with round caps.
fn sketch_into(out: &mut Path, anchors: &Anchors, width: f32, seed: u32, pass: u32) {
    use mocanvas_geo::Vec2;
    let pts = &anchors.pts;
    let closed = anchors.closed;
    let m = pts.len();
    if m < 2 {
        return;
    }
    // The base stream depends on the seed only, so both passes share most of their
    // jitter and never drift far enough apart to leave a gap between them.
    let mut base = Rng::new(mix_seed(seed, 0));
    let mut own = Rng::new(mix_seed(seed, pass + 1));
    let shared = 1.0 - DRAW_PASS_JITTER;
    let jitter = |base: &mut Rng, own: &mut Rng| base.signed() * shared + own.signed() * DRAW_PASS_JITTER;

    // 1. Nudge each anchor perpendicular to the local direction, and push the ones
    //    that are real corners out along their bisector: the corner then sits a
    //    little past the true vertex, which is what makes the silhouette read as
    //    overshot rather than machined. Doing it here, before anything downstream,
    //    keeps the rest of the construction consistent with it.
    let mut a = Vec::with_capacity(m);
    let mut off = Vec::with_capacity(m);
    for i in 0..m {
        let (prev, next) = if closed {
            (pts[if i == 0 { m - 2 } else { i - 1 }], pts[if i == m - 1 { 1 } else { i + 1 }])
        } else {
            (pts[i.saturating_sub(1)], pts[(i + 1).min(m - 1)])
        };
        let cur = pts[i];
        let amp = (DRAW_VERTEX_AMP * width).min(DRAW_VERTEX_MAX_FRACTION * prev.dist(cur).min(cur.dist(next)));
        let mut d = (next - prev).normalize().perp() * (amp * jitter(&mut base, &mut own));
        if anchors.corner[i] {
            let (u_in, u_out) = ((cur - prev).normalize(), (next - cur).normalize());
            let over = DRAW_OVERSHOOT * width * (0.4 + 0.6 * (base.unit() * shared + own.unit() * DRAW_PASS_JITTER));
            d += (u_in - u_out).normalize() * over;
        }
        a.push(cur + d);
        off.push(d);
    }
    if closed {
        // The seam's two anchors are the same vertex. Perturbing them apart would
        // fork the outline there; instead they coincide and the overshoot below runs
        // back over the start, which is what a pen closing a loop actually leaves.
        a[m - 1] = a[0];
        off[m - 1] = off[0];
    }

    // 2. Segment directions and lengths, then corner radii (never at the seam).
    let seg: Vec<(Vec2, f32)> = (0..m - 1)
        .map(|i| {
            let d = a[i + 1] - a[i];
            (d.normalize(), d.len())
        })
        .collect();
    let mut radius = vec![0.0f32; m];
    for i in 1..m - 1 {
        let j = 0.7 + 0.6 * (base.unit() * shared + own.unit() * DRAW_PASS_JITTER);
        radius[i] = corner_radius(width, seg[i - 1].1, seg[i].1, j);
    }

    // 3. One quadratic per span, cut back by the corner radii at both ends and aimed
    //    through the outline's own mid-point (carried along by the average of the two
    //    anchors' offsets, then bowed sideways) — so a curve reduced to a few anchors
    //    is followed rather than cut across by its chords.
    let mut spans: Vec<(Vec2, Vec2, Vec2)> = Vec::with_capacity(m - 1);
    for i in 0..m - 1 {
        let (u, len) = seg[i];
        if len <= 1e-6 {
            spans.push((a[i], a[i], a[i]));
            continue;
        }
        let start = a[i] + u * radius[i];
        let end = a[i + 1] - u * radius[i + 1];
        let bow = (DRAW_BOW_AMP * width).min(DRAW_BOW_MAX_FRACTION * len) * jitter(&mut base, &mut own);
        let target = anchors.mids[i] + (off[i] + off[i + 1]) * 0.5 + u.perp() * bow;
        spans.push((start, target * 2.0 - start.lerp(end, 0.5), end));
    }

    // 4. Emit, bridging each cut-back corner with a quadratic whose control point is
    //    where the two spans' tangents meet. That keeps the tangent continuous across
    //    the join: aiming the bridge at the corner itself instead would leave a
    //    visible kink at every anchor of a curved outline.
    out.move_to(spans[0].0);
    for (i, &(_, ctrl, end)) in spans.iter().enumerate() {
        out.quad_to(ctrl, end);
        if let Some(&(next_start, next_ctrl, _)) = spans.get(i + 1) {
            out.quad_to(fillet_control(end, end - ctrl, next_start, next_ctrl - next_start), next_start);
        }
    }
    if closed {
        // Carry on past the seam the way the outline was going, so the end runs back
        // over the start instead of stopping exactly on it.
        let over = DRAW_OVERSHOOT * width * (0.9 + 0.9 * base.unit());
        let (_, last_ctrl, last_end) = spans[spans.len() - 1];
        let t_in = (last_end - last_ctrl).normalize();
        let t_out = (spans[0].1 - spans[0].0).normalize();
        out.quad_to(last_end + t_in * (over * 0.5), last_end + t_out * over);
    }
}

/// Control point for a quadratic bridging `p`→`q` that leaves `p` along `t_p` and
/// arrives at `q` along `t_q`: where the two tangent lines meet, or the midpoint
/// when they are parallel or meet behind either end.
fn fillet_control(p: mocanvas_geo::Vec2, t_p: mocanvas_geo::Vec2, q: mocanvas_geo::Vec2, t_q: mocanvas_geo::Vec2) -> mocanvas_geo::Vec2 {
    let (tp, tq) = (t_p.normalize(), t_q.normalize());
    let denom = tp.cross(tq);
    let span = p.dist(q);
    if denom.abs() < 1e-3 || span <= 0.0 {
        return p.lerp(q, 0.5);
    }
    // The control has to sit forward of `p` along `t_p` *and* behind `q` along
    // `t_q`; if either runs the wrong way the bridge would double back into a cusp.
    let k = (q - p).cross(tq) / denom;
    let j = -(q - p).cross(tp) / denom;
    let limit = 0.0..=2.0 * span;
    if !limit.contains(&k) || !limit.contains(&j) {
        return p.lerp(q, 0.5);
    }
    p + tp * k
}

/// Build the hand-drawn replacement for `path`'s stroke: one or two passes, each a
/// path together with the line width it should be stroked at.
///
/// Deterministic in `(path, style.seed, style.stroke_width)`. The mesh cache keys
/// on the geometry version alone, so this has to be — otherwise a shape would take
/// a new outline every time it was re-tessellated and shimmer.
pub fn draw_passes(path: &Path, style: &Style) -> Vec<(Path, f32)> {
    let width = style.stroke_width.max(0.5);
    let subs = flatten_subpaths(path, TOLERANCE);
    if subs.is_empty() {
        return Vec::new();
    }
    let mut sets = Vec::with_capacity(subs.len());
    let mut anchor_count = 0usize;
    for sp in &subs {
        let a = draw_anchors(sp, width);
        if a.pts.len() < 2 {
            continue;
        }
        anchor_count += a.pts.len();
        sets.push(a);
    }
    if sets.is_empty() {
        return Vec::new();
    }
    let widths: &[f32] = if anchor_count > DRAW_SINGLE_PASS_ANCHORS { &[1.0] } else { &DRAW_PASS_WIDTHS };
    widths
        .iter()
        .enumerate()
        .map(|(pass, factor)| {
            let mut p = Path::new();
            for (i, anchors) in sets.iter().enumerate() {
                sketch_into(&mut p, anchors, width, mix_seed(style.seed, i as u32 + 1), pass as u32);
            }
            (p, width * factor)
        })
        .collect()
}

#[cfg(test)]
mod draw_tests {
    use super::*;
    use mocanvas_geo::{Box2d, Vec2};

    fn draw_style(seed: u32) -> Style {
        Style { fill: 0, stroke: 0x000000ff, stroke_width: 4.0, dash: dash::DRAW, seed, ..Style::default() }
    }

    fn star(cx: f32, cy: f32, outer: f32, inner: f32, points: usize) -> Path {
        let pts: Vec<Vec2> = (0..points * 2)
            .map(|i| {
                let r = if i % 2 == 0 { outer } else { inner };
                let t = i as f32 / (points * 2) as f32 * std::f32::consts::TAU;
                Vec2::new(cx + r * t.cos(), cy + r * t.sin())
            })
            .collect();
        Path::polygon(&pts)
    }

    fn polygon(cx: f32, cy: f32, r: f32, n: usize) -> Path {
        let pts: Vec<Vec2> = (0..n)
            .map(|i| {
                let t = i as f32 / n as f32 * std::f32::consts::TAU;
                Vec2::new(cx + r * t.cos(), cy + r * t.sin())
            })
            .collect();
        Path::polygon(&pts)
    }

    fn sample_points(p: &Path) -> Vec<Vec2> {
        let mut v = Vec::new();
        p.flatten(0.1, |q, _| v.push(q));
        v
    }

    /// Distance from `p` to the nearest point of the polyline through `pts`.
    fn dist_to_polyline(p: Vec2, pts: &[Vec2]) -> f32 {
        let mut best = f32::INFINITY;
        for w in pts.windows(2) {
            let (a, b) = (w[0], w[1]);
            let d = b - a;
            let l2 = d.len2();
            let t = if l2 <= 0.0 { 0.0 } else { ((p - a).dot(d) / l2).clamp(0.0, 1.0) };
            best = best.min(p.dist(a.lerp(b, t)));
        }
        best
    }

    #[test]
    fn same_seed_and_geometry_give_byte_identical_meshes() {
        for p in [
            Path::rect(&Box2d::from_xywh(0.0, 0.0, 160.0, 90.0)),
            Path::ellipse(&Box2d::from_xywh(0.0, 0.0, 200.0, 120.0)),
            star(0.0, 0.0, 80.0, 34.0, 5),
            polygon(0.0, 0.0, 70.0, 6),
        ] {
            let a = tessellate(&p, &draw_style(0xc0ffee), 1);
            let b = tessellate(&p, &draw_style(0xc0ffee), 1);
            assert_eq!(a.stroke.positions, b.stroke.positions, "positions differ across tessellations");
            assert_eq!(a.stroke.indices, b.stroke.indices, "indices differ across tessellations");
            assert!(!a.stroke.is_empty());
        }
    }

    #[test]
    fn different_seeds_give_different_outlines() {
        let p = Path::rect(&Box2d::from_xywh(0.0, 0.0, 160.0, 90.0));
        let a = tessellate(&p, &draw_style(1), 1);
        let b = tessellate(&p, &draw_style(2), 1);
        assert_ne!(a.stroke.positions, b.stroke.positions);
    }

    #[test]
    fn outline_stays_near_the_true_geometry() {
        for p in [
            Path::rect(&Box2d::from_xywh(0.0, 0.0, 160.0, 90.0)),
            Path::ellipse(&Box2d::from_xywh(0.0, 0.0, 200.0, 120.0)),
            star(0.0, 0.0, 80.0, 34.0, 5),
            polygon(0.0, 0.0, 70.0, 6),
            Path::polyline(&[(0.0, 0.0).into(), (120.0, 10.0).into(), (200.0, 90.0).into()]),
        ] {
            let mut truth = sample_points(&p);
            if p.is_closed() {
                truth.push(truth[0]);
            }
            for seed in 0..24u32 {
                let style = draw_style(seed);
                let limit = DRAW_MAX_DEVIATION * style.stroke_width;
                for (sketch, _) in draw_passes(&p, &style) {
                    for q in sample_points(&sketch) {
                        let d = dist_to_polyline(q, &truth);
                        assert!(d <= limit, "sketched point strayed {d} from the outline (limit {limit})");
                    }
                }
            }
        }
    }

    #[test]
    fn corner_radius_never_exceeds_half_the_shorter_segment() {
        for &(l_prev, l_next) in &[(1.0f32, 40.0f32), (0.2, 0.5), (100.0, 100.0), (3.0, 1.0), (0.0, 10.0)] {
            for width in [0.5f32, 2.0, 8.0, 40.0] {
                for jitter in [0.7f32, 1.0, 1.3] {
                    let r = corner_radius(width, l_prev, l_next, jitter);
                    assert!(r <= 0.5 * l_prev.min(l_next) + 1e-6, "radius {r} over half of {l_prev}/{l_next}");
                    assert!(r >= 0.0);
                }
            }
        }
    }

    #[test]
    fn fills_are_untouched_by_the_draw_style() {
        for p in [
            Path::rect(&Box2d::from_xywh(0.0, 0.0, 160.0, 90.0)),
            Path::ellipse(&Box2d::from_xywh(0.0, 0.0, 200.0, 120.0)),
            star(0.0, 0.0, 80.0, 34.0, 5),
        ] {
            let solid = Style { fill: 0x336699ff, stroke: 0x000000ff, stroke_width: 4.0, dash: dash::SOLID, ..Style::default() };
            let drawn = Style { dash: dash::DRAW, seed: 7, ..solid };
            let a = tessellate(&p, &solid, 1);
            let b = tessellate(&p, &drawn, 1);
            assert!(!a.fill.is_empty());
            assert_eq!(a.fill.positions, b.fill.positions);
            assert_eq!(a.fill.indices, b.fill.indices);
            assert_ne!(a.stroke.positions, b.stroke.positions);
        }
    }

    #[test]
    fn other_dash_styles_are_untouched() {
        let p = Path::rect(&Box2d::from_xywh(0.0, 0.0, 160.0, 90.0));
        for dash in [dash::SOLID, dash::DASHED, dash::DOTTED] {
            let plain = Style { fill: 0, stroke: 0x000000ff, stroke_width: 4.0, dash, ..Style::default() };
            let seeded = Style { seed: 999, ..plain };
            let a = tessellate(&p, &plain, 1);
            let b = tessellate(&p, &seeded, 1);
            assert_eq!(a.stroke.positions, b.stroke.positions, "seed changed a non-draw stroke");
        }
    }

    /// Budgeted over a mixed page, not per shape: the plain stroke of a hexagon is
    /// 24 triangles, so *any* hand-drawn version of it is a large multiple of a very
    /// small number. What has to hold is that a page of draw-styled shapes does not
    /// cost several times a page of plain ones.
    #[test]
    fn draw_strokes_stay_within_the_triangle_budget_over_a_page() {
        let page = [
            Path::rect(&Box2d::from_xywh(0.0, 0.0, 160.0, 90.0)),
            Path::ellipse(&Box2d::from_xywh(0.0, 0.0, 200.0, 120.0)),
            star(0.0, 0.0, 80.0, 34.0, 5),
            polygon(0.0, 0.0, 70.0, 6),
            Path::rounded_rect(&Box2d::from_xywh(0.0, 0.0, 160.0, 90.0), 16.0),
            Path::polyline(&[(0.0, 0.0).into(), (120.0, 10.0).into(), (200.0, 90.0).into()]),
        ];
        let (mut plain_tris, mut draw_tris) = (0usize, 0usize);
        for (i, p) in page.iter().enumerate() {
            let plain = Style { fill: 0, stroke: 0x000000ff, stroke_width: 4.0, dash: dash::SOLID, ..Style::default() };
            let drawn = Style { dash: dash::DRAW, seed: i as u32 + 1, ..plain };
            plain_tris += tessellate(p, &plain, 1).stroke.indices.len();
            draw_tris += tessellate(p, &drawn, 1).stroke.indices.len();
        }
        let ratio = draw_tris as f32 / plain_tris as f32;
        assert!(ratio <= 2.6, "draw strokes cost {ratio:.2}x the plain ones ({draw_tris} vs {plain_tris} indices)");
    }

    /// A quadratic bridge whose control point lands behind either end doubles back
    /// into a cusp; `fillet_control` rejects those, and this is what would catch a
    /// regression. Sampled far finer than the outline is drawn, so that a genuinely
    /// tight corner — a star's point, rounded — reads as curvature and not a fold.
    #[test]
    fn the_sketched_outline_never_doubles_back() {
        for p in [
            Path::rect(&Box2d::from_xywh(0.0, 0.0, 220.0, 140.0)),
            Path::ellipse(&Box2d::from_xywh(0.0, 0.0, 260.0, 160.0)),
            star(0.0, 0.0, 100.0, 42.0, 5),
            polygon(0.0, 0.0, 90.0, 6),
            Path::rounded_rect(&Box2d::from_xywh(0.0, 0.0, 220.0, 140.0), 20.0),
        ] {
            for seed in 0..32u32 {
                for (sketch, _) in draw_passes(&p, &draw_style(seed)) {
                    let mut v = Vec::new();
                    sketch.flatten(0.002, |q, _| v.push(q));
                    for w in v.windows(3) {
                        let turn = turn_at(w[0], w[1], w[2]).to_degrees();
                        assert!(turn < 90.0, "outline reverses by {turn:.0} deg at {:?} (seed {seed})", w[1]);
                    }
                }
            }
        }
    }

    #[test]
    fn a_long_outline_falls_back_to_one_pass() {
        let pts: Vec<Vec2> = (0..400).map(|i| Vec2::new(i as f32 * 3.0, (i as f32 * 0.4).sin() * 40.0)).collect();
        let wiggle = Path::polyline(&pts);
        assert_eq!(draw_passes(&wiggle, &draw_style(5)).len(), 1);
        assert_eq!(draw_passes(&Path::rect(&Box2d::from_xywh(0.0, 0.0, 160.0, 90.0)), &draw_style(5)).len(), 2);
    }
}
