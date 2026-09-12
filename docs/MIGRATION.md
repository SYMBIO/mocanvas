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
renderer, and (c) UI, where the slots are compatible but the message
catalogues are yours to supply (§7).

---

## 0. Coming from mocanvas 1.x

1.x was shaped after the tldraw 3.x API. 2.0.0 targets **tldraw 5.4**, which is a
different architecture in a few places rather than a set of renames. Everything
below is a real change; the rest of the API is unchanged.

**Indicators are canvas paths.** `indicator(shape): ReactNode` still works and is
deprecated. The new form returns a `Path2D` in shape-local space:

```ts
override getIndicatorPath(shape: MyShape): Path2D {
  const path = new Path2D()
  path.rect(0, 0, shape.props.w, shape.props.h)
  return path
}
```

Returning `undefined` means *no outline*, not "use the default". A util that
implements neither method still gets a rectangle around its geometry bounds.

**Custom shapes register their props.** Without this, `shape.props` is `object`:

```ts
declare module "@mocanvas/mocanvas" {
  interface TLGlobalShapePropsMap {
    myShape: MyShapeProps
  }
}
```

`Shape` with no type argument is now the union of *registered* types, and
`shape.type === "myShape"` narrows its props. A type nobody registered is an
`UnknownShape` — use that where the type is not known statically. Inside library
code that must handle any shape, `editor.getShape<UnknownShape>(id)`.

**`static props` are validators, not a plain object.** `T` is exported for this:

```ts
static override props = { w: T.positiveNumber, h: T.positiveNumber, color: DefaultColorStyle }
```

**`pageToScreen` changed meaning.** 1.x computed container-relative coordinates
under that name. Now `pageToViewport` is container-relative and `pageToScreen`
is window-relative. **If you position an overlay inside the canvas container,
you want `pageToViewport`** — the old call was silently correct only while the
container sat at the window origin.

**Geometry primitives follow the documented contract**, which changed a few
existing names and behaviours: `Box.expandBy` and `Mat.invert` now mutate and
return `this` (`Box.ExpandBy` and `Mat.Inverse` are the pure forms);
`Box.Expand(a, b)` is the union of two boxes, with the old scalar form kept as a
deprecated overload; `Vec.Dot` is now `Vec.Dpr` (alias kept) and `Vec.Cross`
returns a `Vec`, with the old scalar as `Vec.Cpr`. `Vec` gained `z` for pen
pressure, defaulting to `undefined` so `toJson()` is byte-for-byte what it was.

**Double click is reported in phases.** A handler that acts on every
`double_click` will now fire twice. Filter:

```ts
override onDoubleClick(info: ClickEventInfo): void {
  if (info.phase !== "up") return
  …
}
```

**`engine` is optional.** `new Editor({ store, shapeUtils, tools, getContainer })`
picks up whatever `loadEngine()` last produced, because importing
`@mocanvas/mocanvas` registers a provider. Pass one explicitly only to run two
editors on separate engines.

**Built-in shape migrations moved namespace.** If you registered a migration for
one of *your own* shape types, nothing changes — you keep `com.tldraw.shape.*`.
mocanvas's own built-ins moved to `com.mocanvas.shape.*` so they stop claiming
the reference implementation's migration line, which was making real `.tldr`
files fail to load. You do not need to do anything unless you deliberately
registered a sequence under a built-in type's id.

**Optional, and worth doing for large documents:** a built-in shape can now
describe its outline to the engine by parameters instead of uploading vertices
(`ShapeUtil.getEngineGeometry`). Custom shapes keep the `getGeometry` path and
need no change; see [ARCHITECTURE.md](ARCHITECTURE.md).

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
`getIndicatorPath`, the `can*` / `hide*` predicates, and the whole
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

### Step 1b — the stylesheet

| Old import               | New import                        |
| ------------------------ | --------------------------------- |
| `"tldraw/tldraw.css"`    | `"@mocanvas/mocanvas/mocanvas.css"` |

Same arrangement, same one line, wherever you had it. The default UI is
unstyled without it.

`@mocanvas/compat` does not re-export the stylesheet — a package can only
export files it contains — so this import names `@mocanvas/mocanvas` even
during the zero-rename step. Under pnpm's strict `node_modules` that means
adding `@mocanvas/mocanvas` to your own dependencies alongside
`@mocanvas/compat`.

**If your own CSS reads tldraw's custom properties, add a second line:**

```ts
import "@mocanvas/compat/compat.css"
```

This is the half of the compat layer that nothing checks for you. The package
alias covers the symbols TypeScript sees; it cannot cover the `--tl-*` names in
your stylesheets. Without it a migration goes green — build, types, tests — and
the damage shows up only to the eye, because a `var()` that resolves to nothing
does not fail, it deletes the declaration it sits in (and inside `calc()`, the
whole property). One consumer found it as a cursor whose white outline had
quietly stopped being drawn.

`compat.css` maps tldraw's tokens onto mocanvas's and gives **every** one a
literal fallback, so a token with no counterpart cannot take a rule down with
it. Two groups are worth knowing about:

| tldraw token | What you get |
| --- | --- |
| `--tl-zoom`, `--tl-scale` | Real values. mocanvas now stamps `--mocanvas-zoom` and `--mocanvas-scale` on the canvas container and restamps them on zoom, so `calc()` rules that hold a constant on-screen size keep working. |
| `--tl-color-overlay`, `--tl-color-background-overlay`, `--tl-color-warn` | A static fallback. mocanvas has no equivalent, so these do not follow your theme — set them yourself if they matter. |

Everything else maps onto a themed mocanvas variable and follows a theme swap
or a flip to dark. The stylesheet is scoped to `.mocanvas` rather than `:root`,
so a page that still renders a real tldraw editor somewhere keeps its own
values.

**Next.js**: an app coming from tldraw almost certainly lists it in
`serverExternalPackages`. Next matches that by package name, so leaving
`@mocanvas/mocanvas` in the list turns `…/mocanvas.css` into a request Node has
to resolve — and Node has no loader for `.css`. Take mocanvas out of the list
entirely; there is nothing in it that needs to be external.

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

**Slot compatibility exists.** This section used to say it did not and that it
was a v1 non-goal; both stopped being true before 4.0. Your existing overrides
of tldraw's UI components are the shape mocanvas expects.

What you have:

- `components` — the `TLComponents` map, at both the canvas level and the
  chrome level. Pass a component to replace a slot, `null` to remove it.
- `overrides` — `TLUiOverrides`, with `tools`, `actions` and `translations`.
  The tool and action lists are what the toolbar, the menus and the keyboard
  bindings are all built from, so rewriting an entry changes all three
  together rather than only what is drawn.
- The default chrome as named exports — `TldrawUi`, `DefaultUi`,
  `DefaultToolbar`, `DefaultMainMenu` and the rest — so you can render one
  piece of it inside chrome of your own.
- `useTools()` and `useActions()` return those lists after overrides, which is
  what a toolbar of your own should render from.
- `hideUi` on `<Mocanvas />` still turns the chrome off entirely, leaving you
  the canvas and your `children`.
- `useEditor()` inside any descendant of `<Canvas>` / `<EditorProvider>`
  returns the `Editor` (`useMaybeEditor()` returns `Editor | null`).
- `track(Component)` and `useValue` from `@mocanvas/state/react` — re-exported
  from `@mocanvas/editor` and `@mocanvas/mocanvas` — make a component re-render
  when the signals it reads change.

One real difference remains: mocanvas ships **no message catalogues**, so
`overrides.translations` is where UI strings come from. The language menu lists
only the locales you supply a non-empty dictionary for, and renders nothing at
all if you supply none — see the note in `UI.md`.

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

Every row below was re-checked against the built package rather than carried
forward from the roadmap. Rows that used to sit here and no longer belong —
`editor.resizeShape` and `stretchShapes`, `editor.getSvgString` and `toImage`,
`editor.textMeasure`/`user`/`menus`, presence records, and slot-compatible UI —
are all present, and the entries claiming otherwise were stale rather than
aspirational.

| Gap | Status |
| --- | ------ |
| `ShapeUtil.toSvg`, `ShapeUtil.toBackgroundSvg` | Not `ShapeUtil` members. Custom shapes contribute to SVG export through `registerShapeSvgRenderer(type, renderer)`; without one they fall back to `geometryFallbackSvg`. |
| Sync protocol | Wire compatibility with tldraw's own sync protocol is not planned. `@mocanvas/sync` is a working transport of its own — presence records, `store.mergeRemoteChanges`, and a relay — but it does not speak tldraw's wire format. |
| `image` shape on the GPU | The texture path exists in the engine (`StyleWords.texture` + `uploadTexture`) but the `image` shape still draws an `<img>` in the DOM overlay. |
| `FrameShapeUtil` default size | mocanvas creates a frame at **160×90**; tldraw creates one at 320×180. Same aspect, half the size. It only bites code that creates a frame *programmatically* without passing `w`/`h` — drawing one with the tool sizes it from the drag either way. Pass explicit dimensions if the size matters to you. Aligning the default is a behaviour change and is not being made in a patch release. |
| An unregistered shape type in `store.put()` | Accepted, deliberately, and confirmed rather than fixed. A `.tldr` written by a build that knows a shape type this one does not must survive a load/save round trip instead of being dropped on the next save, so an unknown `type` passes its props through untouched. Its *other* fields are still validated — `x` must be a number whatever the type is — and a type you did register is validated in full. See `COMPAT.md`. |
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

  override getIndicatorPath(shape: CardShape): Path2D {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
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

  override getIndicatorPath(shape: CardShape): Path2D {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
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
styles with `static props`. `getGeometry`, `getIndicatorPath`, `getDefaultProps`, the
record and the props are the same code you already had.

For a shape written from scratch — including tools, handles and geometry
composition — see [CUSTOM_SHAPES.md](CUSTOM_SHAPES.md).
