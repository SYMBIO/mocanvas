import {
  createShapeId,
  StateNode,
  type PointerEventInfo,
  type ShapeId,
  type StateNodeConstructor,
  type UnknownShape,
} from "@mocanvas/editor"

/** Smallest box a drag may produce, in page units. */
const DEFAULT_MIN_BOX_SIZE = 1

/** A `w`/`h` pair in page units. */
export interface BoxSize {
  w: number
  h: number
}

class BoxIdle extends StateNode {
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

class BoxPointing extends StateNode {
  static override id = "pointing"
  private shapeId: ShapeId | null = null
  private markId = ""

  private get tool(): BaseBoxShapeTool {
    return this.parent as BaseBoxShapeTool
  }

  override onEnter(): void {
    this.shapeId = null
  }

  override onPointerMove(): void {
    if (!this.editor.inputs.isDragging) return
    if (!this.shapeId) this.create()
    this.resize()
  }

  override onPointerUp(): void {
    // A press with no drag places a default-sized box CENTRED on the point,
    // which is what makes "click to place" feel like dropping a stamp rather
    // than starting a rectangle at the cursor.
    if (!this.shapeId) {
      this.create()
      const size = this.tool.getDefaultSize()
      const { originPagePoint } = this.editor.inputs
      this.editor.updateShape({
        id: this.shapeId!,
        type: this.tool.shapeType,
        x: originPagePoint.x - size.w / 2,
        y: originPagePoint.y - size.h / 2,
        // `getCreateProps()` already ran inside `create()`; running it again
        // would ask a counter ("Frame 3") for a second, different answer.
        props: { ...size },
      })
    }
    this.finish()
  }

  override onComplete(): void {
    this.finish()
  }

  override onCancel(): void {
    if (this.markId) this.editor.bailToMark(this.markId)
    this.shapeId = null
    this.parent!.transition("idle")
  }

  private create(): void {
    const editor = this.editor
    const tool = this.tool
    this.markId = editor.markHistoryStoppingPoint(`create ${tool.shapeType}`)
    const id = createShapeId()
    const { originPagePoint } = editor.inputs
    const min = tool.minSize
    editor.createShape({
      id,
      type: tool.shapeType,
      x: originPagePoint.x,
      y: originPagePoint.y,
      props: { ...tool.getCreateProps(), w: min, h: min },
    })
    editor.select(id)
    this.shapeId = id
  }

  private resize(): void {
    const editor = this.editor
    const tool = this.tool
    const shape = editor.getShape(this.shapeId!)
    if (!shape) return
    const { originPagePoint, currentPagePoint, shiftKey } = editor.inputs
    let w = currentPagePoint.x - originPagePoint.x
    let h = currentPagePoint.y - originPagePoint.y
    if (shiftKey) {
      const m = Math.max(Math.abs(w), Math.abs(h))
      w = Math.sign(w || 1) * m
      h = Math.sign(h || 1) * m
    }
    let x = originPagePoint.x
    let y = originPagePoint.y
    // Dragging up or left moves the origin instead of producing a negative box.
    if (w < 0) x += w
    if (h < 0) y += h
    const min = tool.minSize
    editor.updateShape({
      id: shape.id,
      type: shape.type,
      x,
      y,
      props: { w: Math.max(min, Math.abs(w)), h: Math.max(min, Math.abs(h)) },
    })
  }

  private finish(): void {
    const id = this.shapeId
    this.shapeId = null
    this.parent!.transition("idle")
    this.tool.onCreate(id ? (this.editor.getShape(id) ?? null) : null)
  }
}

/**
 * Drag out a box shape, or click to place a default-sized one.
 *
 * The create-on-drag state chart, on its own, so a placement tool is a
 * subclass rather than a copy of it:
 *
 * ```ts
 * class SectionTool extends BaseBoxShapeTool {
 *   static override id = "section"
 *   static override initial = "idle"
 *   override shapeType = "section" as const
 *   override onCreate(shape: UnknownShape | null): void { … }
 * }
 * ```
 *
 * A subclass that overrides {@link BaseBoxShapeTool.onCreate} takes over
 * *everything* the base did afterwards, tool lock included — the default
 * implementation is the whole of that behaviour, so an override is expected to
 * finish the job itself.
 */
export abstract class BaseBoxShapeTool extends StateNode {
  static override id = "box"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [BoxIdle, BoxPointing]

  /** The shape type this tool creates. */
  abstract override shapeType: string

  /** Smallest box a drag may produce, in page units. */
  minSize: number = DEFAULT_MIN_BOX_SIZE

  /**
   * The size a click (as opposed to a drag) places.
   *
   * Defaults to the shape util's own `getDefaultProps()`, so the tool and a
   * programmatic `createShape` agree on what "a new one" means, and a util that
   * changes its default size does not have to tell the tool.
   */
  getDefaultSize(): BoxSize {
    const props = this.editor.getShapeUtil(this.shapeType).getDefaultProps() as { w?: unknown; h?: unknown }
    const w = typeof props.w === "number" ? props.w : this.minSize
    const h = typeof props.h === "number" ? props.h : this.minSize
    return { w, h }
  }

  /**
   * Props to seed a newly created shape with, beyond `w`/`h`.
   *
   * The hook for a shape whose identity is decided at placement time — a
   * frame's `Frame 3`, a section's colour. Runs once, before the shape exists.
   */
  getCreateProps(): Record<string, unknown> {
    return {}
  }

  /**
   * Called once the shape is final: after the drag ends, or after a click has
   * placed a default-sized one. `null` means nothing was created.
   *
   * The default returns to the select tool, unless tool lock is on. Override it
   * to adopt enclosed shapes, open an editor, or anything else a placement
   * should do — and repeat whichever of those two endings you want, because an
   * override replaces this entirely.
   */
  onCreate(_shape: UnknownShape | null): void {
    const editor = this.editor
    if (editor.getInstanceState().isToolLocked) editor.setCurrentTool(this.id)
    else editor.setCurrentTool("select")
  }
}
