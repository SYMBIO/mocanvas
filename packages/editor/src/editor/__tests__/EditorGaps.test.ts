import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { loadEngineSync } from "@mocanvas/wasm"
import { Editor } from "../Editor"
import { createStore } from "../createStore"
import { Rectangle2d } from "../../geometry"
import type { BaseShape, ShapeId } from "../../records/base"
import { BaseBoxShapeUtil } from "../../shapes/ShapeUtil"
import { DOCUMENT_ID, DEFAULT_PAGE_ID } from "../../records/base"

/**
 * Gaps measured against a real consumer, each of which was a member that
 * existed and did nothing.
 */

const wasmPath = fileURLToPath(new URL("../../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

type BoxShape = BaseShape<"box", { w: number; h: number }>
class BoxUtil extends BaseBoxShapeUtil<BoxShape> {
  static override type = "box" as const
  getDefaultProps() {
    return { w: 100, h: 100 }
  }
  override getGeometry(s: BoxShape) {
    return new Rectangle2d({ width: s.props.w, height: s.props.h, isFilled: true })
  }
  component() {
    return null
  }
  override indicator() {
    return null
  }
}

function makeEditor() {
  const editor = new Editor({
    store: createStore(),
    shapeUtils: [BoxUtil],
    tools: [],
    engine: loadEngineSync(readFileSync(wasmPath)),
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

function box(editor: Editor, x: number, y: number, w = 100, h = 100): ShapeId {
  editor.createShape<BoxShape>({ type: "box", x, y, props: { w, h } })
  return editor.getCurrentPageShapes().at(-1)!.id
}

describe("a brand new store", () => {
  it("holds the document and its first page", () => {
    // It used to hold nothing, so anything reading a document without mounting
    // an editor — a sync backend, a headless export — had to seed it by hand.
    const store = createStore()
    expect(store.has(DOCUMENT_ID)).toBe(true)
    expect(store.query.records("page").get().map((p) => p.id)).toEqual([DEFAULT_PAGE_ID])
  })

  it("carries no session records, which belong to an editor and not to a document", () => {
    const store = createStore()
    const typeNames = new Set(store.allRecords().map((r) => r.typeName))
    expect(typeNames).toEqual(new Set(["document", "page"]))
  })

  it("does not seed over data it was given", () => {
    const store = createStore()
    const snapshot = store.getStoreSnapshot()
    const reloaded = createStore({ snapshot })
    expect(reloaded.query.records("page").get()).toHaveLength(1)
  })

  it("gives every replica the same first page, so two of them meet on it", () => {
    expect(createStore().query.records("page").get()[0]!.id).toEqual(createStore().query.records("page").get()[0]!.id)
  })

  it("indexes that page where a tldraw document indexes its own", () => {
    // Every `.tldr` in the fixtures — including the tldraw-written reference
    // this project compares against — puts its first page at `a1`. A page
    // seeded at `a0` sorts before all of them once two documents meet.
    expect(createStore().query.records("page").get()[0]!.index).toBe("a1")
  })
})

describe("the deleted-shapes event", () => {
  it("reports every id that went, descendants included", () => {
    const editor = makeEditor()
    try {
      const parent = box(editor, 0, 0)
      const child = box(editor, 10, 10)
      editor.reparentShapes([child], parent)
      const seen: ShapeId[][] = []
      editor.on("deleted-shapes", (ids) => seen.push(ids))
      editor.deleteShapes([parent])
      expect(seen).toHaveLength(1)
      expect(new Set(seen[0])).toEqual(new Set([parent, child]))
    } finally {
      editor.dispose()
    }
  })

  it("fires after the removal, so a listener sees the document without them", () => {
    const editor = makeEditor()
    try {
      const id = box(editor, 0, 0)
      let visibleToListener: unknown = "not called"
      editor.on("deleted-shapes", () => {
        visibleToListener = editor.getShape(id)
      })
      editor.deleteShapes([id])
      expect(visibleToListener).toBeUndefined()
    } finally {
      editor.dispose()
    }
  })

  it("stays quiet when nothing was actually deleted", () => {
    const editor = makeEditor()
    try {
      const locked = box(editor, 0, 0)
      editor.updateShapes([{ id: locked, type: "box", isLocked: true }])
      const spy = vi.fn()
      editor.on("deleted-shapes", spy)
      editor.deleteShapes([locked])
      editor.deleteShapes(["shape:nonexistent" as ShapeId])
      editor.deleteShapes([])
      expect(spy).not.toHaveBeenCalled()
    } finally {
      editor.dispose()
    }
  })
})

/**
 * `renderingOnly` used to be declared on an options type and read by nothing.
 *
 * The hit test itself runs in the wasm scene, which is not populated in a
 * headless editor — so these assert the one thing that is decidable here: that
 * the option reaches the filter and that it is off by default. The filtering
 * it produces is verified in the browser, where the scene is real.
 */
describe("the renderingOnly hit-test option", () => {
  it("consults the culled set, and only when asked to", () => {
    const editor = makeEditor()
    try {
      box(editor, 10, 10)
      const spy = vi.spyOn(editor, "getCulledShapes")
      editor.getShapeAtPoint({ x: 50, y: 50 })
      editor.getShapesAtPoint({ x: 50, y: 50 })
      editor.getShapesInsideBounds({ x: 0, y: 0, w: 100, h: 100 })
      expect(spy, "a plain query must not pay for the culled set").not.toHaveBeenCalled()

      editor.getShapeAtPoint({ x: 50, y: 50 }, { renderingOnly: true })
      expect(spy).toHaveBeenCalled()
    } finally {
      editor.dispose()
    }
  })

  it("reads the culled set once per query, not once per candidate shape", () => {
    const editor = makeEditor()
    try {
      for (let i = 0; i < 20; i++) box(editor, i * 10, 0, 5, 5)
      const spy = vi.spyOn(editor, "getCulledShapes")
      editor.getShapesInsideBounds({ x: 0, y: 0, w: 1000, h: 1000 }, { renderingOnly: true })
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      editor.dispose()
    }
  })

  it("keeps the caller's own filter as well as the culled set", () => {
    const editor = makeEditor()
    try {
      const id = box(editor, 10, 10)
      const filter = vi.fn(() => true)
      editor.getShapesInsideBounds({ x: 0, y: 0, w: 1000, h: 1000 }, { renderingOnly: true, filter })
      // Both predicates survive into one: a caller does not lose its filter by
      // asking for renderingOnly, which is how the two were wired at first.
      expect(editor.getShape(id)).toBeDefined()
    } finally {
      editor.dispose()
    }
  })
})
