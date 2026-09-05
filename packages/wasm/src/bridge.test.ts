import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  BATCH_WORDS,
  EngineBridge,
  FLAG,
  GEO_FLAG,
  GEO_KIND,
  OVERLAY_WORDS,
  PATH_OP,
  VERTEX_FLOATS,
  loadEngineSync,
} from "./index"

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

    // The engine builds for a slightly padded viewport so small camera moves can
    // reuse the buffers; at this scale the pad (125 page units) still stops short of
    // shape 6 at x = 1200.
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

  it("reports the frame buffers unchanged when only the camera moved", () => {
    // Pad the build the way a hardware-GPU host would, so a small pan can reuse it.
    bridge.setViewportPad(0.25)
    bridge.cmd.clear()
    for (let h = 1; h <= 20; h++) {
      bridge.cmd.upsert(h, 1, 0, h, 0, 0, h * 200, 0, 0, 100, 100)
      bridge.cmd.setGeometry(h, rectPath(100, 100))
      bridge.cmd.setStyle(h, solid)
    }
    bridge.cmd.flush()

    const first = bridge.frame({ x: 0, y: 0, z: 1 }, 1000, 500, 0)
    expect(first.dirty).toBe(true)
    expect(first.pending).toBe(false)
    const version = first.version
    const indices = Array.from(first.indices)

    // Same camera: nothing to rebuild, and the same object (views included) comes back.
    const again = bridge.frame({ x: 0, y: 0, z: 1 }, 1000, 500, 0)
    expect(again.dirty).toBe(false)
    expect(again.version).toBe(version)
    expect(again).toBe(first)

    // A pan inside the padded box still reuses the build.
    const nudged = bridge.frame({ x: -60, y: 0, z: 1 }, 1000, 500, 0)
    expect(nudged.dirty).toBe(false)
    expect(nudged.version).toBe(version)
    expect(Array.from(nudged.indices)).toEqual(indices)

    // A pan past it rebuilds, and so does any scene change.
    const panned = bridge.frame({ x: -900, y: 0, z: 1 }, 1000, 500, 0)
    expect(panned.dirty).toBe(true)
    expect(panned.version).toBeGreaterThan(version)

    bridge.cmd.setStyle(1, { ...solid, fill: 0x00ff00ff })
    bridge.cmd.flush()
    const restyled = bridge.frame({ x: -900, y: 0, z: 1 }, 1000, 500, 0)
    expect(restyled.dirty).toBe(true)
    expect(restyled.version).toBeGreaterThan(panned.version)
    bridge.setViewportPad(0)
  })

  it("defers shapes over the tessellation budget to later frames", () => {
    bridge.cmd.clear()
    for (let h = 1; h <= 4; h++) {
      bridge.cmd.upsert(h, 1, 0, h, 0, 0, h * 200, 0, 0, 100, 100)
      bridge.cmd.setGeometry(h, rectPath(100, 100))
      bridge.cmd.setStyle(h, solid)
    }
    bridge.cmd.flush()

    const first = bridge.frame({ x: 0, y: 0, z: 1 }, 1000, 500, 1)
    expect(first.pending).toBe(true)
    // Deferred shapes are still drawn — as flat quads, not as gaps.
    expect(first.drawn).toBe(4)

    let frames = 1
    let f = first
    while (f.pending && frames < 16) {
      f = bridge.frame({ x: 0, y: 0, z: 1 }, 1000, 500, 1)
      frames++
    }
    expect(f.pending).toBe(false)
    expect(frames).toBe(4)
    // Backlog cleared: the frame is cacheable again.
    expect(bridge.frame({ x: 0, y: 0, z: 1 }, 1000, 500, 1).dirty).toBe(false)
  })

  describe("parametric geometry", () => {
    /** Bounds of one shape built by `write`, on a scene of its own. */
    function boundsOf(write: () => void): [number, number, number, number] | null {
      bridge.cmd.clear()
      bridge.cmd.upsert(1, 1, 0, 1, 0, 0, 0, 0, 0, 100, 60)
      write()
      bridge.cmd.flush()
      return bridge.geometryBounds(1)
    }

    it("builds a geo silhouette from its box", () => {
      for (const kind of Object.values(GEO_KIND)) {
        const b = boundsOf(() => bridge.cmd.setGeo(1, kind, 100, 60))
        expect(b, `kind ${kind}`).not.toBeNull()
        // The engine measures a curved outline off its own flattening, so a
        // cloud or a heart lands a fraction of a unit inside the box it was
        // fitted to. Half a unit on a 100 x 60 box is the tolerance that
        // distinguishes "fills its box" from "is somewhere else entirely".
        expect(b, `kind ${kind}`).toEqual([
          expect.closeTo(0, 0.5),
          expect.closeTo(0, 0.5),
          expect.closeTo(100, 0.5),
          expect.closeTo(60, 0.5),
        ])
      }
    })

    it("agrees with the same outline uploaded as a path", () => {
      const parametric = boundsOf(() => bridge.cmd.setGeo(1, GEO_KIND["rectangle"]!, 100, 60))
      const uploaded = boundsOf(() => bridge.cmd.setGeometry(1, rectPath(100, 60)))
      expect(parametric).toEqual(uploaded)
    })

    it("flips the silhouette without moving its box", () => {
      const flags = GEO_FLAG.FLIP_X | GEO_FLAG.FLIP_Y
      const flipped = boundsOf(() => bridge.cmd.setGeo(1, GEO_KIND["triangle"]!, 100, 60, flags))
      const plain = boundsOf(() => bridge.cmd.setGeo(1, GEO_KIND["triangle"]!, 100, 60))
      expect(flipped).toEqual(plain)
      // But the outline itself did turn over: the apex is now hit-testable at
      // the bottom edge's midpoint rather than the top's.
      bridge.cmd.clear()
      bridge.cmd.upsert(1, 1, 0, 1, 0, 0, 0, 0, 0, 100, 60)
      bridge.cmd.setGeo(1, GEO_KIND["triangle"]!, 100, 60, flags)
      bridge.cmd.setStyle(1, solid)
      bridge.cmd.flush()
      expect(bridge.hitTest(50, 58, 1)).toBe(1)
    })

    it("reports a geo kind it has no generator for", () => {
      bridge.cmd.clear()
      bridge.cmd.upsert(1, 1, 0, 1, 0, 0, 0, 0, 0, 100, 60)
      bridge.cmd.setGeo(1, 999, 100, 60)
      expect(() => bridge.cmd.flush()).toThrow(/unknown geo kind 999/)
    })

    it("builds splines and polylines from points", () => {
      // Three sides of a square: the polyline is the square's own bounds, and a
      // smooth curve through the same corners has to bow outside them.
      const points = [0, 0, 100, 0, 100, 100, 0, 100]
      expect(boundsOf(() => bridge.cmd.setPoly(1, points))).toEqual([0, 0, 100, 100])
      const spline = boundsOf(() => bridge.cmd.setSpline(1, points))
      expect(spline![2]).toBeGreaterThan(100)
      expect(spline![1]).toBeLessThan(0)
    })

    it("closes a polygon only when asked", () => {
      bridge.cmd.clear()
      bridge.cmd.upsert(1, 1, 0, 1, 0, 0, 0, 0, 0, 100, 100)
      bridge.cmd.setPoly(1, [0, 0, 100, 0, 100, 100, 0, 100], GEO_FLAG.CLOSED)
      bridge.cmd.setStyle(1, solid)
      bridge.cmd.flush()
      // A closed, filled outline is hit inside; an open one is not.
      expect(bridge.hitTest(50, 50, 1)).toBe(1)
      bridge.cmd.setPoly(1, [0, 0, 100, 0, 100, 100, 0, 100])
      bridge.cmd.flush()
      expect(bridge.hitTest(50, 50, 1)).toBe(0)
    })

    it("smooths freehand runs and concatenates segments", () => {
      const pen = [0, 0, 10, 4, 22, 1, 33, 12, 41, 30, 52, 25]
      const smoothed = boundsOf(() => bridge.cmd.setDraw(1, [{ points: pen, freehand: true }]))
      const raw = boundsOf(() => bridge.cmd.setDraw(1, [{ points: pen, freehand: false }]))
      expect(smoothed).not.toEqual(raw)
      // Smoothing pulls the interior in but leaves the endpoints where the pen was.
      expect(smoothed![0]).toBe(0)
      expect(smoothed![2]).toBe(52)

      const joined = boundsOf(() =>
        bridge.cmd.setDraw(1, [
          { points: [0, 0, 10, 0], freehand: false },
          { points: [40, 40, 50, 40], freehand: false },
        ]),
      )
      expect(joined).toEqual([0, 0, 50, 40])
    })

    it("costs a fraction of the words an uploaded path does", () => {
      bridge.cmd.clear()
      bridge.cmd.flush()
      bridge.cmd.setGeo(1, GEO_KIND["cloud"]!, 400, 300)
      const parametric = bridge.cmd.pending
      bridge.cmd.flush()
      expect(parametric).toBe(6)

      // The same silhouette as an uploaded path: a move, twelve cubics and a
      // close, which is what the host used to build and copy for every cloud.
      const asPath = [PATH_OP.MOVE, 0, 0]
      for (let k = 0; k < 12; k++) asPath.push(PATH_OP.CUBIC, 0, 0, 0, 0, 0, 0)
      asPath.push(PATH_OP.CLOSE)
      bridge.cmd.setGeometry(1, asPath)
      expect(bridge.cmd.pending).toBe(3 + asPath.length)
      expect(bridge.cmd.pending).toBeGreaterThan(parametric * 10)
      bridge.cmd.flush()
    })
  })
})
