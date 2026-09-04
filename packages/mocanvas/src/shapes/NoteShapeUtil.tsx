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
import { propsOf, readNumber, readString, readStyle, readText } from "./prop-access"
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

/**
 * `shape.props` with every declared prop present and of the declared type, so
 * geometry and rendering survive a record that arrived without one.
 */
export function readNoteProps(shape: { props?: unknown }): NoteShapeProps {
  const p = propsOf(shape)
  return {
    color: readStyle(p, "color", DefaultColorStyle),
    labelColor: readStyle(p, "labelColor", DefaultLabelColorStyle),
    size: readStyle(p, "size", DefaultSizeStyle),
    font: readStyle(p, "font", DefaultFontStyle),
    fontSizeAdjustment: readNumber(p, "fontSizeAdjustment", 0),
    align: readStyle(p, "align", DefaultHorizontalAlignStyle),
    verticalAlign: readStyle(p, "verticalAlign", DefaultVerticalAlignStyle),
    growY: readNumber(p, "growY", 0),
    url: readString(p, "url", ""),
    text: readText(p),
    scale: readNumber(p, "scale", 1),
  }
}

/** Below this, a stored `fontSizeAdjustment` is not a font size anyone meant. */
const MIN_NOTE_FONT_SIZE = 4

/**
 * Effective font size: an explicit adjustment (auto-shrunk text) wins over the
 * size style.
 *
 * `fontSizeAdjustment` is an absolute size in px, written when a label had to
 * shrink to fit; `0` means "unset". Files exist that write a small placeholder
 * there instead (a `1` on a note that was never shrunk), which would render the
 * label at one pixel, so anything too small to be a font size is also read as
 * unset and the size style takes over.
 */
export function getNoteFontSize(shape: NoteShape): number {
  const { size, scale, fontSizeAdjustment } = readNoteProps(shape)
  return (fontSizeAdjustment >= MIN_NOTE_FONT_SIZE ? fontSizeAdjustment : FONT_SIZES[size]) * scale
}

/** `growY` a note needs so its (centered) text fits; the note keeps its square width. */
export function getNoteGrowY(shape: NoteShape): number {
  const { text, font, scale } = readNoteProps(shape)
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
    const { scale, growY } = readNoteProps(shape)
    return new Rectangle2d({ width: NOTE_SIZE * scale, height: NOTE_SIZE * scale + growY, isFilled: true })
  }

  override getRenderStyle(shape: NoteShape): StyleWords {
    return { fill: getNoteFillRgba(readNoteProps(shape).color), stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 }
  }

  component(shape: NoteShape): ReactNode {
    const { text, font, color, labelColor, align, verticalAlign, scale, growY } = readNoteProps(shape)
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
    const { scale, growY } = readNoteProps(shape)
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
    return readText(shape.props)
  }

  override onBeforeCreate(next: NoteShape): NoteShape | void {
    const growY = getNoteGrowY(next)
    if (growY !== next.props.growY) return { ...next, props: { ...next.props, growY } }
  }

  override onBeforeUpdate(prev: NoteShape, next: NoteShape): NoteShape | void {
    if (!LABEL_KEYS.some((k) => propsOf(prev)[k] !== propsOf(next)[k])) return
    const growY = getNoteGrowY(next)
    if (growY !== next.props.growY) return { ...next, props: { ...next.props, growY } }
  }

  override onEditEnd(shape: NoteShape): void {
    const text = readText(shape.props)
    const trimmed = trimTrailingWhitespace(text)
    if (trimmed !== text) this.editor.updateShape<NoteShape>({ id: shape.id, type: "note", props: { text: trimmed } })
  }
}
