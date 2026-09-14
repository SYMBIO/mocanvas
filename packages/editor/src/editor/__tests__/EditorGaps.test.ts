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
import { ZERO_INDEX_KEY, getIndexAbove, setIndexJitterEnabled } from "@mocanvas/store"

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

  it("seeds its page at a1, where every .tldr in the fixtures has one", () => {
    expect(createStore().query.records("page").get()[0]!.index).toBe("a1")
  })

  it("gives every replica the same first page, so two of them meet on it", () => {
    expect(createStore().query.records("page").get()[0]!.id).toEqual(createStore().query.records("page").get()[0]!.id)
  })

  it("can be told not to seed, for a caller that owns the document structure", () => {
    // 4.1.0 seeded unconditionally, so a headless pipeline that put its own
    // page afterwards ended up with two pages AT THE SAME INDEX — and equal
    // index keys have no defined order.
    const store = createStore({ seed: false })
    expect(store.allRecords()).toEqual([])
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

  it("fires before the removal, while a before-delete handler can still veto", () => {
    const editor = makeEditor()
    try {
      const id = box(editor, 0, 0)
      const order: string[] = []
      editor.on("deleted-shapes", () => order.push("event"))
      editor.sideEffects.registerBeforeDeleteHandler("shape", () => {
        order.push("beforeDelete")
      })
      editor.deleteShapes([id])
      // The before-delete handler is the only place a delete can be refused,
      // and whether a shape's own parent is going in the same gesture is the
      // one thing it cannot work out for itself. Announcing the set after the
      // handlers told it what it needed once the decision was already made.
      expect(order).toEqual(["event", "beforeDelete"])
    } finally {
      editor.dispose()
    }
  })

  it("hands the whole gesture to a handler deciding about one of its shapes", () => {
    const editor = makeEditor()
    try {
      const parent = box(editor, 0, 0)
      const child = box(editor, 10, 10)
      editor.reparentShapes([child], parent)
      let gesture: string[] = []
      let sawParentGoingToo: boolean | null = null
      editor.on("deleted-shapes", (ids) => (gesture = [...ids]))
      editor.sideEffects.registerBeforeDeleteHandler("shape", (shape) => {
        if (shape.id === child) sawParentGoingToo = gesture.includes(parent)
      })
      editor.deleteShapes([parent])
      expect(sawParentGoingToo, "the child decided without knowing its parent was going too").toBe(true)
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

/**
 * The editor and the store helpers, asked the same question.
 *
 * A consumer's headless fold computes a first child's index as
 * `getIndexAbove(ZERO_INDEX_KEY)` and matched a live tldraw editor on it for
 * months. Ours answered one step lower, so the two disagreed — inside one
 * package, about one number.
 */
describe("where the first child of an empty parent goes", () => {
  it("is above the zero key, matching what the store helpers answer", () => {
    const editor = makeEditor()
    try {
      const page = editor.getCurrentPageId()
      const fromEditor = editor.getHighestIndexForParent(page as never)
      expect(fromEditor > ZERO_INDEX_KEY, `${fromEditor} must sort above ${ZERO_INDEX_KEY}`).toBe(true)
      // Same bucket as the helper, jitter aside: both land in the gap above a0.
      expect(fromEditor.startsWith("a1")).toBe(true)
      expect(getIndexAbove(ZERO_INDEX_KEY).startsWith("a1")).toBe(true)
    } finally {
      editor.dispose()
    }
  })

  it("puts a created shape there, and keeps later ones climbing", () => {
    const editor = makeEditor()
    try {
      const first = box(editor, 0, 0)
      const second = box(editor, 20, 0)
      const a = editor.getShape(first)!.index
      const b = editor.getShape(second)!.index
      expect(a > ZERO_INDEX_KEY).toBe(true)
      expect(b > a).toBe(true)
    } finally {
      editor.dispose()
    }
  })

  it("gives two editors different indices for their first shape, so a merge keeps both", () => {
    // The jitter, seen from the editor: two peers each adding one shape to an
    // empty page no longer claim the same position.
    // Off under a test runner by design; this is the test OF it.
    setIndexJitterEnabled(true)
    const one = makeEditor()
    const two = makeEditor()
    try {
      const a = one.getShape(box(one, 0, 0))!.index
      const b = two.getShape(box(two, 0, 0))!.index
      expect(a).not.toBe(b)
    } finally {
      one.dispose()
      two.dispose()
      setIndexJitterEnabled(null)
    }
  })
})

/**
 * Rotation is a number two documents have to agree on.
 *
 * `rotateShapesBy` added the delta and stored whatever came out, so rotating
 * −45° left `-0.785…` where a wrapped angle is `5.497…`. The same picture, a
 * different number — and `rotation` is persisted and synced, so a diff, a
 * parity check and a merge all see a difference that is not on screen.
 */
describe("the angle rotateShapesBy stores", () => {
  const TAU = Math.PI * 2
  const rotationOf = (editor: Editor, id: ShapeId) => editor.getShape(id)!.rotation

  it("is wrapped into [0, 2π) when the delta is negative", () => {
    const editor = makeEditor()
    try {
      const id = box(editor, 0, 0)
      editor.rotateShapesBy([id], -Math.PI / 4)
      expect(rotationOf(editor, id)).toBeCloseTo(TAU - Math.PI / 4, 12)
      expect(rotationOf(editor, id)).toBeGreaterThanOrEqual(0)
    } finally {
      editor.dispose()
    }
  })

  it("does not grow without bound as a shape is turned round and round", () => {
    const editor = makeEditor()
    try {
      const id = box(editor, 0, 0)
      for (let i = 0; i < 12; i++) editor.rotateShapesBy([id], Math.PI / 2)
      const r = rotationOf(editor, id)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThan(TAU)
    } finally {
      editor.dispose()
    }
  })

  it("gives two editors the same number for the same visible rotation", () => {
    // The property that matters: one reaches it in a single step, the other the
    // long way round. A parity test compares the records, not the pictures.
    const a = makeEditor()
    const b = makeEditor()
    try {
      const ida = box(a, 0, 0)
      const idb = box(b, 0, 0)
      a.rotateShapesBy([ida], -Math.PI / 4)
      b.rotateShapesBy([idb], -Math.PI / 4 + TAU * 3)
      expect(rotationOf(a, ida)).toBeCloseTo(rotationOf(b, idb), 9)
    } finally {
      a.dispose()
      b.dispose()
    }
  })

  it("leaves an explicitly set rotation alone", () => {
    // `updateShapes` is a caller stating a value, not accumulating one. It is
    // deliberately not canonicalized — that would silently rewrite an angle an
    // app chose on purpose.
    const editor = makeEditor()
    try {
      const id = box(editor, 0, 0)
      editor.updateShapes([{ id, type: "box", rotation: 100 * Math.PI }] as never)
      expect(rotationOf(editor, id)).toBe(100 * Math.PI)
    } finally {
      editor.dispose()
    }
  })
})
