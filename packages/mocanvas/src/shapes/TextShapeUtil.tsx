import {
  FONT_SIZES,
  Rectangle2d,
  ShapeUtil,
  getDefaultDisplayValues,
  getDisplayValues,
  DefaultColorStyle,
  DefaultFontStyle,
  DefaultHorizontalAlignStyle,
  type DefaultTextAlignStyle,
  type TLColorMode,
  type TLDefaultDisplayValues,
  type TLStyledShape,
  type TLTheme,
  DefaultSizeStyle,
  type BaseShape,
  type Editor,
  type Geometry2d,
  type ResizeInfo,
  type ShapeUtilOptions,
  type StyleWords,
  type TLFontFace,
} from "@mocanvas/editor"
import type { ReactNode } from "react"
import { TextLabel } from "../text/TextEditor"
import { applyPlainTextToRichText, richTextToText, toRichText, type RichText } from "../text/rich-text"
import { getTextShapeSize } from "../text/text-layout"
import { getTextTextureKey, renderTextToCanvas, type TextTextureSpec } from "../text/TextTexture"
import { LINE_HEIGHT } from "./text-helpers"
import { propsOf, readBoolean, readEnum, readNumber, readRichText, readStyle, readText } from "./prop-access"
import { getFontFamily, getLabelFontFaces, getStrokeRgba, getTheme, getThemeColors, getTextCssColor } from "./shape-theme"
import { rectPath } from "./indicator-paths"
import { textShapeProps } from "./shape-props"
import { textShapeMigrations } from "./shape-migrations"

export interface TextShapeProps {
  color: DefaultColorStyle
  size: DefaultSizeStyle
  font: DefaultFontStyle
  /**
   * How the paragraphs are aligned inside the shape's own width.
   *
   * Typed as the whole horizontal-align set because that is the style the
   * shape declares, and a record written by an older client may hold one of
   * its `-legacy` values. `readTextProps` narrows every one of them to
   * `start` / `middle` / `end`, so nothing downstream has to know they exist.
   */
  textAlign: DefaultHorizontalAlignStyle
  w: number
  /** The label as a rich-text document; see `NoteShapeProps.richText`. */
  richText: RichText
  /** The label as plain text — optional and derived; see `NoteShapeProps.text`. */
  text?: string
  scale: number
  autoSize: boolean
}

export type TextShape = BaseShape<"text", TextShapeProps>

const TEXT_ALIGNS = ["start", "middle", "end"] as const

/**
 * `shape.props` with every declared prop present and of the declared type, so
 * measuring and rendering survive a record that arrived without one.
 */
/**
 * {@link TextShapeProps} with the *derived* label filled in as well.
 *
 * `props.text` is optional on the record — a v5 writer only sets `richText` —
 * but a util that has run it through {@link readTextProps} always has both, so
 * everything downstream can take a plain `string`.
 */
export type ResolvedTextProps = Omit<TextShapeProps, "textAlign"> & {
  text: string
  richText: RichText
  /**
   * Narrowed to the three alignments that mean something for a paragraph: a
   * stored `-legacy` value reads as `start`, which is what those spellings
   * aligned a label box to.
   */
  textAlign: DefaultTextAlignStyle
}

export function readTextProps(shape: { props?: unknown }): ResolvedTextProps {
  const p = propsOf(shape)
  return {
    color: readStyle(p, "color", DefaultColorStyle),
    size: readStyle(p, "size", DefaultSizeStyle),
    font: readStyle(p, "font", DefaultFontStyle),
    textAlign: readEnum(p, "textAlign", TEXT_ALIGNS, "start"),
    w: readNumber(p, "w", 100),
    richText: readRichText(p),
    text: readText(p),
    scale: readNumber(p, "scale", 1),
    autoSize: readBoolean(p, "autoSize", true),
  }
}

/** Measured size of a text shape: intrinsic when `autoSize`, else wrapped at `w`. */
export function getTextShapeSizeFor(
  shape: { props?: unknown },
  editor?: Editor | null,
): { w: number; h: number; lineCount: number } {
  const { richText, size, scale, w, font, autoSize } = readTextProps(shape)
  return getTextShapeSize({
    text: richText,
    fontFamily: font,
    fontSize: FONT_SIZES[size] * scale,
    autoSize,
    w,
    editor: editor ?? null,
  })
}

/** Height of the text block at its current width. */
export function getTextShapeHeight(shape: TextShape, editor?: Editor | null): number {
  return getTextShapeSizeFor(shape, editor).h
}

/** The box `getGeometry` produces: what a texture for this shape must cover. */
export function getTextShapeBox(shape: TextShape, editor?: Editor | null): { w: number; h: number } {
  const { w, h } = getTextShapeSizeFor(shape, editor)
  const props = readTextProps(shape)
  return { w: Math.max(1, props.autoSize ? Math.max(w, props.w) : props.w), h }
}

/** The rasterization spec for a text shape at the editor's current resolution bucket. */
export function getTextShapeTextureSpec(editor: Editor, shape: TextShape): TextTextureSpec {
  const { text, font, size, scale, color, textAlign, autoSize } = readTextProps(shape)
  const box = getTextShapeBox(shape, editor)
  return {
    text,
    fontFamily: getFontFamily(font, getTheme(editor)),
    fontSize: FONT_SIZES[size] * scale,
    color: getTextCssColor(color, getThemeColors(editor)),
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

const SIZE_KEYS: readonly (keyof TextShapeProps)[] = ["richText", "text", "font", "size", "scale", "autoSize"]

/** `TextShapeUtil`'s settings; see {@link ShapeUtil.configure}. */
/**
 * What a text shape paints with.
 *
 * A text shape is nothing but a label, and its label carries a `scale` the
 * shared set knows nothing about — so the sizes it actually draws at are
 * reported separately from the ones the style asks for.
 */
export interface TextShapeUtilDisplayValues extends TLDefaultDisplayValues {
  /** The font size actually drawn, in page units: `fontSize` with `scale` applied. */
  labelFontSize: number
  /** The line height actually drawn, in page units. */
  labelLineHeight: number
  /** The label's CSS font stack. */
  labelFontFamily: string
}

/** `TextShapeUtil`'s settings; see {@link ShapeUtil.configure}. */
export interface TextShapeOptions extends ShapeUtilOptions<TextShape, TextShapeUtilDisplayValues> {}

/** Resolve a text shape's display values; see {@link TextShapeUtilDisplayValues}. */
export function getTextDisplayValues(
  editor: unknown,
  shape: { props?: unknown },
  theme: TLTheme,
  colorMode: TLColorMode,
): TextShapeUtilDisplayValues {
  const base = getDefaultDisplayValues(editor, shape as TLStyledShape, theme, colorMode)
  const scale = readNumber(propsOf(shape), "scale", 1)
  return {
    ...base,
    labelFontSize: base.fontSize * scale,
    labelLineHeight: base.fontSize * scale * LINE_HEIGHT,
    labelFontFamily: base.fontFamily,
  }
}

export class TextShapeUtil extends ShapeUtil<TextShape, TextShapeUtilDisplayValues> {
  static override type = "text" as const
  static override props = textShapeProps
  static override migrations = textShapeMigrations
  static override options: TextShapeOptions = { getDefaultDisplayValues: getTextDisplayValues }
  declare readonly options: TextShapeOptions

  getDefaultProps(): TextShapeProps {
    return {
      color: "black",
      size: "m",
      font: "draw",
      textAlign: "start",
      // A MINIMUM width, not a starting one: `getTextShapeBox` takes
      // `max(measured, props.w)` while `autoSize` is on. At 100 a new text
      // shape was a hundred pixels wide before a character was typed, which is
      // the opposite of what auto-sizing means.
      w: 8,
      richText: toRichText(""),
      scale: 1,
      autoSize: true,
    }
  }

  getGeometry(shape: TextShape): Geometry2d {
    const box = getTextShapeBox(shape, this.editor)
    return new Rectangle2d({ width: box.w, height: box.h, isFilled: true })
  }

  /** A text shape is nothing but a label, so it always needs its family's faces. */
  override getFontFaces(shape: TextShape): TLFontFace[] {
    return getLabelFontFaces(readTextProps(shape).font)
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
    return {
      fill: getStrokeRgba(readTextProps(shape).color, getThemeColors(this.editor)),
      stroke: 0,
      strokeWidth: 0,
      dash: 0,
      opacity: 1,
      texture,
    }
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
    const { richText, text, font, size, scale, textAlign, w, autoSize } = readTextProps(shape)
    const display = getDisplayValues<TextShape>(this, shape)
    return (
      <TextLabel
        shape={shape}
        text={text}
        richText={richText}
        isEditing={this.editor.getEditingShapeId() === shape.id}
        fontFamily={font}
        fontSize={FONT_SIZES[size] * scale}
        color={display.color}
        textAlign={textAlign}
        verticalAlign="start"
        wrap={!autoSize}
        width={Math.max(1, w)}
        onChange={(next) =>
          this.editor.updateShape<TextShape>({
            id: shape.id,
            type: "text",
            props: { text: next, richText: applyPlainTextToRichText(richText, next) },
          })
        }
        onChangeRichText={(next) =>
          this.editor.updateShape<TextShape>({
            id: shape.id,
            type: "text",
            props: { richText: next, text: richTextToText(next) },
          })
        }
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
    const { w } = getTextShapeSizeFor(shape, this.editor)
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
