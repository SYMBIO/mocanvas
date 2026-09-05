import {
  type EngineGeometry,
  Polygon2d,
  Polyline2d,
  ShapeUtil,
  STROKE_SIZES,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultSizeStyle,
  getDefaultDisplayValues,
  type BaseShape,
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
import { smoothPoints } from "./draw-helpers"
import { propsOf, readArray, readBoolean, readEnum, readNumber, readStyle } from "./prop-access"
import { getFillRgba, getStrokeRgba, getDashId, getThemeColors } from "./shape-theme"
import { polylinePath } from "./indicator-paths"
import { drawShapeProps } from "./shape-props"
import { drawShapeMigrations } from "./shape-migrations"

export interface DrawPoint {
  x: number
  y: number
  /**
   * Pen pressure, `0..1`. Absent on points a mouse or a finger made — and
   * spelled `| undefined` so a validator that produces the key explicitly
   * still describes this type under `exactOptionalPropertyTypes`.
   */
  z?: number | undefined
}

export interface DrawSegment {
  type: "free" | "straight"
  points: DrawPoint[]
}

export interface DrawShapeProps {
  segments: DrawSegment[]
  color: DefaultColorStyle
  fill: DefaultFillStyle
  dash: DefaultDashStyle
  size: DefaultSizeStyle
  isComplete: boolean
  isClosed: boolean
  isPen: boolean
  scale: number
}

export type DrawShape = BaseShape<"draw", DrawShapeProps>

const SEGMENT_TYPES = ["free", "straight"] as const

/**
 * The shape's segments in a usable form. A segment that carries no decoded
 * `points` array — an encoding the load path could not read, say — reads as an
 * empty run and contributes nothing, rather than throwing.
 */
export function readDrawSegments(shape: { props?: unknown }): DrawSegment[] {
  const out: DrawSegment[] = []
  for (const seg of readArray(propsOf(shape), "segments")) {
    const points: DrawPoint[] = readArray(seg, "points").map((p) => {
      const point: DrawPoint = { x: readNumber(p, "x", 0), y: readNumber(p, "y", 0) }
      // Pressure stays absent when the stored point has none, so a round trip
      // through here does not invent one.
      const z = (p as { z?: unknown } | null)?.z
      if (typeof z === "number" && Number.isFinite(z)) point.z = z
      return point
    })
    out.push({ type: readEnum(seg, "type", SEGMENT_TYPES, "free"), points })
  }
  return out
}

/**
 * What a draw shape paints with.
 *
 * A draw shape carries its own `scale`, which the shared set knows nothing
 * about: `strokeWidth` on the base is the width the *style* asks for, and
 * {@link DrawShapeUtilDisplayValues.scaledStrokeWidth} is the width actually
 * drawn. Both are reported rather than one overwriting the other, so a caller
 * comparing two shapes' styles and a caller measuring one shape's ink each get
 * the number they meant.
 */
export interface DrawShapeUtilDisplayValues extends TLDefaultDisplayValues {
  /** `strokeWidth` with the shape's own `scale` applied. */
  scaledStrokeWidth: number
  /** Whether the outline is actually filled: it must be closed *and* have a fill style. */
  isFilled: boolean
}

/** `DrawShapeUtil`'s settings; see {@link ShapeUtil.configure}. */
export interface DrawShapeOptions extends ShapeUtilOptions<DrawShape, DrawShapeUtilDisplayValues> {}

/** Resolve a draw shape's display values against a theme. */
export function getDrawDisplayValues(
  editor: unknown,
  shape: { props?: unknown },
  theme: TLTheme,
  colorMode: TLColorMode,
): DrawShapeUtilDisplayValues {
  const base = getDefaultDisplayValues(editor, shape as TLStyledShape, theme, colorMode)
  const p = propsOf(shape)
  return {
    ...base,
    scaledStrokeWidth: base.strokeWidth * readNumber(p, "scale", 1),
    isFilled: readBoolean(p, "isClosed", false) && readStyle(p, "fill", DefaultFillStyle) !== "none",
  }
}

/** Flatten a draw shape's segments to one outline, smoothing freehand runs. */
export function getDrawOutlinePoints(shape: { props?: unknown }): VecLike[] {
  const out: VecLike[] = []
  for (const seg of readDrawSegments(shape)) {
    const pts = seg.type === "free" && seg.points.length >= 4 ? smoothPoints(seg.points) : seg.points
    for (const p of pts) out.push({ x: p.x, y: p.y })
  }
  return out
}

export class DrawShapeUtil extends ShapeUtil<DrawShape, DrawShapeUtilDisplayValues> {
  static override type = "draw" as const
  static override props = drawShapeProps
  static override migrations = drawShapeMigrations
  static override options: DrawShapeOptions = { getDefaultDisplayValues: getDrawDisplayValues }
  declare readonly options: DrawShapeOptions

  getDefaultProps(): DrawShapeProps {
    return {
      segments: [],
      color: "black",
      fill: "none",
      dash: "draw",
      size: "m",
      isComplete: false,
      isClosed: false,
      isPen: false,
      scale: 1,
    }
  }

  /**
   * Freehand smoothing runs in the engine: the raw segment points go across and
   * the outline is built there. `w`/`h` are the extents of the *unsmoothed*
   * points — the smoothed outline can only sit inside them, and this util sets
   * neither `OVERLAY` nor `LABEL`, so those words feed a fallback the engine
   * never reaches once the geometry command has run.
   */
  override getEngineGeometry(shape: DrawShape): EngineGeometry {
    const p = propsOf(shape)
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
    const isClosed = readBoolean(p, "isClosed", false)
    return {
      type: "draw",
      segments,
      closed: isClosed,
      w: Number.isFinite(minX) ? maxX - minX : 0,
      h: Number.isFinite(minY) ? maxY - minY : 0,
      isClosed,
      isFilled: isClosed && readStyle(p, "fill", DefaultFillStyle) !== "none",
    }
  }

  getGeometry(shape: DrawShape): Geometry2d {
    const points = getDrawOutlinePoints(shape)
    const p = propsOf(shape)
    if (readBoolean(p, "isClosed", false) && points.length > 2) {
      return new Polygon2d({ points, isFilled: readStyle(p, "fill", DefaultFillStyle) !== "none" })
    }
    return new Polyline2d({ points: points.length === 0 ? [{ x: 0, y: 0 }] : points })
  }

  override getRenderStyle(shape: DrawShape): StyleWords {
    const p = propsOf(shape)
    const color = readStyle(p, "color", DefaultColorStyle)
    const fill = readStyle(p, "fill", DefaultFillStyle)
    const size = readStyle(p, "size", DefaultSizeStyle)
    const scale = readNumber(p, "scale", 1)
    const isClosed = readBoolean(p, "isClosed", false)
    const dash = readStyle(p, "dash", DefaultDashStyle)
    const colors = getThemeColors(this.editor)
    return {
      stroke: getStrokeRgba(color, colors),
      strokeWidth: STROKE_SIZES[size] * scale,
      fill: isClosed && fill !== "none" ? getFillRgba(color, fill, colors) : 0,
      // `draw` asks the engine to replace an outline with a hand-drawn version of
      // it. A draw shape's points *are* a hand-drawn version already — a recorded
      // pen movement, smoothed — so putting them through it a second time only
      // adds bulges the hand never made. Ask for the solid stroke instead. The
      // record keeps `props.dash` exactly as it was, so the style panel still
      // shows "draw", a `.tldr` round trip is unaffected, and `dashed`/`dotted`
      // reach the engine untouched.
      dash: getDashId(dash === "draw" ? "solid" : dash),
      opacity: 1,
    }
  }

  component(_shape: DrawShape): ReactNode {
    return null
  }

  override getIndicatorPath(shape: DrawShape): Path2D {
    const points = getDrawOutlinePoints(shape)
    const isClosed = readBoolean(propsOf(shape), "isClosed", false) && points.length > 2
    return polylinePath(points, isClosed)
  }

  override canResize(_shape: DrawShape): boolean {
    return true
  }

  override hideResizeHandles(_shape: DrawShape): boolean {
    return false
  }

  override onResize(shape: DrawShape, info: ResizeInfo<DrawShape>): Partial<DrawShape> {
    const { scaleX, scaleY, initialShape, newPoint } = info
    const segments = readDrawSegments(initialShape).map((seg) => ({
      ...seg,
      points: seg.points.map((p) => ({ ...p, x: p.x * scaleX, y: p.y * scaleY })),
    }))
    return { x: newPoint.x, y: newPoint.y, props: { ...shape.props, segments } }
  }
}
