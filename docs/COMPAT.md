# Compatibility map

Legend: **same** — same name and semantics; **alias** — different core name, a
`@mocanvas/compat` alias exists; **differs** — behavioral difference to know
about; **later** — planned, not in v1.

## Packages

| Migrating from      | To                 | Note                                         |
| ------------------- | ------------------ | -------------------------------------------- |
| `tldraw`            | `mocanvas`         | batteries-included: shapes, tools, UI, `<Mocanvas />` |
| `@tldraw/editor`    | `@mocanvas/editor` | `Editor`, `ShapeUtil`, `StateNode`, geometry  |
| `@tldraw/store`     | `@mocanvas/store`  | records, `Store`, `StoreSchema`, migrations   |
| `@tldraw/state`     | `@mocanvas/state`  | `atom`, `computed`, `react`, `transact`       |
| `@tldraw/state-react` | `@mocanvas/state/react` | `useValue`, `track`, `useAtom`          |
| `@tldraw/tlschema`  | `@mocanvas/editor` (records) | record and prop types live with the editor |
| any of the above    | `@mocanvas/compat` | re-exports everything from `mocanvas` plus `TL*` type aliases, `Tldraw`, `TldrawEditor`, `createTLStore`, `createTLSchema` |

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
| `binding`         | later  | arrow bindings arrive with arrows in phase 2 |
| `asset`           | same   | `id type props meta`; `type` is `image` \| `video` \| `bookmark`; image/video props `w h name isAnimated mimeType src fileSize?`, bookmark `title description image favicon src` |
| `pointer`, `instance_presence` | later | collaboration |

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
| `bringToFront` `sendToBack` `bringForward` `sendBackward` `reparentShapes` `groupShapes` `ungroupShapes` `getOutermostSelectableShape` | same | `group` shape util is in `mocanvas` |
| `duplicateShapes` `getContentFromCurrentPage` `putContentOntoCurrentPage` | same | clipboard content is `{ shapes, bindings }` |
| `createBindings` `updateBindings` `deleteBindings` `getBindingsFromShape` `getBindingsToShape` `getBindingsInvolvingShape` `getBindingUtil` | same | `BindingUtil` callbacks: `onAfterChangeToShape`, `onBeforeDeleteToShape`, `onBeforeIsolate*` |
| `getStyleForNextShape` `setStyleForNextShapes` `setStyleForSelectedShapes` `getSharedStyles` | same | `StyleProp.define` / `defineEnum`; default styles use `mocanvas:` ids |
| `snaps` | same shape | `SnapManager.snapTranslate` returns nudge + guide lines |
| `nudgeShapes` `rotateShapesBy` `flipShapes` `alignShapes` `distributeShapes` `stackShapes` `toggleLock` | same | `flipShapes` mirrors positions, not geometry |
| `resizeShape` `stretchShapes` | phase 3 | interactive resize lives in the select tool |
| `getSvgString` `toImage` | **differs** | not Editor methods: import the free functions `getSvgString(editor, ids?, opts?)` and `exportToBlob(editor, opts)` from `mocanvas` |
| `putExternalContent` `registerExternalContentHandler` `registerExternalAssetHandler` | same | content types `files` `text` `url` `svg-text`; `getAssetForExternalContent` produces an asset without storing it; defaults are installed by `useExternalContent` / `registerDefaultExternalContentHandlers` |
| `getAsset` `getAssets` `createAssets` `updateAssets` `deleteAssets` | same | assets are document-scoped, not per page |
| `inputs` | same shape | pointer/keyboard state on the editor |
| `user` `menus` `textMeasure` | **missing** | `user` arrives with collaboration; text measuring is `getTextMeasure()` from `mocanvas`; no menu registry |
| `sideEffects` | same | store side effects |
| `store` | same | `Store` instance |

## Shapes

| Shape | Status | Notes |
| ----- | ------ | ----- |
| `image` | same | props `w h assetId playing url crop flipX flipY altText`; drawn by the DOM overlay (`<img>`) for now, GPU texture path pending |

## `ShapeUtil<T>`

| Member | Status |
| ------ | ------ |
| `static type`, `static props`, `static migrations` | same |
| `getDefaultProps` `getGeometry` `component` | same |
| `indicator` | **differs** | declared and implemented by every util, but the default indicators layer draws geometry bounds instead of calling it |
| `canEdit` `canResize` `canBind` `canCrop` `canScroll` `hideRotateHandle` `hideResizeHandles` `hideSelectionBoundsBg` `hideSelectionBoundsFg` `isAspectRatioLocked` | same |
| `onResize` `onResizeStart` `onResizeEnd` `onTranslateStart` `onTranslate` `onTranslateEnd` `onRotateStart` `onRotate` `onRotateEnd` `onDoubleClick` `onDoubleClickEdge` `onEditEnd` `onBeforeCreate` `onBeforeUpdate` `onChildrenChange` `onDragShapesOver` `onDragShapesOut` `onDropShapesOver` | same |
| `getHandles` `onHandleDrag` | same |
| `toSvg` `toBackgroundSvg` | **differs** | SVG export lives in a registry: `registerShapeSvgRenderer(type, fn)` from `mocanvas` |
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
