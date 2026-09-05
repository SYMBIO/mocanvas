import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it } from "vitest"
import { createStore, Editor, loadEngineSync, StateNode } from "@mocanvas/editor"
import { defaultShapeUtils } from "../shapes"
import { defaultBindingUtils } from "../bindings"
import { defaultHandleExternalExcalidrawContent, isExcalidrawClipboardContent, putExcalidrawContent } from "./excalidraw"

const wasmPath = fileURLToPath(new URL("../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

class TestTool extends StateNode {
  static override id = "test"
}

function makeEditor(): Editor {
  const editor = new Editor({
    store: createStore(),
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: [TestTool],
    engine: loadEngineSync(readFileSync(wasmPath)),
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

const clipboard = {
  type: "excalidraw/clipboard",
  elements: [
    { type: "rectangle", x: 0, y: 0, width: 100, height: 50, strokeColor: "#1971c2", backgroundColor: "transparent" },
    { type: "ellipse", x: 200, y: 0, width: 60, height: 60, strokeColor: "#e03131", backgroundColor: "#e03131" },
    { type: "text", x: 0, y: 100, width: 80, height: 20, text: "hello" },
    { type: "deleted-thing", x: 0, y: 0, isDeleted: true },
  ],
}

describe("isExcalidrawClipboardContent", () => {
  it("recognises an excalidraw payload by its declared type", () => {
    expect(isExcalidrawClipboardContent(clipboard)).toBe(true)
    expect(isExcalidrawClipboardContent({ type: "excalidraw" })).toBe(true)
  })

  it("does not mistake any object with an elements array for one", () => {
    expect(isExcalidrawClipboardContent({ elements: [] })).toBe(false)
    expect(isExcalidrawClipboardContent(null)).toBe(false)
    expect(isExcalidrawClipboardContent("excalidraw")).toBe(false)
  })
})

describe("putExcalidrawContent", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("creates one shape per convertible element", async () => {
    await putExcalidrawContent(editor, clipboard, { x: 0, y: 0 })
    const shapes = editor.getCurrentPageShapes()
    expect(shapes.filter((s) => s.type === "geo")).toHaveLength(2)
    expect(shapes.filter((s) => s.type === "text")).toHaveLength(1)
  })

  it("skips deleted elements and types it cannot represent", async () => {
    await putExcalidrawContent(editor, clipboard, { x: 0, y: 0 })
    expect(editor.getCurrentPageShapes()).toHaveLength(3)
  })

  it("maps excalidraw's geo types onto ours", async () => {
    await putExcalidrawContent(editor, clipboard, { x: 0, y: 0 })
    const geos = editor.getCurrentPageShapes().filter((s) => s.type === "geo") as { props: { geo: string } }[]
    expect(geos.map((s) => s.props.geo).sort()).toEqual(["ellipse", "rectangle"])
  })

  it("reads a filled background as a solid fill", async () => {
    await putExcalidrawContent(editor, clipboard, { x: 0, y: 0 })
    const fills = (editor.getCurrentPageShapes().filter((s) => s.type === "geo") as { props: { fill: string } }[]).map((s) => s.props.fill)
    expect(fills).toContain("solid")
    expect(fills).toContain("none")
  })

  it("centres the pasted group on the point", async () => {
    await putExcalidrawContent(editor, clipboard, { x: 1000, y: 1000 })
    const bounds = editor.getSelectionPageBounds()!
    expect(bounds.center.x).toBeGreaterThan(800)
    expect(bounds.center.y).toBeGreaterThan(800)
  })

  it("selects what it created", async () => {
    await putExcalidrawContent(editor, clipboard, { x: 0, y: 0 })
    expect(editor.getSelectedShapeIds()).toHaveLength(3)
  })

  it("does nothing for an empty document", async () => {
    await putExcalidrawContent(editor, { type: "excalidraw/clipboard", elements: [] }, { x: 0, y: 0 })
    expect(editor.getCurrentPageShapes()).toHaveLength(0)
  })
})

describe("defaultHandleExternalExcalidrawContent", () => {
  it("ignores content that is not excalidraw's", async () => {
    const editor = makeEditor()
    await defaultHandleExternalExcalidrawContent(editor, { content: { elements: [{ type: "rectangle", width: 10, height: 10 }] } })
    expect(editor.getCurrentPageShapes()).toHaveLength(0)
  })

  it("imports content that is", async () => {
    const editor = makeEditor()
    await defaultHandleExternalExcalidrawContent(editor, { content: clipboard })
    expect(editor.getCurrentPageShapes().length).toBeGreaterThan(0)
  })
})
