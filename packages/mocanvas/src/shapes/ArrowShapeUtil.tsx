import {
  FONT_SIZES,
  Group2d,
  Rectangle2d,
  ShapeUtil,
  STROKE_SIZES,
  Vec,
  type BaseShape,
  type DefaultColorStyle,
  type DefaultDashStyle,
  type DefaultFillStyle,
  type DefaultFontStyle,
  type DefaultSizeStyle,
  type Geometry2d,
  type ShapeHandle,
  type StyleWords,
} from "@mocanvas/editor"
import type { ReactNode } from "react"
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
import { getFontFamily, getStrokeRgba, getTextCssColor } from "./shape-theme"
import { pathWordsToSvgD } from "./svg-path"
import { estimateTextSize, LINE_HEIGHT } from "./text-helpers"

export type { ArrowheadKind } from "./arrow-helpers"

export interface ArrowShapeProps {
  start: { x: number; y: number }
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

const LABEL_PADDING = 8

export class ArrowShapeUtil extends ShapeUtil<ArrowShape> {
  static override type = "arrow" as const

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
    const { start, end, bend, arrowheadStart, arrowheadEnd, size, scale, text, labelPosition } = shape.props
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
      const fontSize = FONT_SIZES[size] * scale
      const est = estimateTextSize(text, fontSize)
      const lw = est.w + LABEL_PADDING * 2
      const lh = est.h + LABEL_PADDING * 2
      const c = getPointOnBody(full, Math.max(0, Math.min(1, labelPosition)))
      children.push(new Rectangle2d({ x: c.x - lw / 2, y: c.y - lh / 2, width: lw, height: lh, isFilled: false, isLabel: true }))
    }
    return new Group2d({ children })
  }

  override getRenderStyle(shape: ArrowShape): StyleWords {
    const { color, size, scale } = shape.props
    const stroke = getStrokeRgba(color)
    // The body is open so it never fills; closed arrowheads fill with the stroke color.
    return { stroke, strokeWidth: STROKE_SIZES[size] * scale, fill: stroke, dash: 0, opacity: 1 }
  }

  component(shape: ArrowShape): ReactNode {
    const { text, font, size, scale, labelColor, start, end, bend, labelPosition } = shape.props
    if (!text) return null
    const c = getPointOnBody(getArrowBody(start, end, bend), Math.max(0, Math.min(1, labelPosition)))
    return (
      <div
        style={{
          position: "absolute",
          left: c.x,
          top: c.y,
          transform: "translate(-50%, -50%)",
          fontFamily: getFontFamily(font),
          fontSize: FONT_SIZES[size] * scale,
          lineHeight: LINE_HEIGHT,
          color: getTextCssColor(labelColor),
          whiteSpace: "pre",
          textAlign: "center",
          padding: LABEL_PADDING,
          pointerEvents: "none",
        }}
      >
        {text}
      </div>
    )
  }

  indicator(shape: ArrowShape): ReactNode {
    return <path d={pathWordsToSvgD(this.getGeometry(shape).toPathWords())} />
  }

  override hasOverlayLabel(shape: ArrowShape): boolean {
    return shape.props.text.trim().length > 0
  }

  override canEdit(_shape: ArrowShape): boolean {
    return true
  }

  override getText(shape: ArrowShape): string {
    return shape.props.text
  }

  override getHandles(shape: ArrowShape): ShapeHandle[] {
    const { start, end, bend } = shape.props
    const mid = getPointOnBody(getArrowBody(start, end, bend), 0.5)
    return [
      { id: "start", type: "vertex", index: "a1", x: start.x, y: start.y },
      { id: "bend", type: "virtual", index: "a2", x: mid.x, y: mid.y },
      { id: "end", type: "vertex", index: "a3", x: end.x, y: end.y },
    ]
  }

  override onHandleDrag(shape: ArrowShape, info: { handle: ShapeHandle }): Partial<ArrowShape> | void {
    const { handle } = info
    const props = shape.props
    switch (handle.id) {
      case "start":
        return { props: { ...props, start: { x: handle.x, y: handle.y } } }
      case "end":
        return { props: { ...props, end: { x: handle.x, y: handle.y } } }
      case "bend":
        return { props: { ...props, bend: getBendFromPoint(props.start, props.end, handle) } }
      default:
        return
    }
  }
}
