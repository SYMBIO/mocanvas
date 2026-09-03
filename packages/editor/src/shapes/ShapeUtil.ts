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
  abstract indicator(shape: T): ReactNode

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
