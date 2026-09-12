# mocanvas architecture

mocanvas is an infinite-canvas SDK with an API surface and document format that
a project using tldraw can migrate to with a mechanical find-and-replace. The
engine is written from scratch. The hot paths (geometry, hit-testing, spatial
indexing, culling, tessellation) live in Rust compiled to WebAssembly; the
document model, tools, and UI live in TypeScript.

## Goals

- Drop-in-shaped API: `Editor`, `ShapeUtil`, `StateNode`, record store with
  `shape:` / `page:` ids, `.tldr` load and save.
- 10× fewer JS objects touched per frame than a DOM/React-per-shape design.
- 100k shapes on a page at 60 fps for pan/zoom, 10k selected shapes dragged at
  60 fps, sub-millisecond hit-testing.
- Renderer backend behind an interface: WebGL2 today, WebGPU later.
- Custom shapes as React components still work (DOM overlay).

## Non-goals (v1)

- Wire compatibility with tldraw's sync protocol. `@mocanvas/sync` is a
  transport of its own; it does not speak tldraw's wire format.
- Pixel-identical rendering of every built-in shape.
- Shipping message catalogues. The translation seam exists
  (`TLUiOverrides.translations`); the strings are the host's.

Slot-compatible UI components were a non-goal here and are no longer: the
`TLComponents` and `TLUiOverrides` surfaces are implemented. See
[MIGRATION.md §7](MIGRATION.md).

## Clean-room rule

No tldraw source is read or referenced while building this. Only public API
documentation and sample `.tldr` documents inform names and formats. Every
dependency must be MIT/Apache/BSD/CC0 licensed. See `docs/CLEAN_ROOM.md`.

## Layer split

```
┌────────────────────────────────────────────────────────────────────┐
│  apps/playground                                                    │
├────────────────────────────────────────────────────────────────────┤
│  mocanvas            default shapes, default tools, default UI     │
├────────────────────────────────────────────────────────────────────┤
│  @mocanvas/editor    Editor, ShapeUtil, StateNode, camera,          │
│                      selection, snapping, React <Canvas/>,         │
│                      renderer frontend (WebGL2 backend)            │
├──────────────────────────┬─────────────────────────────────────────┤
│  @mocanvas/store         │  @mocanvas/wasm  (glue over crates/)     │
│  records, ids, schema,   │  scene mirror, geometry, BVH, hit-test, │
│  history, .tldr IO       │  culling, tessellation → GPU buffers    │
├──────────────────────────┴─────────────────────────────────────────┤
│  @mocanvas/state         signals: atom / computed / react / tx      │
└────────────────────────────────────────────────────────────────────┘
```

### Ownership: who holds the truth

| Concern                              | Owner | Why                                                |
| ------------------------------------ | ----- | -------------------------------------------------- |
| Records (`props`, `meta`, ids, pages) | TS    | Custom shapes carry arbitrary JSON; compat requires JS objects from `getShape()`. |
| Undo/redo history                    | TS    | Operates on record diffs; not a hot path.          |
| Transform, parent, z-order, flags    | WASM  | Mirror of the record fields that geometry depends on. Struct-of-arrays. |
| Shape outline geometry               | WASM  | Built-ins computed in Rust from props; custom shapes upload a path command buffer. |
| Bounds, spatial index, culling       | WASM  | Bulk numeric work.                                 |
| Hit-testing, snapping candidates     | WASM  | Called on every pointer move.                      |
| Tessellated meshes, GPU buffers      | WASM  | Written directly into linear memory; JS uploads by pointer. |
| Tools (state machines)               | TS    | Must be user-extensible with the `StateNode` API.  |
| Text layout                          | TS → WASM (phase 2) | Phase 1 DOM overlay; phase 2 glyph atlas in WASM. |

The TS store is canonical. Every committed change to a shape record is pushed
to WASM as a compact binary command. WASM never mutates the document; it only
mirrors and derives.

## Bridge ABI

All traffic crosses the boundary through a small number of calls per frame,
never per shape.

### Handles

Each record id (`shape:abc`) is interned once to a `u32` handle in TS
(`HandleTable`). WASM only ever sees handles. Handle 0 is reserved (null).

### Command buffer (TS → WASM)

A `Uint32Array`/`Float32Array` pair over one `ArrayBuffer` that TS fills during
a store transaction and flushes once with `engine.apply(cmdPtr, len)`. Opcode
layout (`u32` words; floats are bit-cast):

```
UPSERT_SHAPE   op=1  handle kind parent zkey_lo zkey_hi flags x y rot w h   (12 words)
REMOVE_SHAPE   op=2  handle                                                 (2 words)
SET_GEOMETRY   op=3  handle nwords [path command words...]                  (3+n words)
SET_STYLE      op=4  handle fill stroke stroke_w_f32 dash opacity_f32 seed (8 words)
CLEAR          op=5                                                         (1 word)
SET_TEXTURE    op=6  handle texture                                         (3 words)
SET_GEO        op=7  handle kind flags w_f32 h_f32 stroke_w_f32             (7 words)
SET_SPLINE     op=8  handle flags npoints [x y (f32)]...                    (4+2n words)
SET_POLY       op=9  handle flags npoints [x y (f32)]...                    (4+2n words)
SET_DRAW       op=10 handle flags nsegs [segflags npoints (x y f32)...]...

Word counts include the opcode.
```

`geo_flag` bits: `FLIP_X=1`, `FLIP_Y=2` on `SET_GEO`; `CLOSED=1` on
`SET_SPLINE` / `SET_POLY` / `SET_DRAW`; `FREEHAND=1` per `SET_DRAW` segment.

`SET_GEO`'s stroke width reaches only the open marks drawn *inside* an outline —
the X of an x-box, whose ends sit on the corners and whose round caps would
otherwise spike half a stroke through the box. The outline itself does not move
with it, and a kind with no such marks ignores it.

**Opcodes 7-10 are the parametric fast path.** A built-in shape sends the
numbers that *describe* its outline and the engine generates it, instead of the
host building a `Geometry2d` in JavaScript and uploading its vertices. A shape
util opts in by implementing `getEngineGeometry`; returning `undefined` — the
default, and what every custom shape does — keeps `SET_GEOMETRY`, which is why
opcode 3 is not going away.

Measured at 20,000 shapes (`pnpm --filter bench geo-microbench`): host-side work
drops 10-20×, total time 1.5-1.6×, and the command stream shrinks 1.4-4.6×,
because a rectangle travels as `(kind, w, h)` rather than as its vertices. The
engine half is unchanged — it is dominated by the spatial reindex, not by path
construction, so building the outline in Rust is close to free.

The generators live in `crates/mocanvas-geo/src/shapes.rs` and cover all 20 geo
kinds, cubic splines and freehand smoothing. They compute in `f64` and narrow to
`f32` only when a coordinate enters the path, exactly as the host does, so the
two are **byte-identical** — pinned by `crates/mocanvas-geo/tests/ts_parity.rs`
against fixtures generated from the host implementation itself
(`apps/bench/scripts/dump-shape-fixtures.mts`), not hand-typed.

An unknown geo kind is consumed and reported through `take_error` rather than
desynchronising the stream, and leaves the shape's previous outline in place.

`flags` bits: `HIDDEN=1`, `LOCKED=2`, `OVERLAY=4` (DOM only), `NO_FILL=8`,
`LABEL=16` (GPU + DOM label), `CLIP=32`. A `CLIP` shape (frames) clips every
descendant to its page-space geometry AABB; the nearest clipping ancestor wins
and nested clips intersect. The shape itself is not clipped by its own rect.

`SET_TEXTURE` sets the host texture id of a shape's fill (`0` = none) and is
independent of `SET_STYLE`, which keeps the current texture. With a texture the
fill mesh is replaced by one quad over the shape's local geometry bounds with
`uv` `(0,0)` at the min corner and `(1,1)` at the max corner, coloured
white × opacity; the stroke is drawn as usual. Texture ids are allocated by the
host and uploaded through `RenderBackend.uploadTexture(id, source)`.

`kind` is a `u16` shape-kind id registered at startup for each `ShapeUtil`.
`zkey` is the fractional index converted to a 64-bit sortable key (see
`@mocanvas/store` `zkey.ts`). Path command words follow `mocanvas-geo::PathCmd`
(MoveTo=0, LineTo=1, QuadTo=2, CubicTo=3, Close=4) followed by their f32 args.

### Frame (WASM → TS)

```
engine.frame(cam_x, cam_y, cam_z, vp_w, vp_h, tess_budget) -> FrameInfo
engine.frame_version() -> f64   // bumped only when the buffers are rebuilt
engine.frame_dirty() -> bool    // did this call rebuild them?
engine.frame_pending() -> bool  // shapes still queued behind the budget
```

`FrameInfo` exposes pointers and lengths into WASM memory for:

- `vertices: f32[]` interleaved `x y u v r g b a` (8 floats, 32-byte stride);
  solid geometry has `u = v = 0`
- `indices: u32[]`
- `batches: u32[]`, 8 words each:
  `first_index index_count texture clip_minx clip_miny clip_maxx clip_maxy
  isolate`. The clip words are page-space f32 bits; all four zero = unclipped.
  A new batch starts whenever the texture, the clip rect or the isolation group
  changes.

  `isolate` is 0 for an ordinary batch. Non-zero means the batch is one
  translucent shape's whole mark and the backend must cover each of its pixels
  once — the engine bakes opacity into vertex alpha, so a stroke crossing itself
  would blend twice and show the crossing as a dark knot, where every other
  renderer treats shape opacity as a group. Only a mark that is a single colour
  gets a group (a stroke with no fill and no texture): painting once equals
  compositing the group exactly when the group has one member. The number is
  unique per frame and rises in draw order; the WebGL2 backend uses it as a
  stencil reference, and clears the stencil when 8 bits of it wrap.
- `overlay: u32[]`, 10 words each, for visible shapes that need the DOM
  overlay, in z-order: `handle x y w h rot clip_minx clip_miny clip_maxx
  clip_maxy` as f32 bits, with `x y w h` the page-space bounds and the clip
  rect as in `batches`.

Shapes whose page bounds fall entirely outside their clip rect are culled and
never reach either buffer. Level-of-detail quads and textured quads carry the
clip like any other geometry.

The vertex data is page space and the camera is a shader uniform, so the buffers
do not depend on the camera. `frame()` therefore reuses the previous build while
the scene epoch is unchanged, the viewport is still inside the box that build
covered, and the zoom is in the same √2 bucket; it then leaves the buffers alone
and reports `frame_dirty() == false`, and the host skips re-uploading them.
`engine.set_viewport_pad(p)` grows the built box by a fraction of the viewport so
that panning can reuse it too — off by default, because the pad submits
`(1 + 2p)²` more geometry on every frame in exchange for skipping uploads on some
of them, which only pays when uploads are expensive relative to per-triangle cost.

`tess_budget` caps how many shapes one call may tessellate (0 = no cap, default
`DEFAULT_TESS_BUDGET`). Shapes past the cap are drawn as level-of-detail quads and
picked up by a later frame; `frame_pending()` stays true until the backlog clears,
and the host keeps scheduling frames while it does. This trades a brief flat-quad
stand-in for the multi-hundred-millisecond stall a viewport full of never-seen
shapes used to cause.

TS wraps these in typed-array views (no copy) and issues one
`bufferSubData` (only when `frame_version()` moved) + one `drawElements` per batch. The WebGL2 backend binds the
batch's texture (a 1×1 white texture for `0`, sampled in the fragment shader)
and, for clipped batches only, enables `SCISSOR_TEST` with the clip rect
mapped page → device pixels (`(p + cam) * zoom * dpr`, y flipped).

### Queries

```
engine.hit_test(x, y, tolerance, filter_flags) -> handle | 0
engine.query_box(minx, miny, maxx, maxy, mode) -> ptr,len of u32 handles
engine.bounds(handle) -> ptr to 4 f32
engine.selection_bounds(ptr_handles, len) -> ptr to 4 f32
```

## Render pipeline (per frame)

1. TS: signals mark `camera` or `scene` dirty → `requestAnimationFrame`.
2. WASM `frame()`: if the scene, viewport and zoom bucket still match the last
   build, stop here and report the buffers unchanged. Otherwise: viewport box →
   BVH query → visible handles sorted by zkey.
3. For each visible shape whose `mesh_version != shape_version`, up to the
   frame's tessellation budget: tessellate fill and stroke with lyon into a
   per-shape mesh cache (local space). Shapes past the budget are drawn as
   level-of-detail quads until a later frame reaches them.
4. Append transformed vertices into the frame vertex buffer, batching by
   texture. Shapes flagged `OVERLAY` skip the mesh and go into the overlay list.
5. TS uploads the buffers (unless the engine reports them unchanged) and draws. Overlay list is diffed against the React
   overlay layer, which positions DOM shapes with `transform` and passes
   pointer events through except when editing.

Stroke widths are in page units and scale with zoom, so meshes never need
retessellation while zooming. Dash patterns (`dash` style word: 0 solid,
1 dashed, 2 dotted, 3 draw) are applied in the tessellator. `dashed` and
`dotted` split the flattened outline into open dash subpaths before stroking.

`draw` — the default for every shape — replaces the outline with a hand-drawn
one. The flattened path is reduced to *anchors*: every detected corner, plus the
smooth runs between them walked and split whenever the arc covered reaches a
sixth of the subpath **or** the chord since the last anchor has bowed away from
the outline by more than 1.5% of the local radius of curvature. Bounding that
sagitta rather than fixing a piece count is what keeps a circle a circle — six
anchors make a hexagon however gently it is then perturbed, whereas the sagitta
rule spends anchors only where the outline actually bends and leaves straight
runs alone (a page-sized circle takes about twenty-five, a rectangle four). The
bound yields only to a floor of one stroke width per piece, where the chord error
hides under the stroke anyway; measured over circles of radius 4–200 and stroke
widths 0.5–11.5, the chord never misses by more than 1.5% of the radius or half a
stroke width, whichever is larger.

Each anchor is then nudged perpendicular to the local direction, and each span
between anchors is bowed sideways through a quadratic aimed at the outline's own
mid-point — so a curve reduced to a few anchors is followed rather than cut
across by its chords. Both amplitudes are capped by a fraction of the adjacent
span lengths and, on a smooth run, by 6% of the local radius of curvature
(estimated as span over turn), so a long straight edge still gets a visible bow
while a small circle is barely touched. The offsets come from a smooth field
indexed by *arc length* and periodic around the subpath rather than one draw per
anchor: that keeps the wobble's wavelength at about six lobes however densely
roundness asks the anchors to be placed, so a finely sampled circle reads as a
shaky hand and not as fur.

Anchors that are real corners (not points the resampling dropped on a smooth run)
are additionally pushed out along their bisector, past the true vertex, and every
interior anchor is cut back by a radius taken from the stroke width plus a little
of the shorter adjacent span, clamped to 0.35 of it — or, at a smooth anchor,
0.12 of it, since there the bridge only has to hide the tangent step between two
spans and the wider corner radius would swallow the short spans roundness now
asks for. The cut is bridged by a quadratic whose
control point is where the two spans' tangents meet, which keeps the tangent
continuous across the join: aiming it at the vertex instead leaves a visible kink
at every anchor of a curved outline, and a control point that lands behind either
end folds the bridge into a cusp, so both are rejected in favour of the midpoint.
A closed subpath is emitted open, starting at its first corner and running a
little past it, so the outline overshoots where the pen came back around. Every
amplitude scales with the stroke width, not the shape, and the whole outline
stays within `DRAW_MAX_DEVIATION` (3) stroke widths of the true geometry — which
is itself untouched, and is what fills, bounds and hit-testing keep using.

A `draw` *shape* is exempt. Its points are a recorded pen movement already, so
sketching them a second time only adds bulges the hand never made;
`DrawShapeUtil.getRenderStyle` hands the engine the solid dash id while leaving
`props.dash` alone, so the style panel and a `.tldr` round trip still see `draw`,
and the shape's own `dashed`/`dotted` styles are unaffected. The engine sees only
paths and has no notion of which shape one came from, so the choice belongs to
the host.

Width variation is approximated by stroking that outline twice, at 0.85× and
0.6× the nominal width over slightly different perturbations of the same anchors
(they share most of their jitter, so the two passes never drift apart far enough
to open a gap). A tapered single stroke was the alternative; lyon's stroker takes
one width per call, so tapering would mean tessellating the outline as a filled
ribbon by hand, and unlike a taper the double pass also reproduces the doubled-back
look of a pen going over a line twice. Outlines with more than 64 anchors drop to a
single full-width pass; that test reads only the geometry, so it can never flip
with zoom or shape count and make a shape shimmer. Over a mixed page the draw
style costs about 2.3× the triangles and 2.3× the tessellation time of plain
strokes (8.6 µs against 3.8 µs per shape, so a full 256-shape tessellation budget
is ~2.2 ms and a page of 5,000 draw-styled shapes is ~43 ms spread over 20
frames).

The wobble is deterministic: it comes from a `splitmix32` stream seeded by the
`seed` style word, which the host hashes from the shape's stable id (not its
engine handle, which is recycled). The mesh cache keys on the geometry version
alone, so the same shape has to perturb identically on every rebuild or it would
shimmer whenever it was re-tessellated.

Shapes flagged `LABEL` are drawn on the GPU *and* reported in the overlay
list, so a filled shape can carry a DOM text label.

## Hybrid overlay compositing

GPU shapes are always below DOM shapes. Shapes that must interleave with DOM
shapes get promoted to the overlay layer as well (rendered by their
`ShapeUtil.component`, which built-ins also implement as a fallback). This is
the same compromise Figma makes for text editing and plugin UI.

## Compatibility surface

See `docs/COMPAT.md` for the method-by-method map. Highlights:

- `Editor` methods keep tldraw names where the semantics match
  (`createShapes`, `updateShapes`, `deleteShapes`, `select`, `getShape`,
  `getSelectedShapeIds`, `screenToPage`, `zoomToFit`, `setCurrentTool`...).
- `ShapeUtil<T>` keeps `getDefaultProps`, `getGeometry`, `component`,
  `indicator`, `onResize`, `canBind`, etc. `getGeometry` returns a
  `Geometry2d` that serializes to a path command buffer.
- `StateNode` keeps `id`, `initial`, `children`, `onEnter`, `onExit`,
  `onPointerDown/Move/Up`, `onKeyDown`, `transition`.
- Records: `typeName`, `id`, `type`, `x`, `y`, `rotation`, `index`,
  `parentId`, `isLocked`, `opacity`, `props`, `meta`.
- `.tldr`: `{ tldrawFileFormatVersion, schema, records }` is read and written.
  The mocanvas file writer emits the same envelope so files round-trip.

## Repository layout

```
crates/mocanvas-geo      Vec2, Mat2d, Box2d, PathCmd, Bezier, hit tests, intersections
crates/mocanvas-scene    SoA scene mirror, zkey ordering, BVH (rstar), queries
crates/mocanvas-render   lyon tessellation, mesh cache, frame builder, batching
crates/mocanvas-wasm     wasm-bindgen facade: Engine, command buffer, FrameInfo
packages/state           signals
packages/store           records, ids, zkey, schema, history, .tldr IO
packages/wasm            build output + typed loader
packages/editor          Editor, ShapeUtil, StateNode, Canvas, renderer frontend
packages/mocanvas        default shapes/tools/UI, <Mocanvas/> component
apps/playground          Vite app
```

## Phases

0. Toolchain, monorepo, this document.
1. Vertical slice: geo + scene + render crates, WASM facade, signals, store,
   Editor with camera/selection, select/hand/geo/draw tools, WebGL2 renderer,
   playground. `.tldr` load and save.
2. (done) Text via DOM overlay, arrows and bindings, snapping, resize/rotate
   handles, export SVG/PNG, clipboard, groups, style panel, dash patterns,
   LOD quads, `@mocanvas/compat` aliases.
3. (done) Image assets with GPU textures, text rasterised to textures, frame
   clipping on the GPU, WebGPU backend, arrow/line/frame tools, the icon set,
   and the `.tldr` compatibility layer for documents written by current
   releases (`richText`, encoded draw segments).
4. (done) Collaboration (`@mocanvas/sync`: presence, transports, a relay),
   frame reuse and a tessellation budget, the migration guide, and the
   benchmark against the reference implementation.

The hand-drawn stroke costs about 2.5x the triangles and the tessellation time
of a plain one, and it is the default style, so it is paid on most pages. The
per-frame tessellation budget keeps that off the critical path when shapes
first appear, but the extra triangles are transformed and rasterised every
frame; `docs/BENCHMARK.md` measures a 7-50% cost in the drag redraw path
against a plain stroke. Turning it off is a per-shape style change
(`dash: "solid"`), not a build flag.

Concurrent edits are merged by a per-field CRDT
(`packages/sync/src/crdt.ts`); what it does and does not promise is in
`packages/sync/README.md`.

## Known performance defects

Two were found by measurement rather than by reading, and neither is fixed yet.
Both are recorded here because they are the kind of thing that reads as a hang
rather than as a slowdown.

**The spatial index degenerates on coincident boxes.** Creating 20,000 shapes
that all share a bounding box — every one at the origin — makes `Engine::apply()`
take about **1,660 ms instead of 25 ms**. The rstar index cannot split entries
whose boxes are identical, so the tree collapses. This is not an exotic input:
an app that creates shapes and positions them afterwards hits it directly, which
is what a paste, an import, a template instantiation or a generated layout does.
Candidate fixes, in the order worth trying: an infinitesimal deterministic jitter
applied *in the index only*, never to stored geometry; bulk-loading the index
when a batch arrives instead of inserting one at a time; or detecting
pathological overlap and falling back to a linear scan.

**Snapping rebuilds geometry the engine already holds.** `SnapManager` takes its
candidates from the spatial index — that part is fine — and then calls
`getShapePageBounds` per candidate, where `getShapeGeometry` is not memoised and
reconstructs an entire `Geometry2d` for a box the engine has to hand. Measured at
**0.92 µs per candidate**, which is nothing for a few hundred but about
**18.5 ms per drag frame** when zoomed out over a 20,000-shape page — missing
60 fps on its own. The fix is a bulk read (`Engine::bounds_many`, shaped like the
existing `union_bounds`), not a Rust port of the snap loop: once the boxes are to
hand the loop is trivial arithmetic.

## Assessed and deliberately left in TypeScript

**Arrow routing.** `resolveBody` needs the store — binding terminals, and the
bound shape's outline for the edge intersection — and the label rect needs canvas
text measurement, so a parametric arrow command would cover only the middle third
of the work. The payoff is small: an arrow's path is 10-40 words against a geo
shape's 13-90, and the host-side cost is around 1 µs each, so it would matter
only on a page of 20,000 *arrows*. Worth revisiting if a profile ever shows
arrows dominating.

**Text line breaking.** Breaks are decided from measurements taken by the
browser's own shaper, so moving the loop to Rust would mean shipping every glyph
advance across the boundary per measurement, and the results are already cached.
This becomes a candidate together with the phase-2 glyph atlas, not before.
