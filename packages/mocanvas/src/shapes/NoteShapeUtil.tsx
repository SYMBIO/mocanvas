import {
  FONT_SIZES,
  Rectangle2d,
  ShapeUtil,
  LIGHT_THEME,
  type BaseShape,
  type DefaultColorStyle,
  type DefaultFontStyle,
  type DefaultHorizontalAlignStyle,
  type DefaultSizeStyle,
  type DefaultVerticalAlignStyle,
  type Geometry2d,
  type StyleWords,
} from "@mocanvas/editor"
import type { ReactNode } from "react"
import { horizontalAlignToFlex, horizontalAlignToTextAlign, verticalAlignToFlex } from "./GeoShapeUtil"
import { getFontFamily, getNoteFillRgba, getNoteTextCssColor } from "./shape-theme"
import { LINE_HEIGHT } from "./text-helpers"

export interface NoteShapeProps {
  color: DefaultColorStyle
  labelColor: DefaultColorStyle
  size: DefaultSizeStyle
  font: DefaultFontStyle
  fontSizeAdjustment: number
  align: DefaultHorizontalAlignStyle
  verticalAlign: DefaultVerticalAlignStyle
  growY: number
  url: string
  text: string
  scale: number
}

export type NoteShape = BaseShape<"note", NoteShapeProps>

export const NOTE_SIZE = 200
const NOTE_PADDING = 16

/** Effective font size: an explicit adjustment (auto-shrunk text) wins over the size style. */
export function getNoteFontSize(shape: NoteShape): number {
  const { size, scale, fontSizeAdjustment } = shape.props
  return (fontSizeAdjustment > 0 ? fontSizeAdjustment : FONT_SIZES[size]) * scale
}

export class NoteShapeUtil extends ShapeUtil<NoteShape> {
  static override type = "note" as const

  getDefaultProps(): NoteShapeProps {
    return {
      color: "black",
      labelColor: "black",
      size: "m",
      font: "draw",
      fontSizeAdjustment: 0,
      align: "middle",
      verticalAlign: "middle",
      growY: 0,
      url: "",
      text: "",
      scale: 1,
    }
  }

  getGeometry(shape: NoteShape): Geometry2d {
    const { scale, growY } = shape.props
    return new Rectangle2d({ width: NOTE_SIZE * scale, height: NOTE_SIZE * scale + growY, isFilled: true })
  }

  override getRenderStyle(shape: NoteShape): StyleWords {
    return { fill: getNoteFillRgba(shape.props.color), stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 }
  }

  component(shape: NoteShape): ReactNode {
    const { text, font, color, labelColor, align, verticalAlign, scale, growY } = shape.props
    const textColor = labelColor === "black" ? getNoteTextCssColor(color) : LIGHT_THEME[labelColor].solid
    return (
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: NOTE_SIZE * scale,
          height: NOTE_SIZE * scale + growY,
          background: LIGHT_THEME[color].note.fill,
          display: "flex",
          justifyContent: horizontalAlignToFlex(align),
          alignItems: verticalAlignToFlex(verticalAlign),
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            fontFamily: getFontFamily(font),
            fontSize: getNoteFontSize(shape),
            lineHeight: LINE_HEIGHT,
            color: textColor,
            textAlign: horizontalAlignToTextAlign(align),
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
            padding: NOTE_PADDING * scale,
            maxWidth: "100%",
            boxSizing: "border-box",
          }}
        >
          {text}
        </div>
      </div>
    )
  }

  indicator(shape: NoteShape): ReactNode {
    const { scale, growY } = shape.props
    return <rect width={NOTE_SIZE * scale} height={NOTE_SIZE * scale + growY} />
  }

  override hasOverlayLabel(_shape: NoteShape): boolean {
    return true
  }

  override canEdit(_shape: NoteShape): boolean {
    return true
  }

  override hideResizeHandles(_shape: NoteShape): boolean {
    return true
  }

  override getText(shape: NoteShape): string {
    return shape.props.text
  }
}
