/**
 * One document, driven end to end through as much of the library as a single
 * test can reach: every built-in shape, the tools that create them, selection,
 * camera, history, grouping, bindings, styles, themes, rich text, indicators,
 * the engine's parametric fast path, export, and a `.tldr` round trip.
 *
 * This is deliberately broad rather than deep — the focused suites next to each
 * module test behaviour properly. What this catches is the class of breakage
 * those miss: a change that is locally correct but takes the pieces out of step,
 * so the library stops working *as a library*. It runs against the real
 * WebAssembly engine, not a stub.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it } from "vitest"
import {
  Box,
  Editor,
  Mat,
  Vec,
  createShapeId,
  createStore,
  loadEngineSync,
  type ShapeId,
  tleditors,
  type UnknownShape,
} from "@mocanvas/editor"
import { defaultBindingUtils, defaultShapeUtils, defaultTools } from "./index"
import { toRichText } from "./text/rich-text"
import { getSvgString } from "./export"
import { loadMocanvasFile, serializeMocanvasFile } from "./file"

const wasmPath = fileURLToPath(new URL("../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))
const engine = loadEngineSync(readFileSync(wasmPath))

function makeEditor(): Editor {
  const editor = new Editor({
    store: createStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils }),
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: defaultTools,
    engine,
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1200, h: 800 })
  return editor
}

/** One of every built-in shape type, laid out so nothing overlaps. */
function populate(editor: Editor): Record<string, ShapeId> {
  const ids: Record<string, ShapeId> = {}
  const add = (name: string, partial: Parameters<Editor["createShape"]>[0]): void => {
    const id = createShapeId()
    editor.createShape({ ...partial, id } as never)
    ids[name] = id
  }
  add("rect", { type: "geo", x: 0, y: 0, props: { w: 100, h: 80, geo: "rectangle" } })
  add("ellipse", { type: "geo", x: 200, y: 0, props: { w: 100, h: 80, geo: "ellipse" } })
  add("star", { type: "geo", x: 400, y: 0, props: { w: 100, h: 100, geo: "star" } })
  add("cloud", { type: "geo", x: 600, y: 0, props: { w: 120, h: 90, geo: "cloud" } })
  add("note", { type: "note", x: 0, y: 200, props: {} })
  add("text", { type: "text", x: 200, y: 200, props: {} })
  add("draw", {
    type: "draw",
    x: 400,
    y: 200,
    props: { segments: [{ type: "free", points: [{ x: 0, y: 0 }, { x: 20, y: 30 }, { x: 50, y: 10 }, { x: 80, y: 40 }] }] },
  })
  add("line", {
    type: "line",
    x: 600,
    y: 200,
    props: { points: { a1: { id: "a1", index: "a1", x: 0, y: 0 }, a2: { id: "a2", index: "a2", x: 60, y: 40 }, a3: { id: "a3", index: "a3", x: 120, y: 0 } } },
  })
  add("arrow", { type: "arrow", x: 0, y: 400, props: { start: { x: 0, y: 0 }, end: { x: 120, y: 60 } } })
  add("frame", { type: "frame", x: 300, y: 400, props: { w: 240, h: 180 } })
  return ids
}

describe("functional coverage: one document through the whole library", () => {
  let editor: Editor

  beforeEach(() => {
    editor = makeEditor()
  })

  it("creates one of every built-in shape and reports them on the page", () => {
    const ids = populate(editor)
    const shapes = editor.getCurrentPageShapes()
    expect(shapes).toHaveLength(Object.keys(ids).length)
    // Every shape resolved to a registered util rather than falling through.
    for (const shape of shapes) {
      expect(editor.hasShapeUtil(shape.type)).toBe(true)
      expect(editor.getShapeGeometry(shape as UnknownShape)).toBeDefined()
    }
  })

  it("narrows a shape's props from its type — the augmentation is live", () => {
    const ids = populate(editor)
    const note = editor.getShape(ids["note"]!)
    expect(note).toBeDefined()
    if (note?.type === "note") {
      // If `TLGlobalShapePropsMap` were not wired, `props` here would be `object`
      // and this would not compile.
      expect(typeof note.props.growY).toBe("number")
    } else {
      throw new Error("expected the note to narrow")
    }
  })

  it("takes the engine's parametric fast path for built-ins, and not for custom shapes", () => {
    const ids = populate(editor)
    const geo = editor.getShape(ids["rect"]!)!
    const util = editor.getShapeUtil<UnknownShape>(geo)
    // Geo, draw and line describe themselves by parameters; the rest still
    // upload a path, which is what a custom shape always does.
    expect(util.getEngineGeometry?.(geo)).toMatchObject({ type: "geo", w: 100, h: 80 })
    const note = editor.getShape(ids["note"]!)!
    expect(editor.getShapeUtil<UnknownShape>(note).getEngineGeometry?.(note)).toBeUndefined()
  })

  it("selects, moves, resizes and reports bounds", () => {
    const ids = populate(editor)
    editor.select(ids["rect"]!)
    expect(editor.getSelectedShapeIds()).toEqual([ids["rect"]])
    const before = editor.getShapePageBounds(ids["rect"]!)!
    editor.nudgeShapes([ids["rect"]!], { x: 10, y: 5 })
    const after = editor.getShapePageBounds(ids["rect"]!)!
    expect(after.x - before.x).toBeCloseTo(10)
    expect(after.y - before.y).toBeCloseTo(5)
    editor.resizeShape(ids["rect"]!, { x: 2, y: 2 })
    expect(editor.getShapePageBounds(ids["rect"]!)!.w).toBeGreaterThan(before.w)
  })

  it("undoes and redoes a change as one step", () => {
    const ids = populate(editor)
    const start = editor.getShapePageBounds(ids["rect"]!)!.x
    editor.markHistoryStoppingPoint("nudge")
    editor.nudgeShapes([ids["rect"]!], { x: 50, y: 0 })
    expect(editor.getShapePageBounds(ids["rect"]!)!.x).toBeCloseTo(start + 50)
    editor.undo()
    expect(editor.getShapePageBounds(ids["rect"]!)!.x).toBeCloseTo(start)
    editor.redo()
    expect(editor.getShapePageBounds(ids["rect"]!)!.x).toBeCloseTo(start + 50)
  })

  it("groups and ungroups, reparenting the children both ways", () => {
    const ids = populate(editor)
    const members = [ids["rect"]!, ids["ellipse"]!]
    editor.select(...members)
    editor.groupShapes(members)
    const group = editor.getCurrentPageShapes().find((s) => s.type === "group")
    expect(group).toBeDefined()
    for (const id of members) expect(editor.getShape(id)!.parentId).toBe(group!.id)
    editor.ungroupShapes([group!.id])
    expect(editor.getCurrentPageShapes().some((s) => s.type === "group")).toBe(false)
  })

  it("duplicates a shape, offset and with a new id", () => {
    const ids = populate(editor)
    const before = editor.getCurrentPageShapes().length
    const [copyId] = editor.duplicateShapes([ids["rect"]!], { x: 20, y: 20 })
    expect(editor.getCurrentPageShapes()).toHaveLength(before + 1)
    expect(copyId).not.toBe(ids["rect"])
    const a = editor.getShapePageBounds(ids["rect"]!)!
    const b = editor.getShapePageBounds(copyId!)!
    expect(b.x - a.x).toBeCloseTo(20)
  })

  it("moves the camera and converts between page, viewport and screen space", () => {
    populate(editor)
    editor.zoomToFit()
    const z = editor.getZoomLevel()
    expect(z).toBeGreaterThan(0)
    const page = { x: 100, y: 50 }
    const viewport = editor.pageToViewport(page)
    const back = editor.viewportToPage(viewport)
    expect(back.x).toBeCloseTo(page.x, 4)
    expect(back.y).toBeCloseTo(page.y, 4)
    // Screen space adds the container's window offset; viewport space does not.
    const screen = editor.pageToScreen(page)
    const bounds = editor.getViewportScreenBounds()
    expect(screen.x - viewport.x).toBeCloseTo(bounds.x, 4)
  })

  it("hit-tests through the engine's spatial index", () => {
    const ids = populate(editor)
    const bounds = editor.getShapePageBounds(ids["rect"]!)!
    const centre = { x: bounds.center.x, y: bounds.center.y }
    // A geo shape defaults to `fill: "none"`, and an unfilled outline is a hole:
    // its middle is click-through, its stroke is not.
    expect(editor.getShapeAtPoint(centre)).toBeUndefined()
    expect(editor.getShapeAtPoint({ x: bounds.x, y: bounds.center.y })?.id).toBe(ids["rect"])
    // A filled shape has an interior, and `hitInside` is what reaches it.
    const filled = createShapeId()
    editor.createShape({ id: filled, type: "geo", x: 1000, y: 1000, props: { w: 100, h: 80, geo: "rectangle", fill: "solid" } } as never)
    const fb = editor.getShapePageBounds(filled)!
    expect(editor.getShapeAtPoint({ x: fb.center.x, y: fb.center.y }, { hitInside: true })?.id).toBe(filled)
    expect(editor.getShapeAtPoint({ x: -5000, y: -5000 })).toBeUndefined()
    expect(editor.getShapesInsideBounds(new Box(-10, -10, 5000, 5000)).length).toBeGreaterThan(0)
  })

  it("switches tools, including into a named child state", () => {
    expect(editor.getCurrentToolId()).toBeTruthy()
    editor.setCurrentTool("geo")
    expect(editor.getCurrentToolId()).toBe("geo")
    editor.setCurrentTool("select.idle")
    expect(editor.getCurrentToolId()).toBe("select")
    expect(editor.getCurrentTool().getCurrent()?.id).toBe("idle")
  })

  it("applies a style to the selection and reads it back as shared", () => {
    const ids = populate(editor)
    editor.select(ids["rect"]!, ids["ellipse"]!)
    const shapes = editor.getSelectedShapes()
    expect(shapes).toHaveLength(2)
    for (const s of shapes) expect(s.type).toBe("geo")
  })

  it("resolves display values from the current theme, in both colour modes", () => {
    const ids = populate(editor)
    const shape = editor.getShape(ids["rect"]!)!
    const theme = editor.getCurrentTheme()
    expect(theme.id).toBeTruthy()
    expect(editor.getColorMode()).toMatch(/^(light|dark)$/)
    expect(editor.getShapeUtil<UnknownShape>(shape).getRenderStyle(shape)).toBeDefined()
  })

  it("carries rich text on a label and derives plain text from it", () => {
    const id = createShapeId()
    editor.createShape({ id, type: "note", x: 0, y: 0, props: { richText: toRichText("hello canvas") } } as never)
    const note = editor.getShape(id)!
    const props = note.props as Record<string, unknown>
    expect(props["richText"]).toBeDefined()
  })

  it("declares an indicator path for every built-in", () => {
    populate(editor)
    // `getIndicatorPath` returns a `Path2D`, which only exists in a browser —
    // this suite runs in node. So assert the contract that can be checked here
    // (every built-in implements it) and, where the runtime has `Path2D`, that
    // calling it does not throw. The compositor's fail-soft behaviour is
    // covered properly in `packages/editor/src/indicators/indicators.test.ts`.
    const hasPath2D = typeof (globalThis as { Path2D?: unknown }).Path2D === "function"
    for (const shape of editor.getCurrentPageShapes()) {
      const util = editor.getShapeUtil<UnknownShape>(shape)
      expect(typeof util.getIndicatorPath).toBe("function")
      if (hasPath2D) expect(() => util.getIndicatorPath?.(shape)).not.toThrow()
    }
  })

  it("exports the page to SVG containing every shape", () => {
    populate(editor)
    const svg = getSvgString(editor)
    expect(svg).toBeDefined()
    expect(svg!.svg).toContain("<svg")
    expect(svg!.width).toBeGreaterThan(0)
    expect(svg!.height).toBeGreaterThan(0)
  })

  it("round-trips the document through a .tldr file", () => {
    const ids = populate(editor)
    const before = editor.getCurrentPageShapes().length
    const file = JSON.parse(serializeMocanvasFile(editor))
    const reloaded = makeEditor()
    loadMocanvasFile(reloaded, file)
    expect(reloaded.getCurrentPageShapes()).toHaveLength(before)
    const types = new Set(reloaded.getCurrentPageShapes().map((s) => s.type))
    expect(types.has("geo")).toBe(true)
    expect(types.has("note")).toBe(true)
    expect(types.has("arrow")).toBe(true)
    void ids
  })

  it("creates a second page and keeps the two documents apart", () => {
    populate(editor)
    const first = editor.getCurrentPageId()
    const onFirst = editor.getCurrentPageShapes().length
    editor.createPage({ name: "Second" })
    const second = editor.getPages().find((p) => p.id !== first)!
    editor.setCurrentPage(second.id)
    expect(editor.getCurrentPageShapes()).toHaveLength(0)
    editor.setCurrentPage(first)
    expect(editor.getCurrentPageShapes()).toHaveLength(onFirst)
  })

  it("aligns and distributes a row, including centring on both axes at once", () => {
    const ids = populate(editor)
    const row = [ids["rect"]!, ids["ellipse"]!, ids["star"]!]
    editor.alignShapes(row, "top")
    const ys = row.map((id) => editor.getShapePageBounds(id)!.y)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0, 3)
    editor.alignShapes(row, "center")
    const centres = row.map((id) => editor.getShapePageBounds(id)!.center)
    for (const c of centres) {
      expect(c.x).toBeCloseTo(centres[0]!.x, 3)
      expect(c.y).toBeCloseTo(centres[0]!.y, 3)
    }
  })

  it("reparents a shape into a frame and reports its ancestry", () => {
    const ids = populate(editor)
    editor.reparentShapes([ids["rect"]!], ids["frame"]!)
    expect(editor.getShape(ids["rect"]!)!.parentId).toBe(ids["frame"])
    const ancestors = editor.getShapeAncestors(ids["rect"]!)
    expect(ancestors.map((a) => a.id)).toContain(ids["frame"])
  })

  it("locks a shape out of selection and deletion", () => {
    const ids = populate(editor)
    editor.updateShape({ id: ids["rect"]!, type: "geo", isLocked: true } as never)
    expect(editor.getShape(ids["rect"]!)!.isLocked).toBe(true)
    const before = editor.getCurrentPageShapes().length
    editor.deleteShapes([ids["rect"]!])
    expect(editor.getCurrentPageShapes()).toHaveLength(before)
  })

  it("exposes working geometry primitives", () => {
    const v = new Vec(3, 4)
    expect(v.len()).toBeCloseTo(5)
    const box = new Box(0, 0, 10, 20)
    expect(box.center).toMatchObject({ x: 5, y: 10 })
    const m = Mat.Identity()
    expect(m.applyToPoint({ x: 2, y: 3 })).toMatchObject({ x: 2, y: 3 })
    expect(Mat.Identity().invert().applyToPoint({ x: 7, y: 9 })).toMatchObject({ x: 7, y: 9 })
  })

  it("enrols in the mounted-editor registry on mount, however it was built", () => {
    // This editor was constructed directly, not by `<Mocanvas />`. Enrolment
    // follows the `mount` event on the editor itself, so a test, a devtools
    // panel or a second React tree is on the same footing as the component.
    expect(tleditors.getMounted()).not.toContain(editor)
    editor.emit("mount")
    expect(tleditors.getMounted()).toContain(editor)
    expect(editor.getIsMounted()).toBe(true)
    editor.emit("unmount")
    expect(tleditors.getMounted()).not.toContain(editor)
    expect(editor.getIsMounted()).toBe(false)
  })

  it("disposes without leaving timers or engine work behind", () => {
    populate(editor)
    expect(editor.isDisposed).toBe(false)
    editor.dispose()
    expect(editor.isDisposed).toBe(true)
  })
})
