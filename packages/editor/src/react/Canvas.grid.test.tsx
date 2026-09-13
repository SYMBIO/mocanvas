// @vitest-environment jsdom
/**
 * "Show grid" drew nothing — twice.
 *
 * The `Grid` slot carried three paragraphs of documentation — "rendered only
 * while the editor is in grid mode", handed the camera so it need not
 * subscribe — and `DefaultGrid` was written, patterns, zoom fade and all. And
 * `Canvas` rendered neither, so the menu item ticked a box and the canvas was
 * unchanged. Every unit test passed: there was nothing wrong with the grid, it
 * was simply never asked for.
 *
 * Mounting it was not enough either, and the second failure is the reason the
 * last block of this file exists. The grid is a DOM layer *beneath* the GPU
 * canvas, and the renderer cleared every frame to an opaque near-white, so the
 * grid was painted and then painted over. It had a node, correct patterns and
 * the right colour, and measured zero pixels on screen — which is exactly what
 * a test that asserts "the element is there" cannot see.
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
    // One lattice on the document's step — see the note on `DefaultGrid`.
    expect(grid()!.querySelectorAll("pattern")).toHaveLength(1)
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

/**
 * The invariant that makes any of the layers beneath the canvas visible.
 *
 * These assert the two halves separately because neither is sufficient and
 * jsdom composites nothing: a DOM test can see that the grid comes before the
 * canvas and that the clear is transparent, and those two facts together are
 * what put dots on a screen.
 */
describe("the canvas layer", () => {
  it("clears transparent, so the grid beneath it survives the frame", () => {
    const e = mount()
    fakeBackend.draw.mockClear()
    act(() => {
      e.renderFrame(fakeBackend as never)
    })
    const [, , options] = fakeBackend.draw.mock.calls[0] as [unknown, unknown, { background: number[] }]
    expect(options.background[3], "an opaque clear paints over the grid and the Background slot").toBe(0)
  })

  it("keeps the grid underneath it, so dots do not land on top of shapes", () => {
    mount()
    const layers = [...host!.querySelector(".mocanvas")!.children]
    const gridAt = layers.findIndex((el) => el.classList.contains("mocanvas-grid"))
    const canvasAt = layers.findIndex((el) => el.tagName === "CANVAS")
    expect(gridAt).toBeGreaterThanOrEqual(0)
    expect(gridAt, "the grid must sit below the canvas, not above the shapes on it").toBeLessThan(canvasAt)
  })

  it("paints the page colour on the container instead", () => {
    mount()
    const container = host!.querySelector(".mocanvas") as HTMLElement
    // The theme's colour, not the renderer's — so dark mode gets a dark page.
    expect(container.style.background).toContain("--mocanvas-background")
  })

  it("still honours an app that set the deprecated `backgroundColor`", () => {
    host = document.createElement("div")
    document.body.appendChild(host)
    editor = new Editor({
      store: createStore(),
      shapeUtils: [],
      tools: [SelectTool],
      engine: loadEngineSync(readFileSync(wasmPath)),
      getContainer: () => host!,
      options: { backgroundColor: [1, 0, 0, 1] },
    })
    root = createRoot(host)
    act(() => root!.render(<Canvas editor={editor!} />))
    const container = host!.querySelector(".mocanvas") as HTMLElement
    // jsdom drops a redundant alpha, so both spellings mean the same red.
    expect(container.style.background).toMatch(/rgba?\(255, 0, 0/)
  })
})

/**
 * How the lattice answers the camera.
 *
 * Both directions were backwards, and both were reported from a canvas rather
 * than found here: zooming IN made the grid vanish, because a fixed 1px dot
 * every 80 screen pixels is a speck and not a lattice; and zooming OUT kept a
 * second, heavier lattice at a fixed opacity, which is the grey sheen a
 * zoomed-out board must not have.
 */
const dot = () => grid()!.querySelector("circle")!
const cellOf = () => Number(grid()!.querySelector("pattern")!.getAttribute("width"))

describe("the grid against the camera", () => {
  it("keeps drawing as the camera zooms in — the dot grows with the cell", () => {
    const e = mount()
    const near = Number(dot().getAttribute("r"))
    act(() => void e.setCamera({ x: 0, y: 0, z: 8 }))
    expect(cellOf()).toBe(80)
    expect(Number(dot().getAttribute("r")), "the dot stayed a speck while the cell grew").toBeGreaterThan(near)
  })

  it("caps the dot, so a deep zoom draws a lattice and not a field of blobs", () => {
    const e = mount()
    act(() => void e.setCamera({ x: 0, y: 0, z: 8 }))
    expect(Number(dot().getAttribute("r"))).toBeLessThanOrEqual(5)
  })

  it("goes away entirely once the cells are denser than the eye can read", () => {
    const e = mount()
    // 10 document units at z = 0.4 is a dot every four pixels: a sheen.
    act(() => void e.setCamera({ x: 0, y: 0, z: 0.4 }))
    expect(grid(), "a canvas zoomed out should be blank, not grey").toBeNull()
  })

  it("fades rather than snapping off, on the way there", () => {
    const e = mount()
    act(() => void e.setCamera({ x: 0, y: 0, z: 0.8 }))
    const faint = Number(grid()!.querySelector("rect")!.getAttribute("opacity"))
    expect(faint).toBeGreaterThan(0)
    expect(faint).toBeLessThan(1)
  })

  it("is drawn whole rather than clipped to a quarter by its own tile", () => {
    const e = mount()
    act(() => void e.setCamera({ x: 0, y: 0, z: 8 }))
    const cell = cellOf()
    const r = Number(dot().getAttribute("r"))
    const cx = Number(dot().getAttribute("cx"))
    const cy = Number(dot().getAttribute("cy"))
    // Every edge of the dot inside the tile: at the corner, a pattern throws
    // three quarters of it away.
    expect(Math.min(cx - r, cy - r)).toBeGreaterThanOrEqual(0)
    expect(Math.max(cx + r, cy + r)).toBeLessThanOrEqual(cell)
  })

  it("still lands its dots on the document's own step, so they stay magnets", () => {
    const e = mount()
    act(() => void e.setCamera({ x: 3, y: 7, z: 2 }))
    const cell = cellOf()
    const [tx, ty] = grid()!
      .querySelector("pattern")!
      .getAttribute("patternTransform")!
      .match(/-?[\d.]+/g)!
      .map(Number) as [number, number]
    // A dot is drawn at the tile centre, so the tile is shifted back by half a
    // cell: the dot then sits exactly where a page multiple of the step lands.
    expect(tx + cell / 2).toBeCloseTo(3 * 2, 6)
    expect(ty + cell / 2).toBeCloseTo(7 * 2, 6)
  })
})
