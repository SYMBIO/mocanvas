import { describe, expect, it } from "vitest"
import { b64Vecs, compressLegacySegments, DIM_2D, DIM_3D } from "./b64Vecs"

const points = [
  { x: 0, y: 0, z: 0.5 },
  { x: 12.5, y: -40.25, z: 1 },
  { x: 3.75, y: 8, z: 0.25 },
]

describe("b64Vecs", () => {
  it("round-trips 3D points exactly", () => {
    // Every coordinate here is exactly representable as a float32, so the
    // round-trip is lossless rather than merely close.
    expect(b64Vecs.decodePoints(b64Vecs.encodePoints(points))).toEqual(points)
  })

  it("round-trips 2D points exactly", () => {
    const flat = points.map(({ x, y }) => ({ x, y }))
    expect(b64Vecs.decodePoints2D(b64Vecs.encodePoints2D(flat))).toEqual(flat)
  })

  it("reads the first and last point without decoding the rest", () => {
    const encoded = b64Vecs.encodePoints(points)
    expect(b64Vecs.decodeFirstPoint(encoded)).toEqual(points[0])
    expect(b64Vecs.decodeLastPoint(encoded)).toEqual(points[2])

    const encoded2D = b64Vecs.encodePoints2D(points)
    expect(b64Vecs.decodeFirstPoint2D(encoded2D)).toEqual({ x: 0, y: 0 })
    expect(b64Vecs.decodeLastPoint2D(encoded2D)).toEqual({ x: 3.75, y: 8 })
  })

  it("answers undefined for an empty list", () => {
    const empty = b64Vecs.encodePoints([])
    expect(b64Vecs.decodePoints(empty)).toEqual([])
    expect(b64Vecs.decodeFirstPoint(empty)).toBeUndefined()
    expect(b64Vecs.decodeLastPoint(empty)).toBeUndefined()
    expect(b64Vecs.decodeFirstPoint2D(empty)).toBeUndefined()
    expect(b64Vecs.decodeLastPoint2D(empty)).toBeUndefined()
  })

  it("recognises a single-point stroke", () => {
    expect(b64Vecs.isSinglePoint(b64Vecs.encodePoints([points[0]!]))).toBe(true)
    expect(b64Vecs.isSinglePoint(b64Vecs.encodePoints(points))).toBe(false)
    expect(b64Vecs.isSinglePoint(b64Vecs.encodePoints2D([{ x: 1, y: 2 }]), DIM_2D)).toBe(true)
  })

  it("packs a long stroke far smaller than its JSON", () => {
    // Coordinates as a real stroke produces them: fractional, so their JSON is
    // the ~20 characters per number that packing is meant to avoid.
    const many = Array.from({ length: 2000 }, (_, i) => ({
      x: i * 1.31739,
      y: Math.sin(i / 10) * 213.4471,
      z: 0.5 + (i % 7) / 100,
    }))
    const packed = b64Vecs.encodePoints(many)
    // Comfortably under half the JSON; in practice about a third.
    expect(packed.length).toBeLessThan(JSON.stringify(many).length * 0.4)
    expect(b64Vecs.decodePoints(packed)).toHaveLength(2000)
  })
})

describe("compressLegacySegments", () => {
  it("packs object points and records the dimension", () => {
    const [segment] = compressLegacySegments([
      { type: "free", points: [{ x: 1, y: 2, z: 0.75 }] },
    ])
    expect(segment!.type).toBe("free")
    expect(typeof segment!.points).toBe("string")
    expect(segment!.dim).toBe(DIM_3D)
    expect(b64Vecs.decodePoints(segment!.points)).toEqual([{ x: 1, y: 2, z: 0.75 }])
  })

  it("defaults a missing pressure rather than dropping the point", () => {
    const [segment] = compressLegacySegments([{ type: "straight", points: [{ x: 0, y: 0 }] }])
    expect(b64Vecs.decodePoints(segment!.points)).toEqual([{ x: 0, y: 0, z: 0.5 }])
  })

  it("is idempotent: already-packed segments pass through", () => {
    const packed = compressLegacySegments([{ type: "free", points: [{ x: 1, y: 2, z: 1 }] }])
    expect(compressLegacySegments(packed)).toEqual(packed)
  })
})
