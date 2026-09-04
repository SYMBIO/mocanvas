//! Temporary instrumented pan/zoom profile (mirrors apps/bench geo workload).
//! Run: cargo run --release --example panzoom_profile -- 5000

use mocanvas_geo::{Box2d, Path, Vec2};
use mocanvas_render::{tessellate, Renderer};
use mocanvas_scene::{Scene, Style, ZKey};
use std::time::Instant;

const CELL: f32 = 140.0;
const VP_W: f32 = 1200.0;
const VP_H: f32 = 800.0;

fn poly(n: usize, b: &Box2d) -> Path {
    let (cx, cy) = (b.center().x, b.center().y);
    let (rx, ry) = (b.width() * 0.5, b.height() * 0.5);
    let pts: Vec<Vec2> = (0..n)
        .map(|k| {
            let a = -std::f32::consts::FRAC_PI_2 + k as f32 * std::f32::consts::TAU / n as f32;
            Vec2::new(cx + rx * a.cos(), cy + ry * a.sin())
        })
        .collect();
    Path::polygon(&pts)
}

fn star(b: &Box2d) -> Path {
    let (cx, cy) = (b.center().x, b.center().y);
    let (rx, ry) = (b.width() * 0.5, b.height() * 0.5);
    let pts: Vec<Vec2> = (0..10)
        .map(|k| {
            let a = -std::f32::consts::FRAC_PI_2 + k as f32 * std::f32::consts::PI / 5.0;
            let f = if k % 2 == 0 { 1.0 } else { 0.42 };
            Vec2::new(cx + rx * f * a.cos(), cy + ry * f * a.sin())
        })
        .collect();
    Path::polygon(&pts)
}

fn build(n: usize) -> Scene {
    let mut sc = Scene::new();
    let cols = (n as f32).sqrt().ceil() as usize;
    for i in 0..n {
        let h = i as u32 + 1;
        let x = (i % cols) as f32 * CELL;
        let y = (i / cols) as f32 * CELL;
        let w = 60.0 + (i % 5) as f32 * 12.0;
        let hh = 60.0 + (i % 7) as f32 * 8.0;
        let rot = if i % 3 == 0 { ((i * 37) % 360) as f32 * std::f32::consts::PI / 180.0 } else { 0.0 };
        sc.upsert(h, 1, 0, ZKey(h as u64), 0, x, y, rot, w, hh);
        let b = Box2d::from_xywh(0.0, 0.0, w, hh);
        let p = match i % 6 {
            0 => Path::rect(&b),
            1 => Path::ellipse(&b),
            2 => poly(3, &b),
            3 => poly(4, &b),
            4 => poly(6, &b),
            _ => star(&b),
        };
        sc.set_geometry(h, p);
        let fill = match i % 4 {
            0 => 0x4465e9ff,
            1 => 0x4465e955,
            _ => 0,
        };
        sc.set_style(h, Style { fill, stroke: 0x1d1d1dff, stroke_width: 2.0, ..Style::default() });
    }
    sc
}

fn fit(b: &Box2d) -> (f32, f32, f32) {
    let z = ((VP_W - 64.0) / b.width().max(1.0)).min((VP_H - 64.0) / b.height().max(1.0)).clamp(0.05, 8.0);
    let c = b.center();
    (-c.x + VP_W / (2.0 * z), -c.y + VP_H / (2.0 * z), z)
}

fn camera(t: f32, b: &Box2d, fitc: (f32, f32, f32)) -> (f32, f32, f32) {
    let c = b.center();
    let z_hi = (fitc.2 * 4.0).min(8.0);
    let at = |px: f32, py: f32, z: f32| (-px + VP_W / (2.0 * z), -py + VP_H / (2.0 * z), z);
    if t < 1.0 / 3.0 {
        let u = t * 3.0;
        at(c.x, c.y, fitc.2 + (z_hi - fitc.2) * u)
    } else if t < 2.0 / 3.0 {
        let u = (t - 1.0 / 3.0) * 3.0;
        at(b.min.x + b.width() * (0.25 + 0.5 * u), c.y, z_hi)
    } else {
        let u = (t - 2.0 / 3.0) * 3.0;
        at(c.x, c.y, z_hi + (fitc.2 - z_hi) * u)
    }
}

fn vp_box(cam: (f32, f32, f32)) -> Box2d {
    let z = cam.2.max(1e-6);
    Box2d::new(Vec2::new(-cam.0, -cam.1), Vec2::new(VP_W / z - cam.0, VP_H / z - cam.1)).expand(1.0 / z)
}

fn main() {
    let n: usize = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(5000);
    let frames: usize = 120;
    let mut sc = build(n);
    let all = sc.all_bounds();
    let fitc = fit(&all);
    let mut r = Renderer::new();

    // Warm: run the whole path once so meshes for the fit view exist.
    let c0 = camera(0.0, &all, fitc);
    r.frame(&mut sc, &vp_box(c0), c0.2);

    let mut visible_ms = 0.0f64;
    let mut total_ms = 0.0f64;
    let mut rebuild_ms = 0.0f64;
    let mut tess_shapes = 0usize;
    let mut tess_ms = 0.0f64;
    let mut vbytes = 0usize;
    let mut worst = 0.0f64;
    let mut per_frame: Vec<f64> = Vec::new();
    let mut vis = Vec::new();
    let mut tessed: Vec<bool> = vec![false; n + 1];

    for i in 0..frames {
        let t = i as f32 / (frames - 1) as f32;
        let cam = camera(t, &all, fitc);
        let vp = vp_box(cam);

        // (a) visible-set query, measured on its own
        let t0 = Instant::now();
        sc.visible_slots(&vp, &mut vis);
        let a = t0.elapsed().as_secs_f64() * 1000.0;
        visible_ms += a;

        // (b) tessellation cost of shapes newly entering the viewport at this zoom
        let mut tms = 0.0;
        let mut tcount = 0;
        for &slot in &vis {
            let sh = sc.shape_at(slot);
            let screen = sh.page_bounds.width().max(sh.page_bounds.height()) * cam.2;
            if screen < 4.0 {
                continue;
            }
            if !tessed[slot as usize] {
                let t1 = Instant::now();
                let m = tessellate(sh.path, sh.style, sh.geom_version);
                tms += t1.elapsed().as_secs_f64() * 1000.0;
                std::hint::black_box(&m);
                tessed[slot as usize] = true;
                tcount += 1;
            }
        }
        tess_ms += tms;
        tess_shapes += tcount;

        // (c) the real frame build
        let t2 = Instant::now();
        let out = r.frame(&mut sc, &vp, cam.2);
        let f = t2.elapsed().as_secs_f64() * 1000.0;
        vbytes += out.vertices.len() * 4 + out.indices.len() * 4;
        total_ms += f;
        rebuild_ms += f;
        per_frame.push(f);
        if f > worst {
            worst = f;
        }
        let _ = out;
    }
    per_frame.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let p50 = per_frame[per_frame.len() / 2];
    let p95 = per_frame[(per_frame.len() as f64 * 0.95) as usize];
    println!("N={n} frames={frames}");
    println!("  frame() total        {:8.2} ms   avg {:6.3}  p50 {:6.3}  p95 {:6.3}  max {:6.3}", total_ms, total_ms / frames as f64, p50, p95, worst);
    println!("  visible_slots        {:8.2} ms   avg {:6.3}  ({:4.1}% of frame)", visible_ms, visible_ms / frames as f64, 100.0 * visible_ms / total_ms);
    println!("  tessellation (new)   {:8.2} ms   shapes {}  ({:4.1}% of frame)", tess_ms, tess_shapes, 100.0 * tess_ms / total_ms);
    println!("  transform+batch      {:8.2} ms   ({:4.1}% of frame)", rebuild_ms - visible_ms - tess_ms, 100.0 * (rebuild_ms - visible_ms - tess_ms) / total_ms);
    println!("  buffer bytes/frame   {:8.1} KB  (total {:.1} MB uploaded)", vbytes as f64 / frames as f64 / 1024.0, vbytes as f64 / 1048576.0);
}
