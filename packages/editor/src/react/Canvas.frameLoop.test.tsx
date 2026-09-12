// @vitest-environment jsdom
/**
 * The binding between the canvas's frame loop and the editor's `tick`.
 *
 * `Editor` wires its two frame-driven managers — the scribble fade and edge
 * scrolling — to a `tick` event, and nothing in the library emits it: that is
 * the host's job, and this component is the host. Nobody tested the binding,
 * and for as long as it was missing the laser tool drew no trail at all and a
 * drag never scrolled the board, while every unit test of the managers passed,
 * because a test can drive a manager by hand.
 *
 * Three things are asserted here and nowhere else. That frames carry *real*
 * elapsed milliseconds; that the loop keeps running while something is
 * animating, which the rest of it deliberately does not; and that it stops
 * again afterwards, because a canvas that holds an animation frame forever is
 * a laptop that never idles.
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

/** A backend that records nothing: this test is about the loop, not the pixels. */
const fakeBackend = {
  kind: "webgl2" as const,
  resize: vi.fn(),
  draw: vi.fn(),
  uploadTexture: vi.fn(),
  deleteTexture: vi.fn(),
  dispose: vi.fn(),
}
vi.mock("../render/webgl2", () => ({
  createBackend: () => fakeBackend,
  WebGL2Backend: class {},
}))

// `import.meta.url` is an http url under the jsdom environment, so the wasm is
// found from the working directory instead — either the package or the repo root.
const wasmPath = [resolve(process.cwd(), "../wasm/pkg/mocanvas_bg.wasm"), resolve(process.cwd(), "packages/wasm/pkg/mocanvas_bg.wasm")].find((p) => existsSync(p))!

class SelectTool extends StateNode {
  static override id = "select"
}

const VIEWPORT = { w: 800, h: 600 }

// ---- a hand-cranked animation clock ---------------------------------------

let pending = new Map<number, (time: number) => void>()
let nextHandle = 1
let clock = 0

/** Run every frame callback queued right now, `dt` milliseconds later. */
function frame(dt = 16): void {
  clock += dt
  const due = [...pending.values()]
  pending.clear()
  act(() => {
    for (const cb of due) cb(clock)
  })
}

/** Run frames until nothing schedules another one, or `limit` is reached. */
function runUntilIdle(limit = 600): number {
  let frames = 0
  while (pending.size > 0 && frames < limit) {
    frame()
    frames++
  }
  return frames
}

/** Drive the editor the way an event handler would: inside React's act scope. */
function interact(fn: () => void): void {
  act(fn)
}

let root: Root | null = null
let host: HTMLDivElement | null = null
let editor: Editor | null = null

beforeEach(() => {
  pending = new Map()
  nextHandle = 1
  clock = 1000
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
  // jsdom lays nothing out, and the canvas measures its own container to size
  // the viewport — which edge scrolling then measures the pointer against.
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

/** Mount a real `<Canvas>` over a real editor and settle its start-up frames. */
function mount(): Editor {
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
  act(() => root!.render(<Canvas editor={editor!} />))
  runUntilIdle()
  return editor
}

describe("the canvas drives the editor's tick", () => {
  it("emits one tick per frame, carrying the real elapsed milliseconds", () => {
    const editor = mount()
    const elapsed: number[] = []
    editor.on("tick", (ms) => elapsed.push(ms))

    // Something has to be animating, or the loop is entitled to stay parked.
    interact(() => editor.scribbles.startSession({ delay: 5000 }))
    // The frame that restarts a parked loop has no previous timestamp to
    // measure against, so it carries no tick rather than a made-up one.
    frame(16)
    expect(elapsed).toEqual([])

    frame(16)
    frame(32)
    frame(8)
    // Not a constant 16: the managers fade in time, not in frames, and would
    // otherwise run at half speed on a 30Hz display and double on a 120Hz one.
    expect(elapsed).toEqual([16, 32, 8])
  })

  it("clamps the jump a tab that was hidden comes back with", () => {
    const editor = mount()
    const elapsed: number[] = []
    editor.on("tick", (ms) => elapsed.push(ms))
    interact(() => editor.scribbles.startSession({ delay: 5000 }))
    frame(16)
    // rAF does not fire in a hidden tab; the next frame is minutes later. Handed
    // on whole, that one step would shed a trail and fling the camera.
    frame(120_000)
    expect(elapsed).toEqual([64])
  })

  it("never ticks while a tab is hidden, because it never asks for a frame itself", () => {
    const editor = mount()
    let ticks = 0
    editor.on("tick", () => ticks++)
    interact(() => editor.scribbles.startSession({ delay: 5000 }))
    // A hidden tab is a tab where the queued callbacks simply never run: the
    // loop has no timer of its own to keep going behind rAF's back.
    expect(pending.size).toBeGreaterThan(0)
    expect(ticks).toBe(0)
  })
})

describe("keeping the loop alive for animation", () => {
  it("commits and fades a laser trail with nothing else on the board changing", () => {
    const editor = mount()
    // The laser tool's own numbers, and its own gesture: start, move, lift.
    interact(() => editor.scribbles.startSession({ delay: 1200, shrink: 0.05, taper: true }))
    for (let i = 0; i < 20; i++) {
      interact(() => editor.scribbles.addPointToSession(i * 10, 50))
      frame()
    }

    // The trail is on the instance record, which is what the painter reads —
    // and long enough to be drawn at all (the painter skips fewer than 2 points).
    const drawn = editor.getInstanceState().scribbles[0]!
    expect(drawn.points.length).toBeGreaterThan(1)
    expect(drawn.points.at(-1)).toEqual({ x: 190, y: 50, z: 0.5 })

    // Let go. From here nothing touches the document, the camera or the
    // viewport: every remaining frame exists only because the fade asked for it.
    interact(() => editor.scribbles.stopSession())
    const frames = runUntilIdle()
    expect(frames).toBeGreaterThan(1)
    expect(editor.getInstanceState().scribbles).toEqual([])
    // And the loop let go too.
    expect(pending.size).toBe(0)
  })

  it("keeps the trail moving once it reaches its steady length", () => {
    const editor = mount()
    interact(() => editor.scribbles.startSession({ delay: 100, shrink: 0.5 }))
    for (let i = 0; i < 30; i++) {
      interact(() => editor.scribbles.addPointToSession(i * 10, 0))
      frame()
    }
    // Past the delay the trail sheds as fast as it grows, so its length stops
    // changing. Its position must not: the head follows the pointer.
    expect(editor.getInstanceState().scribbles[0]!.points.at(-1)).toEqual({ x: 290, y: 0, z: 0.5 })
  })

  it("asks for no frames at all while the canvas is idle", () => {
    mount()
    // Mounted, drawn once, nothing animating: not a single animation frame is
    // outstanding, which is the whole reason the loop is invalidation-driven.
    expect(pending.size).toBe(0)
  })
})

describe("edge scrolling", () => {
  /** Put the pointer at a screen position, the way the DOM bridge would. */
  function pointerAt(editor: Editor, x: number, y: number): void {
    interact(() =>
      editor.dispatch({
        type: "pointer",
        name: "pointer_move",
        point: { x, y },
        pointerId: 1,
        button: 0,
        isPen: false,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        accelKey: false,
        target: "canvas",
      }),
    )
  }

  /** The state a tool puts the editor in when a marquee drag starts. */
  function startDragAtLeftEdge(editor: Editor): void {
    pointerAt(editor, 2, 300)
    interact(() => {
      editor.edgeScrollManager.start()
      // A drag writes to the store as it starts, which is what wakes the loop.
      editor.updateInstanceState({ brush: { x: 0, y: 0, w: 10, h: 10 } })
    })
  }

  it("pans the camera while a drag is held against the edge", () => {
    const editor = mount()
    const before = { ...editor.getCamera() }
    startDragAtLeftEdge(editor)

    // `edgeScrollDelay` is 200ms, during which edge scrolling deliberately
    // changes nothing at all — the stretch a loop that stopped at the first
    // settled frame could never get through.
    for (let i = 0; i < 40; i++) frame()

    const after = editor.getCamera()
    expect(after.x).toBeGreaterThan(before.x)
    expect(after.y).toBe(before.y)
  })

  it("keeps the page point under the stationary pointer honest as the board moves", () => {
    const editor = mount()
    startDragAtLeftEdge(editor)
    const pageBefore = { ...editor.inputs.currentPagePoint }

    for (let i = 0; i < 40; i++) frame()

    // The pointer never moved, so a gesture reading `currentPagePoint` would
    // otherwise hold still while the board slid out from under it — the shape
    // being dragged would be left behind by its own scroll.
    expect(editor.inputs.currentPagePoint.x).not.toBe(pageBefore.x)
    expect(editor.inputs.currentPagePoint.x).toBe(editor.viewportToPage(editor.inputs.currentScreenPoint).x)
  })

  it("stops asking for frames as soon as the gesture ends", () => {
    const editor = mount()
    startDragAtLeftEdge(editor)
    for (let i = 0; i < 10; i++) frame()
    expect(pending.size).toBe(1)

    interact(() => {
      editor.edgeScrollManager.stop()
      editor.updateInstanceState({ brush: null })
    })
    runUntilIdle()
    expect(pending.size).toBe(0)
  })
})
