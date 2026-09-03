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
        let mut buf: VertexBuffers<[f32; 2], u32> = VertexBuffers::new();
        let mut t = StrokeTessellator::new();
        let opts = StrokeOptions::tolerance(TOLERANCE)
            .with_line_width(style.stroke_width)
            .with_line_join(LineJoin::Round)
            .with_line_cap(LineCap::Round);
        let ok = t.tessellate_path(
            &lp,
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
