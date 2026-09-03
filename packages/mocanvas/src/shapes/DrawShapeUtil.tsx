import {
  Polygon2d,
  Polyline2d,
  ShapeUtil,
  STROKE_SIZES,
  type BaseShape,
  type DefaultColorStyle,
  type DefaultDashStyle,
  type DefaultFillStyle,
  type DefaultSizeStyle,
  type Geometry2d,
  type ResizeInfo,
  type StyleWords,
  type VecLike,
} from "@mocanvas/editor"
import type { ReactNode } from "react"
import { smoothPoints } from "./draw-helpers"
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

/** Flatten a draw shape's segments to one outline, smoothing freehand runs. */
export function getDrawOutlinePoints(shape: DrawShape): VecLike[] {
  const out: VecLike[] = []
  for (const seg of shape.props.segments) {
    const pts = seg.type === "free" && seg.points.length >= 4 ? smoothPoints(seg.points) : seg.points
    for (const p of pts) out.push({ x: p.x, y: p.y })
  }
  return out
}

export class DrawShapeUtil extends ShapeUtil<DrawShape> {
  static override type = "draw" as const

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
    if (shape.props.isClosed && points.length > 2) {
      return new Polygon2d({ points, isFilled: shape.props.fill !== "none" })
    }
    return new Polyline2d({ points: points.length === 0 ? [{ x: 0, y: 0 }] : points })
  }

  override getRenderStyle(shape: DrawShape): StyleWords {
    const { color, fill, size, scale, isClosed } = shape.props
    return {
      stroke: getStrokeRgba(color),
      strokeWidth: STROKE_SIZES[size] * scale,
      fill: isClosed && fill !== "none" ? getFillRgba(color, fill) : 0,
      dash: getDashId(shape.props.dash),
      opacity: 1,
    }
  }

  component(_shape: DrawShape): ReactNode {
    return null
  }

  indicator(shape: DrawShape): ReactNode {
    const points = getDrawOutlinePoints(shape)
    if (shape.props.isClosed && points.length > 2) points.push(points[0]!)
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
    const segments = initialShape.props.segments.map((seg) => ({
      ...seg,
      points: seg.points.map((p) => ({ ...p, x: p.x * scaleX, y: p.y * scaleY })),
    }))
    return { x: newPoint.x, y: newPoint.y, props: { ...shape.props, segments } }
  }
}
