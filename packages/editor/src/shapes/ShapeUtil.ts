import type { ReactNode } from "react"
import type { StyleWords } from "@mocanvas/wasm"
import type { Editor } from "../editor/Editor"
import type { Geometry2d, VecLike } from "../geometry"
import type { ShapeHandle, SelectionHandle } from "../editor/events"
import type { UnknownShape } from "../records/base"

export interface ShapeUtilConstructor<T extends UnknownShape = UnknownShape, U extends ShapeUtil<T> = ShapeUtil<T>> {
  new (editor: Editor): U
  type: T["type"]
  props?: Record<string, unknown>
  migrations?: unknown
}

export interface ResizeInfo<T extends UnknownShape> {
  newPoint: VecLike
  handle: SelectionHandle
  mode: "scale_shape" | "resize_bounds"
  scaleX: number
  scaleY: number
  initialBounds: { x: number; y: number; w: number; h: number }
  initialShape: T
}

export interface TranslateInfo<T extends UnknownShape> {
  initialShape: T
}

/** Export-wide settings handed to `ShapeUtil.toSvg` / `toBackgroundSvg`. */
export interface ShapeSvgContext {
  /** Whether the export is being drawn against the dark theme. */
  darkMode: boolean
  /** The page background colour of the export, as `#rrggbb`. */
  background: string
}

/**
 * What an SVG export callback may return: a raw markup string (inserted
 * verbatim, so it must be well-formed and escaped by the util) or a React node
 * the exporter serializes. `undefined` means "I have nothing to draw", which
 * lets the exporter fall through to its own renderers.
 */
export type ShapeSvgResult = string | ReactNode

/**
 * Describes how a shape type behaves: its default props, geometry, rendering
 * and interaction callbacks. One instance per shape type per editor.
 */
export abstract class ShapeUtil<T extends UnknownShape = UnknownShape> {
  static type: string
  static props?: Record<string, unknown>
  static migrations?: unknown

  constructor(readonly editor: Editor) {}

  get type(): T["type"] {
    return (this.constructor as ShapeUtilConstructor<T>).type
  }

  abstract getDefaultProps(): T["props"]
  abstract getGeometry(shape: T): Geometry2d
  abstract component(shape: T): ReactNode

  /**
   * The outline drawn over the shape when it is selected or hovered, in
   * shape-local coordinates. The indicators layer supplies `fill: none`, the
   * selection colour and a zoom-independent stroke width, so an indicator is
   * usually just a bare `<path>` or `<rect>`. Return `null` to fall back to a
   * rectangle around the shape's geometry bounds.
   */
  abstract indicator(shape: T): ReactNode

  /**
   * The shape as SVG, in shape-local coordinates: the exporter wraps the
   * result in a `<g>` carrying the shape's page transform and opacity.
   * Implement it to make a custom shape exportable without registering
   * anything; leave it undefined to fall through to the exporter's own
   * renderers.
   */
  toSvg?(shape: T, ctx: ShapeSvgContext): ShapeSvgResult

  /**
   * Extra SVG drawn *behind* every exported shape (a backdrop, a drop shadow,
   * a grid). Same coordinate space and wrapping as `toSvg`.
   */
  toBackgroundSvg?(shape: T, ctx: ShapeSvgContext): ShapeSvgResult

  /**
   * GPU style for the shape's geometry. Return `null` (the default) to render
   * the shape through `component` in the DOM overlay instead.
   */
  getRenderStyle(_shape: T): StyleWords | null {
    return null
  }

  /** Whether the shape should be drawn by the DOM overlay even if it has a render style (e.g. while editing). */
  needsOverlay(shape: T): boolean {
    return this.editor.getEditingShapeId() === shape.id
  }

  /**
   * Whether `component` should be rendered in the DOM overlay *in addition to*
   * the GPU geometry (e.g. a text label on a filled shape).
   */
  hasOverlayLabel(_shape: T): boolean {
    return false
  }

  /**
   * Whether the shape clips its descendants to its own geometry bounds (e.g.
   * frames). Children are then rendered with a scissor rect on the GPU.
   */
  isClipShape(_shape: T): boolean {
    return false
  }

  canEdit(_shape: T): boolean {
    return false
  }
  canResize(_shape: T): boolean {
    return true
  }
  canBind(_opts: { fromShapeType: string; toShapeType: string; bindingType: string }): boolean {
    return true
  }
  canCrop(_shape: T): boolean {
    return false
  }
  canScroll(_shape: T): boolean {
    return false
  }
  canSnap(_shape: T): boolean {
    return true
  }
  canReceiveNewChildrenOfType(_shape: T, _type: string): boolean {
    return false
  }
  canDropShapes(_shape: T, _shapes: UnknownShape[]): boolean {
    return false
  }
  hideRotateHandle(_shape: T): boolean {
    return false
  }
  hideResizeHandles(_shape: T): boolean {
    return false
  }
  hideSelectionBoundsBg(_shape: T): boolean {
    return false
  }
  hideSelectionBoundsFg(_shape: T): boolean {
    return false
  }
  isAspectRatioLocked(_shape: T): boolean {
    return false
  }
  getHandles?(shape: T): ShapeHandle[]
  getText?(shape: T): string | undefined

  onBeforeCreate?(next: T): T | void
  onBeforeUpdate?(prev: T, next: T): T | void
  onResize?(shape: T, info: ResizeInfo<T>): Partial<T> | void
  onResizeStart?(shape: T): void
  onResizeEnd?(initial: T, current: T): void
  onTranslateStart?(shape: T): Partial<T> | void
  onTranslate?(initial: T, current: T): Partial<T> | void
  onTranslateEnd?(initial: T, current: T): Partial<T> | void
  onRotateStart?(shape: T): void
  onRotate?(initial: T, current: T): Partial<T> | void
  onRotateEnd?(initial: T, current: T): void
  onHandleDrag?(shape: T, info: { handle: ShapeHandle; isPrecise: boolean; initial?: T }): Partial<T> | void
  onDoubleClick?(shape: T): Partial<T> | void
  onDoubleClickEdge?(shape: T): Partial<T> | void
  onDoubleClickHandle?(shape: T, handle: ShapeHandle): Partial<T> | void
  onEditEnd?(shape: T): void
  onChildrenChange?(shape: T): Partial<UnknownShape>[] | void
  onDragShapesOver?(shape: T, shapes: UnknownShape[]): void
  onDragShapesOut?(shape: T, shapes: UnknownShape[]): void
  onDropShapesOver?(shape: T, shapes: UnknownShape[]): void
}

/** Shapes with `w` and `h` props. */
export abstract class BaseBoxShapeUtil<T extends UnknownShape & { props: { w: number; h: number } }> extends ShapeUtil<T> {
  override onResize(shape: T, info: ResizeInfo<T>): Partial<T> {
    const { scaleX, scaleY, initialShape, newPoint } = info
    const w = Math.max(1, Math.abs(initialShape.props.w * scaleX))
    const h = Math.max(1, Math.abs(initialShape.props.h * scaleY))
    return { x: newPoint.x, y: newPoint.y, props: { ...shape.props, w, h } } as Partial<T>
  }
}
