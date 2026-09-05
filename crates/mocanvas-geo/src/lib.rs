//! 2D geometry primitives for mocanvas.
//!
//! Everything here is `f32`, `#[repr(C)]` where it crosses the WASM boundary,
//! and allocation-free in hot paths.

#![deny(unsafe_op_in_unsafe_fn)]
#![warn(missing_docs)]

pub mod box2d;
pub mod hit;
pub mod mat2d;
pub mod path;
pub mod shapes;
pub mod vec2;

pub use box2d::Box2d;
pub use mat2d::Mat2d;
pub use path::{Path, PathCmd, PathIter};
pub use shapes::{catmull_rom_path, geo_path, polyline_path, smooth_freehand, GeoKind};
pub use vec2::Vec2;

/// Numeric tolerance used across the crate for degenerate-case checks.
pub const EPS: f32 = 1e-5;
