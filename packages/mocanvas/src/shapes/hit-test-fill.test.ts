import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { createStore, Editor, loadEngineSync, StateNode } from "@mocanvas/editor"
import { defaultShapeUtils } from "./index"

/**
 * Clicking the middle of a filled shape.
 *
 * `hitTestPoint` asked only whether the CALLER wanted the interior, never
 * whether the shape was filled, so a solid rectangle answered only on its
 * outline. Nothing failed and nothing warned — every feature built on hit
 * testing just returned nothing, which reads as several unrelated bugs.
 *
 * Both paths are covered on purpose: `getShapeAtPoint` with no filter goes
 * through the wasm engine, and everything else goes through `Geometry2d`. The
 * engine knew about fill all along; the editor was telling it not to look.
 */

const wasmPath = fileURLToPath(new URL("../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))
class TestTool extends StateNode {
  static override id = "test"
}

let editors: Editor[] = []
afterEach(() => {
  for (const e of editors) e.dispose()
  editors = []
})

/** One 100×100 rectangle at the origin, with the given fill. */
function withRect(fill: string) {
  const editor = new Editor({
    store: createStore({ shapeUtils: defaultShapeUtils }),
    shapeUtils: defaultShapeUtils,
    tools: [TestTool],
    engine: loadEngineSync(readFileSync(wasmPath)),
    getContainer: () => ({}) as HTMLElement,
  })
  editors.push(editor)
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  editor.createShapes([
    { id: "shape:box", type: "geo", x: 0, y: 0, props: { geo: "rectangle", w: 100, h: 100, fill } },
  ] as never)
  return editor
}

/** One unfilled 240×160 shape of the given geo type at the origin. */
function withGeo(geo: string) {
  const editor = new Editor({
    store: createStore({ shapeUtils: defaultShapeUtils }),
    shapeUtils: defaultShapeUtils,
    tools: [TestTool],
    engine: loadEngineSync(readFileSync(wasmPath)),
    getContainer: () => ({}) as HTMLElement,
  })
  editors.push(editor)
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  editor.createShapes([
    { id: "shape:s", type: "geo", x: 0, y: 0, props: { geo, w: 240, h: 160, fill: "none" } },
  ] as never)
  return editor
}

const CENTRE = { x: 50, y: 50 }
const ON_OUTLINE = { x: 0, y: 50 }

describe.each(["solid", "semi", "pattern"])("a %s-filled shape", (fill) => {
  it("is hit by a click in the middle, through the engine", () => {
    const editor = withRect(fill)
    expect(editor.getShapeGeometry("shape:box" as never).isFilled).toBe(true)
    expect(editor.getShapeAtPoint(CENTRE)?.id).toBe("shape:box")
  })

  it("is hit by a click in the middle, through the geometry", () => {
    const editor = withRect(fill)
    // A filter forces the geometry path; the answer must be the same.
    expect(editor.getShapeAtPoint(CENTRE, { filter: () => true })?.id).toBe("shape:box")
    expect(editor.getShapesAtPoint(CENTRE).map((s) => s.id)).toEqual(["shape:box"])
  })

  it("is still hit on its outline", () => {
    expect(withRect(fill).getShapeAtPoint(ON_OUTLINE)?.id).toBe("shape:box")
  })
})

describe("an unfilled shape", () => {
  it("is NOT hit in the middle — it is a frame around what is behind it", () => {
    const editor = withRect("none")
    expect(editor.getShapeGeometry("shape:box" as never).isFilled).toBe(false)
    expect(editor.getShapeAtPoint(CENTRE)).toBeUndefined()
    expect(editor.getShapesAtPoint(CENTRE)).toEqual([])
  })

  it("is hit in the middle when the caller explicitly asks", () => {
    // That is all `hitInside` ever meant: reach the interior of a HOLLOW shape.
    const editor = withRect("none")
    expect(editor.getShapeAtPoint(CENTRE, { hitInside: true })?.id).toBe("shape:box")
  })

  it("is still hit on its outline", () => {
    expect(withRect("none").getShapeAtPoint(ON_OUTLINE)?.id).toBe("shape:box")
  })
})

describe("the two paths agree", () => {
  it("for every fill, with and without hitInside", () => {
    for (const fill of ["solid", "semi", "pattern", "none"]) {
      for (const hitInside of [false, true]) {
        const editor = withRect(fill)
        const viaEngine = editor.getShapeAtPoint(CENTRE, { hitInside })?.id ?? null
        const viaGeometry = editor.getShapeAtPoint(CENTRE, { hitInside, filter: () => true })?.id ?? null
        expect(viaEngine, `fill=${fill} hitInside=${hitInside}`).toBe(viaGeometry)
      }
    }
  })
})

/**
 * A point exactly on the outline, at margin 0.
 *
 * `hitInside: false` goes to the engine and `hitInside: true` goes to the
 * geometry, and the two answered differently: the nearest point on a curved or
 * diagonal outline comes back about 1e-15 away, so `distance <= 0` was false
 * for a point sitting on the shape. `hitInside: true` is meant to be a superset
 * of `hitInside: false`, never a smaller set.
 */
describe("a point exactly on the outline", () => {
  it.each(["ellipse", "hexagon", "octagon", "oval", "rectangle"])("hits %s either way", (geo) => {
    const editor = withGeo(geo)
    const left = { x: 0, y: 80 }
    expect(editor.getShapeAtPoint(left, { margin: 0, hitInside: false })?.id, "hitInside: false").toBe("shape:s")
    expect(editor.getShapeAtPoint(left, { margin: 0, hitInside: true })?.id, "hitInside: true").toBe("shape:s")
  })
})
