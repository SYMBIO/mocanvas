import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { BATCH_WORDS, EngineBridge, FLAG, OVERLAY_WORDS, PATH_OP, VERTEX_FLOATS, loadEngineSync } from "./index"

const wasmPath = fileURLToPath(new URL("../pkg/mocanvas_bg.wasm", import.meta.url))

function rectPath(w: number, h: number): number[] {
  return [PATH_OP.MOVE, 0, 0, PATH_OP.LINE, w, 0, PATH_OP.LINE, w, h, PATH_OP.LINE, 0, h, PATH_OP.CLOSE]
}

const solid = { fill: 0xff0000ff, stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 }

describe("EngineBridge", () => {
  const bridge = loadEngineSync(readFileSync(wasmPath))

  it("upserts shapes, frames, hit tests and culls", () => {
    for (let h = 1; h <= 100; h++) {
      bridge.cmd.upsert(h, 1, 0, h, 0, 0, h * 200, 0, 0, 100, 100)
      bridge.cmd.setGeometry(h, rectPath(100, 100))
      bridge.cmd.setStyle(h, solid)
    }
    expect(bridge.cmd.flush()).toBe(300)
    expect(bridge.shapeCount).toBe(100)

    const f = bridge.frame({ x: 0, y: 0, z: 1 }, 1000, 500)
    expect(f.drawn).toBe(5)
    expect(f.culled).toBe(95)
    expect(f.indices.length).toBe(5 * 6)
    expect(f.vertices.length).toBe(5 * 4 * VERTEX_FLOATS)
    // solid geometry: u = v = 0
    expect(Array.from(f.vertices.subarray(2, 4))).toEqual([0, 0])
    expect(f.batches.length).toBe(BATCH_WORDS)
    expect(Array.from(f.batches)).toEqual([0, 30, 0, 0, 0, 0, 0])
    expect(EngineBridge.readBatches(f.batches)).toEqual([{ firstIndex: 0, indexCount: 30, texture: 0 }])

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
    expect(f.overlay.length).toBe(OVERLAY_WORDS)
    expect(EngineBridge.readOverlay(f.overlay)).toEqual([{ handle: 7, x: 10, y: 20, w: 30, h: 40, rotation: 0 }])
  })

  it("textured shapes draw one uv quad and split batches", () => {
    bridge.cmd.clear()
    for (let h = 1; h <= 3; h++) {
      bridge.cmd.upsert(h, 1, 0, h, 0, 0, h * 200, 50, 0, 100, 100)
      bridge.cmd.setGeometry(h, rectPath(100, 100))
      bridge.cmd.setStyle(h, solid)
    }
    bridge.cmd.setStyle(2, { ...solid, opacity: 0.5 })
    bridge.cmd.setTexture(2, 42)
    expect(bridge.cmd.flush()).toBe(12)

    const f = bridge.frame({ x: 0, y: 0, z: 1 }, 1000, 1000)
    expect(f.drawn).toBe(3)
    expect(EngineBridge.readBatches(f.batches)).toEqual([
      { firstIndex: 0, indexCount: 6, texture: 0 },
      { firstIndex: 6, indexCount: 6, texture: 42 },
      { firstIndex: 12, indexCount: 6, texture: 0 },
    ])
    // quad corners in page space with uv 0..1, colour white × opacity
    const quad = Array.from(f.vertices.subarray(4 * VERTEX_FLOATS, 8 * VERTEX_FLOATS))
    expect(quad).toEqual([
      400, 50, 0, 0, 1, 1, 1, 0.5,
      500, 50, 1, 0, 1, 1, 1, 0.5,
      500, 150, 1, 1, 1, 1, 1, 0.5,
      400, 150, 0, 1, 1, 1, 1, 0.5,
    ])

    // SET_STYLE keeps the texture; SET_TEXTURE 0 clears it
    bridge.cmd.setStyle(2, solid)
    bridge.cmd.flush()
    expect(EngineBridge.readBatches(bridge.frame({ x: 0, y: 0, z: 1 }, 1000, 1000).batches).map((b) => b.texture)).toEqual([0, 42, 0])
    bridge.cmd.setTexture(2, 0)
    bridge.cmd.flush()
    expect(EngineBridge.readBatches(bridge.frame({ x: 0, y: 0, z: 1 }, 1000, 1000).batches)).toEqual([{ firstIndex: 0, indexCount: 18, texture: 0 }])
  })

  it("clip shapes clip their descendants and split batches", () => {
    bridge.cmd.clear()
    // unclipped root shape
    bridge.cmd.upsert(1, 1, 0, 1, 0, 0, 0, 0, 0, 100, 100)
    bridge.cmd.setGeometry(1, rectPath(100, 100))
    bridge.cmd.setStyle(1, solid)
    // frame at (200, 0) 300x300 — not clipped itself
    bridge.cmd.upsert(2, 1, 0, 2, 0, FLAG.CLIP, 200, 0, 0, 300, 300)
    bridge.cmd.setGeometry(2, rectPath(300, 300))
    bridge.cmd.setStyle(2, solid)
    // child half outside the frame → drawn with the frame's clip
    bridge.cmd.upsert(3, 1, 2, 1, 0, 0, 250, 0, 0, 100, 100)
    bridge.cmd.setGeometry(3, rectPath(100, 100))
    bridge.cmd.setStyle(3, solid)
    // nested frame partially outside → its children get the intersection
    bridge.cmd.upsert(4, 1, 2, 2, 0, FLAG.CLIP, 100, 100, 0, 300, 300)
    bridge.cmd.setGeometry(4, rectPath(300, 300))
    bridge.cmd.setStyle(4, solid)
    bridge.cmd.upsert(5, 1, 4, 1, 0, 0, 0, 0, 0, 50, 50)
    bridge.cmd.setGeometry(5, rectPath(50, 50))
    bridge.cmd.setStyle(5, solid)
    // overlay child of the frame carries the clip too
    bridge.cmd.upsert(6, 2, 2, 3, 0, FLAG.OVERLAY, 10, 10, 0, 20, 20)
    // child fully outside the frame → culled
    bridge.cmd.upsert(7, 1, 2, 4, 0, 0, 1000, 0, 0, 100, 100)
    bridge.cmd.setGeometry(7, rectPath(100, 100))
    bridge.cmd.setStyle(7, solid)
    bridge.cmd.flush()

    const f = bridge.frame({ x: 100, y: 100, z: 1 }, 3000, 3000)
    expect(f.drawn).toBe(5)
    expect(f.culled).toBe(1)
    const frameClip = [200, 0, 500, 300]
    // root + frame | frame's children (3 and the nested frame 4) | grandchild 5 (intersection)
    expect(EngineBridge.readBatches(f.batches)).toEqual([
      { firstIndex: 0, indexCount: 12, texture: 0 },
      { firstIndex: 12, indexCount: 12, texture: 0, clip: frameClip },
      { firstIndex: 24, indexCount: 6, texture: 0, clip: [300, 100, 500, 300] },
    ])
    expect(EngineBridge.readOverlay(f.overlay)).toEqual([{ handle: 6, x: 210, y: 10, w: 20, h: 20, rotation: 0, clip: frameClip }])
  })
})
