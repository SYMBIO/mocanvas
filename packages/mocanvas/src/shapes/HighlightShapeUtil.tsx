/**
 * The highlighter: a draw stroke that marks what is already on the canvas
 * instead of adding to it.
 *
 * It is deliberately *not* a draw shape with different styles. A highlight is
 * translucent, is drawn much wider than its size suggests, never closes into a
 * filled region, and is painted behind everything else so that highlighting a
 * note does not hide the note. Those four differences are the whole shape, and
 * each of them would be a special case inside `DrawShapeUtil` if the two
 * shared a type — which is also why a highlight carries no `fill`, no `dash`
 * and no `isClosed`: there is nothing sensible for them to mean.
 */
import {
  DefaultColorStyle,
  DefaultSizeStyle,
  Polyline2d,
  STROKE_SIZES,
  ShapeUtil,
  getColorValue,
  getDefaultDisplayValues,
  hexToRgba,
  type BaseShape,
  type EngineGeometry,
  type Geometry2d,
  type ResizeInfo,
  type ShapeUtilOptions,
  type StyleWords,
  type TLColorMode,
  type TLDefaultDisplayValues,
  type TLStyledShape,
  type TLTheme,
  type VecLike,
} from "@mocanvas/editor"
import type { ReactNode } from "react"
import { readDrawSegments, type DrawSegment } from "./DrawShapeUtil"
import { smoothPoints } from "./draw-helpers"
import { polylinePath } from "./indicator-paths"
import { propsOf, readNumber, readStyle } from "./prop-access"
import { getThemeColors } from "./shape-theme"
import { highlightShapeProps } from "./shape-props"
import { highlightShapeMigrations } from "./shape-migrations"

/**
 * How wide a highlight is drawn, per `size`, at `scale: 1`.
 *
 * MEASURED, replacing a guess: these are tldraw 5.4's painted stroke widths,
 * read off the rendered element in `apps/bench` at each of the four sizes.
 *
 * A table rather than a multiple of `STROKE_SIZES`, because the two do not run
 * in step — the ratio falls from ~10x at `s` to ~4.9x at `xl`, so no single
 * multiplier reproduces them. The previous 3.2x of `STROKE_SIZES` came out
 * between 1.5x and 3.2x too narrow depending on the size.
 */
export const HIGHLIGHT_STROKE_SIZES: typeof STROKE_SIZES = { s: 20.16, m: 26.88, l: 40.32, xl: 49.28 }

/**
 * How see-through a highlight is.
 *
 * MEASURED, replacing a guess: tldraw paints the highlight at this opacity over
 * the palette's highlight ink, which is the same token mocanvas already carries.
 * The old 0.32 washed a saturated `#fddd00` out to a pale cream over white
 * paper — the mark read as a smudge rather than as a highlighter.
 */
export const HIGHLIGHT_OPACITY = 0.82

export interface HighlightShapeProps {
  /** The recorded pen movement, in the same encoding a draw shape uses. */
  segments: DrawSegment[]
  color: DefaultColorStyle
  size: DefaultSizeStyle
  /** Whether the stroke is finished; `false` while the pen is still down. */
  isComplete: boolean
  /** Whether the stroke came from a pen rather than a mouse or a finger. */
  isPen: boolean
  scale: number
}

/** The `@tldraw/tlschema` spelling of {@link HighlightShapeProps}. */
export type TLHighlightShapeProps = HighlightShapeProps

export type HighlightShape = BaseShape<"highlight", HighlightShapeProps>

/** The `@tldraw/tlschema` spelling of {@link HighlightShape}. */
export type TLHighlightShape = HighlightShape

/**
 * What a highlight paints with.
 *
 * `color` on the base is the palette's *solid* ink, which is not what a
 * highlighter lays down — the palette carries a separate, much paler highlight
 * token for exactly this. Both are reported: the solid one so a caller that
 * only knows the shared set still gets something sensible, and
 * {@link HighlightShapeUtilDisplayValues.highlightColor} for the real ink.
 */
export interface HighlightShapeUtilDisplayValues extends TLDefaultDisplayValues {
  /** The highlighter ink: the palette's highlight token for `props.color`. */
  highlightColor: string
  /** The stroke width actually drawn — the base width, widened and scaled. */
  highlightStrokeWidth: number
  /** How see-through the stroke is drawn, `0..1`. */
  highlightOpacity: number
}

/** `HighlightShapeUtil`'s settings; see {@link ShapeUtil.configure}. */
export interface HighlightShapeOptions extends ShapeUtilOptions<HighlightShape, HighlightShapeUtilDisplayValues> {
  /** A multiplier on {@link HIGHLIGHT_STROKE_SIZES}; `1` draws the standard width. */
  strokeScale?: number
  /** How see-through a highlight is, `0..1`; see {@link HIGHLIGHT_OPACITY}. */
  opacity?: number
}

/** Resolve a highlight's display values against a theme. */
export function getHighlightDisplayValues(
  editor: unknown,
  shape: { props?: unknown },
  theme: TLTheme,
  colorMode: TLColorMode,
  options: HighlightShapeOptions = {},
): HighlightShapeUtilDisplayValues {
  const base = getDefaultDisplayValues(editor, shape as TLStyledShape, theme, colorMode)
  const p = propsOf(shape)
  const colors = theme.colors[colorMode] ?? theme.colors.light
  const size = readStyle(p, "size", DefaultSizeStyle)
  const scale = readNumber(p, "scale", 1)
  return {
    ...base,
    highlightColor: getColorValue(colors, readStyle(p, "color", DefaultColorStyle), "highlightSrgb"),
    highlightStrokeWidth: HIGHLIGHT_STROKE_SIZES[size] * (options.strokeScale ?? 1) * scale,
    highlightOpacity: options.opacity ?? HIGHLIGHT_OPACITY,
  }
}

/** The stroke as one polyline, freehand runs smoothed. A highlight never closes. */
export function getHighlightOutlinePoints(shape: { props?: unknown }): VecLike[] {
  const out: VecLike[] = []
  for (const seg of readDrawSegments(shape)) {
    const pts = seg.type === "free" && seg.points.length >= 4 ? smoothPoints(seg.points) : seg.points
    for (const p of pts) out.push({ x: p.x, y: p.y })
  }
  return out
}

/** A translucent marker stroke, drawn behind the shapes it marks. */
export class HighlightShapeUtil extends ShapeUtil<HighlightShape, HighlightShapeUtilDisplayValues> {
  static override type = "highlight" as const
  static override props = highlightShapeProps
  static override migrations = highlightShapeMigrations
  // A method rather than an arrow so `configure()`'s overrides are visible
  // through `this`; see `NoteShapeUtil` for the same pattern.
  static override options: HighlightShapeOptions = {
    getDefaultDisplayValues(editor, shape, theme, colorMode) {
      return getHighlightDisplayValues(editor, shape, theme, colorMode, this)
    },
  }
  declare readonly options: HighlightShapeOptions

  getDefaultProps(): HighlightShapeProps {
    return { segments: [], color: "black", size: "m", isComplete: false, isPen: false, scale: 1 }
  }

  /**
   * The same freehand generator a draw shape uses, so a highlight and a pen
   * stroke recorded from the same movement have the same silhouette; only the
   * width, the colour and the opacity differ, and those are render style.
   */
  override getEngineGeometry(shape: HighlightShape): EngineGeometry {
    const segments = readDrawSegments(shape).map((seg) => ({
      points: seg.points.flatMap((q) => [q.x, q.y]),
      freehand: seg.type === "free",
    }))
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const seg of segments) {
      for (let i = 0; i < seg.points.length; i += 2) {
        const x = seg.points[i]!
        const y = seg.points[i + 1]!
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    return {
      type: "draw",
      segments,
      closed: false,
      w: Number.isFinite(minX) ? maxX - minX : 0,
      h: Number.isFinite(minY) ? maxY - minY : 0,
      isClosed: false,
      isFilled: false,
    }
  }

  getGeometry(shape: HighlightShape): Geometry2d {
    const points = getHighlightOutlinePoints(shape)
    return new Polyline2d({ points: points.length === 0 ? [{ x: 0, y: 0 }] : points })
  }

  override getRenderStyle(shape: HighlightShape): StyleWords {
    const p = propsOf(shape)
    const colors = getThemeColors(this.editor)
    const size = readStyle(p, "size", DefaultSizeStyle)
    const scale = readNumber(p, "scale", 1)
    return {
      stroke: hexToRgba(getColorValue(colors, readStyle(p, "color", DefaultColorStyle), "highlightSrgb")),
      strokeWidth: HIGHLIGHT_STROKE_SIZES[size] * (this.options.strokeScale ?? 1) * scale,
      fill: 0,
      // Never `draw`: the points are already a recorded hand movement, and
      // running them through the hand-drawn generator a second time only adds
      // bulges the hand never made. Same reasoning as `DrawShapeUtil`.
      dash: 0,
      opacity: this.options.opacity ?? HIGHLIGHT_OPACITY,
    }
  }

  component(_shape: HighlightShape): ReactNode {
    return null
  }

  /**
   * The highlight belongs *behind* the shapes it marks, so a renderer with a
   * background layer draws it from here instead of from {@link component}.
   *
   * Both are `null` because the stroke is painted on the GPU from
   * {@link getRenderStyle}; the method exists so that a renderer asking "does
   * this shape want a background pass?" gets a truthful answer, and so a
   * subclass has the seam to paint one in the DOM.
   */
  backgroundComponent(_shape: HighlightShape): ReactNode {
    return null
  }

  override getIndicatorPath(shape: HighlightShape): Path2D {
    return polylinePath(getHighlightOutlinePoints(shape), false)
  }

  override canResize(_shape: HighlightShape): boolean {
    return true
  }

  override hideResizeHandles(_shape: HighlightShape): boolean {
    return false
  }

  override onResize(shape: HighlightShape, info: ResizeInfo<HighlightShape>): Partial<HighlightShape> {
    const { scaleX, scaleY, initialShape, newPoint } = info
    const segments = readDrawSegments(initialShape).map((seg) => ({
      ...seg,
      points: seg.points.map((p) => ({ ...p, x: p.x * scaleX, y: p.y * scaleY })),
    }))
    return { x: newPoint.x, y: newPoint.y, props: { ...shape.props, segments } }
  }
}
