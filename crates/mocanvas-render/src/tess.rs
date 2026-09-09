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
    /// Zoom bucket this mesh was flattened for.
    ///
    /// Curves are flattened to a *screen*-space tolerance, so a mesh built for
    /// one zoom is too coarse once the camera moves well past it — that is what
    /// made a circle read as a polygon when you zoomed in. The frame builder
    /// re-tessellates when the bucket changes.
    pub zoom_bucket: i32,
    /// Fill triangles (empty if the style has no fill).
    pub fill: MeshPart,
    /// Stroke triangles (empty if the style has no stroke).
    pub stroke: MeshPart,
}

/// Tessellation tolerance, in *screen* pixels.
///
/// Divided by the zoom to get the page-space tolerance actually used, so the
/// error a viewer sees is the same at every magnification. A fixed page-space
/// tolerance means the error grows linearly with zoom: at 8x, a 0.1-unit
/// tolerance is 0.8px of visible faceting on what should be a smooth curve.
pub const TOLERANCE: f32 = 0.1;

/// The finest zoom curves are flattened for.
///
/// Past this the segment count buys nothing a viewer can see and the budget is
/// better spent elsewhere; a circle is already smooth to the pixel here.
pub const MAX_TESSELLATION_ZOOM: f32 = 32.0;

/// Page-space flattening tolerance at `zoom`.
#[inline]
pub fn tolerance_for_zoom(zoom: f32) -> f32 {
    TOLERANCE / zoom.clamp(1.0, MAX_TESSELLATION_ZOOM)
}

/// Page-space flattening tolerance for the hand-drawn outline at `zoom`.
///
/// Deliberately coarser than [`tolerance_for_zoom`], and by the same factor at
/// every zoom. A sketched outline is drawn in two passes over a line that is
/// already wobbling by a stroke width, so flattening it as finely as a true
/// curve multiplies the triangle count for an error nobody can see against the
/// wobble. That ratio is what keeps a page of draw-styled shapes from costing
/// several times a page of plain ones.
#[inline]
pub fn draw_tolerance_for_zoom(zoom: f32) -> f32 {
    DRAW_STROKE_TOLERANCE / zoom.clamp(1.0, MAX_TESSELLATION_ZOOM)
}

/// The path's *closed* subpaths only, for filling.
///
/// Filling is decided per shape — one `NO_FILL` flag — but a path can mix closed
/// and open subpaths, and an arrow is exactly that: an open body with a closed,
/// filled head. Handing the whole thing to the fill tessellator fills the body
/// too, because filling an open subpath means implicitly closing it, and a
/// gently bent arrow came out as a solid crescent.
///
/// Dropping the open subpaths here rather than teaching the caller about them
/// keeps the rule where it belongs: an outline that was never closed has no
/// interior to fill, whatever the shape as a whole asked for.
fn to_lyon_closed(path: &Path) -> LPath {
    // Collect first, emit second: the builder's type is not nameable here, so a
    // closure that borrows it is more trouble than a second pass is worth.
    let mut subs: Vec<Vec<PathCmd>> = Vec::new();
    let mut sub: Vec<PathCmd> = Vec::new();
    for c in path.iter() {
        match *c {
            PathCmd::MoveTo(_) => {
                sub.clear();
                sub.push(*c);
            }
            PathCmd::Close => {
                if sub.len() > 1 {
                    subs.push(std::mem::take(&mut sub));
                }
                sub.clear();
            }
            _ => sub.push(*c),
        }
    }
    let mut b = LPath::builder();
    for sub in &subs {
        for c in sub {
            match *c {
                PathCmd::MoveTo(p) => b.begin(point(p.x, p.y)),
                PathCmd::LineTo(p) => b.line_to(point(p.x, p.y)),
                PathCmd::QuadTo(c1, p) => b.quadratic_bezier_to(point(c1.x, c1.y), point(p.x, p.y)),
                PathCmd::CubicTo(c1, c2, p) => b.cubic_bezier_to(point(c1.x, c1.y), point(c2.x, c2.y), point(p.x, p.y)),
                PathCmd::Close => continue,
            };
        }
        b.end(true);
    }
    b.build()
}

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
pub fn tessellate(path: &Path, style: &Style, geom_version: u32, zoom: f32, zoom_bucket: i32) -> MeshCache {
    let tol = tolerance_for_zoom(zoom);
    let draw_tol = draw_tolerance_for_zoom(zoom);
    let mut out = MeshCache { geom_version, zoom_bucket, ..Default::default() };
    if path.is_empty() {
        return out;
    }
    let lp = to_lyon(path);

    if style.has_fill() && path.is_closed() {
        let filled = to_lyon_closed(path);
        let mut buf: VertexBuffers<[f32; 2], u32> = VertexBuffers::new();
        let mut t = FillTessellator::new();
        let opts = FillOptions::tolerance(tol).with_fill_rule(FillRule::NonZero);
        let ok = t.tessellate_path(
            &filled,
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
                // The anchors the sketch is built from stay on the fixed `TOLERANCE`
                // (see `draw_passes`) so the wobble cannot change with the camera;
                // only the flattening of the result follows the zoom, and at the
                // coarser draw tolerance.
                let opts = StrokeOptions::tolerance(draw_tol)
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
        let dashed = dash_pattern(style.dash, style.stroke_width).map(|(d, g)| to_lyon(&dash_path(path, d, g, tol)));
        let stroke_path = dashed.as_ref().unwrap_or(&lp);
        let mut buf: VertexBuffers<[f32; 2], u32> = VertexBuffers::new();
        let mut t = StrokeTessellator::new();
        let opts = StrokeOptions::tolerance(tol)
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
        let m = tessellate(&p, &Style { fill: 0xffffffff, stroke: 0, ..Style::default() }, 1, 1.0, 0);
        assert_eq!(m.fill.indices.len(), 6);
        assert!(m.stroke.is_empty());
    }

    #[test]
    fn stroke_only_when_requested() {
        let p = Path::ellipse(&Box2d::from_xywh(0.0, 0.0, 100.0, 50.0));
        let m = tessellate(&p, &Style { fill: 0, stroke: 0x000000ff, stroke_width: 4.0, ..Style::default() }, 1, 1.0, 0);
        assert!(m.fill.is_empty());
        assert!(m.stroke.indices.len() > 100);
        assert_eq!(m.stroke.indices.len() % 3, 0);
    }

    #[test]
    fn open_path_never_filled() {
        let p = Path::polyline(&[(0.0, 0.0).into(), (10.0, 0.0).into(), (10.0, 10.0).into()]);
        let m = tessellate(&p, &Style { fill: 0xff0000ff, ..Style::default() }, 1, 1.0, 0);
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
        let m = tessellate(&p, &Style { fill: 0, stroke: 0x000000ff, stroke_width: 4.0, dash: dash::DASHED, ..Style::default() }, 1, 1.0, 0);
        assert!(!m.stroke.is_empty());
        let solid = tessellate(&p, &Style { fill: 0, stroke: 0x000000ff, stroke_width: 4.0, dash: dash::SOLID, ..Style::default() }, 1, 1.0, 0);
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
//    reduced to *anchors*: every detected corner is kept, and the smooth runs
//    between corners are walked, dropping an anchor whenever the arc covered
//    reaches a sixth of the subpath *or* the chord since the last anchor has bowed
//    away from the outline by more than `DRAW_SAGITTA_FRACTION` of the local
//    radius of curvature. Spacing by arc length alone — a fixed number of pieces
//    per subpath — turns a circle into a hexagon however gently it is then
//    perturbed; the sagitta bound is what buys roundness back, and it costs
//    nothing on the straight runs, where the chord never leaves the outline at all.
// 2. **Perturb.** Each anchor is nudged perpendicular to the local direction, and
//    each segment between anchors is bowed by routing it through a quadratic whose
//    mid-point is displaced sideways. Both amplitudes scale with the stroke width
//    and are capped by a fraction of the adjacent segment lengths *and*, on a
//    smooth run, by `DRAW_CURVATURE_FRACTION` of the local radius of curvature —
//    so a long straight edge still gets a visible bow while a small circle, which
//    a bow of the same size would flatten into a polygon, is barely touched.
//
//    The offsets themselves come from `Wobble`, a smooth field indexed by arc
//    length and periodic around the subpath, not from one draw per anchor. That is
//    what lets the two jobs come apart: the anchors are as dense as roundness
//    needs, while the wobble keeps the same long wavelength it had at six anchors
//    and so reads as a shaky hand rather than as fur.
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
// A `draw` *shape* — a recorded freehand stroke — is exempt: its points are
// already a hand movement, and perturbing them a second time only adds lumps the
// hand did not make. The host decides that, by handing this tessellator
// `dash::SOLID` for such a shape while leaving its `dash` prop alone; the engine
// has no notion of which shape a path came from.
//
// Cost, measured over a mixed page of rect / ellipse / hexagon / star / rounded
// rect / polyline at a stroke width of 3.5: 2.5x the triangles of the same page
// stroked plain — the extra over the old fixed six-anchor rule is what roundness
// costs — so a full `DEFAULT_TESS_BUDGET` of 256 shapes stays in the low
// milliseconds, and 5,000 draw-styled shapes spread over the twenty frames the
// budget takes to work through them.

/// How coarsely the finished sketch is flattened into triangles.
///
/// Separate from [`TOLERANCE`], which the sketch's anchors are sampled at, and
/// much coarser, because they answer different questions: that one is "where is
/// the curve?", this is "how smooth
/// must the drawn line look?". A sketched line is drawn in two passes over a
/// stroke that is already wobbling by its own width, so flattening it as finely
/// as a true curve multiplies the triangle count for an error nobody can see
/// against the wobble. Conflating the two put the draw style at 4x the triangles
/// of a plain stroke against a 2.7x budget.
const DRAW_STROKE_TOLERANCE: f32 = 0.5;
/// Arc length between forced anchors, as a fraction of the subpath. Only a
/// ceiling on anchor spacing: the sagitta rule below is what actually places them
/// on a curve, and this stops a long straight run from carrying none at all.
const DRAW_ANCHOR_STEP_FRACTION: f32 = 1.0 / 6.0;
/// Wobble lobes around one subpath. This is the *wavelength* of the wobble, and
/// it is deliberately no longer tied to the anchor step.
///
/// The two were one number, which coupled the frequency of the hand's shake to
/// the density roundness demands. It also meant the visible lobes were not
/// really coming from here at all: measured against tldraw's own 800pt circle,
/// dropping the anchor rounding alone took the lobe count from 21 to 6, so most
/// of what read as a shaky line was the cut-back at each anchor, not the wobble.
/// A cut-back is the same size at every anchor, so an outline built that way can
/// never go quiet — it was within a tenth of its peak for 9% of the arc where
/// tldraw managed 27%. The frequency now comes from the wobble, where it can be
/// modulated, and the rounding is pulled back to the tangent-bridging it was for.
const DRAW_WOBBLE_PERIODS: f32 = 20.0;
/// Chord-to-arc sagitta allowed between consecutive anchors, as a fraction of the
/// local radius of curvature. A chord subtending `θ` on a circle of radius `r`
/// misses the arc by about `r·θ²/8` and is about `r·θ` long, so bounding the miss
/// by `ε·r` is the same as bounding it by `√(ε/8)` of the chord's own length —
/// which needs no radius estimate at all, only the flattened outline the anchors
/// are being picked from. At `ε = 1.5%` that is a chord bowing no more than one
/// part in twenty-three of its length, or about eighteen anchors around a circle.
const DRAW_SAGITTA_FRACTION: f32 = 0.015;
/// Shortest piece the sagitta rule may ask for, × stroke width. Below this the
/// chord error is hidden under the stroke itself, so a tiny shape is not paved
/// with anchors it cannot show.
const DRAW_MIN_PIECE: f32 = 1.0;
/// …but never so long that a subpath is left with fewer pieces than this, which
/// is what keeps a stroke wider than its own shape from drawing a pentagon.
const DRAW_MIN_PIECES: f32 = 8.0;
/// Most pieces one corner-to-corner run is split into. Only a bound on
/// pathological input: a full circle asks for about twenty-five.
const DRAW_MAX_RUN_PIECES: usize = 64;
/// Turn (radians) above which a flattened vertex counts as a corner.
const DRAW_CORNER_TURN: f32 = 0.35;
/// Perpendicular anchor offset, × stroke width…
///
/// This and [`DRAW_BOW_AMP`] now carry the whole of the hand's shake, where they
/// used to share it with the anchor rounding. Both went up when the rounding came
/// down, which is why they read high: measured on an 800pt circle against
/// tldraw's own, the pair land the outline's wander within a few hundredths of
/// theirs from the tenth percentile to the ninetieth.
const DRAW_VERTEX_AMP: f32 = 0.45;
/// …capped at this fraction of the shorter adjacent segment…
const DRAW_VERTEX_MAX_FRACTION: f32 = 0.25;
/// …and, on a smooth run, at this fraction of the local radius of curvature, so
/// the wobble can never be a large part of what it is wobbling.
const DRAW_CURVATURE_FRACTION: f32 = 0.06;
/// Sideways bow at a segment's mid-point, × stroke width…
const DRAW_BOW_AMP: f32 = 0.375;
/// …capped at this fraction of the segment's length.
const DRAW_BOW_MAX_FRACTION: f32 = 0.06;
/// Corner cut-back radius, × stroke width…
const DRAW_CORNER_RADIUS: f32 = 1.3;
/// …plus this fraction of the shorter adjacent segment…
const DRAW_CORNER_LEN_FRACTION: f32 = 0.06;
/// …and never more than this fraction of that shorter segment.
///
/// This cap only binds on spans a few stroke widths long, where the width-based
/// term above would otherwise dominate. It has to be tight there: an arrowhead
/// barb is around four stroke widths, and rounding a third of it away from each
/// side of the tip leaves the two roundings almost touching — a blob where a
/// sharp V was meant to be.
const DRAW_CORNER_MAX_FRACTION: f32 = 0.22;
/// How far a corner's control point is pushed past the true vertex, × stroke width.
const DRAW_OVERSHOOT: f32 = 0.55;
/// …and never more than this fraction of the shorter adjacent segment.
///
/// The push runs along the corner's bisector, which on a sharp corner points
/// straight out of the tip. Uncapped, it is the same absolute distance on an
/// arrowhead as on a rectangle, so it reads as a hand's flourish on one and as a
/// spike on the other.
const DRAW_OVERSHOOT_MAX_FRACTION: f32 = 0.10;
/// Share of the offset taken from a second, independent field rather than the
/// first. Two fields mixed unevenly do not repeat as readily as one, which is
/// what keeps a long outline from looking periodic.
///
/// It was the split between two overlaid *passes*, drawn at 0.85 and 0.6 of the
/// width to look sketched twice. That is gone: two ribbons whose centre-lines
/// wander apart have a silhouette that bulges where they diverge and pinches
/// where they meet, so the line's own edges rippled even where its centre-line
/// was smooth — the difference from tldraw that no amount of tuning the wobble
/// could close, because the wobble was not what caused it. One ribbon at full
/// width has clean edges, and is thicker into the bargain.
const DRAW_SECOND_FIELD_SHARE: f32 = 0.3;

/// Quietest the wobble's amplitude envelope goes, as a fraction of full
/// amplitude…
///
/// A hand does not shake evenly. Measured against tldraw's own rendering of an
/// 800pt circle — fitting a circle to the stroke and asking how far the drawn
/// centre-line wanders — the lobe *count* and the *peak* excursion already
/// agreed closely (24 lobes against 20; peak 0.281 stroke widths against
/// 0.281). What did not agree was how much of the outline sat still: theirs was
/// within a tenth of its peak for 27% of the arc, ours for 9%. Scaling the
/// wobble down cannot fix that — it moves the peak and the body together, and
/// the peak was already right. So the amplitude is modulated instead: an
/// independent field over the same lattice, biased low, which leaves stretches
/// of the outline nearly true and spends the amplitude on the rest.
const DRAW_ENVELOPE_FLOOR: f32 = 0.12;
/// How many times slower than the wobble the envelope runs. It has to be slower:
/// an envelope on the wobble's own lattice only reshuffles the heights of the
/// lobes, leaving one at every lobe position, and the outline still reads as
/// evenly shaky (measured: quiet 8% against the baseline's 9%). Silencing a
/// *stretch* takes a field that stays near its floor across several lobes.
const DRAW_ENVELOPE_SLOWDOWN: f32 = 3.0;
/// …and how sharply it favours quiet over loud. The envelope is a unit field
/// raised to this power, so above 1 it spends most of the arc near the floor.
const DRAW_ENVELOPE_BIAS: f32 = 2.2;

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

/// Deterministic value in `[0, 1)` for one `(seed, stream, index)` triple. Indexed
/// rather than sequential: a value depends only on where it is wanted, never on
/// how many were drawn before it, so adding a draw somewhere cannot shift every
/// value after it.
#[inline]
fn rand_at(seed: u32, stream: u32, index: u32) -> f32 {
    let mut s = mix_seed(seed, stream.wrapping_mul(0x9e37_79b9) ^ index.wrapping_mul(0x85eb_ca6b));
    (splitmix32(&mut s) >> 8) as f32 * (1.0 / 16_777_216.0)
}

/// A wobble along a subpath: one random value per cell of arc length,
/// smoothstep-interpolated between neighbours and wrapped at `periods` so a
/// closed outline's wobble meets itself at the seam.
///
/// Sampling by arc length rather than by anchor index is what decouples the two
/// jobs the anchors used to do at once. The anchors are spaced by whatever
/// roundness demands (see [`draw_anchors`]); the wobble keeps its long
/// wavelength regardless, so a finely sampled circle wobbles gently rather than
/// growing fur.
struct Wobble {
    seed: u32,
    stream: u32,
    periods: u32,
}

impl Wobble {
    /// The value at lattice cell `k`, in `[-1, 1)`.
    #[inline]
    fn cell(&self, k: i32) -> f32 {
        let i = k.rem_euclid(self.periods.max(1) as i32) as u32;
        rand_at(self.seed, self.stream, i) * 2.0 - 1.0
    }
    /// The interpolated value at cell coordinate `u`, in `[-1, 1)`.
    #[inline]
    fn at(&self, u: f32) -> f32 {
        let k = u.floor();
        let t = u - k;
        let t = t * t * (3.0 - 2.0 * t);
        let (a, b) = (self.cell(k as i32), self.cell(k as i32 + 1));
        a + (b - a) * t
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

/// Radius of the circle the outline is locally following, estimated from the turn
/// across two spans of the given lengths: a circle of radius `r` sampled at chords
/// of length `l` turns by about `l / r` at each sample, so `r ≈ l / turn`. Returns
/// infinity where the outline is straight, which leaves the caller's other caps to
/// do the work.
#[inline]
fn local_radius(turn: f32, l_prev: f32, l_next: f32) -> f32 {
    let l = 0.5 * (l_prev + l_next);
    if turn <= 1e-4 || l <= 0.0 {
        return f32::INFINITY;
    }
    l / turn
}

/// Turn at anchor `i` of a perturbed anchor list, wrapping at the seam of a closed
/// subpath (whose first and last anchors are the same point) and zero at the free
/// ends of an open one.
#[inline]
fn turn_of(a: &[mocanvas_geo::Vec2], i: usize, m: usize, closed: bool) -> f32 {
    let (prev, next) = if closed {
        (a[if i == 0 { m - 2 } else { i - 1 }], a[if i == m - 1 { 1 } else { i + 1 }])
    } else if i == 0 || i == m - 1 {
        return 0.0;
    } else {
        (a[i - 1], a[i + 1])
    };
    turn_at(prev, a[i], next)
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
    /// Each anchor's arc position, in [`Wobble`] cells.
    cell: Vec<f32>,
    /// Each span mid-point's arc position, in [`Wobble`] cells.
    mid_cell: Vec<f32>,
    /// Cells around the whole subpath — the wobble's period, so a closed outline
    /// wraps onto itself.
    periods: u32,
    closed: bool,
}

/// Sagitta allowed between consecutive anchors as a fraction of the chord itself:
/// `√(ε/8)`, the chord-relative form of [`DRAW_SAGITTA_FRACTION`].
#[inline]
fn draw_sagitta_of_chord() -> f32 {
    (DRAW_SAGITTA_FRACTION / 8.0).sqrt()
}

/// How far the outline between vertices `a` and `b` leaves the chord joining them
/// — the chord's actual sagitta, measured rather than inferred from a turn angle,
/// which under-counts it by a factor of `k/(k-1)` over `k` flattened segments.
fn chord_sagitta(pts: &[mocanvas_geo::Vec2], a: usize, b: usize) -> f32 {
    let (p, q) = (pts[a], pts[b]);
    let d = q - p;
    let l = d.len();
    let mut worst = 0.0f32;
    for &v in &pts[a + 1..b] {
        let w = v - p;
        worst = worst.max(if l <= 0.0 { w.len() } else { w.cross(d).abs() / l });
    }
    worst
}

/// Reduce a subpath to its wobble anchors: every corner, plus enough points along
/// the runs between them that the outline never cuts a corner off a curve. A
/// closed subpath is rotated to start at its first corner and its start point
/// repeated at the end, so callers handle one case.
///
/// Spacing follows arc length *and* curvature: an anchor goes down once the walk
/// has covered `step` of arc — a sixth of the subpath, never less than two stroke
/// widths — or once the chord since the last anchor has bowed away from the
/// outline by more than [`DRAW_SAGITTA_FRACTION`] of the local radius, whichever
/// comes first, and never sooner than [`DRAW_MIN_PIECE`] stroke widths.
///
/// The sagitta rule is what keeps a circle a circle. A fixed piece count per
/// subpath makes one a hexagon no matter how gentle the perturbation is; bounding
/// the chord error instead puts anchors wherever the outline actually bends and
/// leaves the straight runs alone — a circle picks up twenty-odd of them, a
/// rectangle still four.
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
        return Anchors {
            pts: Vec::new(),
            mids: Vec::new(),
            corner: Vec::new(),
            cell: Vec::new(),
            mid_cell: Vec::new(),
            periods: 1,
            closed: sp.closed,
        };
    }
    let step = (total * DRAW_ANCHOR_STEP_FRACTION).max(2.0 * width);
    // A stroke wider than the shape it is drawing would otherwise leave a circle
    // with four or five anchors, so the floor also yields to the subpath's length.
    let min_piece = (DRAW_MIN_PIECE * width).min(total / DRAW_MIN_PIECES).max(1e-4);
    let sag_of_chord = draw_sagitta_of_chord();
    // The wobble's lattice is its own: fixed by the subpath's length and the
    // wavelength asked for, never by where the anchors happened to land. Sharing
    // one number with `step` meant raising the shake's frequency also forced
    // anchors closer together, which walked a small circle straight through the
    // sagitta bound — the lattice is what wanted to be finer, not the polygon.
    //
    // The floor at two stroke widths is still the lattice's, though: a lobe
    // narrower than the pen is drawing cannot be seen, only paid for.
    let cell_len = (total / DRAW_WOBBLE_PERIODS).max(2.0 * width);
    let periods = (total / cell_len).round().max(3.0) as u32;
    let to_cell = periods as f32 / total;

    let mut anchors = Vec::with_capacity(cuts.len() * 2);
    let mut mids = Vec::with_capacity(cuts.len() * 2);
    let mut corner = Vec::with_capacity(cuts.len() * 2);
    let mut cell = Vec::with_capacity(cuts.len() * 2);
    let mut mid_cell = Vec::with_capacity(cuts.len() * 2);
    for (c, w) in cuts.windows(2).enumerate() {
        let (a, b) = (w[0], w[1]);
        // Walk the run, splitting at a flattened vertex as soon as either budget is
        // spent. Splitting at real vertices rather than at resampled arc positions
        // puts every anchor exactly on the true outline.
        let mut splits: Vec<usize> = vec![a];
        let mut last = a;
        // Up to and including `b`: the run's own end is the last chord that can be
        // measured, and without checking it the final piece keeps whatever error was
        // left over when the walk ran out of vertices.
        for i in a + 1..=b {
            let run = cum[i] - cum[last];
            // Arc length spends its budget at `i`; the sagitta rule instead spends it
            // *before* `i`, because by the time a chord is measured to bow too far it
            // is already too long — so the anchor goes on the vertex before it, the
            // last one that was still inside the bound.
            let long = run >= step;
            // The flattened polyline is itself only within `TOLERANCE` of the true
            // curve, so that much of the budget is already spent before the chord is
            // measured — without it a small circle, whose flattening is coarse
            // relative to its radius, passes a bound it does not actually meet.
            let bent = i > last + 1
                && chord_sagitta(&pts, last, i) + TOLERANCE > sag_of_chord * pts[last].dist(pts[i]);
            let cut = if long { i } else { i - 1 };
            // Never leave a runt behind or ahead: a piece shorter than the stroke
            // width is swamped by the cut-backs at its two ends, and the chord error
            // it would have saved hides under the stroke anyway.
            let room = cum[cut] - cum[last] >= min_piece && cum[b] - cum[cut] >= min_piece;
            if (long || bent) && cut > last && cut < b && room && splits.len() < DRAW_MAX_RUN_PIECES {
                splits.push(cut);
                last = cut;
            }
        }
        for (j, &i) in splits.iter().enumerate() {
            let s0 = cum[i];
            let s1 = if j + 1 < splits.len() { cum[splits[j + 1]] } else { cum[b] };
            anchors.push(pts[i]);
            mids.push(point_at_arc(&pts, &cum, 0.5 * (s0 + s1)));
            corner.push(j == 0 && real[c]);
            cell.push(s0 * to_cell);
            mid_cell.push(0.5 * (s0 + s1) * to_cell);
        }
    }
    let last = *cuts.last().unwrap();
    anchors.push(pts[last]);
    corner.push(*real.last().unwrap());
    cell.push(cum[last] * to_cell);
    Anchors { pts: anchors, mids, corner, cell, mid_cell, periods, closed: sp.closed }
}

/// Append one sketched pass over `anchors` to `out`.
///
/// For a closed subpath the first and last anchor are the same point; this emits
/// them apart, the last one running past the first so the outline overshoots at
/// the seam. The result is always an open subpath, stroked with round caps.
fn sketch_into(out: &mut Path, anchors: &Anchors, width: f32, seed: u32, pass: u32, tremor: f32) {
    use mocanvas_geo::Vec2;
    let pts = &anchors.pts;
    let closed = anchors.closed;
    let m = pts.len();
    if m < 2 {
        return;
    }
    // The base fields depend on the seed only, so both passes share most of their
    // jitter and never drift far enough apart to leave a gap between them.
    let shared = 1.0 - DRAW_SECOND_FIELD_SHARE;
    let own_seed = mix_seed(seed, pass + 1);
    let periods = anchors.periods;
    let field = |stream: u32| (Wobble { seed, stream, periods }, Wobble { seed: own_seed, stream, periods });
    let (vert_base, vert_own) = field(0);
    let (bow_base, bow_own) = field(1);
    // The envelope is drawn from the seed alone, never per pass: a stretch the
    // hand held steady has to be steady in *both* passes, or the quiet one just
    // hides under the loud one and the outline reads as evenly shaky again.
    // Its own, coarser lattice, sampled at a coordinate scaled to match: `u` runs
    // 0..periods around the subpath, so `u * env_scale` runs 0..env_periods and
    // wraps exactly where the outline closes.
    let env_periods = ((periods as f32 / DRAW_ENVELOPE_SLOWDOWN).round() as u32).max(2);
    let env_scale = env_periods as f32 / periods as f32;
    let envelope = Wobble { seed, stream: 5, periods: env_periods };
    let amp_at = |u: f32| {
        let e = 0.5 + 0.5 * envelope.at(u * env_scale);
        DRAW_ENVELOPE_FLOOR + (1.0 - DRAW_ENVELOPE_FLOOR) * e.powf(DRAW_ENVELOPE_BIAS)
    };
    let wobble = |b: &Wobble, o: &Wobble, u: f32| (b.at(u) * shared + o.at(u) * DRAW_SECOND_FIELD_SHARE) * amp_at(u) * tremor;
    // Indexed draws for the things that belong to one anchor rather than to a place
    // along the outline: corner overshoot, corner radius, the closing flourish.
    let unit = |stream: u32, i: usize| {
        rand_at(seed, stream, i as u32) * shared + rand_at(own_seed, stream, i as u32) * DRAW_SECOND_FIELD_SHARE
    };

    // 1. Nudge each anchor perpendicular to the local direction, and push the ones
    //    that are real corners out along their bisector: the corner then sits a
    //    little past the true vertex, which is what makes the silhouette read as
    //    overshot rather than machined. Doing it here, before anything downstream,
    //    keeps the rest of the construction consistent with it.
    //
    //    On a smooth run the nudge is also capped by the local radius of curvature,
    //    estimated as `span / turn`: an offset that is a large fraction of what the
    //    outline is curving through does not read as a wobble, it reads as a
    //    different, lumpier shape. A detected corner is exempt — its turn is a real
    //    kink in the geometry, not curvature to be preserved.
    let mut a = Vec::with_capacity(m);
    let mut off = Vec::with_capacity(m);
    for i in 0..m {
        let (prev, next) = if closed {
            (pts[if i == 0 { m - 2 } else { i - 1 }], pts[if i == m - 1 { 1 } else { i + 1 }])
        } else {
            (pts[i.saturating_sub(1)], pts[(i + 1).min(m - 1)])
        };
        let cur = pts[i];
        let (l_prev, l_next) = (prev.dist(cur), cur.dist(next));
        let mut amp = (DRAW_VERTEX_AMP * width).min(DRAW_VERTEX_MAX_FRACTION * l_prev.min(l_next));
        if !anchors.corner[i] {
            amp = amp.min(DRAW_CURVATURE_FRACTION * local_radius(turn_at(prev, cur, next), l_prev, l_next));
        }
        let mut d = (next - prev).normalize().perp() * (amp * wobble(&vert_base, &vert_own, anchors.cell[i]));
        if anchors.corner[i] {
            let (u_in, u_out) = ((cur - prev).normalize(), (next - cur).normalize());
            let over = (DRAW_OVERSHOOT * width * (0.4 + 0.6 * unit(2, i)))
                .min(DRAW_OVERSHOOT_MAX_FRACTION * l_prev.min(l_next));
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
    //
    // Only a real corner is cut back. A smooth anchor gets nothing: the two spans
    // meeting there are given the *same* tangent below, so there is no tangent step
    // for a cut-back to hide. Cutting one anyway was what put a periodic inward pull
    // at every anchor — the outline's lobes — and shrinking it to hide them instead
    // exposed the tangent steps as facets you could count at high zoom. Sharing the
    // tangent removes the reason for either.
    let mut radius = vec![0.0f32; m];
    for i in 1..m - 1 {
        if !anchors.corner[i] {
            continue;
        }
        let (l_prev, l_next) = (seg[i - 1].1, seg[i].1);
        radius[i] = corner_radius(width, l_prev, l_next, 0.7 + 0.6 * unit(3, i));
    }
    // The seam is a corner like any other. On a closed outline the first and last
    // anchor are the same vertex, so its two spans are the last one and the first
    // one; without this it was the only vertex left un-rounded, which read as a
    // single sharp spike on an otherwise soft shape — the top of a triangle, one
    // point of a star.
    if closed && m >= 3 {
        let (l_prev, l_next) = (seg[m - 2].1, seg[0].1);
        let r = if anchors.corner[0] { corner_radius(width, l_prev, l_next, 0.7 + 0.6 * unit(3, 0)) } else { 0.0 };
        radius[0] = r;
        radius[m - 1] = r;
    }

    // 3. The tangent each anchor is passed through. On a smooth anchor it points
    //    through its two neighbours, and *both* spans meeting there use it — which is
    //    what makes the join smooth without anything bridging it. A corner has no
    //    single tangent by definition; its spans use their own chords, and the
    //    cut-back and fillet below do the work instead.
    let tangent: Vec<Vec2> = (0..m)
        .map(|i| {
            let (prev, next) = if closed {
                (a[if i == 0 { m - 2 } else { i - 1 }], a[if i == m - 1 { 1 } else { i + 1 }])
            } else {
                (a[i.saturating_sub(1)], a[(i + 1).min(m - 1)])
            };
            let d = next - prev;
            if d.len() > 1e-6 { d.normalize() } else { seg[i.min(m - 2)].0 }
        })
        .collect();

    // 4. One cubic per span, leaving and arriving along those tangents and aimed
    //    through the outline's own mid-point (carried along by the average of the two
    //    anchors' offsets, then bowed sideways) — so a curve reduced to a few anchors
    //    is followed rather than cut across by its chords.
    //
    //    A cubic rather than a quadratic because a quadratic has one control point
    //    and cannot honour a tangent at each end *and* pass through a chosen
    //    mid-point; the third degree of freedom is exactly what the shared tangents
    //    need.
    let mut spans: Vec<(Vec2, Vec2, Vec2, Vec2)> = Vec::with_capacity(m - 1);
    for i in 0..m - 1 {
        let (u, len) = seg[i];
        if len <= 1e-6 {
            spans.push((a[i], a[i], a[i], a[i]));
            continue;
        }
        let start = a[i] + u * radius[i];
        let end = a[i + 1] - u * radius[i + 1];
        // The bow is capped the same way as the anchor nudge: over a span that turns
        // sharply there is very little room between the chord and the arc, and a bow
        // that fills it flattens the curve into a facet.
        let turn = 0.5 * (turn_of(&a, i, m, closed) + turn_of(&a, i + 1, m, closed));
        let bow = (DRAW_BOW_AMP * width)
            .min(DRAW_BOW_MAX_FRACTION * len)
            .min(DRAW_CURVATURE_FRACTION * local_radius(turn, len, len))
            * wobble(&bow_base, &bow_own, anchors.mid_cell[i]);
        let target = anchors.mids[i] + (off[i] + off[i + 1]) * 0.5 + u.perp() * bow;

        // A corner has no shared tangent — the span leaves and arrives along its own
        // chord, and the cut-back and fillet take the turn. Reading `tangent` there
        // would have the span arrive pointing the way the *next* segment leaves,
        // which on a rectangle's corner is a right-angle reversal.
        let t0 = if anchors.corner[i] { u } else { tangent[i] };
        let t1 = if anchors.corner[i + 1] { u } else { tangent[i + 1] };
        let h = (end - start).len() / 3.0;
        // With handles `h` along each tangent the cubic's mid-point sits at
        // `(P0+P3)/2 + 3h(t0-t1)/8`; pushing both handles by `d` moves it by `3d/4`.
        // Solve for the `d` that lands it on `target`, so the span still follows the
        // true outline and not its chord.
        let base = start.lerp(end, 0.5) + (t0 - t1) * (3.0 * h / 8.0);
        let mut d = (target - base) * (4.0 / 3.0);
        // A span asked to bend far enough folds back on itself. Two limits, both
        // inherited from the quadratic this replaced: the push may not exceed half
        // the span, and neither handle may end up behind the start or past the end
        // along the chord — which is what turns a bend into a cusp.
        let max = 0.5 * len;
        if d.len() > max {
            d = d * (max / d.len());
        }
        let chord = (end - start).dot(u).max(0.0);
        let clamp_along = |c: Vec2| {
            let along = (c - start).dot(u);
            c + u * (along.clamp(0.0, chord) - along)
        };
        spans.push((start, clamp_along(start + t0 * h + d), clamp_along(end - t1 * h + d), end));
    }

    // 5. Emit. A join where nothing was cut back needs no bridge — the two spans
    //    already share a tangent there. Only a corner leaves a gap, and that is
    //    bridged the way it always was, with a quadratic through where the two
    //    tangents meet.
    out.move_to(spans[0].0);
    for (i, &(_, _, c2, end)) in spans.iter().enumerate() {
        let sp = spans[i];
        out.cubic_to(sp.1, sp.2, sp.3);
        if let Some(&(next_start, next_c1, _, _)) = spans.get(i + 1) {
            if (next_start - end).len() > 1e-6 {
                out.quad_to(fillet_control(end, end - c2, next_start, next_c1 - next_start), next_start);
            }
        }
    }
    if closed {
        let (_, _, last_ctrl, last_end) = spans[spans.len() - 1];
        let (first_start, first_ctrl, _, _) = spans[0];
        // Bridge the seam with the same fillet used at every other corner, so the
        // rounding is continuous all the way round rather than stopping one vertex
        // short of where it started.
        out.quad_to(
            fillet_control(last_end, last_end - last_ctrl, first_start, first_ctrl - first_start),
            first_start,
        );
        // And close it, rather than running on past the start the way a pen does.
        //
        // The flourish was the more honest gesture and it has to go: any stroke
        // laid over another is drawn twice, and at less than full opacity that
        // reads as a dark blot exactly where the outline began — the one place a
        // shape has no business being darker. Round caps at the two ends did the
        // same thing on their own, so trimming the flourish alone would not have
        // been enough; closing the subpath replaces both with a single join and
        // covers every pixel once.
        out.close();
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
    draw_passes_inner(path, style, 1.0)
}

/// [`draw_passes`], with the hand's tremor scaled by `tremor`.
///
/// `1.0` is what gets drawn, and is what [`draw_passes`] asks for. `0.0` keeps
/// everything the style does to the *shape* — the cut-back corners, the overshoot
/// past a vertex, the closed seam — and takes away only the perturbation. That is
/// what a selection outline wants: it has to agree with the drawing about where
/// the corners are, but it is a hairline, and a wobble that a 3.5px stroke
/// swallows whole shows on a hairline as a row of kinks.
pub fn draw_passes_with_tremor(path: &Path, style: &Style, tremor: f32) -> Vec<(Path, f32)> {
    draw_passes_inner(path, style, tremor)
}

fn draw_passes_inner(path: &Path, style: &Style, tremor: f32) -> Vec<(Path, f32)> {
    let width = style.stroke_width.max(0.5);
    let subs = flatten_subpaths(path, TOLERANCE);
    if subs.is_empty() {
        return Vec::new();
    }
    let mut sets = Vec::with_capacity(subs.len());
    for sp in &subs {
        let a = draw_anchors(sp, width);
        if a.pts.len() < 2 {
            continue;
        }
        sets.push(a);
    }
    if sets.is_empty() {
        return Vec::new();
    }
    let mut p = Path::new();
    for (i, anchors) in sets.iter().enumerate() {
        sketch_into(&mut p, anchors, width, mix_seed(style.seed, i as u32 + 1), 0, tremor);
    }
    vec![(p, width)]
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
            let a = tessellate(&p, &draw_style(0xc0ffee), 1, 1.0, 0);
            let b = tessellate(&p, &draw_style(0xc0ffee), 1, 1.0, 0);
            assert_eq!(a.stroke.positions, b.stroke.positions, "positions differ across tessellations");
            assert_eq!(a.stroke.indices, b.stroke.indices, "indices differ across tessellations");
            assert!(!a.stroke.is_empty());
        }
    }

    #[test]
    fn different_seeds_give_different_outlines() {
        let p = Path::rect(&Box2d::from_xywh(0.0, 0.0, 160.0, 90.0));
        let a = tessellate(&p, &draw_style(1), 1, 1.0, 0);
        let b = tessellate(&p, &draw_style(2), 1, 1.0, 0);
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

    /// Chord error of the anchor polygon against the circle it was taken from.
    fn worst_circle_sagitta(r: f32, width: f32) -> (usize, f32) {
        let p = Path::ellipse(&Box2d::from_xywh(0.0, 0.0, 2.0 * r, 2.0 * r));
        let subs = flatten_subpaths(&p, TOLERANCE);
        assert_eq!(subs.len(), 1);
        let a = draw_anchors(&subs[0], width);
        let c = Vec2::new(r, r);
        let mut worst = 0.0f32;
        for w in a.pts.windows(2) {
            worst = worst.max(r - (w[0].lerp(w[1], 0.5) - c).len());
        }
        (a.pts.len(), worst)
    }

    /// The anchor rule's whole point: a circle keeps its roundness. The chord
    /// between consecutive anchors never leaves the true circle by more than
    /// `DRAW_SAGITTA_FRACTION` of the radius — or half a stroke width where that is
    /// looser, which is the escape [`DRAW_MIN_PIECE`] and [`DRAW_MIN_PIECES`] open
    /// for a shape drawn with a pen nearly as wide as itself, and is invisible
    /// under the stroke anyway.
    #[test]
    fn a_circle_stays_round_within_the_sagitta_bound() {
        for i in 0..40 {
            let r = 4.0 + i as f32 * 5.0;
            for j in 0..12 {
                let width = 0.5 + j as f32;
                let (anchors, sagitta) = worst_circle_sagitta(r, width);
                let limit = (DRAW_SAGITTA_FRACTION * r).max(0.5 * width);
                assert!(sagitta <= limit, "r={r} w={width}: chord missed the circle by {sagitta} (limit {limit}, {anchors} anchors)");
            }
        }
        // And concretely: a page-sized circle is not a hexagon. Six anchors would
        // leave a chord 13% of the radius short of the arc.
        let (anchors, sagitta) = worst_circle_sagitta(85.0, 3.5);
        assert!(anchors >= 16, "a circle got only {anchors} anchors");
        assert!(sagitta < 0.015 * 85.0, "sagitta {sagitta}");
    }

    /// A straight run costs nothing extra: the sagitta rule only fires where the
    /// outline actually bends, so a rectangle still comes out with a handful of
    /// anchors and not one per flattened vertex.
    #[test]
    fn straight_runs_are_not_paved_with_anchors() {
        let p = Path::rect(&Box2d::from_xywh(0.0, 0.0, 400.0, 260.0));
        let n: usize = flatten_subpaths(&p, TOLERANCE).iter().map(|s| draw_anchors(s, 4.0).pts.len()).sum();
        assert!((5..=12).contains(&n), "a rectangle took {n} anchors");
    }

    /// Amplitude follows curvature. Two things have to hold at once: shrinking a
    /// circle never makes the sketch wander *further* in absolute terms — the
    /// curvature clamp takes over from the stroke-width cap as the radius drops —
    /// and the wander as a share of the radius falls away steeply, which is what
    /// stops a small circle from being wobbled into a blob.
    #[test]
    fn tight_curvature_damps_the_wobble() {
        let width = 4.0;
        let mut prev_dev = 0.0f32;
        let mut shares = Vec::new();
        for r in [8.0f32, 16.0, 32.0, 64.0, 128.0] {
            let p = Path::ellipse(&Box2d::from_xywh(0.0, 0.0, 2.0 * r, 2.0 * r));
            let c = Vec2::new(r, r);
            let mut dev = 0.0f32;
            for seed in 0..16u32 {
                let style = Style { stroke_width: width, ..draw_style(seed) };
                for (sketch, _) in draw_passes(&p, &style) {
                    for q in sample_points(&sketch) {
                        dev = dev.max(((q - c).len() - r).abs());
                    }
                }
            }
            assert!(dev / r <= 0.14, "a circle of radius {r} wandered {} of its radius", dev / r);
            // "A smaller circle never wanders further" is the curvature clamp's job,
            // and the clamp only has a job below the radius where it stops being the
            // binding constraint — above that the stroke-width cap holds both radii
            // to the same value and `dev` is flat in `r`. Asserting a slope across
            // that plateau tests nothing but the sampling: `dev` is a max over
            // sixteen seeds, and it wobbles by a few percent from one radius to the
            // next. So the comparison runs while the clamp binds; past it the
            // absolute bounds below are what hold.
            let clamped_below = DRAW_VERTEX_AMP * width / DRAW_CURVATURE_FRACTION;
            if r <= clamped_below {
                assert!(dev + 1e-3 >= prev_dev, "the smaller circle at radius {r} wandered further ({dev} vs {prev_dev})");
            }
            assert!(dev <= DRAW_MAX_DEVIATION * width);
            prev_dev = dev;
            shares.push(dev / r);
        }
        let (small, large) = (shares[0], *shares.last().unwrap());
        assert!(small >= 3.0 * large, "the wobble did not thin out with the radius ({small} vs {large})");
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
            let a = tessellate(&p, &solid, 1, 1.0, 0);
            let b = tessellate(&p, &drawn, 1, 1.0, 0);
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
            let a = tessellate(&p, &plain, 1, 1.0, 0);
            let b = tessellate(&p, &seeded, 1, 1.0, 0);
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
            plain_tris += tessellate(p, &plain, 1, 1.0, 0).stroke.indices.len();
            draw_tris += tessellate(p, &drawn, 1, 1.0, 0).stroke.indices.len();
        }
        let ratio = draw_tris as f32 / plain_tris as f32;
        assert!(ratio <= 2.7, "draw strokes cost {ratio:.2}x the plain ones ({draw_tris} vs {plain_tris} indices)");
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

    /// One ribbon, at the full stroke width, whatever the outline.
    ///
    /// This used to be two overlaid passes at 0.85 and 0.6 of the width, to read
    /// as drawn twice — and that is what made the line's *edges* ripple: the
    /// silhouette of two ribbons whose centre-lines wander apart bulges where
    /// they diverge and pinches where they meet, independently of how smooth
    /// either one is. The width matters as much as the count: a pass at 0.85
    /// drew a line thinner than the size asked for.
    #[test]
    fn an_outline_is_drawn_as_one_ribbon_at_full_width() {
        let pts: Vec<Vec2> = (0..400).map(|i| Vec2::new(i as f32 * 3.0, (i as f32 * 0.4).sin() * 40.0)).collect();
        for p in [Path::polyline(&pts), Path::rect(&Box2d::from_xywh(0.0, 0.0, 160.0, 90.0)), Path::ellipse(&Box2d::from_xywh(0.0, 0.0, 800.0, 800.0))] {
            for seed in 0..8u32 {
                let style = Style { stroke_width: 7.0, ..draw_style(seed) };
                let passes = draw_passes(&p, &style);
                assert_eq!(passes.len(), 1, "an outline came back as {} passes", passes.len());
                assert_eq!(passes[0].1, style.stroke_width, "the ribbon is not the width that was asked for");
            }
        }
    }
}
