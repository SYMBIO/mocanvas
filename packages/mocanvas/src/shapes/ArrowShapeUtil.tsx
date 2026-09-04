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
  type BindingCanBindOptions,
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
  getBoundElbowAxes,
  getNormalizedAnchor,
  type ArrowTerminals,
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
  type ArrowBody,
  type ArrowheadKind,
} from "./arrow-helpers"
import { ELBOW_CORNER_STROKES, getElbowMidPointFromPoint, getElbowRoute, type ElbowRoute } from "./elbow-helpers"
import { propsOf, readEnum, readNumber, readPoint, readStyle, readText } from "./prop-access"
import { getDashId, getStrokeRgba, getTextCssColor } from "./shape-theme"
import { pathWordsToSvgD } from "./svg-path"
import { svgPath } from "./indicator-paths"

export type { ArrowheadKind } from "./arrow-helpers"

export interface ArrowShapeProps {
  /**
   * How the body is routed: `"arc"` bows from start to end by `bend`,
   * `"elbow"` runs in axis-aligned legs (and ignores `bend`).
   */
  kind: ArrowKind
  /** Static start terminal in arrow-local space; ignored while the terminal is bound. */
  start: { x: number; y: number }
  /** Static end terminal in arrow-local space; ignored while the terminal is bound. */
  end: { x: number; y: number }
  bend: number
  /** Where an elbow's middle leg sits along the routing axis, `0..1`; unused by `"arc"`. */
  elbowMidPoint: number
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

const ARROWHEADS = ["none", "arrow", "triangle", "square", "dot", "diamond", "inverted", "bar", "pipe"] as const

/** Routing kinds an arrow can have. */
export const ARROW_KINDS = ["arc", "elbow"] as const
export type ArrowKind = (typeof ARROW_KINDS)[number]

/**
 * The shape with every declared prop present and of the declared type. Terminal
 * resolution and binding code read the arrow as a whole, so the normalized copy
 * is a whole shape rather than a loose props bag.
 */
export function readArrowShape(shape: ArrowShape): ArrowShape {
  return { ...shape, props: readArrowProps(shape) }
}

/**
 * `shape.props` with every declared prop present and of the declared type, so
 * geometry and rendering survive a record that arrived without one.
 */
export function readArrowProps(shape: { props?: unknown }): ArrowShapeProps {
  const p = propsOf(shape)
  return {
    kind: readEnum(p, "kind", ARROW_KINDS, "arc"),
    start: readPoint(p, "start", { x: 0, y: 0 }),
    end: readPoint(p, "end", { x: 2, y: 0 }),
    bend: readNumber(p, "bend", 0),
    elbowMidPoint: readNumber(p, "elbowMidPoint", 0.5),
    color: readStyle(p, "color", DefaultColorStyle),
    labelColor: readStyle(p, "labelColor", DefaultLabelColorStyle),
    fill: readStyle(p, "fill", DefaultFillStyle),
    dash: readStyle(p, "dash", DefaultDashStyle),
    size: readStyle(p, "size", DefaultSizeStyle),
    arrowheadStart: readEnum(p, "arrowheadStart", ARROWHEADS, "none"),
    arrowheadEnd: readEnum(p, "arrowheadEnd", ARROWHEADS, "arrow"),
    font: readStyle(p, "font", DefaultFontStyle),
    text: readText(p),
    labelPosition: readNumber(p, "labelPosition", 0.5),
    scale: readNumber(p, "scale", 1),
  }
}

export class ArrowShapeUtil extends ShapeUtil<ArrowShape> {
  static override type = "arrow" as const
  /**
   * `kind` is deliberately not among these. A style is shared across shape
   * types, remembered for the next shape and applied to a whole selection at
   * once; arc-versus-elbow is routing that belongs to the one arrow, and
   * declaring it a style would put it in every mixed selection's shared styles
   * (and in the style panel) with nothing else to share it with.
   */
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
      kind: "arc",
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
      bend: 0,
      elbowMidPoint: 0.5,
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

  /**
   * The arrow's terminals and the body running between them, in arrow-local
   * space. `"arc"` bows by `bend`; `"elbow"` routes axis-aligned legs, leaving
   * a bound shape along its nearest edge's normal, with corners rounded in
   * proportion to the stroke. The elbow's route is handed back as well, for the
   * midpoint handle.
   */
  private resolveBody(shape: ArrowShape): { props: ArrowShapeProps; terminals: ArrowTerminals; body: ArrowBody; route: ElbowRoute | null } {
    const normalized = readArrowShape(shape)
    const props = normalized.props
    const terminals = getArrowTerminalsInArrowSpace(this.editor, normalized)
    if (props.kind !== "elbow") {
      return { props, terminals, body: getArrowBody(terminals.start, terminals.end, props.bend), route: null }
    }
    const axes = getBoundElbowAxes(this.editor, normalized, terminals)
    const route = getElbowRoute(terminals.start, terminals.end, {
      midPoint: props.elbowMidPoint,
      startAxis: axes.start,
      endAxis: axes.end,
      cornerRadius: STROKE_SIZES[props.size] * props.scale * ELBOW_CORNER_STROKES,
    })
    return { props, terminals, body: { kind: "elbow", points: route.points }, route }
  }

  getGeometry(shape: ArrowShape): Geometry2d {
    const { props, terminals, body: full } = this.resolveBody(shape)
    const { arrowheadStart, arrowheadEnd, size, scale, text, labelPosition, font } = props
    const { start, end } = terminals
    const strokeWidth = STROKE_SIZES[size] * scale
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
    const { color, dash, size, scale } = readArrowProps(shape)
    const stroke = getStrokeRgba(color)
    // The body is open so it never fills; closed arrowheads fill with the stroke color.
    return { stroke, strokeWidth: STROKE_SIZES[size] * scale, fill: stroke, dash: getDashId(dash), opacity: 1 }
  }

  component(shape: ArrowShape): ReactNode {
    const { text, font, size, scale, labelColor, labelPosition } = readArrowProps(shape)
    const isEditing = this.editor.getEditingShapeId() === shape.id
    if (!text && !isEditing) return null
    const c = getPointOnBody(this.resolveBody(shape).body, Math.max(0, Math.min(1, labelPosition)))
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

  override getIndicatorPath(shape: ArrowShape): Path2D {
    return svgPath(pathWordsToSvgD(this.getGeometry(shape).toPathWords()))
  }

  /** The GPU keeps drawing the arrow while its label is edited. */
  override needsOverlay(_shape: ArrowShape): boolean {
    return false
  }

  override hasOverlayLabel(shape: ArrowShape): boolean {
    return readText(shape.props).trim().length > 0 || this.editor.getEditingShapeId() === shape.id
  }

  override canEdit(_shape: ArrowShape): boolean {
    return true
  }

  /** Nothing binds to an arrow (no arrow-to-arrow bindings). */
  override canBind(_opts: BindingCanBindOptions): boolean {
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
    return readText(shape.props)
  }

  override onEditEnd(shape: ArrowShape): void {
    const text = readText(shape.props)
    const trimmed = trimTrailingWhitespace(text)
    if (trimmed !== text) this.editor.updateShape<ArrowShape>({ id: shape.id, type: "arrow", props: { text: trimmed } })
  }

  /**
   * Start and end handles move (and bind) the terminals. Between them sits one
   * virtual handle: an arc's `bend` handle rides the middle of the curve, while
   * an elbow's `midpoint` handle sits on its middle leg and slides that leg.
   * An elbow with no middle leg (an L route, or a straight run) has neither.
   */
  override getHandles(shape: ArrowShape): ShapeHandle[] {
    const { terminals, body, route } = this.resolveBody(shape)
    const { start, end } = terminals
    const handles: ShapeHandle[] = [{ id: "start", type: "vertex", index: "a1", x: start.x, y: start.y }]
    if (route) {
      if (route.midLeg) {
        const mid = Vec.Lrp(route.midLeg[0], route.midLeg[1], 0.5)
        handles.push({ id: "midpoint", type: "virtual", index: "a2", x: mid.x, y: mid.y })
      }
    } else {
      const mid = getPointOnBody(body, 0.5)
      handles.push({ id: "bend", type: "virtual", index: "a2", x: mid.x, y: mid.y })
    }
    handles.push({ id: "end", type: "vertex", index: "a3", x: end.x, y: end.y })
    return handles
  }

  override onHandleDrag(shape: ArrowShape, info: { handle: ShapeHandle; isPrecise: boolean; initial?: ArrowShape }): Partial<ArrowShape> | void {
    const { handle } = info
    switch (handle.id) {
      case "start":
      case "end":
        return this.dragTerminal(shape, handle.id, handle, info.isPrecise)
      case "bend": {
        const { start, end } = getArrowTerminalsInArrowSpace(this.editor, readArrowShape(shape))
        return { props: { ...shape.props, bend: getBendFromPoint(start, end, handle) } }
      }
      case "midpoint": {
        const { terminals, route } = this.resolveBody(shape)
        if (!route?.slideAxis) return
        const elbowMidPoint = getElbowMidPointFromPoint(terminals.start, terminals.end, handle, route.slideAxis)
        return { props: { ...shape.props, elbowMidPoint } }
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
