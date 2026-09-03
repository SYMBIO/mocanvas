import {
  FONT_SIZES,
  Rectangle2d,
  ShapeUtil,
  DefaultColorStyle,
  DefaultFontStyle,
  DefaultHorizontalAlignStyle,
  DefaultSizeStyle,
  type BaseShape,
  type Geometry2d,
  type ResizeInfo,
  type StyleWords,
} from "@mocanvas/editor"
import type { ReactNode } from "react"
import { TextLabel } from "../text/TextEditor"
import { getTextShapeSize } from "../text/text-layout"
import { getTextCssColor } from "./shape-theme"

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

/** Measured size of a text shape: intrinsic when `autoSize`, else wrapped at `w`. */
export function getTextShapeSizeFor(shape: TextShape): { w: number; h: number; lineCount: number } {
  const { text, size, scale, w, font, autoSize } = shape.props
  return getTextShapeSize({ text, font, fontSize: FONT_SIZES[size] * scale, autoSize, w })
}

/** Height of the text block at its current width. */
export function getTextShapeHeight(shape: TextShape): number {
  return getTextShapeSizeFor(shape).h
}

const SIZE_KEYS: readonly (keyof TextShapeProps)[] = ["text", "font", "size", "scale", "autoSize"]

export class TextShapeUtil extends ShapeUtil<TextShape> {
  static override type = "text" as const
  static override props = { color: DefaultColorStyle, size: DefaultSizeStyle, font: DefaultFontStyle, textAlign: DefaultHorizontalAlignStyle }

  getDefaultProps(): TextShapeProps {
    return { color: "black", size: "m", font: "draw", textAlign: "start", w: 100, text: "", scale: 1, autoSize: true }
  }

  getGeometry(shape: TextShape): Geometry2d {
    const { w, h } = getTextShapeSizeFor(shape)
    return new Rectangle2d({ width: Math.max(1, shape.props.autoSize ? Math.max(w, shape.props.w) : shape.props.w), height: h, isFilled: true })
  }

  /** Text is drawn by the DOM overlay, not the GPU. */
  override getRenderStyle(_shape: TextShape): StyleWords | null {
    return null
  }

  component(shape: TextShape): ReactNode {
    const { text, font, size, scale, color, textAlign, w, autoSize } = shape.props
    return (
      <TextLabel
        shape={shape}
        text={text}
        isEditing={this.editor.getEditingShapeId() === shape.id}
        font={font}
        fontSize={FONT_SIZES[size] * scale}
        color={getTextCssColor(color)}
        align={textAlign}
        verticalAlign="start"
        wrap={!autoSize}
        width={Math.max(1, w)}
        onChange={(next) => this.editor.updateShape<TextShape>({ id: shape.id, type: "text", props: { text: next } })}
      />
    )
  }

  indicator(shape: TextShape): ReactNode {
    const b = this.getGeometry(shape).bounds
    return <rect width={b.w} height={b.h} />
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

  /** Auto-sized text keeps `w` in sync with its measured width. */
  override onBeforeCreate(next: TextShape): TextShape | void {
    return this.fitWidth(next)
  }

  override onBeforeUpdate(prev: TextShape, next: TextShape): TextShape | void {
    if (!next.props.autoSize) return
    if (!SIZE_KEYS.some((k) => prev.props[k] !== next.props[k])) return
    return this.fitWidth(next)
  }

  private fitWidth(shape: TextShape): TextShape | void {
    if (!shape.props.autoSize) return
    const { w } = getTextShapeSizeFor(shape)
    if (w !== shape.props.w) return { ...shape, props: { ...shape.props, w } }
  }

  /** A text shape left empty after editing is removed. */
  override onEditEnd(shape: TextShape): void {
    if (shape.props.text.trim().length === 0) this.editor.deleteShapes([shape.id])
  }

  /** Resizing a text shape changes its wrap width and turns auto-size off. */
  override onResize(shape: TextShape, info: ResizeInfo<TextShape>): Partial<TextShape> {
    const { scaleX, initialShape, newPoint } = info
    const w = Math.max(1, Math.abs(initialShape.props.w * scaleX))
    return { x: newPoint.x, y: newPoint.y, props: { ...shape.props, w, autoSize: false } }
  }
}
