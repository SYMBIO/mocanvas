import { beforeAll, describe, expect, it } from "vitest"
import type { UnknownShape } from "../records/base"
import { ShapeIndicatorOverlayUtil, type IndicatorShapeUtil, type TLIndicatorHost } from "./ShapeIndicatorOverlayUtil"
import { getIndicatorSource, getShapeIndicatorPath, normalizeIndicatorPath } from "./resolve"
import type { TLIndicatorPathResult } from "./types"

// ── Doubles ─────────────────────────────────────────────────────────────────
// `Path2D` and `CanvasRenderingContext2D` are DOM classes and the editor's
// tests run in Node. Recording doubles keep the compositor's *decisions* — the
// order of the calls, the widths, the clip rule — observable, which is the part
// worth testing; the browser owns the rasterization.

/** A `Path2D` that remembers what was drawn into it. */
class FakePath2D {
  readonly ops: string[] = []
  constructor(readonly d?: string) {}
  rect(x: number, y: number, w: number, h: number): void {
    this.ops.push(`rect(${x},${y},${w},${h})`)
  }
}

/** Every call a `ShapeIndicatorOverlayUtil.render` may make, in order. */
class FakeCtx {
  readonly calls: string[] = []
  private depth = 0
  strokeStyle = ""
  lineWidth = 0
  lineJoin = ""
  lineCap = ""
  save(): void {
    this.depth++
    this.calls.push("save")
  }
  restore(): void {
    this.depth--
    this.calls.push("restore")
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.calls.push(`transform(${a},${b},${c},${d},${e},${f})`)
  }
  clip(path: FakePath2D, rule: string): void {
    this.calls.push(`clip(${path.ops.join("|")},${rule})`)
  }
  stroke(path: FakePath2D): void {
    this.calls.push(`stroke(${path.ops.join("|")},w=${this.lineWidth},c=${this.strokeStyle})`)
  }
  setLineDash(dash: number[]): void {
    this.calls.push(`dash(${dash.join(",")})`)
  }
  get balanced(): boolean {
    return this.depth === 0
  }
}

beforeAll(() => {
  ;(globalThis as { Path2D?: unknown }).Path2D ??= FakePath2D
})

const SELECT_STROKE = "#2f6fe4"

function makeShape(id: string, type = "box"): UnknownShape {
  return {
    id,
    typeName: "shape",
    type,
    x: 0,
    y: 0,
    rotation: 0,
    index: "a1",
    parentId: "page:main",
    isLocked: false,
    opacity: 1,
    props: {},
    meta: {},
  } as unknown as UnknownShape
}

interface HostOptions {
  shapes: UnknownShape[]
  utils?: Record<string, IndicatorShapeUtil>
  selected?: string[]
  hovered?: string | undefined
  hinting?: string[]
  zoom?: number
  camera?: { x: number; y: number }
  bounds?: { x: number; y: number; w: number; h: number } | undefined
  coarsePointer?: boolean
  tool?: string
}

const boxUtil: IndicatorShapeUtil = {
  getIndicatorPath: () => {
    const path = new Path2D()
    path.rect(0, 0, 10, 20)
    return path
  },
}

function makeHost(opts: HostOptions): TLIndicatorHost {
  const byId = new Map<string, UnknownShape>(opts.shapes.map((s) => [s.id as string, s]))
  const zoom = opts.zoom ?? 1
  return {
    getZoomLevel: () => zoom,
    getCamera: () => ({ x: opts.camera?.x ?? 0, y: opts.camera?.y ?? 0, z: zoom }),
    getSelectedShapes: () => (opts.selected ?? []).map((id) => byId.get(id)!).filter(Boolean),
    getHoveredShape: () => (opts.hovered ? byId.get(opts.hovered) : undefined),
    getHintingShapeIds: () => opts.hinting ?? [],
    getShape: (id) => byId.get(id),
    getShapeUtil: (shape) => opts.utils?.[shape.type] ?? boxUtil,
    getShapePageTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getShapeGeometryBounds: () => ("bounds" in opts ? opts.bounds : { x: 0, y: 0, w: 10, h: 20 }),
    getInstanceState: () => ({ isCoarsePointer: opts.coarsePointer ?? false }),
    getCurrentToolId: () => opts.tool ?? "select",
    theme: {
      getCurrentTheme: () => ({ colors: { light: { selectStroke: SELECT_STROKE } } }) as never,
      getColorMode: () => "light",
    },
  }
}

describe("getIndicatorSource", () => {
  it("gives the canvas layer a util with getIndicatorPath", () => {
    expect(getIndicatorSource({ getIndicatorPath: () => undefined })).toBe("path")
  })

  it("leaves a util that only has the deprecated indicator() on the SVG layer", () => {
    expect(getIndicatorSource({ indicator: () => null })).toBe("react")
  })

  it("draws a util that has both exactly once, on the canvas", () => {
    expect(getIndicatorSource({ getIndicatorPath: () => undefined, indicator: () => null })).toBe("path")
  })

  it("gives a util with neither to the canvas layer, for the bounds fallback", () => {
    expect(getIndicatorSource({})).toBe("path")
  })
})

describe("normalizeIndicatorPath", () => {
  it("wraps a bare Path2D", () => {
    const path = new Path2D()
    expect(normalizeIndicatorPath(path)).toEqual({ path })
  })

  it("passes a composed path through", () => {
    const composed = { path: new Path2D(), clipPath: new Path2D() }
    expect(normalizeIndicatorPath(composed)).toBe(composed)
  })

  it("reads undefined as nothing to draw", () => {
    expect(normalizeIndicatorPath(undefined)).toBeUndefined()
  })
})

describe("getShapeIndicatorPath", () => {
  const shape = makeShape("shape:a")

  it("falls back to the geometry bounds when the util has no getIndicatorPath", () => {
    const paths = getShapeIndicatorPath({}, shape, { x: 5, y: 6, w: 40, h: 30 })
    expect((paths!.path as unknown as FakePath2D).ops).toEqual(["rect(5,6,40,30)"])
  })

  it("draws nothing for a shape with neither a path nor bounds", () => {
    expect(getShapeIndicatorPath({}, shape, undefined)).toBeUndefined()
  })

  it("does not fall back for a util that answered 'nothing'", () => {
    // Implementing the hook and returning undefined is how a shape opts out of
    // an outline; a bounds rectangle would be exactly the wrong answer.
    const util = { getIndicatorPath: (): TLIndicatorPathResult => undefined }
    expect(getShapeIndicatorPath(util, shape, { x: 0, y: 0, w: 1, h: 1 })).toBeUndefined()
  })

  it("leaves a deprecated-only util to the SVG layer", () => {
    expect(getShapeIndicatorPath({ indicator: () => null }, shape, { x: 0, y: 0, w: 1, h: 1 })).toBeUndefined()
  })
})

describe("ShapeIndicatorOverlayUtil.getIndicators", () => {
  it("strokes a hinted shape heavier than a selected one", () => {
    const a = makeShape("shape:a")
    const b = makeShape("shape:b")
    const overlay = new ShapeIndicatorOverlayUtil(makeHost({ shapes: [a, b], selected: ["shape:a"], hinting: ["shape:b"] }))
    const byId = Object.fromEntries(overlay.getIndicators().map((i) => [i.shapeId, i]))
    expect(byId["shape:a"]!.lineWidth).toBe(1.5)
    expect(byId["shape:b"]!.lineWidth).toBe(2.5)
    expect(byId["shape:b"]!.context).toBe("hinting")
  })

  it("draws a shape that is both selected and hinted once, as the drop target", () => {
    const a = makeShape("shape:a")
    const overlay = new ShapeIndicatorOverlayUtil(makeHost({ shapes: [a], selected: ["shape:a"], hinting: ["shape:a"] }))
    const indicators = overlay.getIndicators()
    expect(indicators).toHaveLength(1)
    expect(indicators[0]!.context).toBe("hinting")
    expect(indicators[0]!.lineWidth).toBe(2.5)
  })

  it("takes the selection colour from the live theme", () => {
    const a = makeShape("shape:a")
    const overlay = new ShapeIndicatorOverlayUtil(makeHost({ shapes: [a], selected: ["shape:a"] }))
    expect(overlay.getIndicators()[0]!.color).toBe(SELECT_STROKE)
  })

  it("hovers only with a fine pointer, and only under the select tool", () => {
    const a = makeShape("shape:a")
    const fine = new ShapeIndicatorOverlayUtil(makeHost({ shapes: [a], hovered: "shape:a" }))
    expect(fine.getIndicators().map((i) => i.context)).toEqual(["hovered"])

    const coarse = new ShapeIndicatorOverlayUtil(makeHost({ shapes: [a], hovered: "shape:a", coarsePointer: true }))
    expect(coarse.getIndicators()).toEqual([])

    const drawing = new ShapeIndicatorOverlayUtil(makeHost({ shapes: [a], hovered: "shape:a", tool: "draw" }))
    expect(drawing.getIndicators()).toEqual([])
  })

  it("lets a lone selected shape suppress its own outline", () => {
    const a = makeShape("shape:a", "quiet")
    const utils = { quiet: { ...boxUtil, hideSelectionBoundsFg: () => true } }
    const alone = new ShapeIndicatorOverlayUtil(makeHost({ shapes: [a], utils, selected: ["shape:a"] }))
    expect(alone.getIndicators()).toEqual([])

    // With more than one selected there is no other cue, so it is drawn anyway.
    const b = makeShape("shape:b", "quiet")
    const many = new ShapeIndicatorOverlayUtil(makeHost({ shapes: [a, b], utils, selected: ["shape:a", "shape:b"] }))
    expect(many.getIndicators()).toHaveLength(2)
  })

  it("survives a util that throws, and keeps drawing the rest", () => {
    const a = makeShape("shape:a", "broken")
    const b = makeShape("shape:b")
    const utils = {
      broken: {
        getIndicatorPath: (): TLIndicatorPathResult => {
          throw new Error("boom")
        },
      },
    }
    const overlay = new ShapeIndicatorOverlayUtil(makeHost({ shapes: [a, b], utils, selected: ["shape:a", "shape:b"] }))
    expect(overlay.getIndicators().map((i) => i.shapeId)).toEqual(["shape:b"])
  })

  it("skips shapes a subclass hides", () => {
    class OnlySelected extends ShapeIndicatorOverlayUtil {
      override shouldShowIndicator(_shape: UnknownShape, context: string): boolean {
        return context === "selected"
      }
    }
    const a = makeShape("shape:a")
    const b = makeShape("shape:b")
    const overlay = new OnlySelected(makeHost({ shapes: [a, b], selected: ["shape:a"], hinting: ["shape:b"] }))
    expect(overlay.getIndicators().map((i) => i.shapeId)).toEqual(["shape:a"])
  })
})

describe("ShapeIndicatorOverlayUtil.configure", () => {
  it("returns a subclass with the new weights and nothing else changed", () => {
    const Heavy = ShapeIndicatorOverlayUtil.configure({ lineWidth: 3 })
    const a = makeShape("shape:a")
    const heavy = new Heavy(makeHost({ shapes: [a], selected: ["shape:a"] }))
    expect(heavy.getIndicators()[0]!.lineWidth).toBe(3)
    // The omitted key keeps its value...
    expect(heavy.options.hintedLineWidth).toBe(2.5)
    // ...and the base class is untouched.
    expect(ShapeIndicatorOverlayUtil.options.lineWidth).toBe(1.5)
  })

  it("layers when configured twice", () => {
    const both = ShapeIndicatorOverlayUtil.configure({ lineWidth: 3 }).configure({ hintedLineWidth: 9 })
    expect(both.options).toEqual({ lineWidth: 3, hintedLineWidth: 9 })
  })
})

describe("ShapeIndicatorOverlayUtil.render", () => {
  function render(opts: HostOptions, utils?: Record<string, IndicatorShapeUtil>): FakeCtx {
    const ctx = new FakeCtx()
    const overlay = new ShapeIndicatorOverlayUtil(makeHost({ ...opts, ...(utils ? { utils } : {}) }))
    overlay.render(ctx as unknown as CanvasRenderingContext2D)
    return ctx
  }

  it("keeps the stroke a constant width on screen at any zoom", () => {
    const a = makeShape("shape:a")
    for (const zoom of [0.1, 1, 8]) {
      const ctx = render({ shapes: [a], selected: ["shape:a"], zoom })
      // The context is scaled by the zoom, so the width has to be divided by it
      // for the result to land on screen as the same 1.5 CSS px hairline.
      expect(ctx.calls.some((c) => c.includes(`w=${1.5 / zoom}`)), `zoom ${zoom}`).toBe(true)
    }
  })

  it("applies the camera and then the shape's page transform", () => {
    const a = makeShape("shape:a")
    const ctx = render({ shapes: [a], selected: ["shape:a"], zoom: 2, camera: { x: 10, y: 20 } })
    expect(ctx.calls[1]).toBe("transform(2,0,0,2,20,40)")
    expect(ctx.calls[2]).toBe("transform(1,0,0,1,0,0)")
  })

  it("clips even-odd before stroking, and lifts the clip for the extra paths", () => {
    const outline = new Path2D() as unknown as FakePath2D
    outline.rect(0, 0, 100, 50)
    const hole = new Path2D() as unknown as FakePath2D
    hole.rect(0, 0, 100, 50)
    hole.rect(0, -20, 40, 20)
    const label = new Path2D() as unknown as FakePath2D
    label.rect(0, -20, 40, 20)

    const a = makeShape("shape:a", "framed")
    const utils = {
      framed: {
        getIndicatorPath: () => ({
          path: outline as unknown as Path2D,
          clipPath: hole as unknown as Path2D,
          additionalPaths: [label as unknown as Path2D],
        }),
      },
    }
    const ctx = render({ shapes: [a], selected: ["shape:a"] }, utils)

    const clipIndex = ctx.calls.findIndex((c) => c.startsWith("clip("))
    const outlineIndex = ctx.calls.findIndex((c) => c.startsWith(`stroke(${outline.ops.join("|")}`))
    const labelIndex = ctx.calls.findIndex((c) => c.startsWith(`stroke(${label.ops.join("|")}`))

    // The even-odd rule is what turns "outer rect + label rect" into a hole.
    expect(ctx.calls[clipIndex]).toContain(",evenodd")
    expect(clipIndex).toBeLessThan(outlineIndex)
    // The clip is restored between the outline and the extra paths, so the
    // label's own box is drawn in the hole the clip just punched.
    expect(ctx.calls.slice(outlineIndex, labelIndex)).toContain("restore")
    expect(ctx.balanced).toBe(true)
  })

  it("leaves the context balanced when nothing is drawn", () => {
    const ctx = render({ shapes: [] })
    expect(ctx.calls).toEqual([])
    expect(ctx.balanced).toBe(true)
  })

  it("scales a dash pattern by the zoom, like the width", () => {
    const dashed = new Path2D() as unknown as FakePath2D
    dashed.rect(0, 0, 5, 5)
    const a = makeShape("shape:a", "dashed")
    const utils = { dashed: { getIndicatorPath: () => ({ path: dashed as unknown as Path2D, lineDash: [4, 4] }) } }
    const ctx = render({ shapes: [a], selected: ["shape:a"], zoom: 2 }, utils)
    expect(ctx.calls).toContain("dash(2,2)")
  })
})
