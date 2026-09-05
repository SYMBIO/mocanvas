# Changelog

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
