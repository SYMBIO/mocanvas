import {
  FONT_SIZES,
  Group2d,
  Rectangle2d,
  ShapeUtil,
  STROKE_SIZES,
  Vec,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  DefaultLabelColorStyle,
  DefaultSizeStyle,
  type BaseShape,
  type Geometry2d,
  type ShapeHandle,
  type StyleWords,
} from "@mocanvas/editor"
import type { ReactNode } from "react"
import {
  applyTransform,
  getArrowBindings,
  getArrowBindingTargetAtPoint,
  getArrowTerminalsInArrowSpace,
  getNormalizedAnchor,
} from "../bindings/arrow-terminals"
import type { ArrowBinding, ArrowTerminal } from "../bindings/ArrowBindingUtil"
import { TextLabel } from "../text/TextEditor"
import { measureLabel, trimTrailingWhitespace } from "../text/text-layout"
import {
  bodyToGeometry,
  getArrowBody,
  getArrowheadGeometry,
  getArrowheadInset,
  getArrowheadLength,
  getBendFromPoint,
  getBodyLength,
  getPointOnBody,
  getTangentOnBody,
  shortenBody,
  type ArrowheadKind,
} from "./arrow-helpers"
import { getDashId, getStrokeRgba, getTextCssColor } from "./shape-theme"
import { pathWordsToSvgD } from "./svg-path"

export type { ArrowheadKind } from "./arrow-helpers"

export interface ArrowShapeProps {
  /** Static start terminal in arrow-local space; ignored while the terminal is bound. */
  start: { x: number; y: number }
  /** Static end terminal in arrow-local space; ignored while the terminal is bound. */
  end: { x: number; y: number }
  bend: number
  color: DefaultColorStyle
  labelColor: DefaultColorStyle
  fill: DefaultFillStyle
  dash: DefaultDashStyle
  size: DefaultSizeStyle
  arrowheadStart: ArrowheadKind
  arrowheadEnd: ArrowheadKind
  font: DefaultFontStyle
  text: string
  labelPosition: number
  scale: number
}

export type ArrowShape = BaseShape<"arrow", ArrowShapeProps>

export const ARROW_LABEL_PADDING = 8
const LABEL_PADDING = ARROW_LABEL_PADDING

export class ArrowShapeUtil extends ShapeUtil<ArrowShape> {
  static override type = "arrow" as const
  static override props = {
    color: DefaultColorStyle,
    labelColor: DefaultLabelColorStyle,
    fill: DefaultFillStyle,
    dash: DefaultDashStyle,
    size: DefaultSizeStyle,
    font: DefaultFontStyle,
  }

  getDefaultProps(): ArrowShapeProps {
    return {
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
      bend: 0,
      color: "black",
      labelColor: "black",
      fill: "none",
      dash: "draw",
      size: "m",
      arrowheadStart: "none",
      arrowheadEnd: "arrow",
      font: "draw",
      text: "",
      labelPosition: 0.5,
      scale: 1,
    }
  }

  getGeometry(shape: ArrowShape): Geometry2d {
    const { bend, arrowheadStart, arrowheadEnd, size, scale, text, labelPosition, font } = shape.props
    const { start, end } = getArrowTerminalsInArrowSpace(this.editor, shape)
    const strokeWidth = STROKE_SIZES[size] * scale
    const full = getArrowBody(start, end, bend)
    const length = getBodyLength(full)
    const headLength = getArrowheadLength(strokeWidth, length)
    const body = shortenBody(full, getArrowheadInset(arrowheadStart, headLength), getArrowheadInset(arrowheadEnd, headLength))

    const children: Geometry2d[] = [bodyToGeometry(body)]
    const startHead = getArrowheadGeometry(arrowheadStart, start, Vec.Mul(getTangentOnBody(full, 0), -1), headLength)
    if (startHead) children.push(startHead)
    const endHead = getArrowheadGeometry(arrowheadEnd, end, getTangentOnBody(full, 1), headLength)
    if (endHead) children.push(endHead)

    if (text) {
      const m = measureLabel(text, { font, fontSize: FONT_SIZES[size] * scale, padding: LABEL_PADDING * scale })
      const c = getPointOnBody(full, Math.max(0, Math.min(1, labelPosition)))
      children.push(new Rectangle2d({ x: c.x - m.w / 2, y: c.y - m.h / 2, width: m.w, height: m.h, isFilled: false, isLabel: true }))
    }
    return new Group2d({ children })
  }

  override getRenderStyle(shape: ArrowShape): StyleWords {
    const { color, dash, size, scale } = shape.props
    const stroke = getStrokeRgba(color)
    // The body is open so it never fills; closed arrowheads fill with the stroke color.
    return { stroke, strokeWidth: STROKE_SIZES[size] * scale, fill: stroke, dash: getDashId(dash), opacity: 1 }
  }

  component(shape: ArrowShape): ReactNode {
    const { text, font, size, scale, labelColor, bend, labelPosition } = shape.props
    const isEditing = this.editor.getEditingShapeId() === shape.id
    if (!text && !isEditing) return null
    const { start, end } = getArrowTerminalsInArrowSpace(this.editor, shape)
    const c = getPointOnBody(getArrowBody(start, end, bend), Math.max(0, Math.min(1, labelPosition)))
    return (
      <div
        style={{
          position: "absolute",
          left: c.x,
          top: c.y,
          transform: "translate(-50%, -50%)",
          width: "max-content",
          pointerEvents: "none",
        }}
      >
        <div style={{ position: "relative", width: "max-content" }}>
          <TextLabel
            shape={shape}
            text={text}
            isEditing={isEditing}
            font={font}
            fontSize={FONT_SIZES[size] * scale}
            color={getTextCssColor(labelColor)}
            align="middle"
            verticalAlign="middle"
            wrap={false}
            padding={LABEL_PADDING * scale}
            onChange={(next) => this.editor.updateShape<ArrowShape>({ id: shape.id, type: "arrow", props: { text: next } })}
          />
        </div>
      </div>
    )
  }

  indicator(shape: ArrowShape): ReactNode {
    return <path d={pathWordsToSvgD(this.getGeometry(shape).toPathWords())} />
  }

  /** The GPU keeps drawing the arrow while its label is edited. */
  override needsOverlay(_shape: ArrowShape): boolean {
    return false
  }

  override hasOverlayLabel(shape: ArrowShape): boolean {
    return shape.props.text.trim().length > 0 || this.editor.getEditingShapeId() === shape.id
  }

  override canEdit(_shape: ArrowShape): boolean {
    return true
  }

  /** Nothing binds to an arrow (no arrow-to-arrow bindings). */
  override canBind(_opts: { fromShapeType: string; toShapeType: string; bindingType: string }): boolean {
    return false
  }

  /** A selected arrow shows its handles instead of a selection box. */
  override hideSelectionBoundsBg(_shape: ArrowShape): boolean {
    return true
  }

  override hideSelectionBoundsFg(_shape: ArrowShape): boolean {
    return true
  }

  override hideResizeHandles(_shape: ArrowShape): boolean {
    return true
  }

  override getText(shape: ArrowShape): string {
    return shape.props.text
  }

  override onEditEnd(shape: ArrowShape): void {
    const trimmed = trimTrailingWhitespace(shape.props.text)
    if (trimmed !== shape.props.text) this.editor.updateShape<ArrowShape>({ id: shape.id, type: "arrow", props: { text: trimmed } })
  }

  override getHandles(shape: ArrowShape): ShapeHandle[] {
    const { start, end } = getArrowTerminalsInArrowSpace(this.editor, shape)
    const mid = getPointOnBody(getArrowBody(start, end, shape.props.bend), 0.5)
    return [
      { id: "start", type: "vertex", index: "a1", x: start.x, y: start.y },
      { id: "bend", type: "virtual", index: "a2", x: mid.x, y: mid.y },
      { id: "end", type: "vertex", index: "a3", x: end.x, y: end.y },
    ]
  }

  override onHandleDrag(shape: ArrowShape, info: { handle: ShapeHandle; isPrecise: boolean; initial?: ArrowShape }): Partial<ArrowShape> | void {
    const { handle } = info
    switch (handle.id) {
      case "start":
      case "end":
        return this.dragTerminal(shape, handle.id, handle, info.isPrecise)
      case "bend": {
        const { start, end } = getArrowTerminalsInArrowSpace(this.editor, shape)
        return { props: { ...shape.props, bend: getBendFromPoint(start, end, handle) } }
      }
      default:
        return
    }
  }

  /**
   * Move a terminal handle. When the handle lands on a bindable shape the
   * terminal is bound to it (centered, or at the precise point under the
   * pointer); otherwise any existing binding is dropped. The static point is
   * always written so the arrow renders sensibly if the binding goes away.
   * Holding Ctrl suppresses binding. Targets are found by hit-testing shape
   * geometry directly (not `editor.getShapeAtPoint`) because the engine treats
   * unfilled shapes as hollow, and arrows must bind into hollow shapes too.
   */
  private dragTerminal(shape: ArrowShape, terminal: ArrowTerminal, point: { x: number; y: number }, isPrecise: boolean): Partial<ArrowShape> {
    const editor = this.editor
    const local = { x: point.x, y: point.y }
    const pagePoint = applyTransform(editor.getShapePageTransform(shape), local)
    const existing = getArrowBindings(editor, shape)[terminal]

    const target = editor.inputs.ctrlKey ? undefined : getArrowBindingTargetAtPoint(editor, shape, pagePoint)

    if (target) {
      const bindingProps: ArrowBinding["props"] = {
        terminal,
        normalizedAnchor: isPrecise ? getNormalizedAnchor(editor, target, pagePoint).toJson() : { x: 0.5, y: 0.5 },
        isPrecise,
        isExact: false,
      }
      if (existing && existing.toId === target.id) {
        editor.updateBinding<ArrowBinding>({ id: existing.id, type: "arrow", props: bindingProps })
      } else {
        if (existing) editor.deleteBinding(existing.id)
        editor.createBinding<ArrowBinding>({ type: "arrow", fromId: shape.id, toId: target.id, props: bindingProps })
      }
    } else if (existing) {
      editor.deleteBinding(existing.id)
    }

    return { props: { ...shape.props, [terminal]: local } }
  }

  /**
   * Dragging the arrow on its own detaches it: bindings to shapes that are not
   * part of the selection are dropped and their terminals frozen in place.
   * Bindings to shapes moving along with the arrow are kept.
   */
  override onTranslateStart(shape: ArrowShape): void {
    const editor = this.editor
    const selected = new Set(editor.getSelectedShapeIds())
    const stale = editor.getBindingsFromShape<ArrowBinding>(shape, "arrow").filter((b) => !selected.has(b.toId))
    if (stale.length) editor.deleteBindings(stale, { isolateShapes: true })
  }
}
