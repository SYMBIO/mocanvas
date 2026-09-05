// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { loadEngineSync, type StyleWords } from "@mocanvas/wasm"
import { Editor } from "../editor/Editor"
import { createStore } from "../editor/createStore"
import type { ClickEventInfo, EventInfo, PointerEventInfo } from "../editor/events"
import { Rectangle2d } from "../geometry"
import type { BaseShape, ShapeId } from "../records/base"
import { BaseBoxShapeUtil } from "../shapes/ShapeUtil"
import { StateNode } from "../tools/StateNode"
import { useCanvasEvents } from "./useCanvasEvents"

/**
 * The DOM → editor event bridge: which browser events become editor events at
 * all, and what page point they resolve against.
 */

// `import.meta.url` is an http url under the jsdom environment, so the wasm is
// found from the working directory instead — either the package or the repo root.
const wasmPath = [resolve(process.cwd(), "../wasm/pkg/mocanvas_bg.wasm"), resolve(process.cwd(), "packages/wasm/pkg/mocanvas_bg.wasm")].find((p) => existsSync(p))!

type BoxShape = BaseShape<"box", { w: number; h: number }>

class BoxUtil extends BaseBoxShapeUtil<BoxShape> {
  static override type = "box" as const
  override getDefaultProps() {
    return { w: 100, h: 100 }
  }
  override getGeometry(shape: BoxShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  override component() {
    return null
  }
  override indicator() {
    return null
  }
  override getRenderStyle(): StyleWords {
    return { fill: 0xff0000ff, stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 }
  }
}

class SelectTool extends StateNode {
  static override id = "select"
}

/** The container sits at (200, 100) in the window — the offset the two spaces differ by. */
const CONTAINER_OFFSET = { left: 200, top: 100 }

let editors: Editor[] = []

function makeEditor(): { editor: Editor; container: HTMLDivElement } {
  const engine = loadEngineSync(readFileSync(wasmPath))
  const container = document.createElement("div")
  container.getBoundingClientRect = () =>
    ({ left: CONTAINER_OFFSET.left, top: CONTAINER_OFFSET.top, x: CONTAINER_OFFSET.left, y: CONTAINER_OFFSET.top, width: 800, height: 600, right: 1000, bottom: 700, toJSON: () => ({}) }) as DOMRect
  const editor = new Editor({
    store: createStore(),
    shapeUtils: [BoxUtil],
    tools: [SelectTool],
    engine,
    getContainer: () => container,
  })
  editor.updateViewportScreenBounds({ x: CONTAINER_OFFSET.left, y: CONTAINER_OFFSET.top, w: 800, h: 600 })
  editors.push(editor)
  return { editor, container }
}

afterEach(() => {
  for (const editor of editors) editor.dispose()
  editors = []
})

type Handlers = ReturnType<typeof useCanvasEvents>

/** `useCanvasEvents` is a `useMemo`, so one render is enough to get its handlers out. */
function handlersFor(editor: Editor): Handlers {
  let handlers: Handlers | null = null
  function Probe() {
    handlers = useCanvasEvents(editor)
    return null
  }
  renderToStaticMarkup(<Probe />)
  return handlers!
}

/** A pointer event shaped enough for the bridge, with a capture-aware `currentTarget`. */
function pointerEvent(over: Partial<Record<string, unknown>> = {}) {
  const target = { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => false, focus: vi.fn() }
  return {
    nativeEvent: new Event("pointerdown"),
    clientX: 0,
    clientY: 0,
    pointerId: 1,
    button: 0,
    buttons: 1,
    pointerType: "mouse",
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    currentTarget: target,
    ...over,
  } as never
}

describe("events a shape already dealt with", () => {
  it("does not turn a marked pointer event into an editor event", () => {
    const { editor } = makeEditor()
    const dispatch = vi.spyOn(editor, "dispatch")
    const handlers = handlersFor(editor)

    const event = pointerEvent()
    editor.markEventAsHandled(event)
    handlers.onPointerDown(event)
    expect(dispatch).not.toHaveBeenCalled()

    // The very same shape of event, unmarked, does dispatch.
    handlers.onPointerDown(pointerEvent())
    expect(dispatch).toHaveBeenCalled()
  })

  it("gates key events too, so a shape's own editor can swallow a key", () => {
    const { editor } = makeEditor()
    const dispatch = vi.spyOn(editor, "dispatch")
    const handlers = handlersFor(editor)

    const down = new KeyboardEvent("keydown", { key: "a", code: "KeyA" })
    editor.markEventAsHandled(down)
    handlers.onKeyDown(down)
    expect(dispatch).not.toHaveBeenCalled()

    handlers.onKeyDown(new KeyboardEvent("keydown", { key: "a", code: "KeyA" }))
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it("marks are per event object, so the next event is unaffected", () => {
    const { editor } = makeEditor()
    const handled = pointerEvent()
    editor.markEventAsHandled(handled)
    expect(editor.isEventHandled(handled)).toBe(true)
    expect(editor.isEventHandled(pointerEvent())).toBe(false)
  })
})

describe("the point an event resolves against", () => {
  it("hit-tests in viewport space — the container's window offset is subtracted once, not twice", () => {
    const { editor } = makeEditor()
    editor.createShapes([{ type: "box", x: 0, y: 0, props: { w: 100, h: 100 } }])
    const shapeId = editor.getCurrentPageShapes()[0]!.id as ShapeId

    const events: EventInfo[] = []
    vi.spyOn(editor, "dispatch").mockImplementation((info: EventInfo) => {
      events.push(info)
      return editor
    })
    const handlers = handlersFor(editor)

    // Page (50, 50) is at viewport (50, 50) with the camera at rest, which is
    // window (250, 150) because the container sits at (200, 100).
    handlers.onPointerDown(pointerEvent({ clientX: CONTAINER_OFFSET.left + 50, clientY: CONTAINER_OFFSET.top + 50 }))

    const down = events.find((e): e is PointerEventInfo => e.type === "pointer" && e.name === "pointer_down")
    expect(down).toBeDefined()
    expect(down!.target).toBe("shape")
    expect(down!.target === "shape" ? down!.shape.id : null).toBe(shapeId)
    // The event's own point stays container-relative.
    expect(down!.point.x).toBe(50)
    expect(down!.point.y).toBe(50)
  })

  it("misses the shape when the pointer is outside it", () => {
    const { editor } = makeEditor()
    editor.createShapes([{ type: "box", x: 0, y: 0, props: { w: 100, h: 100 } }])

    const events: EventInfo[] = []
    vi.spyOn(editor, "dispatch").mockImplementation((info: EventInfo) => {
      events.push(info)
      return editor
    })
    const handlers = handlersFor(editor)
    handlers.onPointerDown(pointerEvent({ clientX: CONTAINER_OFFSET.left + 500, clientY: CONTAINER_OFFSET.top + 400 }))

    const down = events.find((e): e is PointerEventInfo => e.type === "pointer" && e.name === "pointer_down")!
    expect(down.target).toBe("canvas")
  })
})

describe("multi-click", () => {
  // The clock and `dispatch` are stubbed per test; nothing outside this block
  // should inherit a frozen `performance.now`.
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Drives n press/release pairs at the same point, `gapMs` apart, and returns the click events. */
  function clickRun(editor: Editor, count: number, gapMs = 50): EventInfo[] {
    const events: EventInfo[] = []
    vi.spyOn(editor, "dispatch").mockImplementation((info: EventInfo) => {
      events.push(info)
      return editor
    })
    let t = 1000
    vi.spyOn(performance, "now").mockImplementation(() => t)
    const handlers = handlersFor(editor)
    for (let i = 0; i < count; i++) {
      handlers.onPointerDown(pointerEvent())
      handlers.onPointerUp(pointerEvent({ nativeEvent: new Event("pointerup"), buttons: 0 }))
      t += gapMs
    }
    return events.filter((e) => e.type === "click")
  }

  // Detection lives in `editor.click` (`ClickManager`), which reports one double
  // click in phases: `down` when the second press lands, `up` when it is
  // released. A tool that wants to feel responsive acts on `down`; the built-in
  // tools act on `up`, and filter on the phase to say so.
  const phases = (clicks: EventInfo[]) => clicks.map((c) => `${c.name}:${(c as ClickEventInfo).phase}`)

  it("reports one double click, in its down and up phases", () => {
    const { editor } = makeEditor()
    expect(phases(clickRun(editor, 2))).toEqual(["double_click:down", "double_click:up"])
  })

  it("does not report a triple click — the run ends at two", () => {
    const { editor } = makeEditor()
    // Three fast clicks used to produce double_click then triple_click.
    expect(phases(clickRun(editor, 3))).toEqual(["double_click:down", "double_click:up"])
  })

  it("does not report a quadruple click either — presses overflow until the window lapses", () => {
    const { editor } = makeEditor()
    // The third press does NOT start a fresh run: once a double click has been
    // reported, further presses inside the window stop counting, so frantic
    // clicking opens a label editor once rather than twice.
    expect(phases(clickRun(editor, 4))).toEqual(["double_click:down", "double_click:up"])
  })

  it("needs the two presses to be close together in time", () => {
    const { editor } = makeEditor()
    expect(clickRun(editor, 2, 500)).toEqual([])
  })
})
