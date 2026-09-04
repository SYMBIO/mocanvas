import {
  CubicSpline2d,
  Polyline2d,
  ShapeUtil,
  STROKE_SIZES,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultSizeStyle,
  type BaseShape,
  type Geometry2d,
  type ShapeHandle,
  type StyleWords,
} from "@mocanvas/editor"
import { getIndexBetween, sortByIndex, type IndexKey } from "@mocanvas/store"
import type { ReactNode } from "react"
import { propsOf, readEnum, readNumber, readString, readStyle } from "./prop-access"
import { getStrokeRgba, getDashId } from "./shape-theme"
import { catmullRomToBezier } from "./spline-helpers"
import { pathWordsToSvgD } from "./svg-path"
import { svgPath } from "./indicator-paths"

export interface LinePoint {
  id: string
  index: string
  x: number
  y: number
}

export interface LineShapeProps {
  color: DefaultColorStyle
  dash: DefaultDashStyle
  size: DefaultSizeStyle
  spline: "line" | "cubic"
  points: Record<string, LinePoint>
  scale: number
}

export type LineShape = BaseShape<"line", LineShapeProps>

const SPLINES = ["line", "cubic"] as const

/** The line's points in drawing order, skipping any entry that is not a point. */
export function getLinePoints(shape: { props?: unknown }): LinePoint[] {
  const stored = propsOf(shape)["points"]
  if (typeof stored !== "object" || stored === null) return []
  const points: (LinePoint & { index: IndexKey })[] = []
  for (const [id, value] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue
    points.push({
      id: readString(value, "id", id),
      index: readString(value, "index", "a1") as IndexKey,
      x: readNumber(value, "x", 0),
      y: readNumber(value, "y", 0),
    })
  }
  return sortByIndex(points)
}

function midIndex(a: string, b: string): string {
  try {
    return getIndexBetween(a as IndexKey, b as IndexKey)
  } catch {
    return `${a}V`
  }
}

export class LineShapeUtil extends ShapeUtil<LineShape> {
  static override type = "line" as const
  static override props = { color: DefaultColorStyle, dash: DefaultDashStyle, size: DefaultSizeStyle }

  getDefaultProps(): LineShapeProps {
    return {
      color: "black",
      dash: "draw",
      size: "m",
      spline: "line",
      points: {
        a1: { id: "a1", index: "a1", x: 0, y: 0 },
        a2: { id: "a2", index: "a2", x: 100, y: 100 },
      },
      scale: 1,
    }
  }

  getGeometry(shape: LineShape): Geometry2d {
    const points = getLinePoints(shape)
    if (points.length === 0) return new Polyline2d({ points: [{ x: 0, y: 0 }] })
    if (readEnum(propsOf(shape), "spline", SPLINES, "line") === "cubic" && points.length > 2) {
      return new CubicSpline2d({ segments: catmullRomToBezier(points), isClosed: false, isFilled: false })
    }
    return new Polyline2d({ points })
  }

  override getRenderStyle(shape: LineShape): StyleWords {
    const p = propsOf(shape)
    const color = readStyle(p, "color", DefaultColorStyle)
    const size = readStyle(p, "size", DefaultSizeStyle)
    return {
      stroke: getStrokeRgba(color),
      strokeWidth: STROKE_SIZES[size] * readNumber(p, "scale", 1),
      fill: 0,
      dash: getDashId(readStyle(p, "dash", DefaultDashStyle)),
      opacity: 1,
    }
  }

  component(_shape: LineShape): ReactNode {
    return null
  }

  override getIndicatorPath(shape: LineShape): Path2D {
    return svgPath(pathWordsToSvgD(this.getGeometry(shape).toPathWords()))
  }

  override getHandles(shape: LineShape): ShapeHandle[] {
    const points = getLinePoints(shape)
    const handles: ShapeHandle[] = []
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!
      handles.push({ id: p.id, type: "vertex", index: p.index, x: p.x, y: p.y })
      const next = points[i + 1]
      if (next) {
        handles.push({
          id: `mid:${p.id}:${next.id}`,
          type: "virtual",
          index: midIndex(p.index, next.index),
          x: (p.x + next.x) / 2,
          y: (p.y + next.y) / 2,
        })
      }
    }
    return handles
  }

  override onHandleDrag(shape: LineShape, info: { handle: ShapeHandle }): Partial<LineShape> {
    const { handle } = info
    const points: Record<string, LinePoint> = {}
    for (const p of getLinePoints(shape)) points[p.id] = p
    const existing = points[handle.id]
    if (existing) {
      points[handle.id] = { ...existing, x: handle.x, y: handle.y }
    } else {
      // Dragging a virtual midpoint promotes it to a real point.
      points[handle.id] = { id: handle.id, index: handle.index, x: handle.x, y: handle.y }
    }
    return { props: { ...shape.props, points } }
  }
}
