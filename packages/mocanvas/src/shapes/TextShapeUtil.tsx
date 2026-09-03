import {
  FONT_SIZES,
  Rectangle2d,
  ShapeUtil,
  type BaseShape,
  type DefaultColorStyle,
  type DefaultFontStyle,
  type DefaultSizeStyle,
  type Geometry2d,
  type ResizeInfo,
  type StyleWords,
} from "@mocanvas/editor"
import type { ReactNode } from "react"
import { getFontFamily, getTextCssColor } from "./shape-theme"
import { estimateTextSize, LINE_HEIGHT } from "./text-helpers"

export interface TextShapeProps {
  color: DefaultColorStyle
  size: DefaultSizeStyle
  font: DefaultFontStyle
  textAlign: "start" | "middle" | "end"
  w: number
  text: string
  scale: number
  autoSize: boolean
}

export type TextShape = BaseShape<"text", TextShapeProps>

/** Estimated height of the text block at its current width. */
export function getTextShapeHeight(shape: TextShape): number {
  const { text, size, scale, w } = shape.props
  const fontSize = FONT_SIZES[size] * scale
  return estimateTextSize(text, fontSize, Math.max(1, w)).h
}

export class TextShapeUtil extends ShapeUtil<TextShape> {
  static override type = "text" as const

  getDefaultProps(): TextShapeProps {
    return { color: "black", size: "m", font: "draw", textAlign: "start", w: 100, text: "", scale: 1, autoSize: true }
  }

  getGeometry(shape: TextShape): Geometry2d {
    return new Rectangle2d({ width: Math.max(1, shape.props.w), height: getTextShapeHeight(shape), isFilled: true })
  }

  /** Text is drawn by the DOM overlay, not the GPU. */
  override getRenderStyle(_shape: TextShape): StyleWords | null {
    return null
  }

  component(shape: TextShape): ReactNode {
    const { text, font, size, scale, color, textAlign, w } = shape.props
    return (
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: w,
          fontFamily: getFontFamily(font),
          fontSize: FONT_SIZES[size] * scale,
          lineHeight: LINE_HEIGHT,
          color: getTextCssColor(color),
          textAlign: textAlign === "middle" ? "center" : textAlign,
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
          pointerEvents: "none",
        }}
      >
        {text}
      </div>
    )
  }

  indicator(shape: TextShape): ReactNode {
    return <rect width={Math.max(1, shape.props.w)} height={getTextShapeHeight(shape)} />
  }

  override canEdit(_shape: TextShape): boolean {
    return true
  }

  override isAspectRatioLocked(_shape: TextShape): boolean {
    return false
  }

  override getText(shape: TextShape): string {
    return shape.props.text
  }

  /** Resizing a text shape changes its wrap width and turns auto-size off. */
  override onResize(shape: TextShape, info: ResizeInfo<TextShape>): Partial<TextShape> {
    const { scaleX, initialShape, newPoint } = info
    const w = Math.max(1, Math.abs(initialShape.props.w * scaleX))
    return { x: newPoint.x, y: newPoint.y, props: { ...shape.props, w, autoSize: false } }
  }
}
