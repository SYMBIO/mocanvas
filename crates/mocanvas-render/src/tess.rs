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
    /// Hand-drawn look; rendered solid for now.
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
