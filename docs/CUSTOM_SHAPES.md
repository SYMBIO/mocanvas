# Writing a custom shape

A from-scratch tutorial. We build a **callout**: a rounded-ish body with a
pointed tail, a text label, a draggable handle for the tail tip, resize
behaviour, two style props, and a tool that creates it by dragging.

Everything here uses public API from `@mocanvas/mocanvas` / `@mocanvas/editor`. Read
[ARCHITECTURE.md](ARCHITECTURE.md) first if you want to know why the rendering
split looks the way it does.

Contents:

1. [The record: type and props](#1-the-record-type-and-props)
2. [Geometry](#2-geometry)
3. [Rendering: `getRenderStyle`, `component`, `indicator`](#3-rendering)
4. [The overlay label](#4-the-overlay-label)
5. [Handles: `getHandles` and `onHandleDrag`](#5-handles)
6. [Resize with `BaseBoxShapeUtil`](#6-resize)
7. [Styles with `static props`](#7-styles)
8. [The tool: a `StateNode` with Idle and Pointing](#8-the-tool)
9. [Registering both](#9-registering-both)
10. [The whole file](#10-the-whole-file)

---

## 1. The record: type and props

A shape is a record. `BaseShape<Type, Props>` supplies everything except your
props:

```ts
import type { BaseShape, DefaultColorStyle, DefaultSizeStyle } from "@mocanvas/editor"

export interface CalloutShapeProps {
  w: number
  h: number
  /** Tail tip, in shape-local coordinates. */
  tailX: number
  tailY: number
  text: string
  color: DefaultColorStyle
  size: DefaultSizeStyle
}

export type CalloutShape = BaseShape<"callout", CalloutShapeProps>
```

`BaseShape` adds `id`, `typeName: "shape"`, `type`, `x`, `y`, `rotation`,
`index`, `parentId`, `isLocked`, `opacity`, `props` and `meta`. Props must be
JSON-serializable — they go into `.tldr` files verbatim.

`DefaultColorStyle` and `DefaultSizeStyle` are exported twice under one name:
as a **type** (the value union, `"black" | "grey" | ...` and `"s" | "m" | "l" |
"xl"`) and as a **value** (the `StyleProp` instance you will use in §7). One
import gives you both.

Naming the props `w` and `h` is not cosmetic: it is what lets the shape extend
`BaseBoxShapeUtil` in §6.

The util declares the type once:

```ts
export class CalloutShapeUtil extends ShapeUtil<CalloutShape> {
  static override type = "callout" as const

  getDefaultProps(): CalloutShapeProps {
    return { w: 220, h: 120, tailX: 40, tailY: 160, text: "", color: "blue", size: "m" }
  }
}
```

`getDefaultProps` fills in props the creator did not supply, so
`editor.createShape({ type: "callout", x, y })` is enough to make a valid shape.

---

## 2. Geometry

`getGeometry(shape)` returns a `Geometry2d` in **shape-local space** — the
origin is the shape's `(x, y)` before rotation. It is used for hit-testing,
bounds, snapping, the selection box, and (when the shape is on the GPU) as the
outline that gets tessellated. Get it right once and everything else follows.

The classes you can build with:

| Class | Constructor | Notes |
| ----- | ----------- | ----- |
| `Rectangle2d` | `{ x?, y?, width, height, isFilled, isLabel? }` | axis-aligned box |
| `Ellipse2d` | `{ width, height, isFilled }` | serialized as four cubics |
| `Circle2d` | `{ radius, isFilled }` | an `Ellipse2d` |
| `Polygon2d` | `{ points, isFilled }` | closed |
| `Polyline2d` | `{ points }` | open, never filled |
| `Edge2d` | `{ start, end }` | a two-point `Polyline2d` |
| `CubicSpline2d` | `{ segments, isClosed?, isFilled? }` | segments of `{ p0, c1, c2, p1 }` |
| `Group2d` | `{ children }` | several geometries as one shape |

`Group2d` is filled if any child is filled, closed if any child is closed, and
its `toPathWords()` concatenates its children's paths — **skipping children
whose `isLabel` is true**, so a label rectangle contributes to hit-testing and
bounds without being drawn.

The callout is a body plus a tail triangle:

```ts
import { Group2d, Polygon2d, Rectangle2d, type Geometry2d } from "@mocanvas/editor"

const TAIL_WIDTH = 28

getGeometry(shape: CalloutShape): Geometry2d {
  const { w, h, tailX, tailY } = shape.props
  const anchor = Math.max(0, Math.min(w - TAIL_WIDTH, tailX - TAIL_WIDTH / 2))
  return new Group2d({
    children: [
      new Rectangle2d({ width: w, height: h, isFilled: true }),
      new Polygon2d({
        points: [
          { x: anchor, y: h },
          { x: anchor + TAIL_WIDTH, y: h },
          { x: tailX, y: tailY },
        ],
        isFilled: true,
      }),
    ],
  })
}
```

Every `Geometry2d` gives you `vertices`, `bounds`, `center`, `nearestPoint`,
`distanceToPoint` and `hitTestPoint` on the TypeScript side, so a tool can ask
geometry questions without a round trip to the engine.

---

## 3. Rendering

mocanvas draws shapes two ways: as **GPU meshes** tessellated from
`getGeometry`, or as **React components in a DOM overlay** above the canvas. A
`ShapeUtil` picks per shape.

### `getRenderStyle` — the GPU path

```ts
getRenderStyle(shape: T): StyleWords | null
```

The base implementation returns `null`, which means "render me through
`component` in the DOM overlay". Return a `StyleWords` to draw the geometry on
the GPU instead:

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

Colours are packed integers, not CSS strings. `hexToRgba(hex, alpha = 1)`
converts `#rgb`, `#rrggbb` or `#rrggbbaa`. `dash` is `0` solid, `1` dashed, `2`
dotted, `3` draw. `strokeWidth` is in page units and scales with zoom, so the
mesh is never retessellated while zooming.

`LIGHT_THEME` maps each colour value to `{ solid, semi, pattern, fill, note,
highlight }`, and `STROKE_SIZES` / `FONT_SIZES` map each size value to a number
(`STROKE_SIZES` is `{ s: 2, m: 3.5, l: 5, xl: 10 }`).

```ts
import { hexToRgba, LIGHT_THEME, STROKE_SIZES, type StyleWords } from "@mocanvas/editor"

override getRenderStyle(shape: CalloutShape): StyleWords {
  const theme = LIGHT_THEME[shape.props.color]
  return {
    fill: hexToRgba(theme.semi),
    stroke: hexToRgba(theme.solid),
    strokeWidth: STROKE_SIZES[shape.props.size],
    dash: 0,
    opacity: 1,
  }
}
```

### `component` — the DOM overlay

```ts
abstract component(shape: T): ReactNode
```

`component` is always required, even for a GPU shape: it is the fallback when
the shape is promoted to the overlay. The overlay wraps it in an absolutely
positioned `<div>` carrying the shape's page transform, sized to the shape's
geometry bounds, with `pointerEvents: "none"` unless the shape is being edited.
Render in shape-local space starting at `(0, 0)`; do not apply the camera or
the shape transform yourself.

### `getIndicatorPath` — the selection outline

```ts
getIndicatorPath?(shape: T): Path2D | TLIndicatorPath | undefined
```

Return a `Path2D` in shape-local space. The compositor applies the shape's page
transform and supplies the stroke — colour from the theme's selection colour,
width in CSS pixels so it stays a hairline at any zoom — so an indicator is
usually just the outline:

```ts
import { svgPath } from "@mocanvas/mocanvas"

override getIndicatorPath(shape: CalloutShape): Path2D {
  return svgPath(pathWordsToSvgD(this.getGeometry(shape).toPathWords()))
}
```

Return a `TLIndicatorPath` when the outline needs a hole punched in it:

```ts
{ path: outline, clipPath: labelRect, additionalPaths: [tail] }
```

`clipPath` is applied even-odd *before* stroking `path`, so an outer rectangle
plus a label rectangle leaves the label uncovered. `additionalPaths` are stroked
afterwards, without the clip.

Returning `undefined` means **no outline**, not "use the default". A shape that
wants the plain bounds rectangle simply does not implement the method.

Indicators are drawn on a canvas overlay, not as React elements. A util that
throws here does not blank the whole selection layer — the compositor catches it
per shape — but do not rely on that.

> **Coming from mocanvas 1.x**, `indicator(shape): ReactNode` still works and is
> deprecated. A util that implements only the old one is routed to the SVG
> layer, so nothing breaks; a util that implements both is drawn once, on the
> canvas.

---

## 4. The overlay label

Two hooks decide whether `component` runs for a GPU shape.

```ts
needsOverlay(shape: T): boolean      // default: editor.getEditingShapeId() === shape.id
hasOverlayLabel(shape: T): boolean   // default: false
```

- `needsOverlay` **replaces** the GPU mesh with the DOM component. The default
  does that while the shape is being edited.
- `hasOverlayLabel` draws the GPU mesh **and** reports the shape to the overlay,
  so `component` can put a label on top of it.

A callout keeps its body on the GPU at all times and only wants a label:

```tsx
override needsOverlay(_shape: CalloutShape): boolean {
  return false
}

override hasOverlayLabel(shape: CalloutShape): boolean {
  return shape.props.text.trim().length > 0 || this.editor.getEditingShapeId() === shape.id
}

override canEdit(_shape: CalloutShape): boolean {
  return true
}

component(shape: CalloutShape): ReactNode {
  const { w, h, text, color, size } = shape.props
  return (
    <div
      style={{
        width: w,
        height: h,
        display: "grid",
        placeItems: "center",
        padding: 12,
        boxSizing: "border-box",
        fontSize: FONT_SIZES[size] / 2,
        color: LIGHT_THEME[color].solid,
        textAlign: "center",
        pointerEvents: "none",
      }}
    >
      {text}
    </div>
  )
}
```

`canEdit` returning `true` is what lets the select tool put the shape into
editing state (`editor.setEditingShape(id)`). There is also `getText(shape)`,
which the editor and export use to read a shape's plain text:

```ts
override getText(shape: CalloutShape): string {
  return shape.props.text
}
```

One more hook in this family: `isClipShape(shape)` (default `false`) makes the
shape clip all of its descendants to its page-space geometry bounds. Frames are
the intended user; no built-in enables it yet.

---

## 5. Handles

`getHandles` returns the shape's own draggable points. They are drawn by the
selection layer when exactly one shape is selected, and dragged through
`onHandleDrag`.

```ts
interface ShapeHandle {
  id: string
  type: "vertex" | "virtual" | "create" | "clone"
  index: string
  x: number
  y: number
}
```

`x` / `y` are in shape-local space. `vertex` handles draw as a large light dot,
`virtual` as a small translucent one (built-ins use `virtual` for midpoints that
become real points when dragged). `index` orders handles among themselves; a
single handle can use any stable string.

The callout has one handle, the tail tip:

```ts
import type { ShapeHandle } from "@mocanvas/editor"

override getHandles(shape: CalloutShape): ShapeHandle[] {
  return [{ id: "tail", type: "vertex", index: "a1", x: shape.props.tailX, y: shape.props.tailY }]
}

override onHandleDrag(shape: CalloutShape, info: { handle: ShapeHandle }): Partial<CalloutShape> {
  return { props: { ...shape.props, tailX: info.handle.x, tailY: info.handle.y } }
}
```

The full signature is
`onHandleDrag(shape: T, info: { handle: ShapeHandle; isPrecise: boolean; initial?: T }): Partial<T> | void`
— `isPrecise` is set when the user asked for an unsnapped drag, and `initial` is
the shape as it was when the drag began. Destructure only what you need. Return
a partial shape (or nothing, to ignore the drag).

There is also `onDoubleClickHandle(shape, handle)` if you want double-click on a
handle to do something, such as resetting the tail.

---

## 6. Resize

`ShapeUtil.onResize` is called by the select tool while the user drags a
selection handle:

```ts
onResize?(shape: T, info: ResizeInfo<T>): Partial<T> | void

interface ResizeInfo<T extends UnknownShape> {
  newPoint: VecLike
  handle: SelectionHandle
  mode: "scale_shape" | "resize_bounds"
  scaleX: number
  scaleY: number
  initialBounds: { x: number; y: number; w: number; h: number }
  initialShape: T
}
```

For a shape with `w` and `h` props you do not have to write it. Extend
`BaseBoxShapeUtil` instead, which implements exactly this:

```ts
export abstract class BaseBoxShapeUtil<
  T extends UnknownShape & { props: { w: number; h: number } },
> extends ShapeUtil<T> {
  override onResize(shape: T, info: ResizeInfo<T>): Partial<T> {
    const { scaleX, scaleY, initialShape, newPoint } = info
    const w = Math.max(1, Math.abs(initialShape.props.w * scaleX))
    const h = Math.max(1, Math.abs(initialShape.props.h * scaleY))
    return { x: newPoint.x, y: newPoint.y, props: { ...shape.props, w, h } } as Partial<T>
  }
}
```

The callout has one prop the base version does not know about — the tail — so it
extends `BaseBoxShapeUtil` and scales the tail on top of `super.onResize`:

```ts
import { BaseBoxShapeUtil, type ResizeInfo } from "@mocanvas/editor"

export class CalloutShapeUtil extends BaseBoxShapeUtil<CalloutShape> {
  override onResize(shape: CalloutShape, info: ResizeInfo<CalloutShape>): Partial<CalloutShape> {
    const next = super.onResize(shape, info)
    const props = next.props as CalloutShapeProps
    return {
      ...next,
      props: {
        ...props,
        tailX: info.initialShape.props.tailX * info.scaleX,
        tailY: info.initialShape.props.tailY * info.scaleY,
      },
    }
  }
}
```

Related predicates, all defaulting sensibly: `canResize` (default `true`),
`isAspectRatioLocked`, `hideResizeHandles`, `hideRotateHandle`,
`hideSelectionBoundsBg`, `hideSelectionBoundsFg`. `onResizeStart(shape)` and
`onResizeEnd(initial, current)` bracket the interaction.

---

## 7. Styles

A *style* is a prop shared across shape types: it is remembered for the next
shape you create, edited for a whole selection at once, and surfaced by the
style panel. Declare styles on the util's `static props` map, keyed by the prop
name:

```ts
import { DefaultColorStyle, DefaultSizeStyle } from "@mocanvas/editor"

export class CalloutShapeUtil extends BaseBoxShapeUtil<CalloutShape> {
  static override type = "callout" as const
  static override props = {
    color: DefaultColorStyle,
    size: DefaultSizeStyle,
  }
}
```

That is the whole wiring. `editor.getStylePropsForType("callout")` now reports
both, `editor.getSharedStyles()` includes them when a callout is selected, and
`editor.setStyleForSelectedShapes(DefaultColorStyle, "red")` rewrites
`props.color` on selected callouts.

The built-in style props, all exported from `@mocanvas/editor`:
`DefaultColorStyle` (`mocanvas:color`), `DefaultLabelColorStyle`,
`DefaultFillStyle`, `DefaultDashStyle`, `DefaultSizeStyle`, `DefaultFontStyle`,
`DefaultHorizontalAlignStyle`, `DefaultVerticalAlignStyle`, and
`GeoShapeGeoStyle`.

To define your own, use `StyleProp` and namespace the id:

```ts
import { StyleProp } from "@mocanvas/editor"

export const CalloutTailStyle = StyleProp.defineEnum("myapp:calloutTail", {
  defaultValue: "sharp",
  values: ["sharp", "round"] as const,
})
export type CalloutTail = (typeof CalloutTailStyle)["values"][number]
```

`defineEnum` returns an `EnumStyleProp` whose `validate` throws on a value
outside `values`. For a non-enum style there is
`StyleProp.define<T>(id, { defaultValue, validate? })`.

Reading and writing styles from code:

```ts
editor.getStyleForNextShape(DefaultColorStyle)             // the value for the next created shape
editor.setStyleForNextShapes(DefaultColorStyle, "violet")
editor.setStyleForSelectedShapes(DefaultColorStyle, "violet")

const shared = editor.getSharedStyles()                    // SharedStyleMap
shared.getAsKnownValue(DefaultColorStyle)                  // value, or undefined when mixed
shared.get(DefaultColorStyle)                              // { type: "shared", value } | { type: "mixed" }
```

---

## 8. The tool

Tools are trees of `StateNode`s: the tool itself is a branch with an `initial`
child, and each child is a state. The conventional shape is `Idle` (waiting)
plus `Pointing` (a gesture is in progress).

```ts
export interface StateNodeConstructor {
  new (editor: Editor, parent?: StateNode): StateNode
  id: string
  initial?: string
  children?(): StateNodeConstructor[]
  isLockable?: boolean
  useCoalescedEvents?: boolean
}
```

A branch node with children **must** declare `initial`, or the constructor
throws. Move between siblings with `this.parent!.transition(id, info)`; the old
child's `onExit` and the new child's `onEnter` run as part of the transition.

### Idle

```ts
import { StateNode, type PointerEventInfo } from "@mocanvas/editor"

class Idle extends StateNode {
  static override id = "idle"

  override onEnter(): void {
    this.editor.updateInstanceState({ cursor: { type: "cross", rotation: 0 } })
  }

  override onPointerDown(info: PointerEventInfo): void {
    if (info.button === 0) this.parent!.transition("pointing", info)
  }

  override onCancel(): void {
    this.editor.setCurrentTool("select")
  }
}
```

### Pointing

`Pointing` creates the shape on the first drag move, resizes it as the pointer
moves, and finishes on pointer up. A click without a drag gets a
default-sized shape centred on the click.

`editor.inputs` carries the pointer state you need: `originPagePoint` (where
the gesture started), `currentPagePoint`, `previousPagePoint`, `isDragging`
(true once the pointer passed the drag threshold), plus `shiftKey`, `altKey`,
`ctrlKey`, `metaKey` and `accelKey`.

```ts
import { createShapeId, StateNode, type ShapeId } from "@mocanvas/editor"

class Pointing extends StateNode {
  static override id = "pointing"
  private shapeId: ShapeId | null = null
  private markId = ""

  override onEnter(): void {
    this.shapeId = null
  }

  override onPointerMove(): void {
    if (!this.editor.inputs.isDragging) return
    if (!this.shapeId) this.create()
    this.resize()
  }

  override onPointerUp(): void {
    if (!this.shapeId) {
      this.create()
      const shape = this.editor.getShape<CalloutShape>(this.shapeId!)!
      const { w, h } = shape.props
      const { originPagePoint } = this.editor.inputs
      this.editor.updateShape<CalloutShape>({
        id: shape.id,
        type: "callout",
        x: originPagePoint.x - w / 2,
        y: originPagePoint.y - h / 2,
      })
    }
    this.finish()
  }

  override onCancel(): void {
    if (this.markId) this.editor.bailToMark(this.markId)
    this.parent!.transition("idle")
  }

  override onComplete(): void {
    this.finish()
  }

  private create(): void {
    const editor = this.editor
    // One undo entry for the whole creation gesture.
    this.markId = editor.markHistoryStoppingPoint("create callout")
    const id = createShapeId()
    const { originPagePoint } = editor.inputs
    editor.createShape<CalloutShape>({
      id,
      type: "callout",
      x: originPagePoint.x,
      y: originPagePoint.y,
      props: { w: 20, h: 20 },
    })
    editor.select(id)
    this.shapeId = id
  }

  private resize(): void {
    const editor = this.editor
    const shape = editor.getShape<CalloutShape>(this.shapeId!)
    if (!shape) return
    const { originPagePoint, currentPagePoint, shiftKey } = editor.inputs
    let w = currentPagePoint.x - originPagePoint.x
    let h = currentPagePoint.y - originPagePoint.y
    if (shiftKey) {
      const m = Math.max(Math.abs(w), Math.abs(h))
      w = Math.sign(w || 1) * m
      h = Math.sign(h || 1) * m
    }
    const x = w < 0 ? originPagePoint.x + w : originPagePoint.x
    const y = h < 0 ? originPagePoint.y + h : originPagePoint.y
    w = Math.max(1, Math.abs(w))
    h = Math.max(1, Math.abs(h))
    editor.updateShape<CalloutShape>({
      id: shape.id,
      type: "callout",
      x,
      y,
      props: { w, h, tailX: w / 2, tailY: h + 40 },
    })
  }

  private finish(): void {
    const editor = this.editor
    const locked = editor.getInstanceState().isToolLocked
    this.parent!.transition("idle")
    if (!locked) editor.setCurrentTool("select")
  }
}
```

Two conventions worth copying from the built-in tools:

- `markHistoryStoppingPoint(name)` before the first mutation, `bailToMark(id)`
  on cancel. The whole gesture becomes one undo step, and Escape leaves no
  debris.
- Honour `getInstanceState().isToolLocked`: when it is off, return to the select
  tool after one shape; when it is on, stay armed for the next one.

### The tool node

```ts
import { StateNode, type StateNodeConstructor } from "@mocanvas/editor"

/** Drag to place a callout. */
export class CalloutTool extends StateNode {
  static override id = "callout"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [Idle, Pointing]
  override shapeType = "callout"
}
```

`static id` is what `editor.setCurrentTool("callout")` takes and what
`editor.getCurrentToolId()` returns; `editor.getPath()` gives the full active
path, e.g. `"root.callout.pointing"`, and `editor.isIn("callout.pointing")` /
`editor.isInAny(...)` test it. `shapeType` records which shape kind the tool
creates.

Handlers available on any `StateNode`: `onEnter`, `onExit`, `onPointerDown`,
`onPointerMove`, `onPointerUp`, `onRightClick`, `onMiddleClick`,
`onDoubleClick`, `onKeyDown`, `onKeyUp`,
`onKeyRepeat`, `onWheel`, `onCancel`, `onComplete`, `onInterrupt`, `onTick`.

---

## 9. Registering both

`shapeUtils` and `tools` on `<Mocanvas />` are **additive** — they are appended
to the built-in `defaultShapeUtils` and `defaultTools`, so do not re-list the
built-ins:

```tsx
import { Mocanvas } from "@mocanvas/mocanvas"
import { CalloutShapeUtil } from "./CalloutShapeUtil"
import { CalloutTool } from "./CalloutTool"

export function App() {
  return (
    <Mocanvas
      shapeUtils={[CalloutShapeUtil]}
      tools={[CalloutTool]}
      onMount={(editor) => {
        editor.createShape({ type: "callout", x: 120, y: 120, props: { text: "Hi" } })
      }}
    />
  )
}
```

The default toolbar does not grow a button for your tool. Until UI slots exist,
drive it from your own chrome rendered as `children` of `<Mocanvas>`:

```tsx
<Mocanvas shapeUtils={[CalloutShapeUtil]} tools={[CalloutTool]}>
  <MyToolbar />
</Mocanvas>
```

…where `MyToolbar` uses `useEditor()` to get the editor and `track()` (both
re-exported from `@mocanvas/mocanvas`) so it re-renders when the active tool changes:

```tsx
import { track, useEditor } from "@mocanvas/mocanvas"

const MyToolbar = track(function MyToolbar() {
  const editor = useEditor()
  const active = editor.getCurrentToolId() === "callout"
  return (
    <button type="button" aria-pressed={active} onClick={() => editor.setCurrentTool("callout")}>
      Callout
    </button>
  )
})
```

For a bare editor with no default shapes, tools or UI, construct `Editor`
yourself with `loadEngine()` and `createStore()` and render `<Canvas editor={editor} />`.

---

## 10. The whole file

`CalloutShapeUtil.tsx`:

```tsx
import {
  BaseBoxShapeUtil,
  DefaultColorStyle,
  DefaultSizeStyle,
  FONT_SIZES,
  Group2d,
  hexToRgba,
  LIGHT_THEME,
  Polygon2d,
  Rectangle2d,
  STROKE_SIZES,
  type BaseShape,
  type Geometry2d,
  type ResizeInfo,
  type ShapeHandle,
  type StyleWords,
} from "@mocanvas/editor"
import { pathWordsToSvgD } from "@mocanvas/mocanvas"
import type { ReactNode } from "react"

// `DefaultColorStyle` / `DefaultSizeStyle` are imported once, in the value
// list: each name is both the `StyleProp` value and the value-union type.
export interface CalloutShapeProps {
  w: number
  h: number
  tailX: number
  tailY: number
  text: string
  color: DefaultColorStyle
  size: DefaultSizeStyle
}

export type CalloutShape = BaseShape<"callout", CalloutShapeProps>

const TAIL_WIDTH = 28

export class CalloutShapeUtil extends BaseBoxShapeUtil<CalloutShape> {
  static override type = "callout" as const
  static override props = {
    color: DefaultColorStyle,
    size: DefaultSizeStyle,
  }

  getDefaultProps(): CalloutShapeProps {
    return { w: 220, h: 120, tailX: 40, tailY: 160, text: "", color: "blue", size: "m" }
  }

  getGeometry(shape: CalloutShape): Geometry2d {
    const { w, h, tailX, tailY } = shape.props
    const anchor = Math.max(0, Math.min(w - TAIL_WIDTH, tailX - TAIL_WIDTH / 2))
    return new Group2d({
      children: [
        new Rectangle2d({ width: w, height: h, isFilled: true }),
        new Polygon2d({
          points: [
            { x: anchor, y: h },
            { x: anchor + TAIL_WIDTH, y: h },
            { x: tailX, y: tailY },
          ],
          isFilled: true,
        }),
      ],
    })
  }

  override getRenderStyle(shape: CalloutShape): StyleWords {
    const theme = LIGHT_THEME[shape.props.color]
    return {
      fill: hexToRgba(theme.semi),
      stroke: hexToRgba(theme.solid),
      strokeWidth: STROKE_SIZES[shape.props.size],
      dash: 0,
      opacity: 1,
    }
  }

  override needsOverlay(_shape: CalloutShape): boolean {
    return false
  }

  override hasOverlayLabel(shape: CalloutShape): boolean {
    return shape.props.text.trim().length > 0 || this.editor.getEditingShapeId() === shape.id
  }

  component(shape: CalloutShape): ReactNode {
    const { w, h, text, color, size } = shape.props
    return (
      <div
        style={{
          width: w,
          height: h,
          display: "grid",
          placeItems: "center",
          padding: 12,
          boxSizing: "border-box",
          fontSize: FONT_SIZES[size] / 2,
          color: LIGHT_THEME[color].solid,
          textAlign: "center",
          pointerEvents: "none",
        }}
      >
        {text}
      </div>
    )
  }

  override getIndicatorPath(shape: CalloutShape): Path2D {
    return svgPath(pathWordsToSvgD(this.getGeometry(shape).toPathWords()))
  }

  override canEdit(_shape: CalloutShape): boolean {
    return true
  }

  override getText(shape: CalloutShape): string {
    return shape.props.text
  }

  override getHandles(shape: CalloutShape): ShapeHandle[] {
    return [{ id: "tail", type: "vertex", index: "a1", x: shape.props.tailX, y: shape.props.tailY }]
  }

  override onHandleDrag(shape: CalloutShape, info: { handle: ShapeHandle }): Partial<CalloutShape> {
    return { props: { ...shape.props, tailX: info.handle.x, tailY: info.handle.y } }
  }

  override onResize(shape: CalloutShape, info: ResizeInfo<CalloutShape>): Partial<CalloutShape> {
    const next = super.onResize(shape, info)
    const props = next.props as CalloutShapeProps
    return {
      ...next,
      props: {
        ...props,
        tailX: info.initialShape.props.tailX * info.scaleX,
        tailY: info.initialShape.props.tailY * info.scaleY,
      },
    }
  }
}
```

The tool lives in its own file, exactly as written in §8.

---

## Where to go next

- [COMPAT.md](COMPAT.md) — the full `ShapeUtil` / `StateNode` / `Editor`
  surface, member by member.
- [MIGRATION.md](MIGRATION.md) — porting shapes that already exist in a
  tldraw app, and the current known gaps.
- [ARCHITECTURE.md](ARCHITECTURE.md) — the command buffer, the frame buffers,
  and why `getRenderStyle` exists.
- The built-in utils under `packages/mocanvas/src/shapes/` are the reference
  implementations: `GeoShapeUtil` for GPU body plus label, `LineShapeUtil` for
  vertex and virtual handles, `FrameShapeUtil` for a container, `ImageShapeUtil`
  for an asset-backed overlay shape.
