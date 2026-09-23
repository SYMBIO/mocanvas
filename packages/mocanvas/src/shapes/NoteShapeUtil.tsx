import { LABEL_FONT_SIZES } from "@mocanvas/editor"
import {
  DEFAULT_THEME,
  Rectangle2d,
  ShapeUtil,
  getColorValue,
  getDefaultDisplayValues,
  getDisplayValues,
  DefaultColorStyle,
  DefaultFontStyle,
  DefaultHorizontalAlignStyle,
  DefaultLabelColorStyle,
  DefaultSizeStyle,
  DefaultVerticalAlignStyle,
  type BaseShape,
  type Geometry2d,
  type ShapeUtilOptions,
  type StyleWords,
  type TLColorMode,
  type TLDefaultDisplayValues,
  type TLFontFace,
  type TLStyledShape,
  type TLTheme,
} from "@mocanvas/editor"
import type { ReactNode } from "react"
import { TextLabel } from "../text/TextEditor"
import { applyPlainTextToRichText, richTextToText, toRichText, type RichText } from "../text/rich-text"
import { computeGrowY, measureLabel, trimTrailingWhitespace } from "../text/text-layout"
import { noteShapeProps } from "./shape-props"
import { noteShapeMigrations } from "./shape-migrations"
import { propsOf, readNumber, readRichText, readString, readStyle, readText } from "./prop-access"
import {
  getLabelFontFaces,
  getNoteBodyGradientCss,
  getNoteFillRgba,
  getNoteShadowCss,
  getThemeColors,
} from "./shape-theme"
import { rectPath } from "./indicator-paths"

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
  /**
   * The label as a rich-text document — the v5 spelling, and the one the store
   * keeps. {@link NoteShapeProps.text} stays alongside it as the flattened
   * form, derived on load, so plain-text consumers need no conversion.
   */
  richText: RichText
  /**
   * The label as plain text.
   *
   * Optional, and *derived*: v5 replaced it with
   * {@link NoteShapeProps.richText}, and a record written by a v5 client has no
   * `text` at all. mocanvas keeps deriving it on load, because a plain-text
   * consumer (search, export, an agent reading the board) should not have to
   * walk a document — but nothing may require it to be present, and
   * `readRichText` is what reconciles the two when they disagree.
   */
  text?: string
  /**
   * Who first edited the label by hand, or `null` while nobody has.
   *
   * The seam attribution hangs off: a note whose text is still exactly what a
   * generator wrote can be regenerated freely, and one a person has touched
   * cannot. mocanvas stores and round-trips it; it never writes it itself,
   * because only the host knows who "a person" is.
   */
  textFirstEditedBy?: string | null | undefined
  scale: number
}

export type NoteShape = BaseShape<"note", NoteShapeProps>

export const NOTE_SIZE = 200
export const NOTE_PADDING = 16

/**
 * `shape.props` with every declared prop present and of the declared type, so
 * geometry and rendering survive a record that arrived without one.
 */
/**
 * {@link NoteShapeProps} with the *derived* label filled in as well.
 *
 * `props.text` is optional on the record — a v5 writer only sets `richText` —
 * but a util that has run it through {@link readNoteProps} always has both, so
 * everything downstream can take a plain `string`.
 */
export type ResolvedNoteProps = NoteShapeProps & { text: string; richText: RichText }

export function readNoteProps(shape: { props?: unknown }): ResolvedNoteProps {
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
    richText: readRichText(p),
    text: readText(p),
    textFirstEditedBy: readString(p, "textFirstEditedBy", "") || null,
    scale: readNumber(p, "scale", 1),
  }
}

/**
 * The label's size before any shrinking: the size style, scaled.
 *
 * This is the denominator a `fontSizeAdjustment` is a fraction of, so anything
 * that *writes* one — a host fitting text to the square and recording how far
 * it had to shrink — needs this rather than the size the label ends up at.
 * Published as `labelBaseFontSize` for exactly that reason.
 */
export function getNoteBaseFontSize(shape: { props?: unknown }, theme: TLTheme = DEFAULT_THEME): number {
  const { size, scale } = readNoteProps(shape)
  // A note's text is a label, not a text shape: its own scale, which steps up
  // more gently than `fontSize` does. They were the same table until 4.11.0.
  const sizes = theme.labelFontSize ?? LABEL_FONT_SIZES
  return (sizes[size] ?? LABEL_FONT_SIZES[size]) * scale
}

/**
 * Effective font size: the size style, shrunk by `fontSizeAdjustment`.
 *
 * `fontSizeAdjustment` is a *fraction* of the styled size, written when a label
 * had to shrink to fit its square: `1` is a label that fits as it is, `0.25` a
 * label at a quarter. `0` is the backfill for a record written before the prop
 * existed and means the same as `1`.
 *
 * It was read as an absolute size in px until 4.10.1, with anything below 4
 * dismissed as "not a font size anyone meant". Nothing ever wrote such a value:
 * the only sample in this repository carries `1`, which both readings render
 * the same way, and a consumer's live records carry fractions between 0.078 and
 * 0.21 — which the threshold discarded, so every shrunk label came out at full
 * size and ran off its note. A fraction is also what a `.tldr` file means by it.
 */
export function getNoteFontSize(shape: { props?: unknown }, theme: TLTheme = DEFAULT_THEME): number {
  const { fontSizeAdjustment } = readNoteProps(shape)
  const base = getNoteBaseFontSize(shape, theme)
  const ratio = Number.isFinite(fontSizeAdjustment) && fontSizeAdjustment > 0 ? fontSizeAdjustment : 1
  return base * ratio
}

/**
 * What a note paints with, once its style props have been resolved.
 *
 * Wider than the shared set because a note is not a filled rectangle with a
 * label on it: its body colour comes from the palette's *note* tokens rather
 * than from a fill style, and its label has a padding and a typography of its
 * own that anything measuring the note has to agree with. Callers read them
 * through `getDisplayValues(util, note)`, which is the only place the live
 * theme and colour mode are consulted.
 *
 * `noteWidth` and `noteHeight` are the note's **logical square**, before
 * `growY`. That is deliberate: the square is the note's identity, and a caller
 * fitting text into it wants the box the text has to fit, not the box the text
 * already grew.
 */
export interface NoteShapeUtilDisplayValues extends TLDefaultDisplayValues {
  /** The body's width in page units, `scale` applied. */
  noteWidth: number
  /** The body's height in page units before `growY`; equal to `noteWidth`. */
  noteHeight: number
  /** Padding on every side between the body edge and its label, in page units. */
  labelPadding: number
  /** The label's font size in page units, after any `fontSizeAdjustment`. */
  labelFontSize: number
  /**
   * The label's font size in page units *before* `fontSizeAdjustment`: the
   * size style, scaled. The denominator that adjustment is a fraction of.
   */
  labelBaseFontSize: number
  /** The label's CSS font stack. */
  labelFontFamily: string
  /** The label's CSS `font-style`. */
  labelFontStyle: string
  /** The label's CSS `font-weight`. */
  labelFontWeight: string
  /** The label's CSS `font-variant`. */
  labelFontVariant: string
  /** The label's CSS `line-height`, as a unitless multiple of the font size. */
  labelLineHeight: number
}

/** `NoteShapeUtil`'s settings; see {@link ShapeUtil.configure}. */
export interface NoteShapeOptions extends ShapeUtilOptions<NoteShape, NoteShapeUtilDisplayValues> {
  /** The note's logical square side in page units, before `scale`. */
  noteSize?: number
  /** Padding between the body edge and its label, before `scale`. */
  labelPadding?: number
}

/**
 * Resolve a note's display values against a theme.
 *
 * Tolerant of a bare `{ props }` bag rather than a whole record: a placement
 * ghost asks what a note the user has not created yet would look like, and it
 * has only the util's default props to ask with.
 */
export function getNoteDisplayValues(
  editor: unknown,
  shape: { props?: unknown },
  theme: TLTheme,
  colorMode: TLColorMode,
  options: NoteShapeOptions = {},
): NoteShapeUtilDisplayValues {
  const base = getDefaultDisplayValues(editor, shape as TLStyledShape, theme, colorMode)
  const props = readNoteProps(shape)
  const colors = theme.colors[colorMode] ?? theme.colors.light
  const side = (options.noteSize ?? NOTE_SIZE) * props.scale
  const fontSize = getNoteFontSize(shape, theme)
  // A note's ink is the palette's note text unless the label carries a colour
  // of its own; `black` is the "unset" value the style panel writes.
  const labelColor =
    props.labelColor === "black"
      ? getColorValue(colors, props.color, "noteText")
      : getColorValue(colors, props.labelColor, "solid")
  return {
    ...base,
    labelColor,
    fill: getColorValue(colors, props.color, "noteFill"),
    fontSize,
    lineHeight: fontSize * theme.lineHeight,
    noteWidth: side,
    noteHeight: side,
    labelPadding: (options.labelPadding ?? NOTE_PADDING) * props.scale,
    labelFontSize: fontSize,
    labelBaseFontSize: getNoteBaseFontSize(shape, theme),
    labelFontFamily: theme.fonts[props.font] ?? theme.fonts.draw,
    // SEMANTICS-ASSUMED: a note's label is upright, regular and unshaped. Rich
    // text carries its own bold/italic runs as marks, so the shape-level
    // typography is the base every run is measured relative to.
    labelFontStyle: "normal",
    labelFontWeight: "normal",
    labelFontVariant: "normal",
    labelLineHeight: theme.lineHeight,
  }
}

/**
 * `growY` a note needs so its (centered) text fits; the note keeps its square
 * width.
 *
 * Returned in *unscaled* units — the label is measured at the scale the note
 * is actually drawn at, and the overflow is then divided back out, because
 * `growY` is stored as a number of unit-note pixels and multiplied by `scale`
 * when the height is computed. Returning the scaled overflow instead is what
 * made a note from a `.tldr` file, where the prop has always meant the
 * unscaled thing, come out too short for its own text.
 */
export function getNoteGrowY(shape: NoteShape, editor?: { getCurrentTheme?(): TLTheme } | null): number {
  const { richText, text, font, scale } = readNoteProps(shape)
  if (!text) return 0
  const side = NOTE_SIZE * scale
  const m = measureLabel(richText, {
    fontFamily: font,
    fontSize: getNoteFontSize(shape),
    maxWidth: side,
    padding: NOTE_PADDING * scale,
    editor: (editor ?? null) as never,
  })
  return computeGrowY(m.h, side) / scale
}

const LABEL_KEYS: readonly (keyof NoteShapeProps)[] = ["richText", "text", "font", "size", "scale", "fontSizeAdjustment"]

export class NoteShapeUtil extends ShapeUtil<NoteShape, NoteShapeUtilDisplayValues> {
  static override type = "note" as const
  // A method, not an arrow: `getDisplayValues` calls it on the options bag, so
  // `this` is the bag a `configure()` copy actually carries. Closing over
  // `NoteShapeUtil.options` instead would make every configured copy resolve
  // against the unconfigured defaults.
  static override options: NoteShapeOptions = {
    getDefaultDisplayValues(editor, shape, theme, colorMode) {
      return getNoteDisplayValues(editor, shape, theme, colorMode, this)
    },
  }
  declare readonly options: NoteShapeOptions
  static override props = noteShapeProps
  static override migrations = noteShapeMigrations

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
      richText: toRichText(""),
      // Deliberately absent: `textFirstEditedBy` is read and round-tripped but
      // never written by mocanvas (only the host knows who "a person" is), and
      // defaulting it would make every file that predates attribution warn on
      // load about a prop nothing here ever sets.
      scale: 1,
    }
  }

  getGeometry(shape: NoteShape): Geometry2d {
    const { scale, growY } = readNoteProps(shape)
    return new Rectangle2d({ width: NOTE_SIZE * scale, height: (NOTE_SIZE + growY) * scale, isFilled: true })
  }

  override getRenderStyle(shape: NoteShape): StyleWords {
    const colors = getThemeColors(this.editor)
    return { fill: getNoteFillRgba(readNoteProps(shape).color, colors), stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 }
  }

  /** A note is nothing but a label, so it needs its family's faces. */
  override getFontFaces(shape: NoteShape): TLFontFace[] {
    return getLabelFontFaces(readNoteProps(shape).font)
  }

  component(shape: NoteShape): ReactNode {
    const { richText, text, font, color, align, verticalAlign, scale, growY } = readNoteProps(shape)
    const display = getDisplayValues<NoteShape, NoteShapeUtilDisplayValues>(this, shape)
    const colors = getThemeColors(this.editor)
    const textColor = display.labelColor
    const w = NOTE_SIZE * scale
    const h = (NOTE_SIZE + growY) * scale
    return (
      <>
        {/*
          The note's trim: a vertical gradient over the body and a soft shadow
          under it. The GPU quad below this covers exactly the shape's bounds
          and can carry neither, so both are drawn here, beneath the label. The
          shadow falls outside the body and is decoration only — the geometry,
          bounds and hit-testing are the flat rectangle either way.
        */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: w,
            height: h,
            background: getNoteBodyGradientCss(color, colors),
            boxShadow: getNoteShadowCss(scale),
            pointerEvents: "none",
          }}
        />
        <TextLabel
          shape={shape}
          text={text}
          richText={richText}
          isEditing={this.editor.getEditingShapeId() === shape.id}
          fontFamily={font}
          fontSize={display.labelFontSize}
          color={textColor}
          textAlign={align}
          verticalAlign={verticalAlign}
          wrap
          width={w}
          height={h}
          padding={display.labelPadding}
          onChange={(next) =>
            this.editor.updateShape<NoteShape>({
              id: shape.id,
              type: "note",
              props: { text: next, richText: applyPlainTextToRichText(richText, next) },
            })
          }
          onChangeRichText={(next) =>
            this.editor.updateShape<NoteShape>({
              id: shape.id,
              type: "note",
              props: { richText: next, text: richTextToText(next) },
            })
          }
        />
      </>
    )
  }

  override getIndicatorPath(shape: NoteShape): Path2D {
    const { scale, growY } = readNoteProps(shape)
    return rectPath(NOTE_SIZE * scale, (NOTE_SIZE + growY) * scale)
  }

  /**
   * The GPU draws the sticky background even while editing; the overlay adds
   * the gradient and the shadow over it (see `component`).
   */
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
    const growY = getNoteGrowY(next, this.editor)
    if (growY !== next.props.growY) return { ...next, props: { ...next.props, growY } }
  }

  override onBeforeUpdate(prev: NoteShape, next: NoteShape): NoteShape | void {
    if (!LABEL_KEYS.some((k) => propsOf(prev)[k] !== propsOf(next)[k])) return
    const growY = getNoteGrowY(next, this.editor)
    if (growY !== next.props.growY) return { ...next, props: { ...next.props, growY } }
  }

  override onEditEnd(shape: NoteShape): void {
    const text = readText(shape.props)
    const trimmed = trimTrailingWhitespace(text)
    if (trimmed === text) return
    this.editor.updateShape<NoteShape>({
      id: shape.id,
      type: "note",
      props: { text: trimmed, richText: applyPlainTextToRichText(readRichText(shape.props), trimmed) },
    })
  }
}
