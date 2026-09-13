// @vitest-environment jsdom
/**
 * One broken shape used to take the whole application down.
 *
 * `ErrorBoundary` was written, exported, and mounted nowhere; `ErrorFallback`
 * and `ShapeErrorFallback` were documented slots nothing rendered. Its own
 * docstring described the arrangement — "`<Canvas>` wraps each shape body in a
 * boundary of its own, and the editor as a whole is wrapped in another" — and
 * described something that did not exist. So a `TypeError` in one custom
 * `ShapeUtil.component` unmounted the editor and, with no boundary above it in
 * the host either, usually the page.
 */
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loadEngineSync } from "@mocanvas/wasm"
import { Editor } from "../editor/Editor"
import { createStore } from "../editor/createStore"
import { createShapeId } from "../records/base"
import { Rectangle2d } from "../geometry"
import type { BaseShape } from "../records/base"
import { BaseBoxShapeUtil } from "../shapes/ShapeUtil"
import { StateNode } from "../tools/StateNode"
import { Canvas } from "./Canvas"
import { MocanvasUiProvider } from "./ui-context"
import type { TLEditorComponents } from "./defaultEditorComponents"

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

type BoxShape = BaseShape<"box", { w: number; h: number }>

/**
 * A shape with a DOM body that throws — the failure this file exists for.
 *
 * `getRenderStyle` is left at its default `null`, which is what puts the shape
 * in the DOM overlay rather than on the GPU; that is the only path where a
 * shape body runs React at all.
 */
class ExplodingUtil extends BaseBoxShapeUtil<BoxShape> {
  static override type = "box" as const
  override getDefaultProps() {
    return { w: 100, h: 100 }
  }
  override getGeometry(shape: BoxShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  override component(shape: BoxShape): ReactNode {
    throw new Error(`the body of ${shape.id} is broken`)
  }
  override indicator() {
    return null
  }
}

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
  // React logs a caught boundary error; the test is about the containment.
  vi.spyOn(console, "error").mockImplementation(() => {})
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

/**
 * Mount a canvas whose `Indicators` slot throws on render.
 *
 * The throwing slot goes in through the `components` *prop*, which is where
 * `Canvas` reads its own layers from. The `ErrorFallback` slot does not: it is
 * an editor-level slot, read from the UI provider, because the boundary sits
 * above the body that receives the prop. So `slots` is provided the way a host
 * provides it.
 */
function mountWithThrowingSlot(slots?: Partial<TLEditorComponents>, prop?: Parameters<typeof Canvas>[0]["components"]) {
  host = document.createElement("div")
  document.body.appendChild(host)
  editor = new Editor({
    store: createStore(),
    shapeUtils: [],
    tools: [SelectTool],
    engine: loadEngineSync(readFileSync(wasmPath)),
    getContainer: () => host!,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 800, h: 600 })
  root = createRoot(host)
  const Boom = () => {
    throw new Error("the indicators are broken")
  }
  const canvas = <Canvas editor={editor!} components={{ Indicators: Boom, ...prop }} />
  act(() =>
    root!.render(
      slots ? (
        <MocanvasUiProvider editor={editor!} components={slots}>
          {canvas}
        </MocanvasUiProvider>
      ) : (
        canvas
      ),
    ),
  )
  return editor
}

describe("the editor-wide boundary", () => {
  it("shows a fallback instead of unmounting the app", () => {
    mountWithThrowingSlot()
    expect(host!.querySelector(".mocanvas-error-fallback"), "no fallback — the tree unmounted").not.toBeNull()
    expect(host!.textContent).toMatch(/something went wrong/i)
  })

  it("reports what was thrown rather than swallowing it", () => {
    mountWithThrowingSlot()
    expect(host!.textContent).toMatch(/indicators are broken/)
  })

  it("logs it, so a host's error tracker sees it", () => {
    const spy = console.error as unknown as ReturnType<typeof vi.fn>
    mountWithThrowingSlot()
    const said = spy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n")
    expect(said).toMatch(/mocanvas: the editor stopped/)
  })

  it("lets a host replace the screen", () => {
    mountWithThrowingSlot({ ErrorFallback: () => <div data-testid="mine" /> })
    expect(host!.querySelector('[data-testid="mine"]')).not.toBeNull()
    expect(host!.querySelector(".mocanvas-error-fallback")).toBeNull()
  })

  it("lets a host show nothing, for one that has its own error UI outside", () => {
    mountWithThrowingSlot({ ErrorFallback: null })
    expect(host!.querySelector(".mocanvas-error-fallback")).toBeNull()
    // The point is that it did not throw past the boundary.
    expect(host!.textContent).toBe("")
  })
})

/**
 * Mount a canvas holding one shape whose body throws.
 *
 * The overlay list is filled by `renderFrame` — the engine says which shapes
 * have a DOM body — so the frame is driven by hand rather than waited for: the
 * component's own loop is rAF-driven and the backend here is a stub.
 */
function mountWithBrokenShape(slots?: Partial<TLEditorComponents>, prop?: Parameters<typeof Canvas>[0]["components"]) {
  host = document.createElement("div")
  document.body.appendChild(host)
  editor = new Editor({
    store: createStore(),
    shapeUtils: [ExplodingUtil],
    tools: [SelectTool],
    engine: loadEngineSync(readFileSync(wasmPath)),
    getContainer: () => host!,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 800, h: 600 })
  editor.createShapes([{ id: createShapeId(), type: "box", x: 10, y: 10 }] as never)
  root = createRoot(host)
  const canvas = <Canvas editor={editor!} components={prop ?? {}} />
  act(() =>
    root!.render(
      slots ? (
        <MocanvasUiProvider editor={editor!} components={slots}>
          {canvas}
        </MocanvasUiProvider>
      ) : (
        canvas
      ),
    ),
  )
  act(() => {
    editor!.renderFrame(fakeBackend as never)
  })
  return editor
}

describe("a shape whose body throws", () => {
  it("is the only thing that fails — the canvas stays mounted", () => {
    mountWithBrokenShape()
    expect(host!.querySelector(".mocanvas-overlay"), "the whole canvas went down with one shape").not.toBeNull()
    expect(host!.querySelector(".mocanvas-error-fallback"), "the editor-wide fallback took over").toBeNull()
  })

  it("leaves a marker where the shape was", () => {
    mountWithBrokenShape()
    expect(host!.querySelector(".mocanvas-shape-error")).not.toBeNull()
  })

  it("names the shape in the log, since the throw itself does not", () => {
    const spy = console.error as unknown as ReturnType<typeof vi.fn>
    mountWithBrokenShape()
    const said = spy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n")
    expect(said).toMatch(/mocanvas: the "box" shape shape:[^ ]+ failed to render/)
  })

  it("lets a host draw its own marker", () => {
    mountWithBrokenShape({ ShapeErrorFallback: () => <div data-testid="mine" /> })
    expect(host!.querySelector('[data-testid="mine"]')).not.toBeNull()
  })

  it("lets a host leave a hole, for a board that should look untouched", () => {
    mountWithBrokenShape({ ShapeErrorFallback: null })
    expect(host!.querySelector(".mocanvas-shape-error")).toBeNull()
    expect(host!.querySelector(".mocanvas-overlay")).not.toBeNull()
  })
})

/**
 * Both fallbacks used to be provider-only while every other slot on the
 * `components` prop was prop-only — the same names resolved from two different
 * places depending on which boundary you meant. A host that passed
 * `components={{ ErrorFallback }}` to `<Canvas>`, which is what the prop's own
 * type invites, got the built-in screen and no indication why.
 */
describe("where a fallback may be configured", () => {
  it("takes the editor-wide one from the `components` prop", () => {
    mountWithThrowingSlot(undefined, { ErrorFallback: () => <div data-testid="prop" /> })
    expect(host!.querySelector('[data-testid="prop"]')).not.toBeNull()
  })

  it("takes the per-shape one from the `components` prop", () => {
    mountWithBrokenShape(undefined, { ShapeErrorFallback: () => <div data-testid="prop" /> })
    expect(host!.querySelector('[data-testid="prop"]')).not.toBeNull()
  })

  it("lets the prop win over the provider, as it does for every other slot", () => {
    mountWithThrowingSlot({ ErrorFallback: () => <div data-testid="provider" /> }, { ErrorFallback: () => <div data-testid="prop" /> })
    expect(host!.querySelector('[data-testid="prop"]')).not.toBeNull()
    expect(host!.querySelector('[data-testid="provider"]')).toBeNull()
  })

  it("reads `null` on the prop as an answer rather than a miss", () => {
    mountWithThrowingSlot({ ErrorFallback: () => <div data-testid="provider" /> }, { ErrorFallback: null })
    expect(host!.textContent).toBe("")
  })

  it("still falls through to the provider when the prop says nothing", () => {
    mountWithBrokenShape({ ShapeErrorFallback: () => <div data-testid="provider" /> }, { Grid: null })
    expect(host!.querySelector('[data-testid="provider"]')).not.toBeNull()
  })
})
