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

Counted, not estimated:

```
pnpm --filter bench api-coverage -- --members --list
```

That enumerates both surfaces from their `.d.ts` declarations and diffs them. It
lives in `apps/bench` because that is the only place the clean-room policy lets
tldraw's declarations be read at all — see [CLEAN_ROOM.md](CLEAN_ROOM.md). The
denominator is every symbol the packages *export*, which is a harder target than
the reference site's index: measuring against declarations can understate
coverage but never flatter it.

### Reach — is the name there

| | |
| :--- | ---: |
| Distinct symbols across the seven SDK packages | 1,485 |
| Exported by mocanvas under the same name | **1,389 (93.5%)** |
| Missing only as a `TL*` alias | 49 |
| Genuinely absent | 47 |

| Package | Symbols | Covered |
| :--- | ---: | ---: |
| `tldraw` (umbrella, re-exports the rest) | 1,485 | 93.5% |
| `@tldraw/editor` | 840 | 89.2% |
| `@tldraw/tlschema` | 286 | 87.8% |
| `@tldraw/store` | 65 | 100% |
| `@tldraw/state` | 27 | 100% |
| `@tldraw/state-react` | 7 | 100% |
| `@tldraw/validate` | 7 | 100% |

The 49 alias gaps are `TL*` spellings of types mocanvas already exports
unprefixed — `TLGeoShapeProps` for `GeoShapeProps`, `TLImageShape` for
`ImageShape`, and so on. That is a hole in `@mocanvas/compat`, whose whole job is
carrying those spellings, rather than a missing capability.

The 47 that are genuinely absent are mostly `@tldraw/utils`, which the umbrella
re-exports: `debounce`, `throttle`, `modulate`, `invLerp`, `isEqual`, `dedupe`,
`rng`, `sortById`, the `getHashFor*` helpers, `Result` / `OkResult` /
`ErrorResult`, `FileHelpers`, `MediaHelpers`, `PngHelpers`, `LruCache`,
`WeakCache`, and type utilities like `Expand`, `RecursivePartial` and
`Awaitable`. The remainder is a short list of real items: `ContextMenu`,
`PeopleMenu` and `PeopleMenuProps`, `TldrawProps`, `TldrawEditorStoreProps`,
`PerformanceTracker`, `FpsScheduler`, and the `DEFAULT_SUPPORTED_MEDIA_TYPE*`
constants.

### Depth — does the name carry its members

Reach flatters: a class counts above if the name exists, whatever shape it is in.
The same script measures the members of every symbol both sides share, which is
the number to trust when the question is whether real code will run.

| Package | Members of shared symbols | Present |
| :--- | ---: | ---: |
| `@tldraw/store` | 502 | 94.6% |
| `@tldraw/tlschema` | 2,829 | 88.4% |
| `@tldraw/editor` | 8,360 | 85.7% |
| `@tldraw/state` | 72 | 80.6% |
| `@tldraw/validate` | 100 | 72.0% |
| `tldraw` (umbrella) | 14,576 | 69.8% |

The types most code actually touches, checked one by one:

| Type | Members |
| :--- | :--- |
| `Vec` / `Box` / `Mat` | complete — 45 / 43 / 22 |
| `Editor` | 304 of 313 |
| `ShapeUtil` | 52 of 77 |

`Editor` is nine short: `getCameraForFollowing`,
`getViewportPageBoundsForFollowing`, `getIsShapeHiddenCache`,
`getChangesToTranslateShape`, `animatingShapes`, and four `EventEmitter` members.
`ShapeUtil` is the thinner of the two — 25 hooks are absent, mostly the `can*`
predicates (`canTabTo`, `canResizeChildren`, `canBeLaidOut`, `canCull`,
`canEditInReadonly`, …) and `createShapeForAsset`.

An app that drives the canvas through the `Editor` API, or through the default
chrome, is well served. What it is most likely to trip over is a `ShapeUtil` hook
it overrides, a `TL*` alias that is not re-exported yet, or a `@tldraw/utils`
helper it imported from `tldraw` rather than writing itself.

> Earlier revisions of this document reported 1,043 of 1,415 symbols (73.7%), and
> the 2.0.0 changelog reported about 88%. Both predate the script above and are
> superseded by it. The old figure also listed the highlight shape, the laser
> tool, `PathBuilder`, the overlay utils and the asset utils as missing; all of
> them exist.

You can measure a real application against this surface rather than trusting the
tables: `scripts/compat-parity.mjs` type-checks a consumer app with `tldraw`
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
