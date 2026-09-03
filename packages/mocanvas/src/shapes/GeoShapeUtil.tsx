import {
  BaseBoxShapeUtil,
  FONT_SIZES,
  Group2d,
  Rectangle2d,
  STROKE_SIZES,
  type BaseShape,
  type DefaultColorStyle,
  type DefaultDashStyle,
  type DefaultFillStyle,
  type DefaultFontStyle,
  type DefaultHorizontalAlignStyle,
  type DefaultSizeStyle,
  type DefaultVerticalAlignStyle,
  type GeoShapeKind,
  type Geometry2d,
  type StyleWords,
} from "@mocanvas/editor"
import type { CSSProperties, ReactNode } from "react"
import { getGeoGeometry } from "./geo-helpers"
import { getFillRgba, getFontFamily, getStrokeRgba, getTextCssColor } from "./shape-theme"
import { pathWordsToSvgD } from "./svg-path"
import { estimateTextSize, LINE_HEIGHT } from "./text-helpers"

export interface GeoShapeProps {
  geo: GeoShapeKind
  w: number
  h: number
  color: DefaultColorStyle
  labelColor: DefaultColorStyle
  fill: DefaultFillStyle
  dash: DefaultDashStyle
  size: DefaultSizeStyle
  font: DefaultFontStyle
  align: DefaultHorizontalAlignStyle
  verticalAlign: DefaultVerticalAlignStyle
  growY: number
  url: string
  text: string
  scale: number
}

export type GeoShape = BaseShape<"geo", GeoShapeProps>

const LABEL_PADDING = 16

export function horizontalAlignToFlex(align: DefaultHorizontalAlignStyle): CSSProperties["justifyContent"] {
  switch (align) {
    case "start":
    case "start-legacy":
      return "flex-start"
    case "end":
    case "end-legacy":
      return "flex-end"
    default:
      return "center"
  }
}

export function horizontalAlignToTextAlign(align: DefaultHorizontalAlignStyle): CSSProperties["textAlign"] {
  switch (align) {
    case "start":
    case "start-legacy":
      return "left"
    case "end":
    case "end-legacy":
      return "right"
    default:
      return "center"
  }
}

export function verticalAlignToFlex(align: DefaultVerticalAlignStyle): CSSProperties["alignItems"] {
  switch (align) {
    case "start":
      return "flex-start"
    case "end":
      return "flex-end"
    default:
      return "center"
  }
}

export class GeoShapeUtil extends BaseBoxShapeUtil<GeoShape> {
  static override type = "geo" as const

  getDefaultProps(): GeoShapeProps {
    return {
      geo: "rectangle",
      w: 100,
      h: 100,
      color: "black",
      labelColor: "black",
      fill: "none",
      dash: "draw",
      size: "m",
      font: "draw",
      align: "middle",
      verticalAlign: "middle",
      growY: 0,
      url: "",
      text: "",
      scale: 1,
    }
  }

  getGeometry(shape: GeoShape): Geometry2d {
    const { geo, w, h, growY, fill, text } = shape.props
    const height = h + growY
    const body = getGeoGeometry(geo, w, height, fill !== "none")
    if (!text) return body
    return new Group2d({ children: [body, this.getLabelRect(shape)] })
  }

  /** Where the text label sits inside the body, in shape-local space. */
  private getLabelRect(shape: GeoShape): Rectangle2d {
    const { w, h, growY, size, scale, text, align, verticalAlign } = shape.props
    const height = h + growY
    const fontSize = FONT_SIZES[size] * scale
    const est = estimateTextSize(text, fontSize, Math.max(1, w - LABEL_PADDING * 2))
    const lw = Math.min(w, est.w + LABEL_PADDING * 2)
    const lh = Math.min(height, est.h + LABEL_PADDING * 2)
    const x = align === "start" || align === "start-legacy" ? 0 : align === "end" || align === "end-legacy" ? w - lw : (w - lw) / 2
    const y = verticalAlign === "start" ? 0 : verticalAlign === "end" ? height - lh : (height - lh) / 2
    return new Rectangle2d({ x, y, width: lw, height: lh, isFilled: false, isLabel: true })
  }

  override getRenderStyle(shape: GeoShape): StyleWords {
    const { color, fill, size, scale } = shape.props
    return {
      stroke: getStrokeRgba(color),
      strokeWidth: STROKE_SIZES[size] * scale,
      fill: getFillRgba(color, fill),
      dash: 0,
      opacity: 1,
    }
  }

  component(shape: GeoShape): ReactNode {
    const { text, font, size, scale, labelColor, align, verticalAlign, w, h, growY } = shape.props
    if (!text) return null
    return (
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: w,
          height: h + growY,
          display: "flex",
          justifyContent: horizontalAlignToFlex(align),
          alignItems: verticalAlignToFlex(verticalAlign),
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            fontFamily: getFontFamily(font),
            fontSize: FONT_SIZES[size] * scale,
            lineHeight: LINE_HEIGHT,
            color: getTextCssColor(labelColor),
            textAlign: horizontalAlignToTextAlign(align),
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
            padding: LABEL_PADDING,
            maxWidth: "100%",
            boxSizing: "border-box",
          }}
        >
          {text}
        </div>
      </div>
    )
  }

  indicator(shape: GeoShape): ReactNode {
    return <path d={pathWordsToSvgD(this.getGeometry(shape).toPathWords())} />
  }

  override hasOverlayLabel(shape: GeoShape): boolean {
    return shape.props.text.trim().length > 0
  }

  override canEdit(_shape: GeoShape): boolean {
    return true
  }

  override getText(shape: GeoShape): string {
    return shape.props.text
  }
}
