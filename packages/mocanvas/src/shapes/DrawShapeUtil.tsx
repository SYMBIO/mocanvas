import {
  Polygon2d,
  Polyline2d,
  ShapeUtil,
  STROKE_SIZES,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultSizeStyle,
  type BaseShape,
  type Geometry2d,
  type ResizeInfo,
  type StyleWords,
  type VecLike,
} from "@mocanvas/editor"
import type { ReactNode } from "react"
import { smoothPoints } from "./draw-helpers"
import { propsOf, readArray, readBoolean, readEnum, readNumber, readStyle } from "./prop-access"
import { getFillRgba, getStrokeRgba, getDashId } from "./shape-theme"

export interface DrawPoint {
  x: number
  y: number
  z?: number
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

/** Flatten a draw shape's segments to one outline, smoothing freehand runs. */
export function getDrawOutlinePoints(shape: DrawShape): VecLike[] {
  const out: VecLike[] = []
  for (const seg of readDrawSegments(shape)) {
    const pts = seg.type === "free" && seg.points.length >= 4 ? smoothPoints(seg.points) : seg.points
    for (const p of pts) out.push({ x: p.x, y: p.y })
  }
  return out
}

export class DrawShapeUtil extends ShapeUtil<DrawShape> {
  static override type = "draw" as const
  static override props = { color: DefaultColorStyle, fill: DefaultFillStyle, dash: DefaultDashStyle, size: DefaultSizeStyle }

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
    return {
      stroke: getStrokeRgba(color),
      strokeWidth: STROKE_SIZES[size] * scale,
      fill: isClosed && fill !== "none" ? getFillRgba(color, fill) : 0,
      dash: getDashId(readStyle(p, "dash", DefaultDashStyle)),
      opacity: 1,
    }
  }

  component(_shape: DrawShape): ReactNode {
    return null
  }

  indicator(shape: DrawShape): ReactNode {
    const points = getDrawOutlinePoints(shape)
    if (readBoolean(propsOf(shape), "isClosed", false) && points.length > 2) points.push(points[0]!)
    const d = points.map((p) => `${Math.round(p.x * 100) / 100},${Math.round(p.y * 100) / 100}`).join(" ")
    return <polyline points={d} fill="none" />
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
