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
import { createPortal } from "react-dom"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loadEngineSync } from "@mocanvas/wasm"
import { Editor } from "../editor/Editor"
import { createStore } from "../editor/createStore"
import { StateNode } from "../tools/StateNode"
import { Canvas, CanvasComponentsProvider } from "./Canvas"
import { DefaultCanvas } from "./defaultEditorComponents"
import { EditorProvider } from "./EditorContext"

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

/**
 * The canvas an APP renders.
 *
 * Routing the slots as a prop from `Mocanvas` was not enough: fill the
 * `ContextMenu` slot and the chrome renders that component instead of the
 * canvas, and it renders the canvas itself — as `DefaultCanvas`, which takes no
 * props. Molekula does exactly this, so the first fix left its front layer
 * missing for the same reason as before.
 */
describe("a canvas rendered by the app", () => {
  function mountUnderProvider(components: Parameters<typeof Canvas>[0]["components"], inner: () => React.ReactNode) {
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
    act(() =>
      root!.render(
        <EditorProvider editor={editor!}>
          <CanvasComponentsProvider components={components}>{inner()}</CanvasComponentsProvider>
        </EditorProvider>,
      ),
    )
  }

  it("inherits the slots from the provider, with no props of its own", () => {
    mountUnderProvider({ InFrontOfTheCanvas: () => <button type="button">Duplicate</button> }, () => <DefaultCanvas />)
    expect(layer()?.querySelector("button")?.textContent).toBe("Duplicate")
  })

  it("lets its own prop win over the provider, slot by slot", () => {
    mountUnderProvider({ InFrontOfTheCanvas: () => <span>from the provider</span> }, () => (
      <Canvas editor={editor!} components={{ InFrontOfTheCanvas: () => <span>from the prop</span> }} />
    ))
    expect(layer()?.textContent).toBe("from the prop")
  })

  it("keeps a provider slot the prop does not mention", () => {
    mountUnderProvider({ InFrontOfTheCanvas: () => <span>still here</span> }, () => (
      <Canvas editor={editor!} components={{ Grid: null }} />
    ))
    expect(layer()?.textContent).toBe("still here")
  })
})

/**
 * A press on something in the layer is not a press on the canvas.
 *
 * The layer renders inside the element the canvas's pointer handlers sit on,
 * so the app's own button also read as a click on empty canvas: the selection
 * cleared, the canvas took the pointer capture, and the button never saw the
 * `pointerup` or the click at all. Molekula's selection toolbar did nothing on
 * 4.12.1 for exactly this reason.
 */
/**
 * jsdom has neither `PointerEvent` nor pointer capture, and React only listens
 * for pointer events when `window.PointerEvent` exists — a `MouseEvent` named
 * `pointerdown` reaches no handler at all, which makes a test written that way
 * pass while proving nothing.
 */
function installPointerEvents(): void {
  class FakePointerEvent extends MouseEvent {
    pointerId: number
    pointerType: string
    isPrimary = true
    constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 1
      this.pointerType = init.pointerType ?? "mouse"
    }
  }
  ;(globalThis as { PointerEvent?: unknown }).PointerEvent = FakePointerEvent
  ;(window as unknown as { PointerEvent?: unknown }).PointerEvent = FakePointerEvent
  const el = Element.prototype as unknown as Record<string, unknown>
  el["setPointerCapture"] ??= function () {}
  el["releasePointerCapture"] ??= function () {}
  el["hasPointerCapture"] ??= function () {
    return false
  }
}

function pointerEvent(type: string): Event {
  const Ctor = (globalThis as { PointerEvent: new (t: string, i: unknown) => Event }).PointerEvent
  return new Ctor(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: 40, clientY: 40, pointerId: 1, pointerType: "mouse" })
}

describe("pointer events from the layer", () => {
  /** What the canvas told the editor, which is the only thing that separates the two cases. */
  function recordDispatches(ed: Editor): string[] {
    const seen: string[] = []
    const original = ed.dispatch.bind(ed)
    ;(ed as unknown as { dispatch: (info: { type: string; name: string }) => void }).dispatch = (info) => {
      seen.push(`${info.type}:${info.name}`)
      original(info as never)
    }
    return seen
  }

  function press(el: Element): void {
    for (const type of ["pointerdown", "pointerup"]) {
      act(() => {
        el.dispatchEvent(pointerEvent(type))
      })
    }
  }

  it("does not reach the editor, and the button keeps its click", () => {
    installPointerEvents()
    let clicks = 0
    mount({
      InFrontOfTheCanvas: () => (
        <button type="button" onClick={() => (clicks += 1)}>
          Duplicate
        </button>
      ),
    })
    const seen = recordDispatches(editor!)
    const button = layer()!.querySelector("button")!

    press(button)
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(clicks).toBe(1)
    expect(seen.filter((e) => e.startsWith("pointer:"))).toEqual([])
  })

  it("still reaches the editor from the canvas itself", () => {
    installPointerEvents()
    mount({ InFrontOfTheCanvas: () => <button type="button">Duplicate</button> })
    const seen = recordDispatches(editor!)

    press(host!.querySelector('[data-testid="mocanvas-container"]')!)

    expect(seen).toContain("pointer:pointer_down")
    expect(seen).toContain("pointer:pointer_up")
  })
})

/**
 * A press that began somewhere else.
 *
 * Every popover library portals its menu into `<body>`, outside the canvas and
 * outside the layer in front of it. The menu closes on the press, so by the
 * time the release fires the node under the pointer is gone and the browser
 * sends the release to the canvas — which read it as a click on empty canvas,
 * cleared the selection, and left the menu item's own click unfired.
 */
describe("a press that started outside the canvas", () => {
  it("does not make its release a click on the canvas", () => {
    installPointerEvents()
    mount()
    const seen: string[] = []
    const original = editor!.dispatch.bind(editor!)
    ;(editor as unknown as { dispatch: (info: { type: string; name: string }) => void }).dispatch = (info) => {
      seen.push(`${info.type}:${info.name}`)
      original(info as never)
    }

    // The press lands on a node outside the canvas, as a portalled menu is.
    const outside = document.createElement("div")
    document.body.appendChild(outside)
    act(() => {
      outside.dispatchEvent(pointerEvent("pointerdown"))
    })
    // The node goes away with the menu, and the release arrives here instead.
    outside.remove()
    act(() => {
      host!.querySelector('[data-testid="mocanvas-container"]')!.dispatchEvent(pointerEvent("pointerup"))
    })

    expect(seen).toEqual([])
  })

  it("still handles a press and release of its own", () => {
    installPointerEvents()
    mount()
    const seen: string[] = []
    const original = editor!.dispatch.bind(editor!)
    ;(editor as unknown as { dispatch: (info: { type: string; name: string }) => void }).dispatch = (info) => {
      seen.push(`${info.type}:${info.name}`)
      original(info as never)
    }
    const container = host!.querySelector('[data-testid="mocanvas-container"]')!
    act(() => {
      container.dispatchEvent(pointerEvent("pointerdown"))
    })
    act(() => {
      container.dispatchEvent(pointerEvent("pointerup"))
    })
    expect(seen).toContain("pointer:pointer_down")
    expect(seen).toContain("pointer:pointer_up")
  })
})

/**
 * A menu a panel portals into `<body>`.
 *
 * React delivers events along its own tree, not the DOM's, so a portal is a
 * child of whatever rendered it however far away the node sits. A colour
 * swatch in a menu portalled out of the canvas's own chrome therefore ran the
 * canvas's `pointerdown` — which captured the pointer, so the release was
 * retargeted to the canvas and the swatch never saw its own click. That is the
 * consumer's whole toolbar: colour, fill, font, size, alignment.
 */
describe("a menu portalled out of the canvas", () => {
  it("keeps its press and its click to itself", () => {
    installPointerEvents()
    host = document.createElement("div")
    document.body.appendChild(host)
    editor = new Editor({
      store: createStore(),
      shapeUtils: [],
      tools: [SelectTool],
      engine: loadEngineSync(readFileSync(wasmPath)),
      getContainer: () => host!,
    })
    let clicks = 0
    function Menu() {
      return createPortal(
        <button type="button" data-testid="swatch" onClick={() => (clicks += 1)}>
          Red
        </button>,
        document.body,
      )
    }
    root = createRoot(host)
    act(() => root!.render(<Canvas editor={editor!} components={{ InFrontOfTheCanvas: () => <Menu /> }} />))

    const seen: string[] = []
    const original = editor.dispatch.bind(editor)
    ;(editor as unknown as { dispatch: (info: { type: string; name: string }) => void }).dispatch = (info) => {
      seen.push(`${info.type}:${info.name}`)
      original(info as never)
    }

    const swatch = document.querySelector('[data-testid="swatch"]')!
    expect(swatch.closest(".mocanvas")).toBeNull()
    act(() => {
      swatch.dispatchEvent(pointerEvent("pointerdown"))
    })
    act(() => {
      swatch.dispatchEvent(pointerEvent("pointerup"))
    })
    act(() => {
      swatch.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(seen).toEqual([])
    expect(clicks).toBe(1)
  })
})
