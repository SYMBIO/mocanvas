//! Tessellation and frame assembly.
//!
//! Each shape's outline is tessellated once (in local space) into a cached
//! mesh; the visible meshes are transformed to page space and appended to one
//! interleaved vertex buffer plus one index buffer, batched by texture and clip
//! rect. Because the camera is a shader uniform, those buffers do not depend on
//! it: a build is made for a padded viewport and reused across frames until the
//! scene changes, the viewport leaves the padded box, or the zoom crosses a √2
//! bucket — see [`Renderer::frame`] and [`Renderer::frame_version`]. Textured
//! shapes contribute one uv-mapped quad over their local bounds instead of a fill
//! mesh. The host uploads the buffers by pointer (skipping the upload while the
//! version is unchanged) and draws one call per batch.

#![warn(missing_docs)]

mod frame;
mod tess;

pub use frame::{FrameOutput, Renderer, BATCH_WORDS, DEFAULT_TESS_BUDGET, DEFAULT_VIEWPORT_PAD, LOD_MESH_PX, LOD_MIN_PX, LOD_QUAD_PX, OVERLAY_WORDS, VERTEX_FLOATS};
pub use tess::{dash, dash_path, dash_pattern, draw_passes, draw_passes_with_tremor, tessellate, MeshCache, MeshPart, DRAW_MAX_DEVIATION};
