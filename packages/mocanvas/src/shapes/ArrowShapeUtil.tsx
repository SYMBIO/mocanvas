import {
  FONT_SIZES,
  Group2d,
  Rectangle2d,
  ShapeUtil,
  STROKE_SIZES,
  Vec,
  getDefaultDisplayValues,
  getDisplayValues,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  DefaultLabelColorStyle,
  DefaultSizeStyle,
  ARROWHEAD_KINDS,
  ARROW_SHAPE_KINDS,
  type ArrowShapeKind,
  type BaseShape,
  type BindingCanBindOptions,
  type Geometry2d,
  type ShapeHandle,
  type ShapeUtilOptions,
  type StyleWords,
  type TLColorMode,
  type TLDefaultDisplayValues,
  type TLFontFace,
  type TLStyledShape,
  type TLTheme,
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
import { applyPlainTextToRichText, richTextToText, toRichText, type RichText } from "../text/rich-text"
import { getLabelOpticalLift, measureLabel, trimTrailingWhitespace } from "../text/text-layout"
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
  labelGapOnBody,
  shortenBody,
  type ArrowBody,
  type ArrowheadKind,
} from "./arrow-helpers"
import { ELBOW_CORNER_STROKES, getElbowMidPointFromPoint, getElbowRoute, type ElbowRoute } from "./elbow-helpers"
import { propsOf, readEnum, readNumber, readPoint, readRichText, readStyle, readText } from "./prop-access"
import { getDashId, getLabelFontFaces, getStrokeRgba, getThemeColors } from "./shape-theme"
import { pathWordsToSvgD } from "./svg-path"
import { svgPath } from "./indicator-paths"
import { arrowShapeProps } from "./shape-props"
import { arrowShapeMigrations } from "./shape-migrations"

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
  /** The label as a rich-text document; see `NoteShapeProps.richText`. */
  richText: RichText
  /** The label as plain text — optional and derived; see `NoteShapeProps.text`. */
  text?: string
  labelPosition: number
  scale: number
}

export type ArrowShape = BaseShape<"arrow", ArrowShapeProps>

export const ARROW_LABEL_PADDING = 8
const LABEL_PADDING = ARROW_LABEL_PADDING

/**
 * Routing kinds an arrow can have.
 *
 * The list itself lives with the other style vocabularies in the editor, so
 * that `ArrowShapeKindStyle` and this cannot drift apart; these are the names
 * the shape has always exported for it.
 */
export const ARROW_KINDS = ARROW_SHAPE_KINDS
export type ArrowKind = ArrowShapeKind

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
/**
 * {@link ArrowShapeProps} with the *derived* label filled in as well.
 *
 * `props.text` is optional on the record — a v5 writer only sets `richText` —
 * but a util that has run it through {@link readArrowProps} always has both, so
 * everything downstream can take a plain `string`.
 */
export type ResolvedArrowProps = ArrowShapeProps & { text: string; richText: RichText }

export function readArrowProps(shape: { props?: unknown }): ResolvedArrowProps {
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
    arrowheadStart: readEnum(p, "arrowheadStart", ARROWHEAD_KINDS, "none"),
    arrowheadEnd: readEnum(p, "arrowheadEnd", ARROWHEAD_KINDS, "arrow"),
    font: readStyle(p, "font", DefaultFontStyle),
    richText: readRichText(p),
    text: readText(p),
    labelPosition: readNumber(p, "labelPosition", 0.5),
    scale: readNumber(p, "scale", 1),
  }
}

/**
 * What an arrow paints with.
 *
 * An arrow is a body, two terminals and a label, and all four are sized by the
 * shape's own `scale`, which the shared set knows nothing about. The label's
 * padding is here for the same reason a geo shape's is: anything measuring the
 * label has to agree with what draws it.
 */
export interface ArrowShapeUtilDisplayValues extends TLDefaultDisplayValues {
  /** The body's width in page units, `scale` applied. */
  scaledStrokeWidth: number
  /** The label's font size in page units, `scale` applied. */
  labelFontSize: number
  /** Padding between the body and its label, in page units. */
  labelPadding: number
  /** The label's CSS font stack. */
  labelFontFamily: string
}

/** `ArrowShapeUtil`'s settings; see {@link ShapeUtil.configure}. */
export interface ArrowShapeOptions extends ShapeUtilOptions<ArrowShape, ArrowShapeUtilDisplayValues> {}

/** Resolve an arrow's display values; see {@link ArrowShapeUtilDisplayValues}. */
export function getArrowDisplayValues(
  editor: unknown,
  shape: { props?: unknown },
  theme: TLTheme,
  colorMode: TLColorMode,
): ArrowShapeUtilDisplayValues {
  const base = getDefaultDisplayValues(editor, shape as TLStyledShape, theme, colorMode)
  const scale = readNumber(propsOf(shape), "scale", 1)
  return {
    ...base,
    scaledStrokeWidth: base.strokeWidth * scale,
    labelFontSize: base.fontSize * scale,
    labelPadding: ARROW_LABEL_PADDING * scale,
    labelFontFamily: base.fontFamily,
  }
}

export class ArrowShapeUtil extends ShapeUtil<ArrowShape, ArrowShapeUtilDisplayValues> {
  static override type = "arrow" as const
  static override migrations = arrowShapeMigrations
  static override options: ArrowShapeOptions = { getDefaultDisplayValues: getArrowDisplayValues }
  declare readonly options: ArrowShapeOptions
  /**
   * `kind` is deliberately not among these. A style is shared across shape
   * types, remembered for the next shape and applied to a whole selection at
   * once; arc-versus-elbow is routing that belongs to the one arrow, and
   * declaring it a style would put it in every mixed selection's shared styles
   * (and in the style panel) with nothing else to share it with.
   */
  static override props = arrowShapeProps

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
      richText: toRichText(""),
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

  /**
   * The label's box in shape space, or `null` when there is no label.
   *
   * Three things need it and they must agree: the geometry (which is what gets
   * hit-tested), the DOM element that paints the text, and the indicator that
   * outlines it on selection. They were computing it separately.
   */
  private labelBox(shape: ArrowShape): { x: number; y: number; w: number; h: number } | null {
    const { text, labelPosition, font, size, scale } = readArrowProps(shape)
    if (!text) return null
    const m = measureLabel(readRichText(shape.props), {
      fontFamily: font,
      fontSize: FONT_SIZES[size] * scale,
      padding: LABEL_PADDING * scale,
      editor: this.editor,
    })
    const c = getPointOnBody(this.resolveBody(shape).body, Math.max(0, Math.min(1, labelPosition)))
    return { x: c.x - m.w / 2, y: c.y - m.h / 2, w: m.w, h: m.h }
  }

  /**
   * `gapAtLabel` splits the body around the label's box. Only the selection
   * outline asks for it; the geometry the editor hit-tests keeps the body whole,
   * so the stroke the label covers is still there to be clicked.
   */
  getGeometry(shape: ArrowShape, opts?: { gapAtLabel: { x: number; y: number; w: number; h: number } }): Geometry2d {
    const { props, terminals, body: full } = this.resolveBody(shape)
    const { arrowheadStart, arrowheadEnd, size, scale, text, labelPosition, font } = props
    const { start, end } = terminals
    const strokeWidth = STROKE_SIZES[size] * scale
    const length = getBodyLength(full)
    const headLength = getArrowheadLength(strokeWidth, length)
    const body = shortenBody(full, getArrowheadInset(arrowheadStart, headLength), getArrowheadInset(arrowheadEnd, headLength))

    // The body is drawn whole, label or no label. The label is an opaque box laid
    // over it in `component`, which is both simpler than cutting the line and the
    // only version that stays clickable: cut the stroke out from under the label
    // and there is nothing left there to hit, since hit-testing runs on this
    // geometry and the label's own rectangle is excluded from it.
    const children: Geometry2d[] = []
    const gap = opts?.gapAtLabel ? labelGapOnBody(body, opts.gapAtLabel) : null
    if (gap) {
      const len = getBodyLength(body)
      if (gap.from > 0) children.push(bodyToGeometry(shortenBody(body, 0, len * (1 - gap.from))))
      if (gap.to < 1) children.push(bodyToGeometry(shortenBody(body, len * gap.to, 0)))
    } else {
      children.push(bodyToGeometry(body))
    }

    const startHead = getArrowheadGeometry(arrowheadStart, start, Vec.Mul(getTangentOnBody(full, 0), -1), headLength)
    if (startHead) children.push(startHead)
    const endHead = getArrowheadGeometry(arrowheadEnd, end, getTangentOnBody(full, 1), headLength)
    if (endHead) children.push(endHead)

    const label = this.labelBox(shape)
    if (label) {
      children.push(new Rectangle2d({ x: label.x, y: label.y, width: label.w, height: label.h, isFilled: false, isLabel: true }))
    }
    return new Group2d({ children })
  }

  /** An arrow needs its family's faces only while it carries a label. */
  override getFontFaces(shape: ArrowShape): TLFontFace[] {
    return readText(shape.props) ? getLabelFontFaces(readArrowProps(shape).font) : []
  }

  override getRenderStyle(shape: ArrowShape): StyleWords {
    const { color, dash, size, scale } = readArrowProps(shape)
    const stroke = getStrokeRgba(color, getThemeColors(this.editor))
    // The body is open so it never fills; closed arrowheads fill with the stroke color.
    return { stroke, strokeWidth: STROKE_SIZES[size] * scale, fill: stroke, dash: getDashId(dash), opacity: 1 }
  }

  component(shape: ArrowShape): ReactNode {
    const { richText, text, font, size, scale, labelPosition } = readArrowProps(shape)
    const isEditing = this.editor.getEditingShapeId() === shape.id
    if (!text && !isEditing) return null
    const display = getDisplayValues<ArrowShape, ArrowShapeUtilDisplayValues>(this, shape)
    // Positioned from the measured box, not by `translate(-50%, -50%)`: the label
    // inside is absolutely positioned, so this wrapper has no size of its own and
    // a percentage translate resolves against zero — the label hung off the body
    // point by its own width and height instead of sitting on it.
    //
    // Opaque, in the page colour, and laid straight over the line. The arrow does
    // not know or care that a label is on it — it is drawn end to end and this
    // covers the stretch under the text. Painting over rather than cutting a gap
    // is also what keeps the label clickable: the stroke is still there
    // underneath, so a click near the text lands on the arrow's own geometry.
    const box = this.labelBox(shape) ?? { x: 0, y: 0, w: 0, h: 0 }
    const background = getThemeColors(this.editor).background
    return (
      <div
        style={{
          position: "absolute",
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          background,
          borderRadius: LABEL_PADDING * scale * 0.5,
          pointerEvents: "none",
        }}
      >
        {/* The box stays where the geometry puts it — centred on the line — and only
            the letters move, by the amount that face needs to *look* centred. */}
        <div
          style={{
            position: "relative",
            width: "max-content",
            transform: `translateY(${-getLabelOpticalLift({ fontFamily: font, fontSize: FONT_SIZES[size] * scale })}px)`,
          }}
        >
          <TextLabel
            shape={shape}
            text={text}
            richText={richText}
            isEditing={isEditing}
            fontFamily={font}
            fontSize={FONT_SIZES[size] * scale}
            color={display.labelColor}
            textAlign="middle"
            verticalAlign="middle"
            wrap={false}
            padding={LABEL_PADDING * scale}
            onChange={(next) =>
              this.editor.updateShape<ArrowShape>({
                id: shape.id,
                type: "arrow",
                props: { text: next, richText: applyPlainTextToRichText(richText, next) },
              })
            }
            onChangeRichText={(next) =>
              this.editor.updateShape<ArrowShape>({
                id: shape.id,
                type: "arrow",
                props: { richText: next, text: richTextToText(next) },
              })
            }
          />
        </div>
      </div>
    )
  }

  override getIndicatorPath(shape: ArrowShape): Path2D {
    const label = this.labelBox(shape)
    const labelRadius = () => Math.min(LABEL_PADDING * readArrowProps(shape).scale * 0.5, label!.w / 2, label!.h / 2)

    // While the label is being edited it is the only thing indicated. The arrow is
    // not what is being worked on, and outlining it as well reads as "both are
    // selected" when only the text box takes input.
    if (label && this.editor.getEditingShapeId() === shape.id) {
      const p = new Path2D()
      p.roundRect(label.x, label.y, label.w, label.h, labelRadius())
      return p
    }

    // The outline stops at the label and picks up on the far side. The arrow's own
    // geometry runs straight through — that stroke is what a click under the text
    // lands on — but the outline is drawn over the label, and a line ruled across
    // the words is exactly what it should not be.
    const words = label ? this.getGeometry(shape, { gapAtLabel: label }).toPathWords() : this.getGeometry(shape).toPathWords()
    const p = svgPath(pathWordsToSvgD(words))
    // The one box a selected arrow does draw. Everything else about the selection
    // is the curve and its three handles — but the label is a box the pointer can
    // grab, so it says so.
    if (label) p.roundRect(label.x, label.y, label.w, label.h, labelRadius())
    return p
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

  /**
   * …but the arrow's *own* outline is drawn. This flag suppresses a lone selected
   * shape's indicator, and the arrow used to set it because the selection frame
   * was the cue instead. With the frame gone there was no cue at all — a selected
   * arrow showed nothing. Its indicator is the curve and the label's box, which
   * is the cue worth having.
   */
  override hideSelectionBoundsFg(_shape: ArrowShape): boolean {
    return false
  }

  override hideResizeHandles(_shape: ArrowShape): boolean {
    return true
  }

  /**
   * …and no rotate handle either, which is what actually suppresses the box.
   * `selectionHandles` only drops the frame when resize *and* rotate are both
   * hidden, so hiding one of the two left a selected arrow wrapped in a
   * rectangle with a lone rotate dot above it. An arrow has nothing to rotate
   * about: its ends are the two handles, and turning it means moving them.
   */
  override hideRotateHandle(_shape: ArrowShape): boolean {
    return true
  }

  override getText(shape: ArrowShape): string {
    return readText(shape.props)
  }

  override onEditEnd(shape: ArrowShape): void {
    const text = readText(shape.props)
    const trimmed = trimTrailingWhitespace(text)
    if (trimmed === text) return
    this.editor.updateShape<ArrowShape>({
      id: shape.id,
      type: "arrow",
      props: { text: trimmed, richText: applyPlainTextToRichText(readRichText(shape.props), trimmed) },
    })
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
        handles.push({ id: "midpoint", type: "vertex", index: "a2", x: mid.x, y: mid.y })
      }
    } else {
      const mid = getPointOnBody(body, 0.5)
      // A vertex, not a "virtual" handle: virtual means the faint dot that *becomes*
      // a point when dragged, which is what a line's midpoints are. An arrow's bend
      // is a permanent handle, and drawing it as the faint kind made it read as an
      // afterthought next to its own two ends.
      handles.push({ id: "bend", type: "vertex", index: "a2", x: mid.x, y: mid.y })
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
