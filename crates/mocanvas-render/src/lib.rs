//! Tessellation and frame assembly.
//!
//! Each shape's outline is tessellated once (in local space) into a cached
//! mesh; every frame the visible meshes are transformed to page space and
//! appended to one interleaved vertex buffer plus one index buffer, batched by
//! texture and clip rect. Textured shapes contribute one uv-mapped quad over their
//! local bounds instead of a fill mesh. The host uploads the buffers by pointer and
//! draws one call per batch.

#![warn(missing_docs)]

mod frame;
mod tess;

pub use frame::{FrameOutput, Renderer, BATCH_WORDS, LOD_MIN_PX, LOD_QUAD_PX, OVERLAY_WORDS, VERTEX_FLOATS};
pub use tess::{dash, dash_path, dash_pattern, tessellate, MeshCache, MeshPart};
