import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { EngineBridge, FLAG, PATH_OP, loadEngineSync } from "./index"

const wasmPath = fileURLToPath(new URL("../pkg/mocanvas_bg.wasm", import.meta.url))

function rectPath(w: number, h: number): number[] {
  return [PATH_OP.MOVE, 0, 0, PATH_OP.LINE, w, 0, PATH_OP.LINE, w, h, PATH_OP.LINE, 0, h, PATH_OP.CLOSE]
}

describe("EngineBridge", () => {
  const bridge = loadEngineSync(readFileSync(wasmPath))

  it("upserts shapes, frames, hit tests and culls", () => {
    for (let h = 1; h <= 100; h++) {
      bridge.cmd.upsert(h, 1, 0, h, 0, 0, h * 200, 0, 0, 100, 100)
      bridge.cmd.setGeometry(h, rectPath(100, 100))
      bridge.cmd.setStyle(h, { fill: 0xff0000ff, stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 })
    }
    expect(bridge.cmd.flush()).toBe(300)
    expect(bridge.shapeCount).toBe(100)

    const f = bridge.frame({ x: 0, y: 0, z: 1 }, 1000, 500)
    expect(f.drawn).toBe(5)
    expect(f.culled).toBe(95)
    expect(f.indices.length).toBe(5 * 6)
    expect(f.vertices.length).toBe(5 * 4 * 6)
    expect(Array.from(f.batches)).toEqual([0, 30, 0])

    expect(bridge.hitTest(250, 50, 1)).toBe(1)
    expect(bridge.hitTest(150, 50, 1)).toBe(0)
    expect(Array.from(bridge.queryBox(0, 0, 650, 200, 1))).toEqual([1, 2])
    expect(bridge.bounds(2)).toEqual([400, 0, 500, 100])
    expect(bridge.unionBounds([1, 3])).toEqual([200, 0, 700, 100])
  })

  it("grows the command buffer and reports errors", () => {
    const big: number[] = [PATH_OP.MOVE, 0, 0]
    for (let k = 0; k < 100000; k++) big.push(PATH_OP.LINE, k, k % 7)
    bridge.cmd.setGeometry(1, big)
    expect(bridge.cmd.flush()).toBe(1)
    bridge.cmd.setGeometry(1, [99, 1, 2])
    expect(() => bridge.cmd.flush()).toThrow(/malformed path/)
  })

  it("overlay shapes are reported, not drawn", () => {
    bridge.cmd.clear()
    bridge.cmd.upsert(7, 2, 0, 1, 0, FLAG.OVERLAY, 10, 20, 0, 30, 40)
    bridge.cmd.flush()
    const f = bridge.frame({ x: 0, y: 0, z: 1 }, 1000, 1000)
    expect(f.drawn).toBe(0)
    expect(EngineBridge.readOverlay(f.overlay)).toEqual([{ handle: 7, x: 10, y: 20, w: 30, h: 40, rotation: 0 }])
  })
})
