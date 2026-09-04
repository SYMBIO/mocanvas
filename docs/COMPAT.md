# Compatibility map

Legend: **same** — same name and semantics; **alias** — different core name, a
`@mocanvas/compat` alias exists; **differs** — behavioral difference to know
about; **later** — planned, not in v1.

## Packages

| Migrating from      | To                 | Note                                         |
| ------------------- | ------------------ | -------------------------------------------- |
| `tldraw`            | `@mocanvas/mocanvas`         | batteries-included: shapes, tools, UI, `<Mocanvas />` |
| `@tldraw/editor`    | `@mocanvas/editor` | `Editor`, `ShapeUtil`, `StateNode`, geometry  |
| `@tldraw/store`     | `@mocanvas/store`  | records, `Store`, `StoreSchema`, migrations   |
| `@tldraw/state`     | `@mocanvas/state`  | `atom`, `computed`, `react`, `transact`       |
| `@tldraw/state-react` | `@mocanvas/state/react` | `useValue`, `track`, `useAtom`          |
| `@tldraw/tlschema`  | `@mocanvas/editor` (records) | record and prop types live with the editor |
| any of the above    | `@mocanvas/compat` | re-exports everything from `@mocanvas/mocanvas` plus `TL*` type aliases, `Tldraw`, `TldrawEditor`, `createTLStore`, `createTLSchema` |

## Records

Core type names drop the `TL` prefix; `@mocanvas/compat` re-exports them with
the prefix as type aliases (`TLShape = Shape`, `TLShapeId = ShapeId`, ...).

| Record            | Status | Fields |
| ----------------- | ------ | ------ |
| `shape`           | same   | `id type x y rotation index parentId isLocked opacity props meta` |
| `page`            | same   | `id name index meta` |
| `document`        | same   | `id gridSize name meta` |
| `camera`          | same   | `id x y z meta` (session) |
| `instance`        | same   | `currentPageId isFocused isDebugMode isGridMode isReadonly ...` (session) |
| `instance_page_state` | same | `pageId selectedShapeIds hoveredShapeId editingShapeId ...` (session) |
| `binding`         | same   | `id type fromId toId props meta`; the arrow bindings that use it ship in `@mocanvas/mocanvas` |
| `asset`           | same   | `id type props meta`; `type` is `image` \| `video` \| `bookmark`; image/video props `w h name isAnimated mimeType src fileSize?`, bookmark `title description image favicon src` |
| `pointer`, `instance_presence` | **differs** | `instance_presence` is the same record in the `presence` scope; `@mocanvas/sync` keeps it in step with the local editor and `editor.getCollaborators()` reads the others back. There is no `pointer` record: the local cursor lives on `editor.inputs` and is published through presence |

Style values (`color`, `fill`, `dash`, `size`, `font`, `align`, `verticalAlign`)
keep the same string unions so `.tldr` files load without translation.

## `Editor`

| Method group | Status | Notes |
| ------------ | ------ | ----- |
| `createShapes` `updateShapes` `deleteShapes` `getShape` `getShapePageBounds` `getShapeGeometry` | same | |
| `select` `selectAll` `selectNone` `getSelectedShapeIds` `getSelectedShapes` `setSelectedShapes` | same | |
| `getCurrentPageId` `getCurrentPage` `getCurrentPageShapes` `getCurrentPageShapeIds` `setCurrentPage` `createPage` `deletePage` | same | |
| `getCamera` `setCamera` `zoomIn` `zoomOut` `zoomToFit` `zoomToSelection` `zoomToBounds` `resetZoom` `getZoomLevel` `getViewportPageBounds` `getViewportScreenBounds` | same | |
| `screenToPage` `pageToScreen` | same | |
| `setCurrentTool` `getCurrentTool` `getCurrentToolId` `getPath` `isIn` `isInAny` | same | |
| `getShapeAtPoint` `getShapesAtPoint` `getShapesInsideBounds` | same | engine-backed; `getShapesAtPoint` returns draw order top-first |
| `markHistoryStoppingPoint` `undo` `redo` `bail` `getCanUndo` `getCanRedo` | same | `mark()` is an alias of `markHistoryStoppingPoint` |
| `run` `batch` | same | |
| `getInstanceState` `updateInstanceState` `getCurrentPageState` `updateCurrentPageState` | same | |
| `setEditingShape` `getEditingShapeId` `setHoveredShape` `getHoveredShapeId` `setErasingShapes` | same | |
| `bringToFront` `sendToBack` `bringForward` `sendBackward` `reparentShapes` `groupShapes` `ungroupShapes` `getOutermostSelectableShape` | same | `group` shape util is in `@mocanvas/mocanvas` |
| `duplicateShapes` `getContentFromCurrentPage` `putContentOntoCurrentPage` | same | clipboard content is `{ shapes, bindings }` |
| `createBindings` `updateBindings` `deleteBindings` `getBindingsFromShape` `getBindingsToShape` `getBindingsInvolvingShape` `getBindingUtil` | same | `BindingUtil` callbacks: `onAfterChangeToShape`, `onBeforeDeleteToShape`, `onBeforeIsolate*` |
| `getStyleForNextShape` `setStyleForNextShapes` `setStyleForSelectedShapes` `getSharedStyles` | same | `StyleProp.define` / `defineEnum`; default styles use `mocanvas:` ids |
| `snaps` | same shape | `SnapManager.snapTranslate` returns nudge + guide lines |
| `nudgeShapes` `rotateShapesBy` `flipShapes` `alignShapes` `distributeShapes` `stackShapes` `toggleLock` | same | `flipShapes` mirrors positions, not geometry |
| `resizeShape` `resizeShapes` `stretchShapes` | same | `resizeShape(id, scale, opts?)` scales one shape about `scaleOrigin` (its page bounds center by default) in a frame rotated by `scaleAxisRotation`, and hands the prop change to `ShapeUtil.onResize` exactly as the select tool does; `resizeShapes` scales a group about their common center; `stretchShapes(ids, 'horizontal' \| 'vertical')` makes every shape span the common bounds on one axis. Locked and `canResize: false` shapes are skipped. Interactive resize still lives in the select tool |
| `getSvgString` `toImage` | same | `getSvgString(ids?, opts?)` returns `{ svg, width, height }`; `toImage(ids?, opts?)` resolves to `{ blob, width, height }`. Both are thin methods over an implementation that `@mocanvas/mocanvas` installs at import time through `registerExportImplementation({ getSvgString, toImage })`; without it they fail with an error saying so. The free functions `getSvgString(editor, ids?, opts?)` and `exportToBlob(editor, opts)` from `@mocanvas/mocanvas` are unchanged |
| `putExternalContent` `registerExternalContentHandler` `registerExternalAssetHandler` | same | content types `files` `text` `url` `svg-text`; `getAssetForExternalContent` produces an asset without storing it; defaults are installed by `useExternalContent` / `registerDefaultExternalContentHandlers` |
| `getAsset` `getAssets` `createAssets` `updateAssets` `deleteAssets` | same | assets are document-scoped, not per page |
| `inputs` | same shape | pointer/keyboard state on the editor |
| `user` `menus` `textMeasure` | same | `user` is the local identity (`getId` `getName` `getColor` plus setters, session-only, used by `@mocanvas/sync`); `menus` is `addOpenMenu` `removeOpenMenu` `getOpenMenus` `clearOpenMenus` `isMenuOpen` over the reactive `instance.openMenus` field; `textMeasure` is installed by `@mocanvas/mocanvas` through `registerTextMeasureImplementation(getTextMeasure)` and throws until it is (the free `getTextMeasure()` still works) |
| `sideEffects` | same | store side effects |
| `store` | same | `Store` instance |

## Shapes

| Shape | Status | Notes |
| ----- | ------ | ----- |
| `arrow` | same | props `kind start end bend elbowMidPoint arrowheadStart arrowheadEnd labelPosition text scale` plus the `color labelColor fill dash size font` styles. `kind` is honoured: `"arc"` (default) bows by `bend`, `"elbow"` routes axis-aligned legs and ignores `bend`, with `elbowMidPoint` (`0..1`) sliding the middle leg along the routing axis. A bound elbow leaves the shape along its nearest edge's normal. **differs**: `kind` is a plain prop, not a style, so it is not in `getSharedStyles` and has no style-panel control; an elbow's midpoint handle replaces the arc's `bend` handle |
| `image` | same | props `w h assetId playing url crop flipX flipY altText`; drawn by the DOM overlay (`<img>`) for now, GPU texture path pending |
| `bookmark` | same | props `w h assetId url`; the link card (banner, title, description, favicon + host) is drawn by the DOM overlay from the `bookmark` asset; the url is an inert `<a>` — the canvas keeps the pointer unless the shape is being edited |
| `embed` | **differs** | props `w h url`; only urls on an exported permit list (`embedDefinitions`, `getEmbedDefinition`) are put in a sandboxed `<iframe>` — anything else renders a placeholder card. An app extends the list by pushing its own `EmbedDefinition` |
| `video` | same | props `w h assetId time playing url altText`; drawn by the DOM overlay (`<video>`) from the `video` asset, muted and `playsInline`, with controls only while editing |

## `ShapeUtil<T>`

| Member | Status |
| ------ | ------ |
| `static type`, `static props`, `static migrations` | same |
| `getDefaultProps` `getGeometry` `component` | same |
| `indicator` | same | the default indicators layer calls it for every selected and hovered shape and draws the result inside that shape's page transform, with the selection colour and a zoom-independent hairline inherited from the wrapping `<g>`; a util that returns `null` falls back to a rectangle around its geometry bounds |
| `canEdit` `canResize` `canBind` `canCrop` `canScroll` `hideRotateHandle` `hideResizeHandles` `hideSelectionBoundsBg` `hideSelectionBoundsFg` `isAspectRatioLocked` | same |
| `onResize` `onResizeStart` `onResizeEnd` `onTranslateStart` `onTranslate` `onTranslateEnd` `onRotateStart` `onRotate` `onRotateEnd` `onDoubleClick` `onDoubleClickEdge` `onEditEnd` `onBeforeCreate` `onBeforeUpdate` `onChildrenChange` `onDragShapesOver` `onDragShapesOut` `onDropShapesOver` | same |
| `getHandles` `onHandleDrag` | same |
| `toSvg` `toBackgroundSvg` | same | optional; return SVG markup as a string or a React node, in shape-local space. The exporter prefers a util's own method, then a renderer registered with `registerShapeSvgRenderer(type, fn)` from `@mocanvas/mocanvas` (still supported, and the way to override a type whose util you do not own), then the shape's geometry outline. `toBackgroundSvg` output is drawn behind every exported shape |
| `getRenderStyle` | **new** — returns the GPU style words (fill, stroke, width, dash, opacity). Custom shapes that don't implement it are drawn by `component` in the DOM overlay. |

## `StateNode`

`id`, `initial`, `children`, `parent`, `editor`, `onEnter`, `onExit`,
`onPointerDown`, `onPointerMove`, `onPointerUp`, `onDoubleClick`,
`onRightClick`, `onMiddleClick`, `onKeyDown`, `onKeyUp`, `onKeyRepeat`,
`onWheel`, `onCancel`, `onComplete`, `onInterrupt`, `onTick`, `transition`,
`getCurrent`, `getIsActive`, `getPath` — all **same**.

## File format

`.tldr` v1 envelope: **same**. Records inside are stored as-is; the schema
`sequences` map is preserved and migrations run for sequences we know. Unknown
record types and unknown props survive a load/save round trip untouched.

## Intentionally different

- **Rendering**: built-in shapes are GPU meshes, not DOM. `ShapeUtil.component`
  for built-ins is still implemented and used when a shape is being edited or
  when it must interleave with a DOM shape.
- **No watermark, license key, or telemetry.**
- **Text**: phase 1 uses `richText` if present, else `text`; rendered in the DOM overlay.

## Installing the editor's optional members

`Editor.getSvgString`, `Editor.toImage` and `Editor.textMeasure` cannot live in
`@mocanvas/editor`: exporting needs the default shapes' SVG renderers and
measuring text needs the DOM, and both live in `@mocanvas/mocanvas`, which depends on the
editor rather than the other way round. Importing `@mocanvas/mocanvas` registers them.

An app built on `@mocanvas/editor` alone gets a clear error from those three
until it either imports `@mocanvas/mocanvas` or registers its own:

```ts
import { registerExportImplementation, registerTextMeasureImplementation } from "@mocanvas/editor"

registerExportImplementation({ getSvgString, toImage })
registerTextMeasureImplementation(() => myTextMeasure)
```
