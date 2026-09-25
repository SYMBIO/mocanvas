// @vitest-environment jsdom
/**
 * The layer in front of the canvas.
 *
 * `TLEditorComponents.InFrontOfTheCanvas` was declared, documented and read by
 * `DefaultUi`'s chrome — and `Mocanvas` renders `TldrawUi`, whose layout has no
 * such slot, so an app passing it through `components` (which is the one map
 * tldraw takes) got nothing and no warning. Molekula lost a whole layer that
 * way: the toolbar over a selected shape, its comment pins, an agent's cursor.
 *
 * It lives on the canvas rather than in the chrome because that is where tldraw
 * puts it, and because the chrome is optional: `hideUi` must not take an app's
 * own overlay with it.
 */
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loadEngineSync } from "@mocanvas/wasm"
import { Editor } from "../editor/Editor"
import { createStore } from "../editor/createStore"
import { StateNode } from "../tools/StateNode"
import { Canvas } from "./Canvas"

const fakeBackend = {
  kind: "webgl2" as const,
  resize: vi.fn(),
  draw: vi.fn(),
  uploadTexture: vi.fn(),
  deleteTexture: vi.fn(),
  dispose: vi.fn(),
}
vi.mock("../render/webgl2", () => ({ createBackend: () => fakeBackend, WebGL2Backend: class {} }))

const wasmPath = [
  resolve(process.cwd(), "../wasm/pkg/mocanvas_bg.wasm"),
  resolve(process.cwd(), "packages/wasm/pkg/mocanvas_bg.wasm"),
].find((p) => existsSync(p))!

class SelectTool extends StateNode {
  static override id = "select"
}

let root: Root | null = null
let host: HTMLDivElement | null = null
let editor: Editor | null = null

beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never
  Element.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, x: 0, y: 0, width: 800, height: 600, right: 800, bottom: 600, toJSON: () => ({}) }) as DOMRect
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => root?.unmount())
  editor?.dispose()
  host?.remove()
  root = null
  host = null
  editor = null
  vi.restoreAllMocks()
})

function mount(components?: Parameters<typeof Canvas>[0]["components"]): Editor {
  host = document.createElement("div")
  document.body.appendChild(host)
  editor = new Editor({
    store: createStore(),
    shapeUtils: [],
    tools: [SelectTool],
    engine: loadEngineSync(readFileSync(wasmPath)),
    getContainer: () => host!,
  })
  root = createRoot(host)
  act(() => root!.render(<Canvas editor={editor!} {...(components ? { components } : {})} />))
  return editor
}

const layer = () => host!.querySelector(".mocanvas-in-front-of-canvas")

describe("InFrontOfTheCanvas", () => {
  it("renders the slot's content over the canvas", () => {
    mount({ InFrontOfTheCanvas: () => <button type="button">Duplicate</button> })
    expect(layer()).not.toBeNull()
    expect(layer()!.querySelector("button")?.textContent).toBe("Duplicate")
  })

  it("draws no layer at all when nothing fills the slot", () => {
    mount()
    expect(layer()).toBeNull()
  })

  it("lets its children take the pointer while the layer itself does not", () => {
    mount({ InFrontOfTheCanvas: () => <button type="button">Duplicate</button> })
    // Empty space over the canvas still pans it; the button is still clickable.
    expect((layer() as HTMLElement).style.pointerEvents).toBe("none")
  })
})
