import { describe, expect, it } from "vitest"
import { DEFAULT_THEME, Polyline2d, getColorValue, hexToRgba } from "@mocanvas/editor"
import {
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_STROKE_SCALE,
  HighlightShapeUtil,
  getHighlightDisplayValues,
  getHighlightOutlinePoints,
  type HighlightShape,
} from "./HighlightShapeUtil"

function shape(props: Partial<HighlightShape["props"]> = {}): HighlightShape {
  return {
    id: "shape:h" as HighlightShape["id"],
    typeName: "shape",
    type: "highlight",
    x: 0,
    y: 0,
    rotation: 0,
    index: "a1",
    parentId: "page:p" as HighlightShape["parentId"],
    isLocked: false,
    opacity: 1,
    meta: {},
    props: {
      segments: [{ type: "free", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 5 }] }],
      color: "black",
      size: "m",
      isComplete: true,
      isPen: false,
      scale: 1,
      ...props,
    },
  } as HighlightShape
}

/** A util with no editor behind it: enough for the pure methods. */
function util(): HighlightShapeUtil {
  return new (HighlightShapeUtil as unknown as new (editor: unknown) => HighlightShapeUtil)(null)
}

describe("HighlightShapeUtil", () => {
  it("is an open polyline, never a filled region", () => {
    const geometry = util().getGeometry(shape())
    expect(geometry).toBeInstanceOf(Polyline2d)
    expect(geometry.isClosed).toBe(false)
  })

  it("survives a record whose segments never arrived", () => {
    expect(getHighlightOutlinePoints({ props: { segments: "corrupt" } })).toEqual([])
    expect(util().getGeometry(shape({ segments: [] }))).toBeInstanceOf(Polyline2d)
  })

  it("hands the engine the same freehand generator a draw stroke uses", () => {
    const geometry = util().getEngineGeometry(shape())
    expect(geometry.type).toBe("draw")
    expect(geometry).toMatchObject({ closed: false, isClosed: false, isFilled: false })
  })

  it("paints with the palette's highlight ink, not its solid ink", () => {
    const colors = DEFAULT_THEME.colors.light
    const style = util().getRenderStyle(shape({ color: "yellow" }))
    expect(style.stroke).toBe(hexToRgba(getColorValue(colors, "yellow", "highlightSrgb")))
    expect(style.stroke).not.toBe(hexToRgba(getColorValue(colors, "yellow", "solid")))
  })

  it("draws far wider and far more transparent than a pen of the same size", () => {
    const style = util().getRenderStyle(shape())
    expect(style.opacity).toBe(HIGHLIGHT_OPACITY)
    expect(style.opacity).toBeLessThan(1)
    expect(style.strokeWidth).toBeGreaterThan(3.5)
    expect(style.fill).toBe(0)
    // Never the hand-drawn dash: the points are already a recorded movement.
    expect(style.dash).toBe(0)
  })

  it("scales the stroke with the shape", () => {
    const one = util().getRenderStyle(shape())
    const two = util().getRenderStyle(shape({ scale: 2 }))
    expect(two.strokeWidth).toBeCloseTo(one.strokeWidth * 2)
  })

  it("reports the widened, scaled stroke through its display values", () => {
    const display = getHighlightDisplayValues(null, shape({ scale: 2 }), DEFAULT_THEME, "light")
    expect(display.highlightStrokeWidth).toBeCloseTo(display.strokeWidth * HIGHLIGHT_STROKE_SCALE * 2)
    expect(display.highlightOpacity).toBe(HIGHLIGHT_OPACITY)
    // The shared set is still there, unchanged.
    expect(display.color).toBe(getColorValue(DEFAULT_THEME.colors.light, "black", "solid"))
  })

  it("honours a configured width and opacity", () => {
    const display = getHighlightDisplayValues(null, shape(), DEFAULT_THEME, "light", { strokeScale: 1, opacity: 0.5 })
    expect(display.highlightStrokeWidth).toBeCloseTo(display.strokeWidth)
    expect(display.highlightOpacity).toBe(0.5)
  })

  it("scales its points when resized, leaving the record's other props alone", () => {
    const original = shape()
    const next = util().onResize(original, {
      handle: "bottom_right",
      scaleX: 2,
      scaleY: 1,
      initialShape: original,
      initialBounds: { x: 0, y: 0, w: 20, h: 5 },
      newPoint: { x: 0, y: 0 },
      mode: "resize_bounds",
    } as never)
    expect(next.props!.segments[0]!.points.at(-1)).toMatchObject({ x: 40, y: 5 })
    expect(next.props!.color).toBe("black")
  })
})
