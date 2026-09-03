import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it } from "vitest"
import {
  createStore,
  Editor,
  loadEngineSync,
  StateNode,
  Vec,
  type ShapeHandle,
  type ShapeId,
} from "@mocanvas/editor"
import { defaultShapeUtils, type ArrowShape, type ArrowShapeUtil, type GeoShape } from "../shapes"
import { ArrowBindingUtil, defaultBindingUtils, type ArrowBinding } from "./index"
import { applyTransform, getArrowTerminalsInArrowSpace, intersectSegments } from "./arrow-terminals"

const wasmPath = fileURLToPath(new URL("../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

class TestTool extends StateNode {
  static override id = "test"
}

function makeEditor(): Editor {
  const engine = loadEngineSync(readFileSync(wasmPath))
  const editor = new Editor({
    store: createStore(),
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: [TestTool],
    engine,
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

function lastShapeId(editor: Editor): ShapeId {
  return editor.getCurrentPageShapes().at(-1)!.id
}

function createGeo(editor: Editor, partial: { x: number; y: number; w?: number; h?: number; geo?: GeoShape["props"]["geo"]; rotation?: number }): GeoShape {
  editor.createShape<GeoShape>({
    type: "geo",
    x: partial.x,
    y: partial.y,
    ...(partial.rotation !== undefined ? { rotation: partial.rotation } : {}),
    props: { w: partial.w ?? 100, h: partial.h ?? 100, geo: partial.geo ?? "rectangle" },
  })
  return editor.getShape<GeoShape>(lastShapeId(editor))!
}

function createArrow(editor: Editor, partial: { x?: number; y?: number; rotation?: number; start: Vec; end: Vec; bend?: number }): ArrowShape {
  editor.createShape<ArrowShape>({
    type: "arrow",
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    ...(partial.rotation !== undefined ? { rotation: partial.rotation } : {}),
    props: { start: partial.start.toJson(), end: partial.end.toJson(), bend: partial.bend ?? 0 },
  })
  return editor.getShape<ArrowShape>(lastShapeId(editor))!
}

function bind(editor: Editor, arrow: ArrowShape, target: GeoShape, props: Partial<ArrowBinding["props"]> = {}): ArrowBinding {
  editor.createBinding<ArrowBinding>({ type: "arrow", fromId: arrow.id, toId: target.id, props: { terminal: "end", ...props } })
  return editor.getBindingsFromShape<ArrowBinding>(arrow, "arrow").at(-1)!
}

function arrowBindings(editor: Editor, arrow: ArrowShape | ShapeId): ArrowBinding[] {
  return editor.getBindingsFromShape<ArrowBinding>(arrow, "arrow")
}

/** Distance from an arrow-local point to the target shape's flattened outline. */
function distanceToOutline(editor: Editor, arrow: ArrowShape, target: GeoShape, arrowLocal: Vec): number {
  const page = applyTransform(editor.getShapePageTransform(arrow), arrowLocal)
  const local = editor.getPointInShapeSpace(target, page)
  return editor.getShapeGeometry(target).distanceToPoint(local)
}

function dragHandle(editor: Editor, arrowId: ShapeId, id: "start" | "end" | "bend", x: number, y: number, isPrecise = false): ArrowShape {
  const arrow = editor.getShape<ArrowShape>(arrowId)!
  const util = editor.getShapeUtil<ArrowShape>(arrow) as ArrowShapeUtil
  const handle: ShapeHandle = { id, type: id === "bend" ? "virtual" : "vertex", index: "a1", x, y }
  const change = util.onHandleDrag(arrow, { handle, isPrecise, initial: arrow })
  if (change) editor.updateShape<ArrowShape>({ id: arrow.id, type: "arrow", ...change })
  return editor.getShape<ArrowShape>(arrowId)!
}

describe("ArrowBindingUtil", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("is registered as the arrow binding util with sensible defaults", () => {
    const util = editor.getBindingUtil<ArrowBinding>("arrow")
    expect(util).toBeInstanceOf(ArrowBindingUtil)
    expect(util.getDefaultProps()).toEqual({ terminal: "end", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false })
    expect(defaultBindingUtils).toEqual([ArrowBindingUtil])
  })

  it("resolves a bound terminal on the target outline and follows the target when it moves", () => {
    const geo = createGeo(editor, { x: 300, y: 0 })
    const arrow = createArrow(editor, { start: new Vec(0, 50), end: new Vec(350, 50) })
    bind(editor, arrow, geo)

    let terminals = getArrowTerminalsInArrowSpace(editor, editor.getShape<ArrowShape>(arrow.id)!)
    expect(terminals.start.toJson()).toEqual({ x: 0, y: 50 })
    // Anchor is the geo center (350, 50); the arrow enters through the left edge at x=300.
    expect(terminals.end.x).toBeCloseTo(300, 6)
    expect(terminals.end.y).toBeCloseTo(50, 6)

    editor.updateShape<GeoShape>({ id: geo.id, type: "geo", x: 500, y: 100 })

    const moved = editor.getShape<ArrowShape>(arrow.id)!
    terminals = getArrowTerminalsInArrowSpace(editor, moved)
    // Ray from (0,50) toward the new center (550,150) meets the left edge x=500 at y=140.9...
    expect(terminals.end.x).toBeCloseTo(500, 6)
    expect(terminals.end.y).toBeCloseTo(50 + (100 / 550) * 500, 6)
    // The arrow record itself was refreshed so the engine re-derives its geometry.
    expect(moved.props.end.x).toBeCloseTo(500, 6)
    expect(editor.getShapeGeometry(moved).bounds.maxX).toBeCloseTo(500, 6)
    expect(arrowBindings(editor, arrow)).toHaveLength(1)
  })

  it("places an exact terminal on the anchor itself", () => {
    const geo = createGeo(editor, { x: 300, y: 0 })
    const arrow = createArrow(editor, { start: new Vec(0, 50), end: new Vec(350, 50) })
    bind(editor, arrow, geo, { isExact: true, normalizedAnchor: { x: 0.25, y: 0.75 } })
    const { end } = getArrowTerminalsInArrowSpace(editor, editor.getShape<ArrowShape>(arrow.id)!)
    expect(end.toJson()).toEqual({ x: 325, y: 75 })
  })

  it("freezes the terminal and removes the binding when the target is deleted", () => {
    const geo = createGeo(editor, { x: 300, y: 0 })
    const arrow = createArrow(editor, { start: new Vec(0, 50), end: new Vec(350, 50) })
    bind(editor, arrow, geo)
    editor.updateShape<GeoShape>({ id: geo.id, type: "geo", x: 600 })

    editor.deleteShape(geo.id)

    expect(editor.getShape(geo.id)).toBeUndefined()
    expect(arrowBindings(editor, arrow)).toHaveLength(0)
    const after = editor.getShape<ArrowShape>(arrow.id)!
    expect(after.props.end.x).toBeCloseTo(600, 6)
    expect(after.props.end.y).toBeCloseTo(50, 6)
    expect(getArrowTerminalsInArrowSpace(editor, after).end.toJson()).toEqual(after.props.end)
  })

  it("binds a dragged terminal handle to the shape under it and unbinds when dragged away", () => {
    const geo = createGeo(editor, { x: 300, y: 0 })
    const arrow = createArrow(editor, { start: new Vec(0, 50), end: new Vec(200, 50) })
    expect(arrowBindings(editor, arrow)).toHaveLength(0)

    // Drag the end handle over the geo (imprecise → centered anchor).
    let current = dragHandle(editor, arrow.id, "end", 330, 70)
    let bindings = arrowBindings(editor, arrow)
    expect(bindings).toHaveLength(1)
    expect(bindings[0]!.toId).toBe(geo.id)
    expect(bindings[0]!.props).toEqual({ terminal: "end", normalizedAnchor: { x: 0.5, y: 0.5 }, isPrecise: false, isExact: false })
    // The static fallback tracks the handle.
    expect(current.props.end).toEqual({ x: 330, y: 70 })
    // While bound the geometry ends on the geo outline, not at the raw handle.
    expect(getArrowTerminalsInArrowSpace(editor, current).end.x).toBeCloseTo(300, 6)

    // A precise drag records the exact anchor and updates the same binding.
    current = dragHandle(editor, arrow.id, "end", 320, 30, true)
    bindings = arrowBindings(editor, arrow)
    expect(bindings).toHaveLength(1)
    expect(bindings[0]!.props.isPrecise).toBe(true)
    expect(bindings[0]!.props.normalizedAnchor.x).toBeCloseTo(0.2, 6)
    expect(bindings[0]!.props.normalizedAnchor.y).toBeCloseTo(0.3, 6)

    // Dragging onto empty canvas removes the binding and leaves a static point.
    current = dragHandle(editor, arrow.id, "end", 800, 50)
    expect(arrowBindings(editor, arrow)).toHaveLength(0)
    expect(current.props.end).toEqual({ x: 800, y: 50 })
    expect(getArrowTerminalsInArrowSpace(editor, current).end.toJson()).toEqual({ x: 800, y: 50 })
  })

  it("rebinds to a different shape and never binds to another arrow", () => {
    const a = createGeo(editor, { x: 300, y: 0 })
    const b = createGeo(editor, { x: 600, y: 0 })
    const other = createArrow(editor, { x: 0, y: 300, start: new Vec(0, 0), end: new Vec(200, 0) })
    const arrow = createArrow(editor, { start: new Vec(0, 50), end: new Vec(200, 50) })

    dragHandle(editor, arrow.id, "end", 350, 50)
    expect(arrowBindings(editor, arrow)[0]!.toId).toBe(a.id)
    dragHandle(editor, arrow.id, "end", 650, 50)
    const bindings = arrowBindings(editor, arrow)
    expect(bindings).toHaveLength(1)
    expect(bindings[0]!.toId).toBe(b.id)

    // Over the other arrow's body: no binding is created.
    dragHandle(editor, arrow.id, "end", 100, 300)
    expect(arrowBindings(editor, arrow)).toHaveLength(0)
    expect(editor.getShape(other.id)).toBeDefined()
  })

  it("keeps both terminals bound independently", () => {
    const a = createGeo(editor, { x: 0, y: 0 })
    const b = createGeo(editor, { x: 400, y: 0 })
    const arrow = createArrow(editor, { x: 0, y: 0, start: new Vec(50, 50), end: new Vec(450, 50) })
    dragHandle(editor, arrow.id, "start", 50, 50)
    dragHandle(editor, arrow.id, "end", 450, 50)
    const bindings = arrowBindings(editor, arrow)
    expect(bindings.map((x) => x.props.terminal).sort()).toEqual(["end", "start"])
    const { start, end } = getArrowTerminalsInArrowSpace(editor, editor.getShape<ArrowShape>(arrow.id)!)
    expect(start.x).toBeCloseTo(100, 6)
    expect(end.x).toBeCloseTo(400, 6)
    expect(distanceToOutline(editor, arrow, a, start)).toBeLessThan(1)
    expect(distanceToOutline(editor, arrow, b, end)).toBeLessThan(1)
  })

  it("puts a non-exact terminal on the target outline for rotated and curved targets", () => {
    const ellipse = createGeo(editor, { x: 300, y: 100, w: 120, h: 80, geo: "ellipse", rotation: Math.PI / 5 })
    const arrow = createArrow(editor, { x: 20, y: 10, rotation: Math.PI / 7, start: new Vec(0, 0), end: new Vec(300, 100) })
    bind(editor, arrow, ellipse)
    const shape = editor.getShape<ArrowShape>(arrow.id)!
    const { end } = getArrowTerminalsInArrowSpace(editor, shape)
    expect(distanceToOutline(editor, shape, ellipse, end)).toBeLessThan(1)

    // The bent body approaches from a different angle but still lands on the outline.
    editor.updateShape<ArrowShape>({ id: arrow.id, type: "arrow", props: { bend: 60 } })
    const bent = editor.getShape<ArrowShape>(arrow.id)!
    const bentEnd = getArrowTerminalsInArrowSpace(editor, bent).end
    expect(distanceToOutline(editor, bent, ellipse, bentEnd)).toBeLessThan(1)
    expect(Vec.Dist(bentEnd, end)).toBeGreaterThan(1)
  })

  it("falls back to the anchor when the body never crosses the outline", () => {
    const geo = createGeo(editor, { x: 0, y: 0, w: 400, h: 400 })
    // Both terminals inside the shape: nothing to intersect.
    const arrow = createArrow(editor, { start: new Vec(50, 50), end: new Vec(100, 100) })
    bind(editor, arrow, geo)
    const { end } = getArrowTerminalsInArrowSpace(editor, editor.getShape<ArrowShape>(arrow.id)!)
    expect(end.toJson()).toEqual({ x: 200, y: 200 })
  })

  it("exposes handles at the resolved terminals", () => {
    const geo = createGeo(editor, { x: 300, y: 0 })
    const arrow = createArrow(editor, { start: new Vec(0, 50), end: new Vec(350, 50) })
    bind(editor, arrow, geo)
    const shape = editor.getShape<ArrowShape>(arrow.id)!
    const util = editor.getShapeUtil<ArrowShape>(shape) as ArrowShapeUtil
    const handles = util.getHandles(shape)
    expect(handles.map((h) => h.id)).toEqual(["start", "bend", "end"])
    expect(handles[2]!.x).toBeCloseTo(300, 6)
    expect(handles[1]!.x).toBeCloseTo(150, 6)
    expect(util.canBind({ fromShapeType: "arrow", toShapeType: "arrow", bindingType: "arrow" })).toBe(false)
    expect(util.hideSelectionBoundsBg(shape)).toBe(true)
    expect(util.hideSelectionBoundsFg(shape)).toBe(true)
    expect(util.hideResizeHandles(shape)).toBe(true)
  })

  it("drops bindings to unselected shapes when the arrow starts moving on its own", () => {
    const geo = createGeo(editor, { x: 300, y: 0 })
    const arrow = createArrow(editor, { start: new Vec(0, 50), end: new Vec(350, 50) })
    bind(editor, arrow, geo)
    const util = editor.getShapeUtil<ArrowShape>("arrow") as ArrowShapeUtil

    editor.select(arrow.id)
    util.onTranslateStart(editor.getShape<ArrowShape>(arrow.id)!)
    expect(arrowBindings(editor, arrow)).toHaveLength(0)
    const frozen = editor.getShape<ArrowShape>(arrow.id)!
    expect(frozen.props.end.x).toBeCloseTo(300, 6)
    expect(frozen.props.end.y).toBeCloseTo(50, 6)

    // Moving the arrow together with its target keeps the binding.
    bind(editor, arrow, geo)
    editor.select(arrow.id, geo.id)
    util.onTranslateStart(editor.getShape<ArrowShape>(arrow.id)!)
    expect(arrowBindings(editor, arrow)).toHaveLength(1)
  })

  it("deleting a binding with isolateShapes freezes the terminal once", () => {
    const geo = createGeo(editor, { x: 300, y: 0 })
    const arrow = createArrow(editor, { start: new Vec(0, 50), end: new Vec(350, 50) })
    const binding = bind(editor, arrow, geo)
    editor.deleteBinding(binding.id, { isolateShapes: true })
    const after = editor.getShape<ArrowShape>(arrow.id)!
    expect(after.props.end.x).toBeCloseTo(300, 6)
    expect(arrowBindings(editor, arrow)).toHaveLength(0)
  })

  it("deleting the arrow removes its bindings", () => {
    const geo = createGeo(editor, { x: 300, y: 0 })
    const arrow = createArrow(editor, { start: new Vec(0, 50), end: new Vec(350, 50) })
    bind(editor, arrow, geo)
    editor.deleteShape(arrow.id)
    expect(editor.getBindingsToShape(geo.id)).toHaveLength(0)
    expect(editor.getShape(geo.id)).toBeDefined()
  })
})

describe("intersectSegments", () => {
  it("finds crossings and rejects parallel or disjoint segments", () => {
    expect(intersectSegments({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })!.toJson()).toEqual({ x: 5, y: 5 })
    expect(intersectSegments({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBeNull()
    expect(intersectSegments({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 5, y: 0 }, { x: 5, y: 10 })).toBeNull()
    expect(intersectSegments({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: -5 }, { x: 10, y: 5 })!.toJson()).toEqual({ x: 10, y: 0 })
  })
})
