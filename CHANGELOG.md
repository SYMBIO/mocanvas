# Changelog

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
