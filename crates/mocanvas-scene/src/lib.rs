//! Scene mirror: a struct-of-arrays store of the geometric facts about every
//! shape on the current page, a spatial index over their page-space bounds,
//! and the queries the editor needs (hit test, box select, visible set).
//!
//! The scene never owns document truth; the TypeScript store pushes changes
//! into it via `upsert`/`remove`/`set_geometry`/`set_style`.

#![warn(missing_docs)]

mod order;
mod query;
mod scene;
mod style;

pub use order::ZKey;
pub use query::{BoxQueryMode, HitFilter};
pub use scene::{Scene, ShapeRef, Slot, FLAG_CLIP, FLAG_HIDDEN, FLAG_LABEL, FLAG_LOCKED, FLAG_NO_FILL, FLAG_OVERLAY};
pub use style::{unpack_rgba, Style, DEFAULT_HATCH_SPACING};

/// Opaque shape handle assigned by the host. `0` is null.
pub type Handle = u32;

/// Null handle.
pub const NULL_HANDLE: Handle = 0;
