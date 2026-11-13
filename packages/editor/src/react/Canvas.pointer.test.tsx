// @vitest-environment jsdom
/**
 * What hovering and dragging cost the DOM overlay, in React's own currency.
 *
 * Measured in `apps/bench` (`dom-overlay.mjs`, `--why`): sweeping the pointer
 * over cards was one React commit per pointer move — the overlay layer and the
 * indicators re-rendered every time — and a drag re-rendered the overlay layer,
 * which walks every mounted shape, plus the dragged shape's wrapper on every
 * step. tldraw does neither. The counts here are exact on purpose.
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
import type { BaseShape, ShapeId } from "../records/base"
import { BaseBoxShapeUtil } from "../shapes/ShapeUtil"
import { StateNode } from "../tools/StateNode"
import { OverlayUtil } from "../indicators/OverlayUtil"
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

const renders = new Map<string, number>()

function CardBody({ name }: { name: string }) {
  renders.set(name, (renders.get(name) ?? 0) + 1)
  useLayoutEffect(() => {}, [])
  return <div data-card={name}>{name}</div>
}

type CardShape = BaseShape<"card", { w: number; h: number; label?: string }>

/** A card whose indicator is stroked on the canvas overlay, as every ported util's is. */
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
  renders.clear()
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

/** Stand-ins for the canvas painters that own the selection chrome, as `Mocanvas` registers them. */
class SelectionForeground extends OverlayUtil {
  static override type = "selectionForeground"
  render() {}
}
class ShapeHandles extends OverlayUtil {
  static override type = "shapeHandle"
  render() {}
}

/** Three cards side by side, all on screen. */
function mount(withPainters = false): { editor: Editor; ids: ShapeId[] } {
  host = document.createElement("div")
  document.body.appendChild(host)
  editor = new Editor({
    store: createStore(),
    shapeUtils: [CardUtil],
    tools: [SelectTool],
    engine: loadEngineSync(readFileSync(wasmPath)),
    getContainer: () => host!,
    ...(withPainters ? { overlayUtils: [SelectionForeground, ShapeHandles] as never } : {}),
  })
  editor.createShapes([
    { type: "card", x: 10, y: 10, meta: { name: "a" } },
    { type: "card", x: 210, y: 10, meta: { name: "b" } },
    { type: "card", x: 410, y: 10, meta: { name: "c" } },
  ])
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
  const ids = ["a", "b", "c"].map((n) => editor!.getCurrentPageShapes().find((s) => s.meta.name === n)!.id)
  return { editor, ids }
}

const step = (fn: () => void) => {
  act(fn)
  runUntilIdle()
}

const cardElement = (name: string) => (host!.querySelector(`[data-card="${name}"]`)?.closest(".mocanvas-shape") ?? null) as HTMLElement | null

describe("hovering is not a React render", () => {
  it("moves the hover from card to card without a commit", () => {
    const { editor, ids } = mount()
    commits = 0
    for (const id of [ids[0]!, ids[1]!, ids[2]!, null]) step(() => editor.setHoveredShape(id))
    expect(editor.getHoveredShapeId()).toBeNull()
    expect(commits).toBe(0)
  })

  it("rewrites the cursor with the value it already has without a commit", () => {
    // The select tool did this on every pointer move. The instance record is
    // new, though nothing in it changed that the canvas draws.
    const { editor } = mount()
    commits = 0
    for (let i = 0; i < 5; i++) step(() => editor.updateInstanceState({ cursor: { type: "default", rotation: 0 } }))
    expect(commits).toBe(0)
  })

  it("hit-tests the pointer once per move over empty canvas", () => {
    const { editor } = mount()
    const hit = vi.spyOn(editor, "getShapeAtPoint")
    const container = host!.querySelector(".mocanvas") as HTMLElement
    act(() => {
      container.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 700, clientY: 500 }))
    })
    expect(hit).toHaveBeenCalledTimes(1)
  })
})

describe("dragging a shape is a transform write", () => {
  it("moves a shape without a commit, writing only its transform", () => {
    const { editor, ids } = mount()
    commits = 0
    const before = new Map(renders)
    for (let i = 1; i <= 5; i++) step(() => editor.updateShapes([{ id: ids[1]!, type: "card", x: 210 + i * 7, y: 10 + i * 3 }]))
    expect(commits).toBe(0)
    expect(renders).toEqual(before)
    expect(cardElement("b")!.style.transform).toBe("matrix(1, 0, 0, 1, 245, 25)")
    expect(cardElement("a")!.style.transform).toBe("matrix(1, 0, 0, 1, 10, 10)")
  })

  it("drags a selected shape without a commit when the canvas paints the selection", () => {
    // With the selection chrome on the canvas overlay, the SVG layer draws
    // nothing for this shape, and used to re-render on every step to say so.
    const { editor, ids } = mount(true)
    step(() => editor.select(ids[1]!))
    commits = 0
    for (let i = 1; i <= 5; i++) step(() => editor.updateShapes([{ id: ids[1]!, type: "card", x: 210 + i * 7 }]))
    expect(commits).toBe(0)
  })

  it("still re-renders the body, and resizes the wrapper, when props change", () => {
    const { editor, ids } = mount()
    const before = renders.get("b")!
    step(() => editor.updateShapes([{ id: ids[1]!, type: "card", props: { w: 140 } }]))
    expect(renders.get("b")).toBe(before + 1)
    expect(cardElement("b")!.style.width).toBe("140px")
    step(() => editor.updateShapes([{ id: ids[1]!, type: "card", opacity: 0.5 }]))
    expect(cardElement("b")!.style.opacity).toBe("0.5")
  })

  it("keeps the props object when an update names props it does not change", () => {
    const { editor, ids } = mount()
    const props = editor.getShape(ids[1]!)!.props
    const before = renders.get("b")!
    step(() => editor.updateShapes([{ id: ids[1]!, type: "card", x: 300, props: { w: 100 } }]))
    expect(editor.getShape(ids[1]!)!.props).toBe(props)
    expect(renders.get("b")).toBe(before)
  })
})
