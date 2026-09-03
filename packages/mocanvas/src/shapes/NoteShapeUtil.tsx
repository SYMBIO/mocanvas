import {
  FONT_SIZES,
  Rectangle2d,
  ShapeUtil,
  LIGHT_THEME,
  DefaultColorStyle,
  DefaultFontStyle,
  DefaultHorizontalAlignStyle,
  DefaultLabelColorStyle,
  DefaultSizeStyle,
  DefaultVerticalAlignStyle,
  type BaseShape,
  type Geometry2d,
  type StyleWords,
} from "@mocanvas/editor"
import type { ReactNode } from "react"
import { TextLabel } from "../text/TextEditor"
import { computeGrowY, measureLabel, trimTrailingWhitespace } from "../text/text-layout"
import { getNoteFillRgba, getNoteTextCssColor } from "./shape-theme"

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
export const NOTE_PADDING = 16

/** Effective font size: an explicit adjustment (auto-shrunk text) wins over the size style. */
export function getNoteFontSize(shape: NoteShape): number {
  const { size, scale, fontSizeAdjustment } = shape.props
  return (fontSizeAdjustment > 0 ? fontSizeAdjustment : FONT_SIZES[size]) * scale
}

/** `growY` a note needs so its (centered) text fits; the note keeps its square width. */
export function getNoteGrowY(shape: NoteShape): number {
  const { text, font, scale } = shape.props
  if (!text) return 0
  const side = NOTE_SIZE * scale
  const m = measureLabel(text, { font, fontSize: getNoteFontSize(shape), maxWidth: side, padding: NOTE_PADDING * scale })
  return computeGrowY(m.h, side)
}

const LABEL_KEYS: readonly (keyof NoteShapeProps)[] = ["text", "font", "size", "scale", "fontSizeAdjustment"]

export class NoteShapeUtil extends ShapeUtil<NoteShape> {
  static override type = "note" as const
  static override props = {
    color: DefaultColorStyle,
    labelColor: DefaultLabelColorStyle,
    size: DefaultSizeStyle,
    font: DefaultFontStyle,
    align: DefaultHorizontalAlignStyle,
    verticalAlign: DefaultVerticalAlignStyle,
  }

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
      <TextLabel
        shape={shape}
        text={text}
        isEditing={this.editor.getEditingShapeId() === shape.id}
        font={font}
        fontSize={getNoteFontSize(shape)}
        color={textColor}
        align={align}
        verticalAlign={verticalAlign}
        wrap
        width={NOTE_SIZE * scale}
        height={NOTE_SIZE * scale + growY}
        padding={NOTE_PADDING * scale}
        onChange={(next) => this.editor.updateShape<NoteShape>({ id: shape.id, type: "note", props: { text: next } })}
      />
    )
  }

  indicator(shape: NoteShape): ReactNode {
    const { scale, growY } = shape.props
    return <rect width={NOTE_SIZE * scale} height={NOTE_SIZE * scale + growY} />
  }

  /** The GPU draws the sticky background even while editing. */
  override needsOverlay(_shape: NoteShape): boolean {
    return false
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

  override onBeforeCreate(next: NoteShape): NoteShape | void {
    const growY = getNoteGrowY(next)
    if (growY !== next.props.growY) return { ...next, props: { ...next.props, growY } }
  }

  override onBeforeUpdate(prev: NoteShape, next: NoteShape): NoteShape | void {
    if (!LABEL_KEYS.some((k) => prev.props[k] !== next.props[k])) return
    const growY = getNoteGrowY(next)
    if (growY !== next.props.growY) return { ...next, props: { ...next.props, growY } }
  }

  override onEditEnd(shape: NoteShape): void {
    const trimmed = trimTrailingWhitespace(shape.props.text)
    if (trimmed !== shape.props.text) this.editor.updateShape<NoteShape>({ id: shape.id, type: "note", props: { text: trimmed } })
  }
}
