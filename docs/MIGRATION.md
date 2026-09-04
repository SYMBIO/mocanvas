# Migrating an existing tldraw app to mocanvas

This guide is for a team that already has a working app built on tldraw and
wants to move it to mocanvas. It assumes you have read
[COMPAT.md](COMPAT.md), which is the authoritative symbol-by-symbol map; this
document is the ordered procedure and the parts where a mechanical rename is
not enough.

The short version: your **documents, records, ids and `.tldr` files carry over
untouched**, most of your **`Editor` calls carry over untouched**, your
**`ShapeUtil` / `StateNode` / `BindingUtil` subclasses keep their shape**, and
the real work is (a) imports, (b) teaching custom shapes about the GPU
renderer, and (c) rebuilding UI, which has no slot compatibility yet.

---

## 1. What stays the same

**Records.** The shape record is field-for-field the same:

```ts
interface BaseShape<Type extends string, Props extends object> {
  readonly id: ShapeId
  readonly typeName: "shape"
  type: Type
  x: number
  y: number
  rotation: number
  index: IndexKey
  parentId: ParentId
  isLocked: boolean
  opacity: number
  props: Props
  meta: JsonObject
}
```

Ids keep their prefixes and their format: `shape:`, `page:`, `binding:`,
`asset:`. `createShapeId()`, `isShapeId()`, `isShape()` are exported from
`@mocanvas/editor` (and re-exported from `@mocanvas/mocanvas`). `page`, `document`,
`camera`, `instance`, `instance_page_state`, `binding` and `asset` records keep
their names and their fields.

**Style values.** `color`, `fill`, `dash`, `size`, `font`, `align`,
`verticalAlign` keep the same string unions, so existing documents validate
without translation.

**`.tldr` files.** `parseTldrFile` / `serializeTldrFile` read and write the
`{ tldrawFileFormatVersion, schema, records }` envelope. Existing files load;
files you save are still `.tldr`.

**`Editor` method names.** `createShapes`, `updateShapes`, `deleteShapes`,
`getShape`, `getShapePageBounds`, `getShapeGeometry`, `select`, `selectAll`,
`selectNone`, `getSelectedShapeIds`, `setSelectedShapes`, `getCurrentPageId`,
`setCurrentPage`, `createPage`, `deletePage`, `getCamera`, `setCamera`,
`zoomIn`, `zoomOut`, `zoomToFit`, `zoomToSelection`, `zoomToBounds`,
`resetZoom`, `getZoomLevel`, `getViewportPageBounds`, `screenToPage`,
`pageToScreen`, `setCurrentTool`, `getCurrentToolId`, `getPath`, `isIn`,
`isInAny`, `getShapeAtPoint`, `getShapesAtPoint`, `getShapesInsideBounds`,
`markHistoryStoppingPoint` (with `mark` as an alias), `undo`, `redo`, `bail`,
`getCanUndo`, `getCanRedo`, `run`, `batch`, `getInstanceState`,
`updateInstanceState`, `getCurrentPageState`, `updateCurrentPageState`,
`setEditingShape`, `getEditingShapeId`, `setHoveredShape`, `getHoveredShapeId`,
`bringToFront`, `sendToBack`, `bringForward`, `sendBackward`, `reparentShapes`,
`groupShapes`, `ungroupShapes`, `duplicateShapes`, `getContentFromCurrentPage`,
`putContentOntoCurrentPage`, `nudgeShapes`, `rotateShapesBy`, `flipShapes`,
`alignShapes`, `distributeShapes`, `stackShapes`, `toggleLock` — all present
with the same names. `editor.store`, `editor.inputs`, `editor.sideEffects`,
`editor.snaps` and `editor.history` are fields, as before.

**Lifecycles.** `ShapeUtil` keeps `static type`, `static props`,
`static migrations`, `getDefaultProps`, `getGeometry`, `component`,
`indicator`, the `can*` / `hide*` predicates, and the whole
`onBeforeCreate` / `onBeforeUpdate` / `onResize*` / `onTranslate*` /
`onRotate*` / `onDoubleClick*` / `onEditEnd` / `onChildrenChange` /
`onDragShapesOver` / `onDragShapesOut` / `onDropShapesOver` /
`getHandles` / `onHandleDrag` set. `StateNode` keeps `id`, `initial`,
`children`, `parent`, `editor`, `onEnter`, `onExit`, the pointer/keyboard/wheel
handlers, `onCancel`, `onComplete`, `onInterrupt`, `onTick`, `transition`,
`getCurrent`, `getIsActive`, `getPath`. `BindingUtil` keeps `static type`,
`getDefaultProps` and the `onBefore*` / `onAfter*` callbacks including
`onAfterChangeFromShape`, `onAfterChangeToShape`, `onBeforeDeleteFromShape`,
`onBeforeDeleteToShape`, `onBeforeIsolateFromShape`, `onBeforeIsolateToShape`.

---

## 2. Imports

### Step 0 — the zero-rename step

Point every import at `@mocanvas/compat` and change nothing else. That package
is pure re-exports (no runtime code): it re-exports everything from `@mocanvas/mocanvas`
and adds back the `TL`-prefixed names.

```ts
// before
import { Tldraw, type TLShape, type TLShapeId } from "tldraw"
// after — same identifiers
import { Tldraw, type TLShape, type TLShapeId } from "@mocanvas/compat"
```

The aliases `@mocanvas/compat` actually exports:

| Value alias      | Is                     |
| ---------------- | ---------------------- |
| `Tldraw`         | `Mocanvas`             |
| `TldrawEditor`   | `Canvas`               |
| `createTLStore`  | `createStore`          |
| `createTLSchema` | `createSchema`         |

| Type alias | Is | | Type alias | Is |
| ---------- | -- | - | ---------- | -- |
| `TLEditor` | `Editor` | | `TLRecord` | `EditorRecord` |
| `TLStore` | `EditorStore` | | `TLStoreSnapshot` | `EditorStoreSnapshot` |
| `TLShape` | `Shape` | | `TLUnknownShape` | `UnknownShape` |
| `TLShapeId` | `ShapeId` | | `TLParentId` | `ParentId` |
| `TLShapePartial<T>` | `ShapePartial<T>` | | `TLShapeCreate<T>` | `ShapeCreate<T>` |
| `TLPage` | `Page` | | `TLPageId` | `PageId` |
| `TLDocument` | `Document` | | `TLCamera` | `Camera` |
| `TLCameraId` | `CameraId` | | `TLInstance` | `Instance` |
| `TLInstancePageState` | `InstancePageState` | | `TLBinding` | `UnknownBinding` |
| `TLBindingId` | `BindingId` | | `TLArrowBinding` | `ArrowBinding` |
| `TLGeoShape` | `GeoShape` | | `TLDrawShape` | `DrawShape` |
| `TLLineShape` | `LineShape` | | `TLArrowShape` | `ArrowShape` |
| `TLTextShape` | `TextShape` | | `TLNoteShape` | `NoteShape` |
| `TLFrameShape` | `FrameShape` | | `TLGroupShape` | `GroupShape` |
| `TLGeoShapeGeoStyle` | `GeoShapeKind` | | `TLDefaultColorStyle` | `DefaultColorStyle` |
| `TLDefaultDashStyle` | `DefaultDashStyle` | | `TLDefaultFillStyle` | `DefaultFillStyle` |
| `TLDefaultFontStyle` | `DefaultFontStyle` | | `TLDefaultSizeStyle` | `DefaultSizeStyle` |
| `TLDefaultHorizontalAlignStyle` | `DefaultHorizontalAlignStyle` | | `TLDefaultVerticalAlignStyle` | `DefaultVerticalAlignStyle` |
| `TLEventInfo` | `EventInfo` | | `TLPointerEventInfo` | `PointerEventInfo` |
| `TLClickEventInfo` | `ClickEventInfo` | | `TLKeyboardEventInfo` | `KeyboardEventInfo` |
| `TLWheelEventInfo` | `WheelEventInfo` | | `TLHandle` | `ShapeHandle` |
| `TLSelectionHandle` | `SelectionHandle` | | `TLResizeInfo<T>` | `ResizeInfo<T>` |
| `TLShapeUtilConstructor<T>` | `ShapeUtilConstructor<T>` | | `TLAnyShapeUtilConstructor` | `ShapeUtilConstructor` |
| `TLStateNodeConstructor` | `StateNodeConstructor` | | `TLBindingUtilConstructor` | `BindingUtilConstructor` |

Anything not in that list has the same name in both worlds and comes through
the `export * from "@mocanvas/mocanvas"` at the top of the package.

### Step 1 — package map

| Old import                      | New import                | Note |
| ------------------------------- | ------------------------- | ---- |
| `tldraw`                        | `@mocanvas/mocanvas`                | `<Mocanvas />`, default shapes, tools, UI, `.tldr` helpers, export helpers |
| `@tldraw/editor`                | `@mocanvas/editor`        | `Editor`, `ShapeUtil`, `StateNode`, `BindingUtil`, geometry, `<Canvas />` |
| `@tldraw/store`                 | `@mocanvas/store`         | records, `Store`, `StoreSchema`, migrations, `.tldr` IO |
| `@tldraw/state`                 | `@mocanvas/state`         | `atom`, `computed`, `react`, `transact` |
| `@tldraw/state-react`           | `@mocanvas/state/react`   | `useValue`, `track`, `useAtom` |
| `@tldraw/tlschema`              | `@mocanvas/editor`        | record and prop types live with the editor |
| any of the above (first pass)   | `@mocanvas/compat`        | keeps the `TL*` names |

Everything `@mocanvas/editor` exports is re-exported by `@mocanvas/mocanvas`, so in app
code you can import from `@mocanvas/mocanvas` alone.

### Step 2 — drop the prefixes

Once the app builds and runs against `@mocanvas/compat`, rename `TLFoo` →
`Foo` file by file and move imports to `@mocanvas/mocanvas` / `@mocanvas/editor`. Nothing
forces you to finish this in one pass.

---

## 3. The rendering model, and what it means for your custom shapes

This is the substantive difference and the only part of a migration that is not
mechanical.

In mocanvas, built-in shapes are **GPU meshes**, not DOM nodes. The engine
culls, tessellates and batches in WebAssembly and the canvas issues roughly one
draw call per batch. React components still exist, but they are a **DOM overlay
layer** drawn above the GPU canvas, used for text editing, custom shapes that
opt out of the GPU path, and labels.

A `ShapeUtil` therefore has three rendering-related decisions.

### `getRenderStyle` — put the shape on the GPU

```ts
getRenderStyle(shape: T): StyleWords | null
```

The base implementation returns `null`, which means *"do not draw me on the
GPU; render `component` in the DOM overlay instead"*. **A custom shape ported
from tldraw with no changes keeps working through this path** — it just renders
like it did before, as DOM. That is the safe first move.

To move it onto the GPU, return `StyleWords`:

```ts
interface StyleWords {
  /** 0xRRGGBBAA, alpha 0 = none */
  fill: number
  stroke: number
  strokeWidth: number
  dash: number
  opacity: number
  /** host texture id; 0 or undefined = none */
  texture?: number
}
```

Colours are packed `0xRRGGBBAA` integers, not CSS strings. Convert with
`hexToRgba`, exported from `@mocanvas/editor`:

```ts
export function hexToRgba(hex: string, alpha = 1): number
```

It accepts `#rgb`, `#rrggbb` and `#rrggbbaa`. `dash` is `0` solid, `1` dashed,
`2` dotted, `3` draw. `strokeWidth` is in page units and scales with zoom.

The geometry that gets tessellated is whatever `getGeometry` returns — the
`Geometry2d` is serialized to the engine's flat path encoding, so your existing
`getGeometry` is reused as-is.

### `component` — the DOM overlay

`component(shape)` is unchanged in signature and still returns a `ReactNode`.
What changed is *when* it runs:

- `getRenderStyle` returns `null` → `component` is the only renderer.
- `getRenderStyle` returns a style → `component` runs only if `needsOverlay` or
  `hasOverlayLabel` says so.

Overlay shapes are positioned in page space by the overlay layer; render inside
the shape's local box starting at `(0, 0)` and do not add your own page
transform.

### `needsOverlay` — temporarily promote to DOM

```ts
needsOverlay(shape: T): boolean   // default: editor.getEditingShapeId() === shape.id
```

The default promotes a shape to the overlay while it is being edited, which is
what a text-editing shape wants. `NoteShapeUtil` overrides it to `false`
because the GPU keeps drawing the sticky background even while its label is
being edited.

### `hasOverlayLabel` — GPU body plus a DOM label

```ts
hasOverlayLabel(shape: T): boolean   // default: false
```

Return `true` to have the shape drawn on the GPU **and** reported in the
overlay list, so `component` can render a text label on top of the mesh. This is
how `geo`, `note`, `arrow` and `frame` carry labels.

### `isClipShape` — clip descendants

```ts
isClipShape(shape: T): boolean   // default: false
```

Return `true` to clip every descendant to this shape's page-space geometry
bounds (the shape itself is not clipped by its own rect; nested clips
intersect). The engine sets a scissor rect per batch. No built-in shape opts in
yet; GPU frame clipping is a phase 3 item.

### Textures

A shape's fill can be a texture instead of a colour: set
`StyleWords.texture` to a non-zero host texture id and upload the pixels
through the render backend:

```ts
uploadTexture(id: number, source: TextureSource, opts?: TextureOptions): void
```

The fill mesh is then replaced by one quad over the shape's local geometry
bounds, `uv (0,0)` at the min corner and `(1,1)` at the max, tinted white ×
opacity; the stroke is still drawn normally. Texture ids are allocated by you,
the host. The built-in `image` shape does **not** use this yet — it renders an
`<img>` in the DOM overlay (`getImageTextureSource` is the seam where the GPU
path will attach).

### Porting checklist for one custom shape

1. Move the import, keep the class.
2. Build and run. It renders through the DOM overlay; nothing else to do.
3. If it is a hot shape (thousands on a page), implement `getRenderStyle` and
   let `getGeometry` do the drawing; delete the SVG/DOM body from `component`
   and keep only the label, if any, behind `hasOverlayLabel`.

---

## 4. `<Mocanvas />`

The batteries-included component. Full prop list:

```ts
interface MocanvasProps {
  store?: EditorStore
  shapeUtils?: readonly ShapeUtilConstructor[]
  bindingUtils?: readonly BindingUtilConstructor[]
  tools?: readonly StateNodeConstructor[]
  initialState?: string
  onMount?: (editor: Editor) => void | (() => void)
  hideUi?: boolean
  showStats?: boolean
  className?: string
  style?: CSSProperties
  children?: ReactNode
  components?: CanvasProps["components"]
  options?: ConstructorParameters<typeof Editor>[0]["options"]
}
```

Points worth knowing:

- `shapeUtils`, `bindingUtils` and `tools` are **additive**: they are appended
  to `defaultShapeUtils`, `defaultBindingUtils` and `defaultTools`. You do not
  re-list the built-ins, and there is no "replace the defaults" mode.
- `onMount` may return a cleanup function; it runs on unmount before
  `editor.dispose()`.
- The engine is WebAssembly and loads asynchronously, so `<Mocanvas />` shows a
  loading placeholder for one tick before the editor exists. `onMount` is the
  reliable hook for "the editor is ready".
- `children` render inside `<Canvas>`, above the canvas element.
- `options` are editor config overrides (`maxShapesPerPage`, `hitTestMargin`,
  `zoomMin`, `zoomMax`, `zoomSteps`, `backgroundColor`, ...).

For a bare canvas with no default shapes, tools or UI, construct `Editor`
yourself and render `<Canvas editor={editor} />` from `@mocanvas/editor`
(`TldrawEditor` in the compat package).

---

## 5. Styles

Styles work the way you expect. `StyleProp.define` and `StyleProp.defineEnum`:

```ts
static define<T>(id: string, options: { defaultValue: T; validate?: (value: unknown) => T }): StyleProp<T>
static defineEnum<const V extends readonly string[]>(
  id: string,
  options: { defaultValue: V[number]; values: V },
): EnumStyleProp<V[number]>
```

**The built-in style prop ids use the `mocanvas:` namespace**, not `tldraw:` —
`mocanvas:color`, `mocanvas:labelColor`, `mocanvas:fill`, `mocanvas:dash`,
`mocanvas:size`, `mocanvas:font`, `mocanvas:horizontalAlign`,
`mocanvas:verticalAlign`, `mocanvas:geo`. The *values* are unchanged, so
documents are unaffected; only code that hard-codes a style id needs a look.
For your own styles, namespace them with your app's name.

Declare styles on the util's `static props` map, keyed by the prop name:

```ts
export class CardShapeUtil extends BaseBoxShapeUtil<CardShape> {
  static override type = "card" as const
  static override props = {
    color: DefaultColorStyle,
    size: DefaultSizeStyle,
  }
}
```

`getStylePropsOf` picks the `StyleProp` instances out of that map; the editor
uses it for `editor.getStylePropsForType(type)`. Reading and writing:

```ts
editor.getStyleForNextShape(DefaultColorStyle)          // T
editor.setStyleForNextShapes(DefaultColorStyle, "blue") // this
editor.setStyleForSelectedShapes(DefaultColorStyle, "blue")
editor.getSharedStyles()                                 // SharedStyleMap
```

`SharedStyleMap` entries are `{ type: "shared"; value: T } | { type: "mixed" }`;
`getAsKnownValue(prop)` returns the value or `undefined` when mixed.

---

## 6. Bindings

`BindingUtil` is present with the same lifecycle. Records:

```ts
interface BaseBinding<Type extends string, Props extends object> {
  readonly id: BindingId
  readonly typeName: "binding"
  type: Type
  fromId: ShapeId
  toId: ShapeId
  props: Props
  meta: JsonObject
}
```

Editor methods: `createBinding` / `createBindings`, `updateBinding` /
`updateBindings`, `deleteBinding` / `deleteBindings` (which take
`{ isolateShapes?: boolean }`), `getBinding`, `getBindingsFromShape`,
`getBindingsToShape`, `getBindingsInvolvingShape`, `getBindingUtil`,
`hasBindingUtil`.

Callbacks run inside the store transaction that caused them:
`onBeforeCreate`, `onAfterCreate`, `onBeforeChange`, `onAfterChange`,
`onBeforeDelete`, `onAfterDelete`, `onAfterChangeFromShape`,
`onAfterChangeToShape`, `onBeforeDeleteFromShape`, `onBeforeDeleteToShape`,
`onBeforeIsolateFromShape`, `onBeforeIsolateToShape`. `getDefaultProps` is
abstract and returns `Partial<B["props"]>`.

The built-in `ArrowBindingUtil` (type `"arrow"`) stores
`{ terminal, normalizedAnchor, isExact, isPrecise }`, matching what `.tldr`
files hold for arrow bindings, so arrow documents round-trip. Register custom
binding utils through `<Mocanvas bindingUtils={[...]} />`.

Clipboard content is `{ shapes, bindings }`: `getContentFromCurrentPage`
returns both and `putContentOntoCurrentPage` accepts both.

---

## 7. UI

**There is no slot compatibility yet**, and it is an explicit v1 non-goal. Do
not expect your existing overrides of tldraw's UI components to compile.

What you have:

- `hideUi` on `<Mocanvas />` turns off the default toolbar and zoom bar
  entirely, leaving you the canvas and your `children`.
- `components` (passed through to `<Canvas>`) lets you replace the canvas-level
  render slots.
- `useEditor()` inside any descendant of `<Canvas>` / `<EditorProvider>`
  returns the `Editor` (`useMaybeEditor()` returns `Editor | null`).
- `track(Component)` and `useValue` from `@mocanvas/state/react` — re-exported
  from `@mocanvas/editor` and `@mocanvas/mocanvas` — make a component re-render when the
  signals it reads change.

The practical migration is: `hideUi`, then rebuild your chrome as ordinary
React inside `<Mocanvas>`, reading and driving the editor through `useEditor`
and `track`. Because the default UI is still being reworked, treat its internals
as unstable and build against `useEditor` rather than against specific UI
components.

---

## 8. Files

Two helpers, both from `@mocanvas/mocanvas`:

```ts
function serializeMocanvasFile(editor: Editor): string
function loadMocanvasFile(editor: Editor, json: unknown): ParseTldrFileResult
```

`loadMocanvasFile` accepts the JSON text or an already-parsed value, replaces
the document, clears history, fixes up the current page if the file does not
contain it, and calls `zoomToFit`. It never throws: the result is

```ts
type ParseTldrFileResult =
  | { ok: true; schema: SerializedSchema; records: UnknownRecord[] }
  | { ok: false; error: TldrFileParseError; cause?: unknown }
```

with `error` one of `"notATldrFile" | "v1File" | "invalidRecords" | "futureVersion"`.

**What round-trips.** The `{ tldrawFileFormatVersion, schema, records }`
envelope, every document-scoped record as stored, the schema `sequences` map,
and unknown record types and unknown props — those survive load and save
untouched. Output is pretty-printed with recursively sorted keys, so identical
documents produce identical bytes.

**What is dropped.** `serializeMocanvasFile` writes the `"document"` scope
only, so session state — `camera`, `instance`, `instance_page_state` — is not
in the file. Your current selection, camera position, editing shape and hovered
shape do not survive a save/load, and neither does undo history, which is
cleared on load. The pre-envelope legacy format is detected and rejected with
`error: "v1File"` rather than converted.

---

## 9. Assets and external content

Assets are **document-scoped** records, not per page:

```ts
editor.getAsset<A>(id)     editor.getAssets()
editor.createAsset(asset)  editor.createAssets(assets)
editor.updateAsset(partial) editor.updateAssets(partials)
editor.deleteAsset(id)     editor.deleteAssets(ids)
```

`Asset` is `ImageAsset | VideoAsset | BookmarkAsset`. Image and video props are
`{ w, h, name, isAnimated, mimeType, src, fileSize? }`; bookmark props are
`{ title, description, image, favicon, src }`. `src` is a URL or data URL, and
`null` while uploading.

Drops and pastes go through the external-content pipeline:

```ts
editor.registerExternalContentHandler<T extends ExternalContentType>(
  type: T, handler: ExternalContentHandler<T> | null,
): () => void

editor.registerExternalAssetHandler<T extends ExternalAssetType>(
  type: T, handler: ExternalAssetHandler<T> | null,
): () => void

editor.putExternalContent(info: ExternalContent): Promise<void>
editor.getAssetForExternalContent(info: ExternalAssetContent): Promise<Asset | undefined>
```

Both register calls return an unregister function, and passing `null` clears
the handler. Content types are `files`, `text`, `url` and `svg-text`:

```ts
type ExternalContent =
  | { type: "files"; files: File[]; point?: { x: number; y: number } }
  | { type: "text"; text: string; point?: { x: number; y: number } }
  | { type: "url"; url: string; point?: { x: number; y: number } }
  | { type: "svg-text"; text: string; point?: { x: number; y: number } }

type ExternalAssetContent = { type: "file"; file: File } | { type: "url"; url: string }
```

`point` is in page space and defaults to the viewport centre.
`getAssetForExternalContent` **produces an asset record without storing it** —
you decide whether to `createAssets` it.

`<Mocanvas />` installs the defaults for you via `useExternalContent`; to wire
them up on a hand-built editor call
`registerDefaultExternalContentHandlers(editor, opts)`, which returns a single
teardown function. Its `ExternalContentOptions` let you swap the image-size
loader and cap the imported dimension (`DEFAULT_MAX_IMAGE_DIMENSION` is 1000).
Building blocks are exported individually if you want to compose your own:
`createImageAssetFromFile`, `createImageAssetFromSvgText`,
`createImageShapesForAssets`, `createTextShapeAt`, `classifyExternalText`,
`fitImageSize`, `isImageFile`, `isSvgFile`, `isAnimatedImageType`,
`looksLikeUrl`, `looksLikeSvg`, `readFileAsDataUrl`, `svgTextToDataUrl`,
`getSvgTextSize`, `loadImageSizeInBrowser`.

To upload dropped files to your own storage, register an asset handler that
returns an asset whose `props.src` is your URL — that is the same seam you used
before.

---

## 10. Known gaps

Taken from the "phase 3" and "later" rows of [COMPAT.md](COMPAT.md), plus what
the code confirms today.

| Gap | Status |
| --- | ------ |
| `editor.resizeShape`, `editor.stretchShapes` | phase 3. Interactive resize lives in the select tool; `ShapeUtil.onResize` and `BaseBoxShapeUtil` work, but there is no imperative resize entry point on `Editor`. |
| `editor.getSvgString`, `editor.toImage` | Not `Editor` methods. Export is a set of free functions in `@mocanvas/mocanvas`: `getSvgString(editor, ids?, opts?)`, `exportToBlob(editor, opts)`, `downloadBlob(blob, filename)`, `copyBlobToClipboard(blob)`. |
| `ShapeUtil.toSvg`, `ShapeUtil.toBackgroundSvg` | Not `ShapeUtil` members. Custom shapes contribute to SVG export through `registerShapeSvgRenderer(type, renderer)`; without one they fall back to `geometryFallbackSvg`. |
| `pointer` and `instance_presence` records | later — collaboration. No presence records, and no `mergeRemoteChanges` transport yet. |
| Sync protocol | Explicit v1 non-goal. Wire compatibility with tldraw's sync protocol is not planned for v1. |
| Slot-compatible UI | Explicit v1 non-goal. See §7. |
| `image` shape on the GPU | The texture path exists in the engine (`StyleWords.texture` + `uploadTexture`) but the `image` shape still draws an `<img>` in the DOM overlay. |
| `editor.textMeasure`, `editor.user`, `editor.menus` | Not implemented. Text measurement is DOM-backed inside the text layer; `editor.inputs` and `editor.sideEffects` do exist. |
| Text rendering | DOM overlay. Glyph-atlas text in WASM is phase 3. |
| GPU frame clipping | The `CLIP` flag and `isClipShape` hook are wired end to end, but no built-in shape enables it yet (phase 3). |
| WebGPU backend | Phase 3. WebGL2 is the only backend today, behind `RenderBackend`. |
| Real `.tldr` schema migrations | Phase 4. The `sequences` map is preserved and migrations run for sequences that are known; unknown ones pass through. |
| Pixel-identical built-in shapes | Explicit v1 non-goal. Built-ins are GPU meshes and will not match a DOM renderer pixel for pixel. |
| No watermark, license key or telemetry | Intentional difference, not a gap. |

---

## 11. Worked example: a small custom "card" shape

A sketch, not a copy of anything: a card with a coloured body and a title. The
*before* is how such a shape is typically written for a DOM renderer; the
*after* is the same shape in mocanvas, on the GPU with a DOM label.

### Before (DOM renderer)

```tsx
// Everything the shape looks like is in `component`.
export class CardShapeUtil extends ShapeUtil<CardShape> {
  static override type = "card"

  getDefaultProps(): CardShapeProps {
    return { w: 220, h: 140, title: "", color: "blue" }
  }

  getGeometry(shape: CardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  component(shape: CardShape) {
    return (
      <div
        style={{
          width: shape.props.w,
          height: shape.props.h,
          background: PALETTE[shape.props.color],
          border: "2px solid #1e1e1e",
          borderRadius: 8,
          display: "grid",
          placeItems: "center",
        }}
      >
        {shape.props.title}
      </div>
    )
  }

  indicator(shape: CardShape) {
    return <rect width={shape.props.w} height={shape.props.h} />
  }
}
```

### After (mocanvas)

Step 1 is *do nothing*: change the import to `@mocanvas/editor` and the class
above runs unmodified, rendered by the DOM overlay because `getRenderStyle`
defaults to `null`.

Step 2 moves the body onto the GPU and leaves only the title in the overlay:

```tsx
import {
  BaseBoxShapeUtil,
  DefaultColorStyle,
  DefaultSizeStyle,
  hexToRgba,
  LIGHT_THEME,
  Rectangle2d,
  type BaseShape,
  type Geometry2d,
  type StyleWords,
} from "@mocanvas/editor"
import type { ReactNode } from "react"

// `DefaultColorStyle` and `DefaultSizeStyle` are each both a value (the
// `StyleProp`) and a type (the value union), so one import serves both uses.
export interface CardShapeProps {
  w: number
  h: number
  title: string
  color: DefaultColorStyle
  size: DefaultSizeStyle
}

export type CardShape = BaseShape<"card", CardShapeProps>

export class CardShapeUtil extends BaseBoxShapeUtil<CardShape> {
  static override type = "card" as const
  // These two props are now app-wide styles: the style panel edits them and
  // `setStyleForSelectedShapes` reaches them.
  static override props = {
    color: DefaultColorStyle,
    size: DefaultSizeStyle,
  }

  getDefaultProps(): CardShapeProps {
    return { w: 220, h: 140, title: "", color: "blue", size: "m" }
  }

  getGeometry(shape: CardShape): Geometry2d {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  // The body: fill, stroke and dash as packed 0xRRGGBBAA words.
  override getRenderStyle(shape: CardShape): StyleWords {
    const theme = LIGHT_THEME[shape.props.color]
    return {
      fill: hexToRgba(theme.semi),
      stroke: hexToRgba(theme.solid),
      strokeWidth: 2,
      dash: 0,
      opacity: 1,
    }
  }

  // Draw the GPU body *and* report the shape to the overlay, so `component`
  // can put the title on top of the mesh.
  override hasOverlayLabel(shape: CardShape): boolean {
    return shape.props.title.length > 0
  }

  // Only the label now — the box itself is a mesh.
  component(shape: CardShape): ReactNode {
    const { w, h, title, color } = shape.props
    return (
      <div
        style={{
          width: w,
          height: h,
          display: "grid",
          placeItems: "center",
          color: LIGHT_THEME[color].solid,
          pointerEvents: "none",
        }}
      >
        {title}
      </div>
    )
  }

  indicator(shape: CardShape): ReactNode {
    return <rect width={shape.props.w} height={shape.props.h} />
  }
}
```

Register it, additively:

```tsx
<Mocanvas shapeUtils={[CardShapeUtil]} />
```

What changed, and only this: `getRenderStyle` was added, `hasOverlayLabel` was
added, `component` shrank to the label, `extends ShapeUtil` became
`extends BaseBoxShapeUtil` to inherit `onResize`, and two props were promoted to
styles with `static props`. `getGeometry`, `indicator`, `getDefaultProps`, the
record and the props are the same code you already had.

For a shape written from scratch — including tools, handles and geometry
composition — see [CUSTOM_SHAPES.md](CUSTOM_SHAPES.md).
