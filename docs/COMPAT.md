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
pnpm --filter bench api-coverage -- --reference          # the documented surface
pnpm --filter bench api-coverage -- --members --list     # the stricter one, with names
```

The script enumerates both surfaces and diffs them. It lives in `apps/bench`
because that is the only place the clean-room policy lets tldraw's declarations
be read at all — see [CLEAN_ROOM.md](CLEAN_ROOM.md).

### Against tldraw.dev/reference: 100%

Every symbol the reference documents, in the packages this project maps, exists
under the same name. The enumeration is
`apps/bench/fixtures/tldraw-reference.txt` in the repository,
taken from the site's own sitemap; `--reference` exits non-zero if anything
regresses, so it can hold the line in CI.

| Package | Documented | Covered |
| :--- | ---: | ---: |
| `tldraw` | 642 | **100%** |
| `@tldraw/editor` | 387 | **100%** |
| `@tldraw/tlschema` | 285 | **100%** |
| `@tldraw/store` | 65 | **100%** |
| `@tldraw/state` | 27 | **100%** |
| `@tldraw/state-react` | 7 | **100%** |
| `@tldraw/validate` | 7 | **100%** |
| **In scope** | **1,420** | **1,420 (100%)** |

The reference documents four more packages that mocanvas does not implement:
`@tldraw/sync-core` (42 symbols), `@tldraw/mermaid` (17), `@tldraw/sync` (9, of
which 2 exist) and `@tldraw/driver` (3). The reasons differ — one is a different
multiplayer architecture, two are simply not built yet, and only a single symbol
among them is tied to a service tldraw runs. See *Not implemented* below.
Counting all eleven packages, the whole reference site is 1,422 of 1,491.

### The stricter count: 97.0%

The packages export more than the reference documents. Measured against every
exported symbol instead, mocanvas covers 1,440 of 1,485 — the 45 absent are all
undocumented, and almost all of them are `@tldraw/utils` helpers that the
`tldraw` umbrella re-exports: `debounce`, `throttle`, `modulate`, `invLerp`,
`isEqual`, `dedupe`, `rng`, `sortById`, the `getHashFor*` family, `Result` /
`OkResult` / `ErrorResult`, `FileHelpers`, `MediaHelpers`, `PngHelpers`,
`LruCache`, `WeakCache`, and type utilities like `Expand`, `RecursivePartial` and
`Awaitable`. The rest is `ContextMenu`, `PeopleMenu`, `PeopleMenuProps`,
`PerformanceTracker` and `FpsScheduler`.

None of them are part of the documented API, but `import { debounce } from
"tldraw"` compiles today, so a migrating codebase can still trip over one. They
are not reimplemented on guessed semantics: an undocumented helper that behaves
almost-right is worse than one that is absent and reported by the compiler.

### Depth — names are not behaviour

Both counts above ask only whether the name exists. The same script measures the
members of every symbol both sides share, which is the number to trust when the
question is whether real code will run:

| Package | Members of shared symbols | Present |
| :--- | ---: | ---: |
| `@tldraw/store` | 502 | 94.6% |
| `@tldraw/tlschema` | 3,298 | 89.7% |
| `@tldraw/editor` | 9,005 | 86.4% |
| `@tldraw/state` | 72 | 80.6% |
| `@tldraw/validate` | 100 | 72.0% |

The types most code touches, checked one by one:

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
`canEditInReadonly`, …) and `createShapeForAsset`. **That is where the remaining
work is**, not in the symbol tables above.

You can measure a real application against this surface rather than trusting the
tables: `scripts/compat-parity.mjs` type-checks a consumer app with `tldraw`
remapped onto `@mocanvas/compat` and reports what breaks, grouped by symbol.

> Earlier revisions reported 1,043 of 1,415 symbols (73.7%), and the 2.0.0
> changelog said about 88%. Both predate the script and are superseded by it.
> The old breakdown also listed the highlight shape, the laser tool,
> `PathBuilder`, the overlay utils and the asset utils as missing; all of them
> exist.

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

## Not implemented

Three different reasons, kept apart because they have different futures. An
earlier revision of this section filed all of them under "client halves of
services tldraw operates", which was wrong about sync — see below.

### Tied to a service tldraw runs — not coming

| | Why |
| :--- | :--- |
| Licensing, watermark, license telemetry | mocanvas is MIT; there is no licence to check. `licenseKey` is accepted and ignored. |
| `useSyncDemo` | Points at demo servers tldraw hosts. The only symbol in `@tldraw/sync` that genuinely does. |
| The tldraw asset CDN defaults | The asset mechanism is kept; the host is not. Supply your own `AssetStore`. |
| Third-party embed unfurling and integrations | Each is a call to somebody's API. `EmbedShapeUtil.configure({ embedConfig })` lets an app supply its own. |
| tldraw.com UI chrome | Product UI, not SDK surface. |

### A different architecture, not a missing one

`@tldraw/sync` (9 documented symbols) and `@tldraw/sync-core` (42) are tldraw's
multiplayer stack: `useSync` on the client, `TLSocketRoom`, `TLSyncClient` and
the SQLite storage wrappers on the server.

It is worth being accurate about what that is. `TLSocketRoom` is **self-hosted** —
it runs on Node, Cloudflare Durable Objects, Bun, or any WebSocket server, and
you own the infrastructure and the data. It is not a client half of anything.

mocanvas does not implement it because `@mocanvas/sync` is a different answer to
the same problem: its own transport and a field-level CRDT, rather than tldraw's
diff-and-rebase protocol. Two wire protocols in one library would be two things
to keep correct. The consequence for a migrating app is specific: collaboration
works, but an existing tldraw sync *server* does not, and the app would move to
`@mocanvas/sync`.

### Wanted, not yet built

| | What it is |
| :--- | :--- |
| `@tldraw/mermaid` (17 symbols) | Mermaid diagram text laid out as shapes on the canvas — `createMermaidDiagram`, the blueprint types, the node render mapper. Self-contained; nothing about the architecture blocks it. |
| `@tldraw/driver` (3 symbols) | `Driver`, an imperative API over an editor for tests, automation and REPL use — `click`, `keyPress`, `pointerMove`, `translateSelection` and so on, built on public editor calls only. Nothing blocks it either. |
| `@tldraw/commenting`, `@tldraw/mentions` | Separate libraries, not in the 5.4 reference index. |

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
