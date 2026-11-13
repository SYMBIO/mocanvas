/**
 * What a pointer move costs on a big page, in work the editor does per event.
 *
 * Measured in `apps/bench` (`dom-overlay.mjs`) on 1,000 DOM cards, a drag step
 * spent ~10 ms in `getCurrentPageShapesSorted()`, reached three times per step:
 * hit-testing the pointer, the drop-target search, and the overlay's kept set.
 * It sorted each shape's children by filtering every shape on the page, so a
 * page of N shapes cost N² comparisons, and the hit test then asked every one
 * of those shapes for its bounds. These tests pin the cheaper shape of both
 * without changing a single answer.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { createStore, Editor, loadEngineSync, sortByIndex, type ParentId, type ShapeId, type UnknownShape } from "@mocanvas/editor"
import { defaultBindingUtils } from "../bindings"
import { defaultShapeUtils, type GeoShape } from "../shapes"
import { defaultTools } from "../tools"

const wasmPath = fileURLToPath(new URL("../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

function makeEditor(): Editor {
  const editor = new Editor({
    store: createStore(),
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: defaultTools,
    engine: loadEngineSync(readFileSync(wasmPath)),
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

/** The order the editor used to compute, one parent at a time, from scratch. */
function referenceSorted(editor: Editor): UnknownShape[] {
  const all = [...editor.store.query.records("shape").get()] as UnknownShape[]
  const out: UnknownShape[] = []
  const visit = (parentId: ParentId) => {
    for (const child of sortByIndex(all.filter((s) => s.parentId === parentId))) {
      out.push(child)
      visit(child.id)
    }
  }
  visit(editor.getCurrentPageId())
  return out
}

/** The hit test the editor used to run for `hitInside`: every shape on the page, topmost first. */
function referenceHitInside(editor: Editor, point: { x: number; y: number }, margin: number): UnknownShape | undefined {
  const candidates = referenceSorted(editor).filter((s) => editor.getShapePageBounds(s)?.containsPoint(point, margin))
  candidates.reverse()
  for (const shape of candidates) {
    const local = editor.getPointInShapeSpace(shape, point)
    if (editor.getShapeGeometry(shape).hitTestPoint(local, margin, true)) return shape
  }
  return undefined
}

function geo(editor: Editor, x: number, y: number, props: Partial<GeoShape["props"]> = {}, rest: Partial<GeoShape> = {}): ShapeId {
  editor.createShape<GeoShape>({ type: "geo", x, y, ...rest, props: { w: 80, h: 60, geo: "rectangle", fill: "solid", ...props } } as never)
  return editor.getCurrentPageShapes().at(-1)!.id
}

/**
 * A page with what makes hit testing interesting: a grid of filled cards, a
 * large hollow shape behind them, a rotated one, a locked one, a frame with
 * children, a group, and a stack whose order has been changed after creation.
 */
function buildPage(editor: Editor): void {
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) geo(editor, i * 100, j * 80)
  const hollow = geo(editor, -200, -200, { w: 1600, h: 1400, fill: "none" })
  editor.sendToBack([hollow])
  geo(editor, 300, 300, { w: 200, h: 40 }, { rotation: 0.6 })
  geo(editor, 520, 520, {}, { isLocked: true })
  editor.createShape({ type: "frame", x: 1300, y: 0, props: { w: 400, h: 400 } } as never)
  const frame = editor.getCurrentPageShapes().at(-1)!.id
  const inFrame = [geo(editor, 1320, 20), geo(editor, 1360, 40, { fill: "none" })]
  editor.reparentShapes(inFrame, frame)
  const grouped = [geo(editor, 1300, 500), geo(editor, 1420, 540)]
  editor.groupShapes(grouped)
  const stack = [geo(editor, 1500, 700), geo(editor, 1520, 710), geo(editor, 1540, 720)]
  editor.bringToFront([stack[0]!])
  editor.sendBackward([stack[2]!])
}

describe("the page's draw order", () => {
  it("is the per-parent order, on a page with frames, groups and reordered stacks", () => {
    const editor = makeEditor()
    buildPage(editor)
    expect(editor.getCurrentPageShapesSorted().map((s) => s.id)).toEqual(referenceSorted(editor).map((s) => s.id))

    // And stays so after the edits a drag makes: moves, reorders, reparenting.
    const [first, second] = editor.getCurrentPageShapesSorted()
    editor.updateShapes([{ id: first!.id, type: first!.type, x: first!.x + 13 }])
    editor.bringToFront([second!.id])
    const frame = editor.getCurrentPageShapes().find((s) => s.type === "frame")!
    editor.reparentShapes([first!.id], frame.id)
    expect(editor.getCurrentPageShapesSorted().map((s) => s.id)).toEqual(referenceSorted(editor).map((s) => s.id))
  })

  it("is not re-sorted one parent at a time on every call", () => {
    // Each per-parent call filtered every shape on the page: N + 1 passes over
    // N shapes for one answer. The order is now kept per parent, built once per
    // change to the page, and the walk below reads it.
    const editor = makeEditor()
    buildPage(editor)
    editor.getCurrentPageShapesSorted()
    const perParent = vi.spyOn(editor, "getSortedChildIdsForParent")
    editor.getCurrentPageShapesSorted()
    expect(perParent).not.toHaveBeenCalled()
  })

  it("hands out arrays a caller may change without corrupting the next answer", () => {
    const editor = makeEditor()
    buildPage(editor)
    const sorted = editor.getCurrentPageShapesSorted()
    const count = sorted.length
    sorted.reverse().pop()
    expect(editor.getCurrentPageShapesSorted()).toHaveLength(count)

    const pageId = editor.getCurrentPageId()
    const children = editor.getSortedChildIdsForParent(pageId)
    const before = [...children]
    children.length = 0
    expect(editor.getSortedChildIdsForParent(pageId)).toEqual(before)
  })
})

describe("hit testing with hitInside", () => {
  it("answers what the scan of the whole page answered, everywhere on it", () => {
    const editor = makeEditor()
    buildPage(editor)
    const margin = 4
    let checked = 0
    for (let x = -250; x <= 1800; x += 37) {
      for (let y = -250; y <= 1300; y += 29) {
        const point = { x, y }
        expect(editor.getShapeAtPoint(point, { hitInside: true, margin })?.id, `at ${x},${y}`).toBe(referenceHitInside(editor, point, margin)?.id)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(2000)
  })

  it("asks only the shapes near the point, not every shape on the page", () => {
    const editor = makeEditor()
    buildPage(editor)
    const pageBounds = vi.spyOn(editor, "getShapePageBounds")
    const hit = editor.getShapeAtPoint({ x: 440, y: 330 }, { hitInside: true, margin: 4 })
    expect(hit).toBeDefined()
    // The card under the point, the hollow shape behind everything, and
    // whatever overlaps them — never the 150-odd shapes elsewhere on the page.
    expect(pageBounds.mock.calls.length).toBeLessThan(10)
  })

  it("still reaches the middle of a large hollow shape", () => {
    const editor = makeEditor()
    const ring = geo(editor, 0, 0, { w: 2000, h: 2000, fill: "none" })
    for (let i = 0; i < 50; i++) geo(editor, 3000 + i * 100, 0)
    expect(editor.getShapeAtPoint({ x: 1000, y: 1000 }, { hitInside: true })?.id).toBe(ring)
    expect(editor.getShapeAtPoint({ x: 1000, y: 1000 })).toBeUndefined()
  })
})

describe("hovering with the select tool", () => {
  it("does not rewrite the instance record on every pointer move", () => {
    // Idle set the cursor on every move by writing a new cursor object, and a
    // new instance record re-ran everything that reads it: a React commit per
    // pointer move on a board where nothing visible changed.
    const editor = makeEditor()
    const card = geo(editor, 100, 100, { w: 300, h: 200 })
    editor.setCurrentTool("select")
    const before = editor.getInstanceState()
    for (let i = 0; i < 10; i++) {
      editor.dispatch({
        type: "pointer",
        name: "pointer_move",
        point: { x: 150 + i * 10, y: 150 },
        pointerId: 1,
        button: 0,
        isPen: false,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        accelKey: false,
        target: "shape",
        shape: editor.getShape(card)!,
      } as never)
    }
    expect(editor.getHoveredShapeId()).toBe(card)
    expect(editor.getInstanceState()).toBe(before)
  })
})
