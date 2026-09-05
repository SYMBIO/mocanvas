//! Parity with the TypeScript generators these ports replace.
//!
//! `tests/fixtures/ts-shapes.txt` is written by
//! `apps/bench/scripts/dump-shape-fixtures.mts`, which runs the real
//! `geo-helpers` / `spline-helpers` / `draw-helpers` and records their output as
//! `f32` bit patterns. Nothing here is a hand-copied number: if a generator
//! drifts from the reference implementation, these fail with the exact word.

use mocanvas_geo::shapes::{catmull_rom_path, geo_path, smooth_freehand, GeoKind};
use mocanvas_geo::{PathCmd, Vec2};

const FIXTURE: &str = include_str!("fixtures/ts-shapes.txt");

/// One fixture record: the leading integer fields, then the `f32` payload.
struct Record<'a> {
    tag: &'a str,
    fields: Vec<u32>,
    floats: Vec<f32>,
}

/// Split a record into its integer fields (values that are plainly decimal) and
/// the hex bit patterns that follow. A field is decimal iff it is not 8 hex
/// digits, which the writer guarantees by always padding floats to 8.
fn parse(line: &str) -> Record<'_> {
    let mut it = line.split(' ');
    let tag = it.next().unwrap();
    let mut fields = Vec::new();
    let mut floats = Vec::new();
    for tok in it {
        if tok.len() == 8 && tok.chars().all(|c| c.is_ascii_hexdigit()) {
            floats.push(f32::from_bits(u32::from_str_radix(tok, 16).unwrap()));
        } else {
            fields.push(tok.parse::<u32>().unwrap());
        }
    }
    Record { tag, fields, floats }
}

fn records(tag: &str) -> impl Iterator<Item = Record<'_>> {
    FIXTURE
        .lines()
        .filter(|l| !l.starts_with('#') && !l.is_empty())
        .map(parse)
        .filter(move |r| r.tag == tag)
}

/// The wire words of a path, the way the host's `toPathWords` would emit them.
fn to_words(path: &mocanvas_geo::Path) -> Vec<f32> {
    let mut out = Vec::new();
    for c in path.cmds() {
        match *c {
            PathCmd::MoveTo(p) => out.extend_from_slice(&[PathCmd::OP_MOVE as f32, p.x, p.y]),
            PathCmd::LineTo(p) => out.extend_from_slice(&[PathCmd::OP_LINE as f32, p.x, p.y]),
            PathCmd::QuadTo(c1, p) => out.extend_from_slice(&[PathCmd::OP_QUAD as f32, c1.x, c1.y, p.x, p.y]),
            PathCmd::CubicTo(c1, c2, p) => {
                out.extend_from_slice(&[PathCmd::OP_CUBIC as f32, c1.x, c1.y, c2.x, c2.y, p.x, p.y])
            }
            PathCmd::Close => out.push(PathCmd::OP_CLOSE as f32),
        }
    }
    out
}

fn assert_words_eq(label: &str, got: &[f32], want: &[f32]) {
    assert_eq!(got.len(), want.len(), "{label}: word count {} != {}", got.len(), want.len());
    for (i, (g, w)) in got.iter().zip(want).enumerate() {
        assert_eq!(
            g.to_bits(),
            w.to_bits(),
            "{label}: word {i} is {g} (0x{:08x}), TypeScript says {w} (0x{:08x})",
            g.to_bits(),
            w.to_bits()
        );
    }
}

#[test]
fn geo_paths_match_the_typescript_word_for_word() {
    let mut seen = 0;
    for r in records("geo") {
        // fields: kindIndex flipX flipY nWords; floats: w h then the path words.
        let kind = GeoKind::from_u32(r.fields[0]).expect("fixture names a kind this build knows");
        let flip_x = r.fields[1] == 1;
        let flip_y = r.fields[2] == 1;
        let n = r.fields[3] as usize;
        let (w, h) = (r.floats[0], r.floats[1]);
        let want = &r.floats[2..];
        assert_eq!(want.len(), n, "fixture word count disagrees with its own header");
        let got = to_words(&geo_path(kind, w, h, flip_x, flip_y));
        assert_words_eq(&format!("{kind:?} {w}x{h} flip({flip_x},{flip_y})"), &got, want);
        seen += 1;
    }
    assert!(seen >= 100, "only {seen} geo cases in the fixture — is it stale?");
}

/// `GeoKind`'s discriminants are the host's `GEO_SHAPE_KINDS` indices, and the
/// command stream carries nothing but that number — so a kind inserted in the
/// middle of the host's table, or renamed, would silently redraw every shape
/// after it as something else. The fixture header records the host's table as
/// it stood when these numbers were captured; this pins the two together.
#[test]
fn the_kind_table_is_in_the_hosts_order() {
    let header = FIXTURE
        .lines()
        .find(|l| l.starts_with("# kinds "))
        .expect("fixture header names the host's kind table");
    for (i, name) in header.trim_start_matches("# kinds ").split(' ').enumerate() {
        let kind = GeoKind::from_u32(i as u32).unwrap_or_else(|| panic!("no Rust kind at index {i} ({name})"));
        // "arrow-right" against the Debug name "ArrowRight", "rhombus-2" against "Rhombus2".
        let flattened: String = format!("{kind:?}").to_lowercase();
        let expected: String = name.chars().filter(|c| *c != '-').collect();
        assert_eq!(flattened, expected, "index {i}: Rust says {kind:?}, the host says {name}");
    }
}

#[test]
fn every_geo_kind_is_covered_by_the_fixture() {
    let mut covered = [false; 20];
    for r in records("geo") {
        covered[r.fields[0] as usize] = true;
    }
    for (i, c) in covered.iter().enumerate() {
        assert!(c, "no fixture case for geo kind {i} ({:?})", GeoKind::from_u32(i as u32));
    }
}

#[test]
fn catmull_rom_matches_the_typescript() {
    let mut seen = 0;
    for r in records("spline") {
        // fields: closed nPoints nWords; floats: the points, then p0/c1/c2/p1 per segment.
        let closed = r.fields[0] == 1;
        let n = r.fields[1] as usize;
        let points: Vec<Vec2> = r.floats[..n * 2].chunks(2).map(|c| Vec2::new(c[0], c[1])).collect();
        let want = &r.floats[n * 2..];

        // The fixture records whole segments; the path drops each `p0`, which is
        // the previous `p1`, so compare against the segments it does keep.
        let path = catmull_rom_path(&points, closed);
        let mut got = Vec::new();
        for c in path.cmds() {
            if let PathCmd::CubicTo(c1, c2, p) = *c {
                got.extend_from_slice(&[c1.x, c1.y, c2.x, c2.y, p.x, p.y]);
            }
        }
        let mut want_trimmed = Vec::new();
        for seg in want.chunks(8) {
            want_trimmed.extend_from_slice(&seg[2..]);
        }
        assert_words_eq(&format!("catmull-rom closed={closed}"), &got, &want_trimmed);

        // And the start point, which the path carries as its `MoveTo`.
        if let Some(PathCmd::MoveTo(m)) = path.cmds().first() {
            assert_eq!(m.x.to_bits(), want[0].to_bits());
            assert_eq!(m.y.to_bits(), want[1].to_bits());
        }
        seen += 1;
    }
    assert_eq!(seen, 2, "expected an open and a closed spline case");
}

#[test]
fn freehand_smoothing_matches_the_typescript() {
    let mut seen = 0;
    for r in records("smooth") {
        let n = r.fields[0] as usize;
        let out_n = r.fields[1] as usize;
        let points: Vec<Vec2> = r.floats[..n * 2].chunks(2).map(|c| Vec2::new(c[0], c[1])).collect();
        let want = &r.floats[n * 2..];
        assert_eq!(want.len(), out_n * 2);
        let mut got_pts = Vec::new();
        smooth_freehand(&points, &mut got_pts);
        let got: Vec<f32> = got_pts.iter().flat_map(|p| [p.x, p.y]).collect();
        assert_words_eq(&format!("smooth {n} points"), &got, want);
        seen += 1;
    }
    assert_eq!(seen, 2, "expected a long and a short freehand run");
}
