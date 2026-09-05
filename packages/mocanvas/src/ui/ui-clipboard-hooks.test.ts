import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createShapeId, createStore, Editor, loadEngineSync, StateNode, type ShapeId } from "@mocanvas/editor"
import { defaultShapeUtils } from "../shapes"
import { defaultBindingUtils } from "../bindings"
import { handleNativeOrMenuCopy } from "./ui-clipboard-hooks"
import { iconTypes } from "./ui-icon-types"

const wasmPath = ["packages/wasm/pkg/mocanvas_bg.wasm", "../wasm/pkg/mocanvas_bg.wasm"]
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate))!

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

/** A `ClipboardEvent` stand-in that records what was written to it. */
function fakeClipboardEvent() {
  const written = new Map<string, string>()
  return {
    written,
    event: {
      preventDefault: vi.fn(),
      clipboardData: {
        setData: (type: string, value: string) => {
          written.set(type, value)
        },
      },
    } as unknown as ClipboardEvent,
  }
}

describe("handleNativeOrMenuCopy", () => {
  let editor: Editor
  let id: ShapeId

  beforeEach(() => {
    editor = makeEditor()
    id = createShapeId()
    editor.createShape({ id, type: "geo", x: 0, y: 0, props: { w: 10, h: 10 } } as never)
    editor.setSelectedShapes([id])
  })

  it("writes both flavours when it has an event", async () => {
    const { event, written } = fakeClipboardEvent()
    expect(await handleNativeOrMenuCopy(editor, event)).toBe(true)
    expect(written.has("text/html")).toBe(true)
    expect(written.has("text/plain")).toBe(true)
  })

  it("marks the html flavour so a paste back is lossless", async () => {
    const { event, written } = fakeClipboardEvent()
    await handleNativeOrMenuCopy(editor, event)
    expect(written.get("text/html")).toContain("data-mocanvas")
  })

  it("escapes the serialized content it embeds in html", async () => {
    const { event, written } = fakeClipboardEvent()
    await handleNativeOrMenuCopy(editor, event)
    const html = written.get("text/html")!
    // The payload is JSON full of quotes and braces; between the marker div's
    // tags nothing may look like markup, or a paste target would parse it.
    const payload = html.slice(html.indexOf(">") + 1, html.lastIndexOf("</div>"))
    expect(payload).not.toContain("<")
    expect(payload).not.toContain(">")
    expect(payload).toContain("application/mocanvas")
  })

  it("takes over the event so the browser does not also copy", async () => {
    const { event } = fakeClipboardEvent()
    await handleNativeOrMenuCopy(editor, event)
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it("reports nothing copied for an empty selection", async () => {
    editor.setSelectedShapes([])
    const { event } = fakeClipboardEvent()
    expect(await handleNativeOrMenuCopy(editor, event)).toBe(false)
  })

  it("copies an explicit id list rather than the selection", async () => {
    const other = createShapeId()
    editor.createShape({ id: other, type: "geo", x: 100, y: 0, props: { w: 10, h: 10 } } as never)
    editor.setSelectedShapes([])
    const { event } = fakeClipboardEvent()
    expect(await handleNativeOrMenuCopy(editor, event, [other])).toBe(true)
  })
})

describe("iconTypes", () => {
  it("lists every built-in icon name", () => {
    expect(iconTypes.length).toBeGreaterThan(0)
    expect(new Set(iconTypes).size).toBe(iconTypes.length)
  })
})
