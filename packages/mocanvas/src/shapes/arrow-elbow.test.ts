/**
 * Arrow shape util: the elbow routing kind, and proof that `kind: "arc"` still
 * draws exactly what it drew before elbows existed.
 *
 * Node-only: nothing here renders, so no `component()` is called.
 */
import { describe, expect, it } from "vitest"
import {
  createShapeId,
  Group2d,
  PATH_OP,
  Polyline2d,
  Rectangle2d,
  Vec,
  type Editor,
  type Geometry2d,
  type PageId,
  type ShapeId,
  type UnknownShape,
} from "@mocanvas/editor"
import type { IndexKey } from "@mocanvas/store"
import { ArrowShapeUtil, type ArrowShape, type ArrowShapeProps } from "./ArrowShapeUtil"

const ARROW_ID = createShapeId("arrow")
const TARGET_ID = createShapeId("target")

interface Target {
  geometry: Geometry2d
  terminal: "start" | "end"
}

/**
 * An editor stub with identity transforms, optionally holding one shape the
 * arrow is bound to.
 */
function makeEditor(target?: Target): Editor {
  const targetShape = { id: TARGET_ID, type: "geo" } as unknown as UnknownShape
  return {
    getSortedChildIdsForParent: () => [],
    getEditingShapeId: () => null,
    getBindingsFromShape: () =>
      target
        ? [{ id: "binding:b", type: "arrow", fromId: ARROW_ID, toId: TARGET_ID, props: { terminal: target.terminal, normalizedAnchor: { x: 0.5, y: 0.5 }, isPrecise: false, isExact: false } }]
        : [],
    getShape: (id: ShapeId) => (target && id === TARGET_ID ? targetShape : undefined),
    getShapeGeometry: () => target?.geometry,
    getShapePageTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getPointInShapeSpace: (_shape: UnknownShape, p: Vec) => Vec.From(p),
    getCurrentPageShapesSorted: () => [],
    getShapeParent: () => undefined,
    options: { hitTestMargin: 8 },
    getZoomLevel: () => 1,
    inputs: { ctrlKey: false },
  } as unknown as Editor
}

function makeArrow(props: Partial<ArrowShapeProps>): ArrowShape {
  const util = new ArrowShapeUtil(makeEditor())
  return {
    id: ARROW_ID,
    typeName: "shape",
    type: "arrow",
    x: 0,
    y: 0,
    rotation: 0,
    index: "a1" as IndexKey,
    parentId: "page:page" as PageId,
    isLocked: false,
    opacity: 1,
    props: { ...util.getDefaultProps(), ...props },
    meta: {},
  } as ArrowShape
}

function bodyOf(geometry: Geometry2d): Polyline2d {
  const body = (geometry as Group2d).children[0]!
  expect(body).toBeInstanceOf(Polyline2d)
  return body as Polyline2d
}

/**
 * Direction a chevron arrowhead points, recovered from its geometry: the tip
 * is the middle vertex, the two wings straddle the base.
 */
function headDirection(head: Geometry2d): Vec {
  const [a, tip, b] = (head as Polyline2d).points as [Vec, Vec, Vec]
  return Vec.Uni(Vec.Sub(tip, Vec.Lrp(a, b, 0.5)))
}

const ARG_COUNT: Record<number, number> = {
  [PATH_OP.MOVE]: 2,
  [PATH_OP.LINE]: 2,
  [PATH_OP.QUAD]: 4,
  [PATH_OP.CUBIC]: 6,
  [PATH_OP.CLOSE]: 0,
}

function expectWellFormedPath(words: number[]): void {
  let i = 0
  let subpathOpen = false
  while (i < words.length) {
    const op = words[i]!
    expect(Number.isInteger(op)).toBe(true)
    expect(op in ARG_COUNT).toBe(true)
    if (op !== PATH_OP.MOVE) expect(subpathOpen).toBe(true)
    if (op === PATH_OP.MOVE) subpathOpen = true
    if (op === PATH_OP.CLOSE) subpathOpen = false
    const n = ARG_COUNT[op]!
    for (let k = 1; k <= n; k++) expect(Number.isFinite(words[i + k])).toBe(true)
    i += 1 + n
  }
  expect(i).toBe(words.length)
}

describe("arc arrows are untouched by elbow support", () => {
  /**
   * Captured from `getGeometry(...).toPathWords()` on the revision before
   * `props.kind` existed. Arc arrows must serialize to exactly these numbers.
   */
  const BEFORE: Record<string, { props: Partial<ArrowShapeProps>; words: number[] }> = {
    straight: {
      props: { end: { x: 200, y: 0 } },
      words: [0, 0, 0, 1, 200, 0, 0, 186, 8.08290376865476, 1, 200, 0, 1, 186, -8.08290376865476],
    },
    bent: {
      props: { end: { x: 200, y: 0 }, bend: 40, arrowheadEnd: "none" },
      words: [
        0, 1.4210854715202004e-14, 0, 3, 26.9615364994153, 25.677653808966937, 62.76740197699795, 40, 100.00000000000001, 40, 3, 137.23259802300208,
        40, 173.03846350058473, 25.677653808966927, 200, -1.4210854715202004e-14,
      ],
    },
    heads: {
      props: { end: { x: 140, y: -90 }, bend: -25, arrowheadStart: "triangle", arrowheadEnd: "dot", size: "l", scale: 2 },
      words: [
        0, 20.78597322649314, -34.03834396676983, 3, 30.905118957870016, -46.534567396578005, 42.955268405225254, -57.334310005311316,
        56.48106021716252, -66.02946188441385, 3, 70.00685202909979, -74.72461376351637, 84.8346582523729, -81.20355694304413, 100.40415306616352,
        -85.2214595779865, 0, 0, 0, 1, -4.970610622685282, -45.91978183061176, 1, 37.28239229020623, -27.26456598687212, 4, 0, 140.00152478179527,
        -90.24695940324492, 3, 140.00152478179527, -79.20126440662905, 131.04721977841115, -70.24695940324492, 120.00152478179527,
        -70.24695940324492, 3, 108.9558297851794, -70.24695940324492, 100.00152478179527, -79.20126440662905, 100.00152478179527, -90.24695940324492,
        3, 100.00152478179527, -101.29265439986078, 108.9558297851794, -110.24695940324492, 120.00152478179527, -110.24695940324492, 3,
        131.04721977841115, -110.24695940324492, 140.00152478179527, -101.29265439986078, 140.00152478179527, -90.24695940324492, 4,
      ],
    },
    labelled: {
      props: { end: { x: 200, y: 0 }, bend: 12, text: "go" },
      words: [
        0, -5.684341886080802e-14, 0, 3, 32.73590530413606, 7.971405512370811, 66.3075260343794, 12.000000000000002, 100.00000000000003, 12, 3,
        133.69247396562065, 11.999999999999998, 167.264094695864, 7.971405512370816, 200.0000000000001, 0, 0, 188.3098352764956, 11.165723535475287,
        1, 200, 0, 1, 184.4851174048924, -4.541117857241847,
      ],
    },
  }

  const util = new ArrowShapeUtil(makeEditor())

  it.each(Object.keys(BEFORE))("%s serializes to the same path words as before", (name) => {
    const shape = makeArrow(BEFORE[name]!.props)
    expect(util.getGeometry(shape).toPathWords()).toEqual(BEFORE[name]!.words)
  })

  it("defaults to the arc kind, so a document without `kind` is unaffected", () => {
    expect(util.getDefaultProps().kind).toBe("arc")
    expect(util.getDefaultProps().elbowMidPoint).toBe(0.5)
    const noKind = makeArrow({ end: { x: 200, y: 0 }, bend: 40, arrowheadEnd: "none" })
    delete (noKind.props as unknown as Record<string, unknown>)["kind"]
    expect(util.getGeometry(noKind).toPathWords()).toEqual(BEFORE["bent"]!.words)
  })

  it("keeps the bend handle on an arc", () => {
    const shape = makeArrow({ end: { x: 200, y: 0 }, bend: 40 })
    expect(util.getHandles(shape).map((h) => h.id)).toEqual(["start", "bend", "end"])
  })
})

describe("elbow arrows", () => {
  const util = new ArrowShapeUtil(makeEditor())
  const elbow = (props: Partial<ArrowShapeProps>): ArrowShape => makeArrow({ kind: "elbow", ...props })

  it("draws an axis-aligned polyline body", () => {
    const shape = elbow({ end: { x: 200, y: 80 } })
    const geometry = util.getGeometry(shape)
    const words = geometry.toPathWords()
    expectWellFormedPath(words)
    // A polyline body: one MOVE then LINEs only, apart from the chevron head.
    expect(words[0]).toBe(PATH_OP.MOVE)
    const body = bodyOf(geometry)
    const radius = 3.5 * 2.5
    for (let i = 1; i < body.points.length; i++) {
      const a = body.points[i - 1]!
      const b = body.points[i]!
      const axisAligned = Math.abs(a.x - b.x) < 1e-9 || Math.abs(a.y - b.y) < 1e-9
      if (!axisAligned) expect(Vec.Dist(a, b)).toBeLessThanOrEqual(radius + 1e-9)
    }
    expect(body.points[0]).toEqual(new Vec(0, 0))
    // The body spans the terminals and stays inside their box.
    expect(body.bounds.w).toBeCloseTo(200)
    expect(body.bounds.h).toBeCloseTo(80)
  })

  it("moves the middle leg monotonically with elbowMidPoint", () => {
    const legX = (elbowMidPoint: number): number => {
      const handles = util.getHandles(elbow({ end: { x: 200, y: 80 }, elbowMidPoint }))
      return handles.find((h) => h.id === "midpoint")!.x
    }
    expect(legX(0.2)).toBeCloseTo(40)
    expect(legX(0.5)).toBeCloseTo(100)
    expect(legX(0.8)).toBeCloseTo(160)
    expect(legX(0.2)).toBeLessThan(legX(0.5))
    expect(legX(0.5)).toBeLessThan(legX(0.8))
  })

  it.each([
    ["right", { x: 200, y: 80 }, [1, 0]],
    ["left", { x: -200, y: 80 }, [-1, 0]],
    ["down", { x: 80, y: 200 }, [0, 1]],
    ["up", { x: 80, y: -200 }, [0, -1]],
  ] as const)("points its arrowhead along the last leg (%s)", (_name, end, expected) => {
    const geometry = util.getGeometry(elbow({ end })) as Group2d
    const dir = headDirection(geometry.children[1]!)
    expect(dir.x).toBeCloseTo(expected[0])
    expect(dir.y).toBeCloseTo(expected[1])
  })

  it("replaces the bend handle with a midpoint handle that writes elbowMidPoint", () => {
    const shape = elbow({ end: { x: 200, y: 80 } })
    const handles = util.getHandles(shape)
    expect(handles.map((h) => h.id)).toEqual(["start", "midpoint", "end"])
    const midpoint = handles[1]!
    expect(midpoint.type).toBe("virtual")
    expect(midpoint.x).toBeCloseTo(100)
    expect(midpoint.y).toBeCloseTo(40)
    const drag = (x: number, y: number) => util.onHandleDrag(shape, { handle: { ...midpoint, x, y }, isPrecise: false })
    expect(drag(40, 40)?.props?.elbowMidPoint).toBeCloseTo(0.2)
    expect(drag(-500, 40)?.props?.elbowMidPoint).toBe(0)
    expect(drag(9000, 40)?.props?.elbowMidPoint).toBe(1)
    // Terminals still bind and move exactly as they did.
    expect(util.onHandleDrag(shape, { handle: { ...handles[0]!, x: -5, y: 3 }, isPrecise: false })?.props?.start).toEqual({ x: -5, y: 3 })
    expect(util.onHandleDrag(shape, { handle: { ...handles[2]!, x: 250, y: 9 }, isPrecise: false })?.props?.end).toEqual({ x: 250, y: 9 })
  })

  it("has no midpoint handle when the route is a single straight run", () => {
    expect(util.getHandles(elbow({ end: { x: 200, y: 0 } })).map((h) => h.id)).toEqual(["start", "end"])
  })

  it("keeps the label on the body", () => {
    const geometry = util.getGeometry(elbow({ end: { x: 200, y: 80 }, text: "go" })) as Group2d
    const label = geometry.children.at(-1)!
    expect(label.isLabel).toBe(true)
    expect(label.center.x).toBeCloseTo(100)
    expect(label.center.y).toBeCloseTo(40)
  })
})

describe("a bound elbow arrow", () => {
  /** A 140 × 80 rectangle whose left edge faces an arrow coming from the origin. */
  const rightOfStart = new Rectangle2d({ x: 260, y: 0, width: 140, height: 80, isFilled: false })
  /** The same rectangle below the origin, so the nearest edge is its top one. */
  const belowStart = new Rectangle2d({ x: 0, y: 260, width: 80, height: 140, isFilled: false })

  it("leaves its target square-on through the nearest edge's normal", () => {
    const util = new ArrowShapeUtil(makeEditor({ geometry: rightOfStart, terminal: "end" }))
    const shape = makeArrow({ kind: "elbow", end: { x: 330, y: 40 } })
    const geometry = util.getGeometry(shape) as Group2d
    const body = bodyOf(geometry)
    const last = body.points.at(-1)!
    const previous = body.points.at(-2)!
    // The final leg runs horizontally into the rectangle's left edge.
    expect(last.y).toBeCloseTo(previous.y)
    expect(last.x).toBeGreaterThan(previous.x)
    // And it stops short of the edge by the terminal gap.
    expect(last.x).toBeLessThan(260)
    expect(headDirection(geometry.children[1]!).x).toBeCloseTo(1)
    expect(headDirection(geometry.children[1]!).y).toBeCloseTo(0)
  })

  it("uses the vertical normal when the nearest edge is horizontal", () => {
    const util = new ArrowShapeUtil(makeEditor({ geometry: belowStart, terminal: "end" }))
    const shape = makeArrow({ kind: "elbow", end: { x: 40, y: 330 } })
    const geometry = util.getGeometry(shape) as Group2d
    const body = bodyOf(geometry)
    const last = body.points.at(-1)!
    const previous = body.points.at(-2)!
    expect(last.x).toBeCloseTo(previous.x)
    expect(last.y).toBeGreaterThan(previous.y)
    expect(last.y).toBeLessThan(260)
    expect(headDirection(geometry.children[1]!).y).toBeCloseTo(1)
    expect(headDirection(geometry.children[1]!).x).toBeCloseTo(0)
  })
})
