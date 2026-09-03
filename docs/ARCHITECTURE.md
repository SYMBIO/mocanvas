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

- Wire compatibility with tldraw's sync protocol.
- Slot-compatible UI components.
- Pixel-identical rendering of every built-in shape.

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
SET_STYLE      op=4  handle fill_rgba stroke_rgba stroke_w_f32 dash opacity (7 words)
CLEAR          op=5                                                         (1 word)

Word counts include the opcode.
```

`kind` is a `u16` shape-kind id registered at startup for each `ShapeUtil`.
`zkey` is the fractional index converted to a 64-bit sortable key (see
`@mocanvas/store` `zkey.ts`). Path command words follow `mocanvas-geo::PathCmd`
(MoveTo=0, LineTo=1, QuadTo=2, CubicTo=3, Close=4) followed by their f32 args.

### Frame (WASM → TS)

```
engine.frame(cam_x, cam_y, cam_z, vp_w, vp_h) -> FrameInfo
```

`FrameInfo` exposes pointers and lengths into WASM memory for:

- `vertices: f32[]` interleaved `x y r g b a` (6 floats)
- `indices: u32[]`
- `batches: u32[]` triples `(first_index, index_count, texture_or_0)`
- `overlay: u32[]` handles of visible shapes that need the DOM overlay,
  in z-order, each followed by its screen-space `x y w h rot` as f32 bits.

TS wraps these in typed-array views (no copy) and issues one
`bufferSubData` + one `drawElements` per batch.

### Queries

```
engine.hit_test(x, y, tolerance, filter_flags) -> handle | 0
engine.query_box(minx, miny, maxx, maxy, mode) -> ptr,len of u32 handles
engine.bounds(handle) -> ptr to 4 f32
engine.selection_bounds(ptr_handles, len) -> ptr to 4 f32
```

## Render pipeline (per frame)

1. TS: signals mark `camera` or `scene` dirty → `requestAnimationFrame`.
2. WASM `frame()`: viewport box → BVH query → visible handles sorted by zkey.
3. For each visible shape whose `mesh_version != shape_version`: tessellate
   fill and stroke with lyon into a per-shape mesh cache (local space).
4. Append transformed vertices into the frame vertex buffer, batching by
   texture. Shapes flagged `OVERLAY` skip the mesh and go into the overlay list.
5. TS uploads buffers and draws. Overlay list is diffed against the React
   overlay layer, which positions DOM shapes with `transform` and passes
   pointer events through except when editing.

Stroke widths are in page units and scale with zoom, so meshes never need
retessellation while zooming. Dash patterns (`dash` style word: 0 solid,
1 dashed, 2 dotted, 3 draw) are applied in the tessellator by splitting the
flattened outline into open dash subpaths before stroking.

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
  The `mocanvas` file writer emits the same envelope so files round-trip.

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
3. Glyph atlas text rendering in WASM, image/video assets with textures,
   frame clipping on the GPU, WebGPU backend, persistent per-shape GPU buffers.
4. Migration guide, real `.tldr` schema migrations, collaboration hooks
   (presence records, `mergeRemoteChanges` transport).
