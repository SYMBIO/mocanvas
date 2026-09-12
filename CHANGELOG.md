# Changelog

## 4.1.0

> **This minor release contains breaking changes.** They are marked below, and
> the two that will reach you without warning are these:
>
> 1. **Add `import "@mocanvas/mocanvas/mocanvas.css"` to your app.** Without it
>    the chrome renders unstyled. Until 4.0.2 your bundler picked the
>    stylesheet up on its own.
> 2. **`createStore()` now validates records and seeds a document and a page.**
>    A store built with no shape utils will no longer load a document whose geo
>    shapes predate the flip migration, and a brand new store is no longer
>    empty.
>
> A `^4.0.0` range will pull this in on its own, so read the two items above
> before upgrading rather than after.

Four things in this release were controls that existed and did nothing. They are
grouped that way below rather than by package, because that is what they have in
common and it is worth seeing at once.

### Breaking: record validation actually runs

`StoreSchema.validateRecord` returned every record untouched. Three independent
causes, each of which alone was enough:

- A record whose type was not found was returned as-is. A record carrying **no**
  `typeName` looked up as `undefined`, missed, and took the same path as foreign
  data that is deliberately allowed through.
- **No editor record type ever carried a validator.** `ShapeRecordType` and the
  rest were constructed without a `validator` key, and `RecordType.validate`
  opens with `if (!this.validator) return record`.
- `createSchema()` read `static migrations` off the utils but never `static
  props`, and `registerDefaultShapeSchema` — documented as the seam a package
  registers itself through on import — was exported and never called, so
  `defaultShapeSchemas` was permanently empty.

So the `static props` that were a breaking change in 2.0.0 were documentation.
They did nothing.

Turning validation on found a real defect in our own code:
`external/excalidraw.ts` spread `{color, dash, size}` into every converted shape
including `text`, and `textShapeProps` has no `dash`. **Every label imported from
Excalidraw carried a prop its own type rejects.**

Declared props are validated; props no util declares still pass through, so a
round trip preserves them (`binding:arrow.props.snap` in our own reference
`.tldr` depends on this). Strict rejection stays available to direct callers.

**What changes for you:** `createStore()` with no shape utils passed will no
longer load a document whose geo shapes predate the flip migration — without the
utils the migration cannot run and `flipX`/`flipY` are absent. This is
fail-closed and matches what `createSchema` documents ("pass the same lists you
pass the editor"), but it is visible.

### Breaking: the stylesheet is now imported by your app

Add one line, once, anywhere in your app:

```ts
import "@mocanvas/mocanvas/mocanvas.css"
```

Without it `<Mocanvas />` renders the canvas but the toolbar, panels, menus and
dialogs come up unstyled. This is the same arrangement as `tldraw/tldraw.css`,
and `@mocanvas/compat` users need the same line (the stylesheet lives in
`@mocanvas/mocanvas`; a package can only export files it contains).

It is listed as breaking because it changes required consumer setup: until
4.0.2 a bundler picked the stylesheet up on its own, and now it does not. It is
also a bug fix, and the bug was worse than the fix:

- **`@mocanvas/mocanvas` could not be imported outside a bundler.**
  `dist/index.js` carried `import "./ui-4C5V5GYT.css"`, which Node has no
  loader for, so vitest, SSR, and any plain `node` import threw
  `ERR_UNKNOWN_FILE_EXTENSION: Unknown file extension ".css"`. Consumers were
  working around it in their bundler config.
- **The stylesheet's name was content-hashed**, and `exports` did not list it
  at all, so there was no stable path to import instead — any import written
  against `ui-4C5V5GYT.css` would have broken at the next release.

The JavaScript entry no longer imports CSS. The stylesheet is emitted as
`dist/mocanvas.css` under a fixed name and exported as the subpath
`@mocanvas/mocanvas/mocanvas.css`, which resolves under Node, under every
bundler, and under TypeScript's `moduleResolution: "node16"` and `"bundler"`.

`@mocanvas/wasm` had the same shape of problem with a different asset: it
shipped `pkg/` with no `exports` subpath, so `import wasmUrl from
"@mocanvas/wasm/pkg/mocanvas_bg.wasm?url"` was blocked. Now exported.

### The frame loop never ticked

`Editor` wired `on("tick", …)` correctly and nothing ever emitted it. `draw` now
takes rAF's timestamp and emits the real elapsed milliseconds, clamped to 64ms
so a tab returning from hidden — where rAF does not fire at all — does not
arrive with seconds on the clock and fling the camera.

- **Laser and highlighter trails never advanced.** A separate defect in
  `ScribbleManager.tick()` compared only `points.length` and `state`, so once a
  trail reached equilibrium (one point added and one shed per frame) the record
  stopped updating and the trail froze behind a still-moving pointer.
- **Edge scrolling was dead twice over.** Beyond the missing tick,
  `edgeScrollManager.start()` was never called anywhere in the repository, so
  the tick alone would have fixed nothing. It is now started and stopped by
  `SelectTool`'s `Brushing` and `Translating`, and `EdgeScrollManager` refreshes
  `inputs.currentPagePoint` after panning so a dragged shape tracks the camera
  instead of being left behind.

The loop parks when there is no work: measured at 0 editor ticks against 122
available browser frames on an idle board.

### Menus and controls that did nothing

- **No submenu in the chrome was clickable.** Submenus are portalled as
  siblings of the menu that opened them, so each parent layer's "did this press
  land inside me?" check answered no for its own submenu's rows and closed
  everything on `pointerdown`, swallowing the click. Layers now know their
  nesting; Escape backs out of the innermost only.
- **Print printed the host web page.** It called
  `editor.getContainerWindow().print()`. It now renders the selection (or the
  page) through the SVG exporter into a hidden same-origin iframe and prints
  that. The row disables itself on an empty page.
- **`v`, `r`, `n` and the other tool keys did nothing.** `TldrawUi` never
  mounted `<ToolShortcuts/>` while `Mocanvas` had already switched off the
  hard-coded tool keys — and the shortcuts dialog advertised them anyway. The
  dialog is now generated from the same tables that install the bindings.
- **Theme moved a tick and changed no pixel.** It wrote only to user
  preferences, which `ThemeManager` — what the canvas paints from — never reads.
- **Reduce motion could not be switched off** on a machine that asks the OS for
  reduced motion, because the tick combined the two; and nothing consumed
  `animationSpeed` at all. `setCamera` now scales animation duration by it.
- **The selection was never announced to a screen reader.**
  `useSelectedShapesAnnouncer` existed, was exported, and was mounted nowhere —
  the live regions rendered and nothing ever announced into them.
- **Page rename closed the menu it needed to stay in.** The page list is also
  restructured: one actions trigger per page rather than three action rows
  printed beside every page, which made a five-page document a twenty-row menu
  with no indication which "Delete" belonged to which page.

### Twelve keyboard shortcuts the menus advertised and nothing bound

`⇧L` on Toggle lock, `⌥A/H/D/W/V/S` on the align items, `⌥⇧H/V` on distribute,
`⇧H/V` on flip, and bare `]` and `[` on bring-to-front and send-to-back all
printed in the Arrange and Actions menus and did nothing.

They are bound now, by binding the action list itself — the same way the tool
list's shortcuts are bound — so `TLUiOverrides.actions` carries its bindings
with it and the two cannot drift apart again. The shortcuts dialog has an
Actions section generated from the same map.

Two related defects went with it:

- **`⇧H` and `⇧L` selected the hand and line tools.** The tool-key handler
  lowercased the key without checking Shift, so a shifted press fell through to
  the plain tool binding underneath.
- **`⌥D` printed "Align right" in the menu and opened the frame-statistics
  overlay.** Align right keeps `⌥D` — it is one of a coherent `⌥A/H/D/W/V/S`
  set — and frame statistics moves to `⌘⌥D`.

### Gaps found by a consumer integration (MOL-2410)

Measured against a real app rather than read off the documentation.

- **`store.put()` validated nothing.** Covered above; the remaining half is
  fixed here. A store built with **no shape utils** — what a sync backend, a
  headless export or a test gets — still passed every shape straight through,
  so `x: "NOT A NUMBER"` landed in the document. Forward compatibility is about
  `props` and only `props`: a `.tldr` from a newer build may carry props this
  one cannot describe, and those are still kept verbatim, but `x`, `y`,
  `rotation`, `index`, `parentId`, `isLocked` and `opacity` are the same on
  every shape record there has ever been and are now checked whatever utils
  were passed.

- **A new store held nothing at all.** `createStore()` now seeds the document
  and its first page, so anything reading a document without mounting an editor
  sees one. Only those two: camera, instance and page-state are session records
  and belong to an editor, not to a document. Skipped when `initialData` or a
  `snapshot` is supplied.

- **The seeded page was indexed `a0`.** Every `.tldr` tldraw writes — including
  the reference fixture this project compares against — puts its first page at
  `a1`, so a mocanvas-seeded page sorted before all of them. Invisible with one
  page; it shows the moment two documents are merged. The index *helpers* still
  start at `ZERO_INDEX_KEY` and remain consistent with each other; reconciling
  the generator itself with tldraw's first key changes how every index is
  allocated and is not in this release.

- **`deleted-shapes` did not exist.** Added, carrying every id removed,
  descendants included — deleting a frame takes its children with it and a
  listener cleaning up per-shape state needs all of them. Fires after the
  removal and only when something was actually removed.

- **`renderingOnly` was declared and read by nothing.** The hit-test option now
  skips shapes the viewport has culled. Off by default: a programmatic query is
  asked about the document, and an answer that changed with the scroll position
  would be surprising. The culled set is read once per query, not per shape.

- **`TLEditorComponents.CollaboratorCursor` was declared on two component maps
  and rendered by nothing**, so an app that supplied its own cursor silently
  kept seeing ours. `CollaboratorCursors` now renders the slot when one is
  supplied — in its own HTML layer, since the default is a `div` and would not
  render inside the SVG layer — and draws nothing of its own in that case.

- **The published declarations failed a consumer's typecheck.**
  `@mocanvas/wasm`'s `pkg/mocanvas.d.ts` carries `[Symbol.dispose](): void`
  from wasm-pack, which needs TypeScript's `esnext.disposable`. A consumer on
  any ordinary target got `TS2550` pointing into *our* file, with no fix
  available but widening their own `lib` to satisfy a dependency. The file now
  carries its own `/// <reference lib="esnext.disposable" />`.

  On the reported type-check memory: not reproduced here. A consumer importing
  `@mocanvas/mocanvas` and `@mocanvas/editor` from the tarballs, with
  `skipLibCheck: false`, typechecks in **124 MB and 0.18s** (65k types, 120k
  instantiations); `tsc -b` across this repository peaks at **890 MB**. If a
  4.97 GB figure persists after the `TS2550` fix above, it needs measuring in
  the consumer's own tree.

### Documentation

`MIGRATION.md` §7 and §10 described a 3.x-era editor. §7 said slot
compatibility did not exist and was a v1 non-goal; both stopped being true
before 4.0. §10 listed `editor.resizeShape` / `stretchShapes`,
`editor.getSvgString` / `toImage`, `editor.textMeasure` / `user` / `menus`,
presence records and slot-compatible UI as missing — every one of them is
present, checked against the built package rather than the roadmap.
`ARCHITECTURE.md`'s non-goals list carried the same stale entry.

### Breaking: two menu items removed

- **Language.** mocanvas ships no message catalogues, so the default mount
  offered twenty-five languages that all rendered the same English. The menu now
  lists only locales the host supplied non-empty dictionaries for, and renders
  nothing below two. An app that ships dictionaries is unaffected and now sees
  exactly its own languages.
- **`useEnhancedA11yMode`.** The hook was backed by a module-level boolean, so
  every caller got its own copy of state and nothing read any of them. The
  preference is now the single source of truth
  (`editor.user.getIsEnhancedA11yMode()`), and `ToggleEnhancedA11yModeItem` —
  which tldraw's reference documents and which is unchanged — writes it. Turning
  it on makes the selection announcer read back position and size as well as
  what is selected.

## 4.0.2

Corrects the benchmark. No code change.

The published figures were measured under software rasterisation — the harness
assumed headless Chromium on macOS always falls back to SwiftShader, which is
wrong. On a real GPU the numbers move in both directions: creating shapes is
about 2.6× rather than the ~3× claimed, and dragging a thousand shapes is 1.8×
faster rather than the loss that was reported. "tldraw is ahead on small scenes"
was an artefact of the CPU rasteriser and is gone.

Pan and zoom is no longer quoted at all: mocanvas sits at the harness's own frame
floor in every case, so it cannot be measured and is not claimed.

## 4.0.1

Wording only. The licence sections no longer close by noting that versions
released under MIT stay available under MIT. It remains true, and `LICENSE`
section 9 still says so — a licence that quietly dropped it would read as if old
grants were being withdrawn, which is not something this or any licence can do.
It simply does not belong in the pitch.

## 4.0.0

**The licence has changed. mocanvas is no longer MIT.**

### Breaking: licence

mocanvas is now source-available. It stays free for personal and non-commercial
projects, for non-profit organisations, for development, evaluation, testing and
staging — including inside a for-profit company, so you can try it and build
against it — and for teaching and research.

Shipping it in a commercial product, service or website now requires a written
agreement: **mocanvas@symbio.agency**.

Versions released under MIT remain available under MIT, on the terms they were
released with. This applies to 4.0.0 and later. The full text is in `LICENSE`,
which every package ships.

### Added

- The README now leads with what the library is, why it exists — we built on
  tldraw, ran out of headroom, and wanted a migration rather than a rewrite —
  what the performance actually measures, and what of tldraw is supported. Each
  of those was previously somewhere further down or in a linked file.
- Measured performance tables against tldraw 5.4, with the caveat they need:
  the run had no hardware GPU, so the interaction figures are close to a worst
  case for mocanvas.

## 3.1.1

Packaging only; no code change.

The repository is private, so the links every published README carried into it
were 404s for whoever read them on npm — and with no website yet, there was
nowhere else to point. The `repository`, `homepage` and `bugs` fields are gone
from all seven manifests, the fourteen links are replaced by what they pointed
at, and each package now ships the whole `docs/` set in its tarball, copied at
`prepack`. The flagship README carries the compatibility figures and the
clean-room statement outright rather than by reference.

## 3.1.0

Every symbol the tldraw 5.4 reference documents now exists under the same name:
1,420 of 1,420, across the seven packages this project maps.

### Added

- The 51 `TL*` spellings that were still missing, all in `@mocanvas/compat`.
  Each is an alias of a type mocanvas already exported unprefixed —
  `TLGeoShapeProps` for `GeoShapeProps`, `TLImageShape` for `ImageShape` — so
  nothing was missing but the name a migrating codebase imports it by. The two
  that are concrete in tldraw rather than generic are written out as such:
  `TLSerializedStore` is `SerializedStore<EditorRecord>`, `TLStoreSchema` is
  `TLSchema`.
- `apps/bench/fixtures/tldraw-reference.txt`, the 1,491 `package/Symbol` names
  the reference documents, and `api-coverage --reference` to measure against it.
  It exits non-zero on a regression, so it can hold the line in CI instead of
  being re-derived by hand.

### Documentation

- The README now carries the clean-room statement outright: mocanvas has never
  been built by reading tldraw's source, the compatibility is built against the
  public reference, and it is measured against that same reference.
- What is *not* covered is stated in the README rather than only in COMPAT.md,
  split by reason rather than lumped together.
- COMPAT.md's rationale for the four unimplemented packages was wrong and is
  corrected. It filed `@tldraw/sync-core` under "client halves of services
  tldraw operates"; `TLSocketRoom` is in fact self-hosted — Node, Cloudflare
  Durable Objects, Bun, any WebSocket server — and only `useSyncDemo` points at
  a host tldraw runs. Not implementing tldraw's sync stack is an architecture
  choice against `@mocanvas/sync`'s own transport and field-level CRDT, not a
  service dependency. `@tldraw/mermaid` and `@tldraw/driver` are recorded as
  wanted and unbuilt, with what each would be.

### Still not covered, and said plainly

- Four documented packages are excluded on purpose: `@tldraw/sync-core` (42
  symbols), `@tldraw/mermaid` (17), `@tldraw/sync` (9) and `@tldraw/driver` (3).
- 45 exported-but-undocumented symbols, almost all `@tldraw/utils` helpers the
  umbrella re-exports (`debounce`, `modulate`, `Result`, `FileHelpers`,
  `LruCache`). `import { debounce } from "tldraw"` still fails. They are not
  written from guessed semantics: a helper that behaves almost-right is worse
  than one the compiler reports as absent.
- Names are not behaviour. Across shared symbols `@tldraw/editor` is at 86.4% of
  members, `ShapeUtil` has 52 of 77 and `Editor` 304 of 313.
  [docs/COMPAT.md](docs/COMPAT.md) has the breakdown.

## 3.0.0

A rendering release. Three things were visibly wrong on the canvas — each one
found by putting mocanvas and tldraw side by side in `apps/bench` — and fixing
the third needed a change to how the engine composites a translucent shape. The
breaking surface is small and confined to the highlighter's configuration and to
one internal buffer that `@mocanvas/wasm` describes.

### Breaking

- **`HIGHLIGHT_STROKE_SCALE` is gone**, replaced by `HIGHLIGHT_STROKE_SIZES`: a
  width per `size` rather than one multiple of `STROKE_SIZES`. No single
  multiplier can reproduce the widths tldraw draws — the ratio to a pen of the
  same size falls from about 10x at `s` to 4.9x at `xl` — so the model had to
  become a table. `HighlightShapeUtil`'s `strokeScale` option now multiplies that
  table and defaults to `1`, where it used to default to `3.2` and multiply
  `STROKE_SIZES`.
- **`Batch` carries an `isolate` field and `BATCH_WORDS` is 8**, not 7. Code that
  reads batches through `readBatch`, `readBatches` or `forEachDrawBatch` is
  unaffected; code that builds a `Batch` literal has one more field to supply.

### Fixed

- **The highlighter was far too narrow and washed out.** It drew at 3.2x the pen
  of the same size where it should draw at roughly 7.7x, and at 32% opacity where
  it should be 82%, which turned a saturated `#fddd00` into pale cream over white
  paper. Both numbers were guesses — the source said so — and both are now
  measured off the rendered result.
- **An x-box's diagonals spiked through its own outline.** The host has always
  pulled the X's ends back by half a stroke so the round cap lands on the corner,
  but only in the geometry it keeps for hit testing: a built-in geo is *drawn*
  from a path the engine generates, and that copy ran corner to corner. The
  engine is now told the stroke width, and the parity fixture captures geo paths
  at three widths instead of only at zero, which is the check that would have
  caught it.
- **A translucent stroke darkened wherever it crossed itself.** Shape opacity is
  baked into vertex alpha, so an overlapping ribbon blended twice; every other
  renderer treats it as a group — rasterize the mark, then make it see-through.
  A single-colour translucent shape now gets an isolation group and the WebGL2
  backend covers each of its pixels once, via the stencil buffer. A shape with a
  fill under its stroke is a group of two and keeps the per-triangle blend.

### Changed

- `Editor.updateViewportScreenBounds` accepts an `HTMLElement` as well as a box,
  which is both what a host has to hand and what tldraw accepts.
- `SET_GEO` carries a stroke width (7 words, was 6) and the frame's batch records
  carry an isolation group (8 words, was 7). Both are documented in
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Also in this release

Work from earlier sessions that had not been released yet: the hand-drawn outline
generator reworked around anchors and a wobble field, tessellation tolerance made
zoom-aware (a fixed *screen*-pixel error at every magnification, with a separate
coarser tolerance for sketched outlines), fills restricted to a path's closed
subpaths, selection indicators that follow the sketched outline rather than the
true one, arrow indicator and selection-frame fixes, rich-text label editing on a
TipTap surface behind a replaceable seam, and a gallery page in `apps/bench` that
renders every element through both libraries for comparison.

## 2.0.0

The API model moved from tldraw 3.x to **tldraw 5.4**. That is a different
architecture in several places, not a set of renames, so this is a major version.
[docs/MIGRATION.md](docs/MIGRATION.md) §0 walks through it; the short version is
below.

About 88% of the documented tldraw 5.4 API surface now exists, measured against an
enumeration of the public reference documentation.
[docs/COMPAT.md](docs/COMPAT.md) says what is present, what is missing, and what is
excluded on purpose.

### Breaking

- **Indicators are canvas paths.** `getIndicatorPath(shape): Path2D | TLIndicatorPath | undefined`
  replaces `indicator(shape): ReactNode`. The old hook still works and is
  deprecated; a util that implements only it is routed to the SVG layer.
  Returning `undefined` means *no outline*, not "use the default".
- **Custom shapes must register their props** through `TLGlobalShapePropsMap`
  module augmentation, or `shape.props` stays `object`. `Shape` with no type
  argument is now the union of *registered* types; use `UnknownShape` where the
  type is not known statically.
- **`static props` are validator maps**, not plain objects. `T` is exported for it.
- **`pageToScreen` changed meaning.** 1.x computed container-relative coordinates
  under that name. `pageToViewport` is now container-relative and `pageToScreen`
  is window-relative. An overlay positioned inside the canvas container wants
  `pageToViewport`; the old call was silently correct only while the container
  sat at the window origin.
- **Geometry follows the documented contract.** `Box.expandBy` and `Mat.invert`
  mutate and return `this` (`Box.ExpandBy` / `Mat.Inverse` are the pure forms);
  `Box.Expand(a, b)` is the union of two boxes, with the old scalar form kept as
  a deprecated overload; `Vec.Dot` is `Vec.Dpr` (alias kept) and `Vec.Cross`
  returns a `Vec`, with the old scalar as `Vec.Cpr`. `Vec` gained `z` for pen
  pressure, defaulting to `undefined` so `toJson()` is unchanged.
- **Double click is reported in phases** (`down`, `up`, `settle`). A handler that
  acts on every `double_click` now fires twice — filter on `info.phase`. Triple
  and quadruple click are gone; further presses inside the window stop counting
  rather than starting a second run.
- **`TLUserId` is branded.** Plain strings must go through `createUserId`.
- **Built-in shape migrations moved to `com.mocanvas.shape.*`.** Registering them
  under `com.tldraw.shape.*` claimed the reference implementation's migration
  line and made every real `.tldr` fail to load. Your own custom shape types keep
  the default prefix.
- **`ShapeUtil.getText` is a concrete method** returning `string | undefined`,
  not an optional one, so callers need no guard.
- **`Editor.getSelectionPageBounds()` returns `null`** rather than `undefined`
  when nothing is selected.
- **`EditorTextMeasure` gained `measureHtml` and `measureHtmlBatch`**, and
  `scrollWidth` on an HTML measurement is no longer optional.
- **Loading a `.tldr` keeps `props.richText`.** It used to be dropped and
  flattened into `props.text`, which lost every mark on the next save.
- **`<Mocanvas />` mounts the documented chrome** (`TldrawUi`). Its `components`
  prop now takes the UI panel map as well as the canvas slot map; the canvas-only
  map moved to `canvasComponents`.
- Selection-background and overlay React components are gone, per tldraw 5.0 —
  overlays are canvas-drawn. Node 22.12 or later.

### Added

- The **full `Editor` surface** — all 298 documented members — plus `ClickManager`,
  `ScribbleManager`, `TextManager`, `OverlayManager`, `EditorManager`, `Timers`,
  `FontManager` and `PerformanceManager`.
- The **complete geometry library**: `Vec` (107 members), `Box` (58), `Mat` (38),
  `Geometry2d` (37), `Arc2d`, `Point2d`, `Stadium2d`, `TransformedGeometry2d`,
  every documented intersection helper and arc function.
- **Every documented React UI component**, each replaceable through the
  components map, with roles, focus handling and keyboard navigation.
- **Canvas overlay painters**: brush, zoom brush, scribble, snap indicators,
  handles, selection foreground, arrow hints and the collaborator set.
- **Themes with display values**, `resolveThemes` and `registerColorsFromThemes`
  so an app can supply its own palette.
- **Rich text** on ProseMirror JSON. TipTap is an *optional* peer dependency:
  rich text renders, measures, exports and round-trips without it, and only
  WYSIWYG editing needs it.
- **Custom record types** through `createTLSchema({ records })`, alongside custom
  shapes and bindings.
- `AssetStore`, users and attribution, presence derivation, `tleditors`.
- The **highlight** shape and the **laser** tool.

### Performance

- **Built-in shapes describe their outline to the engine by parameters** instead
  of building a `Geometry2d` in JavaScript and uploading its vertices
  (`ShapeUtil.getEngineGeometry`). At 20,000 shapes that is 10–20× less
  host-side work and up to 4.6× fewer words copied. Custom shapes are unaffected
  — returning `undefined` keeps the old path.
- All 20 geo silhouettes, cubic splines and freehand smoothing now generate in
  Rust, byte-identical to the previous TypeScript, pinned by generated fixtures.

### Fixed

- `EnumStyleProp` shared its value array with the exported `DEFAULT_COLORS`
  tuple, so registering an app palette silently rewrote `DEFAULT_COLORS` for
  everyone importing it.
- `editor.click.cancelDoubleClick()` did nothing: double-click detection lived in
  the DOM event layer with its own timer, so there was no gesture to cancel.
- The mounted-editor registry only saw editors created by `<Mocanvas />`.
- Collaborator cursors and selection outlines were positioned in window space
  inside a container-space overlay.

### Known

Two performance defects, both found by measurement and both written up in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#known-performance-defects): the
spatial index degenerates when many shapes share a bounding box (20,000 at the
origin takes 1,660 ms instead of 25 ms), and snapping rebuilds geometry the
engine already holds (about 18.5 ms per drag frame at 20,000 shapes zoomed out).
Neither is fixed; both have a described fix.

## 1.0.0

First release. Rust/WebAssembly engine, WebGL2 and WebGPU backends, the document
model with `.tldr` IO, tools, bindings, styles, snapping, groups, history,
export, collaboration, and the default shapes, tools and UI.
