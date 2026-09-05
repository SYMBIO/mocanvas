import { describe, expect, it } from "vitest"
import { ShapeIndicatorCompositor, DEFAULT_SHAPE_INDICATOR_OPTIONS, type CanvasProps } from "@mocanvas/editor"
import { ShapeIndicatorOverlayUtil } from "./ShapeIndicatorOverlayUtil"

// `<Canvas indicatorOverlayUtil>` is typed against the editor's compositor, so
// the SDK class (and anything `configure` makes of it) has to fit that slot.
const _accepted: CanvasProps["indicatorOverlayUtil"] = ShapeIndicatorOverlayUtil
const _configured: CanvasProps["indicatorOverlayUtil"] = ShapeIndicatorOverlayUtil.configure({ lineWidth: 2 })
void _accepted
void _configured

describe("ShapeIndicatorOverlayUtil", () => {
  it("is the editor compositor under the name the SDK exports", () => {
    expect(ShapeIndicatorOverlayUtil.prototype).toBeInstanceOf(ShapeIndicatorCompositor)
    expect(ShapeIndicatorOverlayUtil.options).toEqual(DEFAULT_SHAPE_INDICATOR_OPTIONS)
  })

  it("configures into a subclass without touching the base", () => {
    const Heavy = ShapeIndicatorOverlayUtil.configure({ lineWidth: 3 })
    expect(Heavy.options.lineWidth).toBe(3)
    // The unspecified weight is inherited, not reset.
    expect(Heavy.options.hintedLineWidth).toBe(DEFAULT_SHAPE_INDICATOR_OPTIONS.hintedLineWidth)
    expect(ShapeIndicatorOverlayUtil.options.lineWidth).toBe(DEFAULT_SHAPE_INDICATOR_OPTIONS.lineWidth)
    expect(ShapeIndicatorCompositor.options.lineWidth).toBe(DEFAULT_SHAPE_INDICATOR_OPTIONS.lineWidth)
  })
})
