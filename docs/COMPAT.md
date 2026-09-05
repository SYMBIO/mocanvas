# Compatibility with tldraw 5.4

mocanvas reimplements the tldraw API from scratch, under MIT, without reading
tldraw's source — see [CLEAN_ROOM.md](CLEAN_ROOM.md). This document says what
that covers today, what it deliberately does not, and where the two libraries
behave differently on purpose.

**Target: tldraw 5.4.0.** Earlier releases of mocanvas were shaped after the 3.x
API; 2.0.0 moved to the 5.x model, which is a different architecture in several
places, not a rename. If you are coming from mocanvas 1.x, read
[MIGRATION.md](MIGRATION.md).

## How much of the API exists

Measured against an enumeration of the public reference documentation, not
against a feeling. Regenerate the enumeration from `tldraw.dev` and re-diff
whenever you want the current figure.

| | |
| :--- | ---: |
| Documented symbols, six SDK packages | 1,415 |
| Exported by mocanvas | **1,043 (73.7%)** |
| Still missing | 372 |
| Excluded on purpose (see below) | ~60 symbols + 3 packages |

Where the remainder is:

| Area | State |
| :--- | :--- |
| `Editor` | **complete** — all 298 documented members |
| `Vec` / `Box` / `Mat` / `Geometry2d` | **complete** — 107 / 58 / 38 / 37 members |
| Geometry classes, intersections, angle and arc helpers | complete |
| React UI components | **complete** — all 233, each reachable through the components map |
| `@tldraw/store`, `@tldraw/state`, `@tldraw/state-react`, `@tldraw/validate` | complete |
| Records, migrations, `.tldr` IO, custom record types | substantially complete |
| `ShapeUtil` / `BindingUtil` / `StateNode` extension points | substantially complete |
| Shapes, tools, export, external content, rich text, themes | substantially complete |

The 372 that remain are concentrated in a few places rather than spread thin:
the canvas **overlay utils** (`BrushOverlayUtil`, `ScribbleOverlayUtil`, the
collaborator set — the `OverlayUtil` base class and `OverlayManager` they plug
into exist, the painters do not); the **`AssetUtil` subclasses**
(`ImageAssetUtil`, `BookmarkAssetUtil`); **`PathBuilder`** and the stroke
helpers; the **highlight** shape and the **laser** tool; the **elbow-arrow**
types; and about 48 `@tldraw/tlschema` symbols, mostly per-shape props and
migration variables.

An app that drives the canvas through the `Editor` API, or through the default
chrome, is well served. What it may still miss is a specific painter, asset util
or shape from the list above.

You can measure a real application against this surface rather than trusting the
table: `scripts/compat-parity.mjs` type-checks a consumer app with `tldraw`
remapped onto `@mocanvas/compat` and reports what breaks, grouped by symbol.

## Packages

| From | To | Note |
| :--- | :--- | :--- |
| `tldraw` | `@mocanvas/mocanvas` | batteries-included: shapes, tools, UI, `<Mocanvas />` |
| `@tldraw/editor` | `@mocanvas/editor` | `Editor`, `ShapeUtil`, `StateNode`, geometry, indicators |
| `@tldraw/store` | `@mocanvas/store` | records, `Store`, `StoreSchema`, migrations, `.tldr` IO |
| `@tldraw/state` | `@mocanvas/state` | `atom`, `computed`, `react`, `transact`, `AtomMap` |
| `@tldraw/state-react` | `@mocanvas/state/react` | `useValue`, `track`, `useAtom` |
| `@tldraw/tlschema` | `@mocanvas/editor` | record and prop types live with the editor |
| `@tldraw/validate` | `@mocanvas/editor` | the `T` validator library |
| any of the above | `@mocanvas/compat` | everything above plus the `TL*`-prefixed spellings |

Core type names drop the `TL` prefix; `@mocanvas/compat` re-exports them with it
(`TLShape = Shape`, `TLShapeId = ShapeId`, and so on), so an existing codebase can
switch its import paths first and rename at its own pace.

## The five differences that are not renames

### 1. Custom shapes register by module augmentation

```ts
declare module "@mocanvas/mocanvas" {
  interface TLGlobalShapePropsMap {
    format: { w: number; h: number }
  }
}
```

From then on `editor.createShape({ type: "format", props: … })` is checked, and
`shape.type === "format"` narrows `shape.props`. Augmenting whichever module you
import from works — the interface merges across the re-export chain.

`Shape` with no type argument is the union of *registered* types. A type nobody
registered is an `UnknownShape`; that split is what lets the union narrow at all.
`@mocanvas/editor` deliberately registers nothing, and the built-in shapes are
registered by `@mocanvas/mocanvas`.

### 2. Indicators are canvas paths, not JSX

```ts
override getIndicatorPath(shape: MyShape): Path2D {
  const path = new Path2D()
  path.rect(0, 0, shape.props.w, shape.props.h)
  return path
}
```

Return `Path2D`, or `TLIndicatorPath` (`{ path, clipPath?, additionalPaths? }`)
when the outline needs a hole punched in it. Coordinates are shape-local; the
compositor supplies the stroke. The old `indicator(): ReactNode` still works and
is deprecated — a util that implements only the old one is routed to the SVG
layer, and one that implements neither gets a rectangle around its bounds.

### 3. Built-in shapes describe their outline; they do not upload it

`ShapeUtil.getEngineGeometry` hands the engine the numbers that generate an
outline — `(kind, w, h)` for a geo shape — instead of building a `Geometry2d` in
JavaScript and copying its vertices across. Returning `undefined`, the default
and what every custom shape does, keeps the `getGeometry` path.

At 20,000 shapes this is 10-20× less host-side work and up to 4.6× fewer words
copied. See [ARCHITECTURE.md](ARCHITECTURE.md) and [BENCHMARK.md](BENCHMARK.md).

### 4. Built-in migrations live under `com.mocanvas.*`

A `.tldr` records the version of every migration sequence it was written under. A
sequence the schema does not know is ignored with a warning and the props load as
written; a sequence it *claims to know* at a lower version is a hard failure.

So mocanvas's own built-in shape migrations use
`BUILTIN_SHAPE_MIGRATION_SEQUENCE_PREFIX` (`com.mocanvas.shape`) rather than
`com.tldraw.shape`. Registering ours under tldraw's id made every real tldraw file
fail to load, because its `geo` line is far ahead of ours. Your own custom shape
types keep the default prefix — nothing else claims those names.

### 5. The engine is optional at construction

`new Editor({ store, shapeUtils, tools, getContainer })` needs no `engine`:
importing `@mocanvas/mocanvas` registers a provider that supplies whatever
`loadEngine()` last produced. Pass one explicitly to run two editors on separate
engines. Without either, construction fails with a message naming both fixes.

## Deliberately not implemented

Client halves of services tldraw operates, which we would have to operate too:

| | Why |
| :--- | :--- |
| Licensing, watermark, license telemetry | mocanvas is MIT; there is no licence to check. `licenseKey` is accepted and ignored. |
| tldraw's hosted sync and demo servers, `@tldraw/sync-core` | `@mocanvas/sync` is the multiplayer layer, with its own transport and a field-level CRDT. |
| The tldraw asset CDN defaults | The asset mechanism is kept; the host is not. Supply your own `AssetStore`. |
| Third-party embed unfurling and integrations | Each is a call to somebody's API. `EmbedShapeUtil.configure({ embedConfig })` lets an app supply its own. |
| tldraw.com UI chrome | Product UI, not SDK surface. |
| `@tldraw/driver`, `@tldraw/mermaid`, `@tldraw/commenting`, `@tldraw/mentions` | Separate libraries. Out of scope for 2.0.0, not ruled out later. |

Not excluded, despite looking infrastructural: attribution, presence primitives,
local persistence, and `onUiEvent`. Those are canvas features.

## Behavioural differences to know about

- **Rendering.** Built-in shapes are GPU meshes, not DOM. `ShapeUtil.component`
  is still used when a shape is being edited or must interleave with a DOM shape.
- **Hit-test margin.** tldraw ships 3 px fine / 4 px coarse. mocanvas keeps its
  own tuned 8 px and gives a coarse pointer 12 px — the same rule (a fingertip
  gets half as much again as a cursor), not the same number. Both are
  `EditorConfig` fields.
- **Double click** is reported in three phases — `down`, `up`, `settle`. The
  built-in tools act on `up`. Further presses inside the window stop counting
  rather than starting a second run, so frantic clicking opens a label editor
  once.
- **Rich text** is ProseMirror JSON, and TipTap is an *optional* peer dependency.
  Rich text renders, measures, exports and round-trips without it; only WYSIWYG
  editing needs it. Two ProseMirror instances on one page break schema identity,
  so an app that already ships TipTap keeps exactly one copy.
- **`pageToScreen` vs `pageToViewport`.** Viewport space is container-relative,
  screen space is window-relative. mocanvas 1.x had one method that computed
  viewport space under the screen-space name; both now exist and mean what they
  say.
- **No watermark, licence key or telemetry.**

## File format

The `.tldr` v1 envelope is unchanged. Records are stored as written, the schema
`sequences` map is preserved, and migrations run for sequences we know. Unknown
record types and unknown props survive a load/save round trip untouched.
`packages/mocanvas/src/tldr-compat.test.ts` pins loading a file written by the
reference implementation.

## Installing the editor's optional members

`Editor.getSvgString`, `Editor.toImage` and `Editor.textMeasure` cannot live in
`@mocanvas/editor`: exporting needs the default shapes' SVG renderers and
measuring text needs the DOM, and both live in `@mocanvas/mocanvas`, which
depends on the editor rather than the other way round. Importing
`@mocanvas/mocanvas` registers them, alongside the engine provider.

An app built on `@mocanvas/editor` alone gets a clear error from those three
until it either imports the flagship or registers its own:

```ts
import { registerExportImplementation, registerTextMeasureImplementation } from "@mocanvas/editor"

registerExportImplementation({ getSvgString, toImage })
registerTextMeasureImplementation(() => myTextMeasure)
```
