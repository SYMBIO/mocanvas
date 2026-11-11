// @vitest-environment jsdom
/**
 * What a camera move costs the DOM overlay, in React's own currency.
 *
 * Two failures this pins down. Every pan or zoom frame re-rendered the overlay
 * layer — and the canvas body under it — through React, only to write one CSS
 * transform; and every card that crossed the viewport edge was unmounted, then
 * built again from nothing when the pan came back. Neither shows in a still
 * screenshot, and neither showed in the benchmark, which had no DOM shapes.
 *
 * The counts here are exact on purpose: a camera move with nothing selected is
 * zero React commits, and a pan out and back is one mount per card.
 */
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act, Profiler, useLayoutEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loadEngineSync } from "@mocanvas/wasm"
import { Editor } from "../editor/Editor"
import { createStore } from "../editor/createStore"
import { Rectangle2d } from "../geometry"
import type { BaseShape } from "../records/base"
import { BaseBoxShapeUtil } from "../shapes/ShapeUtil"
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

const counts = { renders: 0, mounts: 0, unmounts: 0 }

function CardBody({ name }: { name: string }) {
  counts.renders++
  useLayoutEffect(() => {
    counts.mounts++
    return () => {
      counts.unmounts++
    }
  }, [])
  return <div data-card={name}>{name}</div>
}

type CardShape = BaseShape<"card", { w: number; h: number }>

class CardUtil extends BaseBoxShapeUtil<CardShape> {
  static override type = "card" as const
  getDefaultProps() {
    return { w: 100, h: 100 }
  }
  override getGeometry(shape: CardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  component(shape: CardShape) {
    return <CardBody name={String(shape.meta.name)} />
  }
  override indicator() {
    return null
  }
}

const VIEWPORT = { w: 800, h: 600 }

let pending = new Map<number, (time: number) => void>()
let nextHandle = 1
let clock = 0
let commits = 0

function runUntilIdle(limit = 100): void {
  for (let frames = 0; pending.size > 0 && frames < limit; frames++) {
    clock += 16
    const due = [...pending.values()]
    pending.clear()
    act(() => {
      for (const cb of due) cb(clock)
    })
  }
}

let root: Root | null = null
let host: HTMLDivElement | null = null
let editor: Editor | null = null

beforeEach(() => {
  pending = new Map()
  nextHandle = 1
  clock = 1000
  commits = 0
  counts.renders = counts.mounts = counts.unmounts = 0
  globalThis.requestAnimationFrame = ((cb: (time: number) => void) => {
    const handle = nextHandle++
    pending.set(handle, cb)
    return handle
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((handle: number) => {
    pending.delete(handle)
  }) as typeof cancelAnimationFrame
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never
  Element.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, x: 0, y: 0, width: VIEWPORT.w, height: VIEWPORT.h, right: VIEWPORT.w, bottom: VIEWPORT.h, toJSON: () => ({}) }) as DOMRect
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  host?.remove()
  host = null
  editor?.dispose()
  editor = null
})

/** A canvas with card `a` on screen and card `b` 1500 units to its right, off screen. */
function mount(): Editor {
  host = document.createElement("div")
  document.body.appendChild(host)
  editor = new Editor({
    store: createStore(),
    shapeUtils: [CardUtil],
    tools: [SelectTool],
    engine: loadEngineSync(readFileSync(wasmPath)),
    getContainer: () => host!,
  })
  editor.createShapes([
    { type: "card", x: 10, y: 10, meta: { name: "a" } },
    { type: "card", x: 1500, y: 10, meta: { name: "b" } },
  ])
  // Grid mode is on by default, and the grid is the one layer that does redraw
  // per camera move — it is handed the camera as props. These tests are about
  // everything else.
  editor.updateInstanceState({ isGridMode: false })
  root = createRoot(host)
  act(() =>
    root!.render(
      <Profiler id="canvas" onRender={() => commits++}>
        <Canvas editor={editor!} />
      </Profiler>,
    ),
  )
  runUntilIdle()
  return editor
}

const move = (fn: () => void) => {
  act(fn)
  runUntilIdle()
}

const cardElement = (name: string) => (host!.querySelector(`[data-card="${name}"]`)?.closest(".mocanvas-shape") ?? null) as HTMLElement | null
const overlayLayer = () => host!.querySelector(".mocanvas-overlay") as HTMLElement

describe("a camera move is not a React render", () => {
  it("re-renders only the grid while grid mode is on", () => {
    const editor = mount()
    act(() => editor.updateInstanceState({ isGridMode: true }))
    runUntilIdle()
    commits = 0
    const renders = counts.renders
    move(() => editor.setCamera({ x: -40, y: -20, z: 1 }))
    // One commit for the grid, and no card renders in it.
    expect(commits).toBe(1)
    expect(counts.renders).toBe(renders)
  })

  it("pans without a commit and writes the new transform straight to the layer", () => {
    const editor = mount()
    expect(cardElement("a")).not.toBeNull()
    commits = 0
    const renders = counts.renders

    move(() => editor.setCamera({ x: -40, y: -20, z: 1 }))
    move(() => editor.setCamera({ x: -80, y: -30, z: 1 }))

    expect(commits).toBe(0)
    expect(counts.renders).toBe(renders)
    expect(overlayLayer().style.transform).toBe("scale(1) translate(-80px, -30px)")
  })

  it("zooms without a commit and still restamps the zoom custom properties", () => {
    const editor = mount()
    commits = 0
    const renders = counts.renders

    move(() => editor.setCamera({ x: 0, y: 0, z: 1.25 }))

    expect(commits).toBe(0)
    expect(counts.renders).toBe(renders)
    expect(overlayLayer().style.transform).toBe("scale(1.25) translate(0px, 0px)")
    const container = host!.querySelector(".mocanvas") as HTMLElement
    expect(container.style.getPropertyValue("--mocanvas-zoom")).toBe("1.25")
    expect(container.style.getPropertyValue("--mocanvas-scale")).toBe(String(1 / 1.25))
  })

  it("lets a caller's own --mocanvas-zoom win over the camera's", () => {
    host = document.createElement("div")
    document.body.appendChild(host)
    editor = new Editor({
      store: createStore(),
      shapeUtils: [CardUtil],
      tools: [SelectTool],
      engine: loadEngineSync(readFileSync(wasmPath)),
      getContainer: () => host!,
    })
    root = createRoot(host)
    act(() => root!.render(<Canvas editor={editor!} style={{ ["--mocanvas-zoom" as string]: "3" }} />))
    runUntilIdle()
    move(() => editor!.setCamera({ x: 0, y: 0, z: 2 }))
    const container = host.querySelector(".mocanvas") as HTMLElement
    expect(container.style.getPropertyValue("--mocanvas-zoom")).toBe("3")
    expect(container.style.getPropertyValue("--mocanvas-scale")).toBe("0.5")
  })
})

describe("a card that crosses the viewport edge is not remounted", () => {
  it("mounts each card once over a pan out and back, hiding the one off screen", () => {
    const editor = mount()
    expect(counts.mounts).toBe(1)

    // `a` leaves on the left as `b` comes in on the right.
    move(() => editor.setCamera({ x: -1450, y: 0, z: 1 }))
    expect(counts.mounts).toBe(2)
    expect(counts.unmounts).toBe(0)
    expect(cardElement("a")!.dataset.retained).toBe("true")
    expect(cardElement("b")!.dataset.retained).toBeUndefined()

    move(() => editor.setCamera({ x: 0, y: 0, z: 1 }))
    expect(counts.mounts).toBe(2)
    expect(counts.unmounts).toBe(0)
    expect(cardElement("a")!.dataset.retained).toBeUndefined()
    expect(cardElement("b")!.dataset.retained).toBe("true")
  })

  it("unmounts at the edge when retention is turned off", () => {
    const editor = mount()
    editor.options.overlayRetainLimit = 0
    move(() => editor.setCamera({ x: -1450, y: 0, z: 1 }))
    expect(counts.unmounts).toBe(1)
    expect(cardElement("a")).toBeNull()
  })
})

describe("moving a shape does not re-render its body", () => {
  it("re-renders the body when props change, not when x, y or rotation do", () => {
    const editor = mount()
    const a = editor.getCurrentPageShapes().find((s) => s.meta.name === "a")!
    const renders = counts.renders

    move(() => editor.updateShapes([{ id: a.id, type: "card", x: 60, y: 40 }]))
    move(() => editor.updateShapes([{ id: a.id, type: "card", rotation: 0.2 }]))
    expect(counts.renders).toBe(renders)
    // The wrapper still moved: its transform is the shape's page transform.
    expect(cardElement("a")!.style.transform).toContain("matrix(")

    move(() => editor.updateShapes([{ id: a.id, type: "card", props: { w: 140 } }]))
    expect(counts.renders).toBe(renders + 1)
  })
})
