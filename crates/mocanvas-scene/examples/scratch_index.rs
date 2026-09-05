use mocanvas_geo::{Box2d, Path};
use mocanvas_scene::{Scene, ZKey};
use std::time::Instant;

fn run(n: u32, spread: f32, label: &str) {
    let grid = (n as f32).sqrt().ceil() as u32;
    let mut sc = Scene::new();
    let t0 = Instant::now();
    for h in 1..=n {
        let i = h - 1;
        let (x, y) = if spread == 0.0 {
            (0.0, 0.0)
        } else {
            ((i % grid) as f32 * spread, (i / grid) as f32 * spread)
        };
        sc.upsert(h, 1, 0, ZKey(h as u64), 0, x, y, 0.0, 100.0, 100.0);
    }
    let t_upsert = t0.elapsed();
    let t1 = Instant::now();
    for h in 1..=n {
        sc.set_geometry(h, Path::rect(&Box2d::from_xywh(0.0, 0.0, 100.0, 100.0)));
    }
    let t_geo = t1.elapsed();
    println!("{label:24} n={n}  upsert {:>9.1} ms   set_geometry {:>9.1} ms", t_upsert.as_secs_f64()*1e3, t_geo.as_secs_f64()*1e3);
}

fn main() {
    let n: u32 = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(20000);
    run(n, 500.0, "grid (non-coincident)");
    run(n, 0.0, "all at origin");
}
