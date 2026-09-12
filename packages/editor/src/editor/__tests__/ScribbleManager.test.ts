/**
 * The fade of a scribble, driven one tick at a time.
 *
 * `ScribbleManager` buffers offered points and only commits them on a tick, so
 * every one of these behaviours — the trail existing at all, the `delay` before
 * it starts retracting, `shrink` controlling how fast it does — is invisible
 * until something drives frames. It went unnoticed for exactly that reason:
 * nothing emitted `tick`, so the manager was never wrong, it was only stopped.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { loadEngineSync } from "@mocanvas/wasm"
import { Editor } from "../Editor"
import { createStore } from "../createStore"
import { StateNode } from "../../tools/StateNode"

const wasmPath = fileURLToPath(new URL("../../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

class SelectTool extends StateNode {
  static override id = "select"
}

let editors: Editor[] = []

function makeEditor(): Editor {
  const editor = new Editor({
    store: createStore(),
    shapeUtils: [],
    tools: [SelectTool],
    engine: loadEngineSync(readFileSync(wasmPath)),
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 800, h: 600 })
  editors.push(editor)
  return editor
}

afterEach(() => {
  for (const editor of editors) editor.dispose()
  editors = []
})

/** Drive `n` frames of 16ms, offering a point before each one. */
function drawFrames(editor: Editor, n: number, at: (i: number) => [number, number]): void {
  for (let i = 0; i < n; i++) {
    const [x, y] = at(i)
    editor.scribbles.addPointToSession(x, y)
    editor.emit("tick", 16)
  }
}

describe("committing points", () => {
  it("holds an offered point until a tick, then commits it", () => {
    const editor = makeEditor()
    const item = editor.scribbles.startSession({ delay: 1000 })
    editor.scribbles.addPointToSession(10, 20)

    // Buffered, not committed: the point is in `next` and nowhere else.
    expect(item.next).toEqual({ x: 10, y: 20, z: 0.5 })
    expect(item.scribble.points).toEqual([])

    editor.emit("tick", 16)
    expect(item.next).toBeNull()
    expect(editor.scribbles.getItems()[0]!.scribble.points).toEqual([{ x: 10, y: 20, z: 0.5 }])
  })

  it("takes at most one point per tick, so the trail is the same shape at any frame rate", () => {
    const editor = makeEditor()
    editor.scribbles.startSession({ delay: 1000 })
    for (let i = 0; i < 10; i++) editor.scribbles.addPointToSession(i, i)
    editor.emit("tick", 16)
    // Only the last offer survives; nine intermediate pointer moves in one
    // frame do not become nine points.
    expect(editor.scribbles.getItems()[0]!.scribble.points).toEqual([{ x: 9, y: 9, z: 0.5 }])
  })

  it("ignores a repeat of the point it already has, so a held pointer does not stack", () => {
    const editor = makeEditor()
    editor.scribbles.startSession({ delay: 1000 })
    drawFrames(editor, 5, () => [3, 4])
    expect(editor.scribbles.getItems()[0]!.scribble.points).toHaveLength(1)
  })

  it("mirrors the committed points onto the instance record, which is what gets painted", () => {
    const editor = makeEditor()
    editor.scribbles.startSession({ delay: 1000 })
    drawFrames(editor, 3, (i) => [i * 10, 0])
    const [scribble] = editor.getInstanceState().scribbles
    expect(scribble!.points).toHaveLength(3)
    // The painter skips anything shorter than two points: a trail that never
    // committed is a trail nobody can see.
    expect(scribble!.points.length).toBeGreaterThan(1)
  })

  it("moves off `starting` once there is a line to draw", () => {
    const editor = makeEditor()
    editor.scribbles.startSession({ delay: 1000 })
    drawFrames(editor, 1, () => [0, 0])
    expect(editor.scribbles.getItems()[0]!.scribble.state).toBe("starting")
    drawFrames(editor, 1, () => [10, 0])
    expect(editor.scribbles.getItems()[0]!.scribble.state).toBe("active")
  })
})

describe("delay, shrink and taper", () => {
  it("keeps the whole trail for `delay` milliseconds, in time and not in frames", () => {
    const editor = makeEditor()
    // 320ms of delay, spent at two different frame rates. Both must burn the
    // same amount of it: a fade measured in frames runs at half speed on a
    // 30Hz display.
    const slow = makeEditor()
    editor.scribbles.startSession({ delay: 320, shrink: 0.5 })
    slow.scribbles.startSession({ delay: 320, shrink: 0.5 })
    for (let i = 0; i < 20; i++) {
      editor.scribbles.addPointToSession(i * 5, 0)
      editor.emit("tick", 16)
    }
    for (let i = 0; i < 10; i++) {
      slow.scribbles.addPointToSession(i * 5, 0)
      slow.emit("tick", 32)
    }
    // Both burned exactly the 320ms; neither has shed anything yet.
    expect(editor.scribbles.getItems()[0]!.scribble.points).toHaveLength(20)
    expect(slow.scribbles.getItems()[0]!.scribble.points).toHaveLength(10)

    editor.emit("tick", 16)
    slow.emit("tick", 32)
    expect(editor.scribbles.getItems()[0]!.scribble.points.length).toBeLessThan(20)
    expect(slow.scribbles.getItems()[0]!.scribble.points.length).toBeLessThan(10)
  })

  it("sheds from the head, so the trail follows the pointer rather than eating its own tip", () => {
    const editor = makeEditor()
    editor.scribbles.startSession({ delay: 0, shrink: 0.5 })
    drawFrames(editor, 6, (i) => [i * 10, 0])
    const points = editor.scribbles.getItems()[0]!.scribble.points
    // Whatever survived, the newest point is still the last one in the array.
    expect(points.at(-1)).toEqual({ x: 50, y: 0, z: 0.5 })
  })

  it("sheds faster with a bigger `shrink`", () => {
    const lengths = [0.05, 0.5].map((shrink) => {
      const editor = makeEditor()
      editor.scribbles.startSession({ delay: 200, shrink })
      drawFrames(editor, 40, (i) => [i * 5, 0])
      return editor.scribbles.getItems()[0]!.scribble.points.length
    })
    expect(lengths[0]!).toBeGreaterThan(lengths[1]!)
  })

  it("carries `taper` through to the record the painter reads", () => {
    const editor = makeEditor()
    editor.scribbles.startSession({ taper: false, delay: 1000 })
    drawFrames(editor, 2, (i) => [i, 0])
    expect(editor.getInstanceState().scribbles[0]!.taper).toBe(false)
    editor.scribbles.clearSession()
    editor.scribbles.startSession({ taper: true, delay: 1000 })
    drawFrames(editor, 2, (i) => [i, 0])
    expect(editor.getInstanceState().scribbles[0]!.taper).toBe(true)
  })

  it("a laser stroke survives the gesture and then fades away on its own", () => {
    const editor = makeEditor()
    // The laser tool's own numbers.
    editor.scribbles.startSession({ delay: 1200, shrink: 0.05, taper: true })
    drawFrames(editor, 30, (i) => [i * 8, 0])
    // Half a second in, the whole sweep is still on screen — this is the trail
    // the bug report said was missing.
    expect(editor.scribbles.getItems()[0]!.scribble.points).toHaveLength(30)

    editor.scribbles.stopSession()
    expect(editor.scribbles.getItems()[0]!.scribble.state).toBe("stopping")
    // It does not vanish the instant the pointer lifts...
    for (let i = 0; i < 6; i++) editor.emit("tick", 16)
    expect(editor.scribbles.getItems()[0]!.scribble.points.length).toBeGreaterThan(0)
    // ...and it does not hang around forever either.
    for (let i = 0; i < 300; i++) editor.emit("tick", 16)
    expect(editor.scribbles.getItems()).toHaveLength(0)
    expect(editor.getInstanceState().scribbles).toEqual([])
  })
})

describe("hasPendingWork", () => {
  it("is false with nothing to animate, so an idle canvas can park its loop", () => {
    const editor = makeEditor()
    expect(editor.scribbles.hasPendingWork()).toBe(false)
  })

  it("is true from the moment a scribble exists until it has faded out", () => {
    const editor = makeEditor()
    editor.scribbles.startSession({ delay: 0, shrink: 1 })
    expect(editor.scribbles.hasPendingWork()).toBe(true)
    drawFrames(editor, 3, (i) => [i * 10, 0])
    editor.scribbles.stopSession()
    // Still true while the tail is retracting: those frames have to come from
    // somewhere, and nothing else on the board is changing.
    expect(editor.scribbles.hasPendingWork()).toBe(true)
    for (let i = 0; i < 300; i++) editor.emit("tick", 16)
    expect(editor.scribbles.hasPendingWork()).toBe(false)
  })

  it("stays true while a point is buffered but uncommitted", () => {
    const editor = makeEditor()
    editor.scribbles.startSession({ delay: 0 })
    editor.scribbles.addPointToSession(1, 1)
    // `addPoint` writes nothing to the store, so a loop that stopped here would
    // never wake up to commit it.
    expect(editor.scribbles.hasPendingWork()).toBe(true)
  })
})
