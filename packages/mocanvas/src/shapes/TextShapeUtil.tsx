import {
  FONT_SIZES,
  Rectangle2d,
  ShapeUtil,
  DefaultColorStyle,
  DefaultFontStyle,
  DefaultHorizontalAlignStyle,
  DefaultSizeStyle,
  type BaseShape,
  type Editor,
  type Geometry2d,
  type ResizeInfo,
  type StyleWords,
} from "@mocanvas/editor"
import type { ReactNode } from "react"
import { TextLabel } from "../text/TextEditor"
import { getTextShapeSize } from "../text/text-layout"
import { getTextTextureKey, renderTextToCanvas, type TextTextureSpec } from "../text/TextTexture"
import { LINE_HEIGHT } from "./text-helpers"
import { propsOf, readBoolean, readEnum, readNumber, readStyle, readText } from "./prop-access"
import { getFontFamily, getStrokeRgba, getTextCssColor } from "./shape-theme"
import { rectPath } from "./indicator-paths"

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

const TEXT_ALIGNS = ["start", "middle", "end"] as const

/**
 * `shape.props` with every declared prop present and of the declared type, so
 * measuring and rendering survive a record that arrived without one.
 */
export function readTextProps(shape: { props?: unknown }): TextShapeProps {
  const p = propsOf(shape)
  return {
    color: readStyle(p, "color", DefaultColorStyle),
    size: readStyle(p, "size", DefaultSizeStyle),
    font: readStyle(p, "font", DefaultFontStyle),
    textAlign: readEnum(p, "textAlign", TEXT_ALIGNS, "start"),
    w: readNumber(p, "w", 100),
    text: readText(p),
    scale: readNumber(p, "scale", 1),
    autoSize: readBoolean(p, "autoSize", true),
  }
}

/** Measured size of a text shape: intrinsic when `autoSize`, else wrapped at `w`. */
export function getTextShapeSizeFor(shape: TextShape): { w: number; h: number; lineCount: number } {
  const { text, size, scale, w, font, autoSize } = readTextProps(shape)
  return getTextShapeSize({ text, font, fontSize: FONT_SIZES[size] * scale, autoSize, w })
}

/** Height of the text block at its current width. */
export function getTextShapeHeight(shape: TextShape): number {
  return getTextShapeSizeFor(shape).h
}

/** The box `getGeometry` produces: what a texture for this shape must cover. */
export function getTextShapeBox(shape: TextShape): { w: number; h: number } {
  const { w, h } = getTextShapeSizeFor(shape)
  const props = readTextProps(shape)
  return { w: Math.max(1, props.autoSize ? Math.max(w, props.w) : props.w), h }
}

/** The rasterization spec for a text shape at the editor's current resolution bucket. */
export function getTextShapeTextureSpec(editor: Editor, shape: TextShape): TextTextureSpec {
  const { text, font, size, scale, color, textAlign, autoSize } = readTextProps(shape)
  const box = getTextShapeBox(shape)
  return {
    text,
    fontFamily: getFontFamily(font),
    fontSize: FONT_SIZES[size] * scale,
    color: getTextCssColor(color),
    align: textAlign,
    verticalAlign: "start",
    lineHeight: LINE_HEIGHT,
    width: box.w,
    height: box.h,
    ...(autoSize ? {} : { maxWidth: box.w }),
    resolution: editor.getTextureResolution(),
  }
}

/** Whether this environment can rasterize text at all (no `document` in Node/SSR). */
function canRasterizeText(): boolean {
  return typeof document !== "undefined"
}

const SIZE_KEYS: readonly (keyof TextShapeProps)[] = ["text", "font", "size", "scale", "autoSize"]

export class TextShapeUtil extends ShapeUtil<TextShape> {
  static override type = "text" as const
  static override props = { color: DefaultColorStyle, size: DefaultSizeStyle, font: DefaultFontStyle, textAlign: DefaultHorizontalAlignStyle }

  getDefaultProps(): TextShapeProps {
    return { color: "black", size: "m", font: "draw", textAlign: "start", w: 100, text: "", scale: 1, autoSize: true }
  }

  getGeometry(shape: TextShape): Geometry2d {
    const box = getTextShapeBox(shape)
    return new Rectangle2d({ width: box.w, height: box.h, isFilled: true })
  }

  /**
   * A texture of the rasterized label, so the GPU draws the text instead of the
   * DOM. The shape being edited (and any environment without a canvas) keeps
   * the DOM path; `fill` is the text colour so the level-of-detail quad the
   * engine draws below a few pixels still looks right.
   */
  override getRenderStyle(shape: TextShape): StyleWords | null {
    const key = this.getTextureKey(shape)
    if (!key) return null
    const texture = this.editor.textures.acquire(key.key, async () => renderTextToCanvas(key.spec))
    if (!texture) return null
    return { fill: getStrokeRgba(readTextProps(shape).color), stroke: 0, strokeWidth: 0, dash: 0, opacity: 1, texture }
  }

  /** The DOM label stands in while editing and until the texture is ready. */
  override needsOverlay(shape: TextShape): boolean {
    const key = this.getTextureKey(shape)
    return key === null || !this.editor.textures.isReady(key.key)
  }

  private getTextureKey(shape: TextShape): { key: string; spec: TextTextureSpec } | null {
    if (this.editor.getEditingShapeId() === shape.id) return null
    if (readText(shape.props).length === 0) return null
    if (!canRasterizeText()) return null
    const spec = getTextShapeTextureSpec(this.editor, shape)
    return { key: getTextTextureKey(spec), spec }
  }

  component(shape: TextShape): ReactNode {
    const { text, font, size, scale, color, textAlign, w, autoSize } = readTextProps(shape)
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

  override getIndicatorPath(shape: TextShape): Path2D {
    const b = this.getGeometry(shape).bounds
    return rectPath(b.w, b.h)
  }

  override canEdit(_shape: TextShape): boolean {
    return true
  }

  override isAspectRatioLocked(_shape: TextShape): boolean {
    return false
  }

  override getText(shape: TextShape): string {
    return readText(shape.props)
  }

  /** Auto-sized text keeps `w` in sync with its measured width. */
  override onBeforeCreate(next: TextShape): TextShape | void {
    return this.fitWidth(next)
  }

  override onBeforeUpdate(prev: TextShape, next: TextShape): TextShape | void {
    if (!readTextProps(next).autoSize) return
    if (!SIZE_KEYS.some((k) => propsOf(prev)[k] !== propsOf(next)[k])) return
    return this.fitWidth(next)
  }

  private fitWidth(shape: TextShape): TextShape | void {
    const props = readTextProps(shape)
    if (!props.autoSize) return
    const { w } = getTextShapeSizeFor(shape)
    if (w !== props.w) return { ...shape, props: { ...shape.props, w } }
  }

  /** A text shape left empty after editing is removed. */
  override onEditEnd(shape: TextShape): void {
    if (readText(shape.props).trim().length === 0) this.editor.deleteShapes([shape.id])
  }

  /** Resizing a text shape changes its wrap width and turns auto-size off. */
  override onResize(shape: TextShape, info: ResizeInfo<TextShape>): Partial<TextShape> {
    const { scaleX, initialShape, newPoint } = info
    const w = Math.max(1, Math.abs(readTextProps(initialShape).w * scaleX))
    return { x: newPoint.x, y: newPoint.y, props: { ...shape.props, w, autoSize: false } }
  }
}
