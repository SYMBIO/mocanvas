// @vitest-environment jsdom
/**
 * "Show grid" drew nothing.
 *
 * The `Grid` slot carried three paragraphs of documentation — "rendered only
 * while the editor is in grid mode", handed the camera so it need not
 * subscribe — and `DefaultGrid` was written, patterns, zoom fade and all. And
 * `Canvas` rendered neither, so the menu item ticked a box and the canvas was
 * unchanged. Every unit test passed: there was nothing wrong with the grid, it
 * was simply never asked for.
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

const VIEWPORT = { w: 800, h: 600 }

beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never
  // jsdom lays nothing out, and the canvas measures its container to size the
  // viewport — which the grid's own camera reading then depends on.
  Element.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, x: 0, y: 0, width: VIEWPORT.w, height: VIEWPORT.h, right: VIEWPORT.w, bottom: VIEWPORT.h, toJSON: () => ({}) }) as DOMRect
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

const grid = () => host!.querySelector(".mocanvas-grid")

describe("grid mode", () => {
  it("is on by default, because a canvas is a drawing surface", () => {
    mount()
    expect(grid()).not.toBeNull()
  })

  it("draws nothing once it is switched off", () => {
    const e = mount()
    act(() => void e.updateInstanceState({ isGridMode: false }))
    expect(grid()).toBeNull()
  })

  it("draws a grid once it is on", () => {
    const e = mount()
    act(() => void e.updateInstanceState({ isGridMode: false }))
    act(() => void e.updateInstanceState({ isGridMode: true }))
    expect(grid(), "the slot rendered nothing — this is the bug it was written for").not.toBeNull()
    // A fine cell and a heavier fifth, so the eye can count.
    expect(grid()!.querySelectorAll("pattern")).toHaveLength(2)
  })

  it("goes away and comes back as the state flips", () => {
    const e = mount()
    expect(grid()).not.toBeNull()
    act(() => void e.updateInstanceState({ isGridMode: false }))
    expect(grid()).toBeNull()
    act(() => void e.updateInstanceState({ isGridMode: true }))
    expect(grid()).not.toBeNull()
  })

  it("takes its cell from the document's step and the camera's zoom", () => {
    const e = mount()
    const step = e.getDocumentSettings().gridSize
    expect(grid()!.querySelector("pattern")!.getAttribute("width")).toBe(String(step))
    act(() => void e.setCamera({ x: 0, y: 0, z: 2 }))
    expect(grid()!.querySelector("pattern")!.getAttribute("width")).toBe(String(step * 2))
  })

  it("lets an app replace it", () => {
    mount({ Grid: () => <div data-testid="mine" /> })
    expect(host!.querySelector('[data-testid="mine"]')).not.toBeNull()
    expect(grid()).toBeNull()
  })

  it("lets an app switch it off entirely", () => {
    mount({ Grid: null })
    expect(grid()).toBeNull()
  })
})
