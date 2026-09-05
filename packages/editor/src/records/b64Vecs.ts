/**
 * Packed point lists for freehand strokes.
 *
 * A drawn stroke is thousands of points. Stored as JSON objects
 * (`{"x":12.5,"y":40.25,"z":0.5}`) a single scribble costs tens of kilobytes,
 * dominates the size of a `.tldr` file, and has to be parsed object by object
 * on every load. Packed as base64 over a `Float32Array` the same stroke is
 * roughly a tenth of the size and decodes in one pass.
 *
 * The encoding is deliberately dumb: little-endian `Float32`s, `DIM_2D` or
 * `DIM_3D` of them per point, base64 of the resulting bytes. Nothing about it
 * is negotiated — the segment's own `dim` says which it is.
 */

import { T } from "../validation/T"

/** Floats per point in a 2D stroke: `x`, `y`. */
export const DIM_2D = 2
/** Floats per point in a 3D stroke: `x`, `y`, `z` — where `z` is pen pressure. */
export const DIM_3D = 3

const BYTES_PER_FLOAT = 4

function toBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = ""
    // Chunked: `String.fromCharCode(...bytes)` blows the argument limit on a
    // stroke of any real length.
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return btoa(binary)
  }
  return Buffer.from(bytes).toString("base64")
}

function fromBase64(value: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  return new Uint8Array(Buffer.from(value, "base64"))
}

function floatsOf(encoded: string): Float32Array {
  const bytes = fromBase64(encoded)
  // `Float32Array` needs a 4-byte-aligned buffer; a base64 decode may not give
  // one, so copy into a fresh buffer rather than viewing in place.
  const aligned = new Uint8Array(bytes.length - (bytes.length % BYTES_PER_FLOAT))
  aligned.set(bytes.subarray(0, aligned.length))
  return new Float32Array(aligned.buffer)
}

/** A point with pen pressure, as freehand strokes record them. */
export interface B64VecPoint {
  x: number
  y: number
  z: number
}

/**
 * Encode and decode packed point lists.
 *
 * A namespace object rather than a class of statics so it can be re-exported
 * and stubbed like any other value — the same reason `T` is one.
 *
 * The `*2D` methods work on `{ x, y }` pairs, the unsuffixed ones on `{ x, y, z }`
 * triples. Decoding just the first or last point is separate from decoding all
 * of them because hit-testing a stroke's endpoints must not pay for the middle.
 */
export const b64Vecs = {
  /** Pack `{ x, y, z }` points. */
  encodePoints(points: readonly B64VecPoint[]): string {
    const floats = new Float32Array(points.length * DIM_3D)
    for (let i = 0; i < points.length; i++) {
      const point = points[i]!
      floats[i * DIM_3D] = point.x
      floats[i * DIM_3D + 1] = point.y
      floats[i * DIM_3D + 2] = point.z
    }
    return toBase64(new Uint8Array(floats.buffer))
  },

  /** Pack `{ x, y }` points. */
  encodePoints2D(points: readonly { x: number; y: number }[]): string {
    const floats = new Float32Array(points.length * DIM_2D)
    for (let i = 0; i < points.length; i++) {
      const point = points[i]!
      floats[i * DIM_2D] = point.x
      floats[i * DIM_2D + 1] = point.y
    }
    return toBase64(new Uint8Array(floats.buffer))
  },

  /** Unpack `{ x, y, z }` points. */
  decodePoints(encoded: string): B64VecPoint[] {
    const floats = floatsOf(encoded)
    const count = Math.floor(floats.length / DIM_3D)
    const points: B64VecPoint[] = new Array(count)
    for (let i = 0; i < count; i++) {
      points[i] = { x: floats[i * DIM_3D]!, y: floats[i * DIM_3D + 1]!, z: floats[i * DIM_3D + 2]! }
    }
    return points
  },

  /** Unpack `{ x, y }` points. */
  decodePoints2D(encoded: string): { x: number; y: number }[] {
    const floats = floatsOf(encoded)
    const count = Math.floor(floats.length / DIM_2D)
    const points: { x: number; y: number }[] = new Array(count)
    for (let i = 0; i < count; i++) {
      points[i] = { x: floats[i * DIM_2D]!, y: floats[i * DIM_2D + 1]! }
    }
    return points
  },

  /** The first point, without decoding the rest. `undefined` when empty. */
  decodeFirstPoint(encoded: string): B64VecPoint | undefined {
    const floats = floatsOf(encoded)
    if (floats.length < DIM_3D) return undefined
    return { x: floats[0]!, y: floats[1]!, z: floats[2]! }
  },

  /** The first point of a 2D list. */
  decodeFirstPoint2D(encoded: string): { x: number; y: number } | undefined {
    const floats = floatsOf(encoded)
    if (floats.length < DIM_2D) return undefined
    return { x: floats[0]!, y: floats[1]! }
  },

  /** The last point, without decoding the rest. */
  decodeLastPoint(encoded: string): B64VecPoint | undefined {
    const floats = floatsOf(encoded)
    const count = Math.floor(floats.length / DIM_3D)
    if (count === 0) return undefined
    const at = (count - 1) * DIM_3D
    return { x: floats[at]!, y: floats[at + 1]!, z: floats[at + 2]! }
  },

  /** The last point of a 2D list. */
  decodeLastPoint2D(encoded: string): { x: number; y: number } | undefined {
    const floats = floatsOf(encoded)
    const count = Math.floor(floats.length / DIM_2D)
    if (count === 0) return undefined
    const at = (count - 1) * DIM_2D
    return { x: floats[at]!, y: floats[at + 1]! }
  },

  /**
   * Whether a packed list holds exactly one point.
   *
   * A one-point stroke is a dot, which is drawn differently from a line — so
   * this question is asked on every render and must not decode anything.
   */
  isSinglePoint(encoded: string, dim: number = DIM_3D): boolean {
    return Math.floor(floatsOf(encoded).length / dim) === 1
  },
}

/**
 * One continuous run of a freehand stroke.
 *
 * A stroke is a list of segments rather than one point list because lifting the
 * pen — or drawing a straight segment with a modifier held — starts a new run
 * that must not be smoothed into the previous one.
 */
export interface TLDrawShapeSegment {
  type: "free" | "straight"
  /** The segment's points, packed by {@link b64Vecs}. */
  points: string
  /** Floats per point: {@link DIM_2D} or {@link DIM_3D}. */
  dim?: number
}

export const drawShapeSegmentValidator = T.object({
  type: T.literalEnum("free", "straight"),
  points: T.string,
  dim: T.literalEnum(DIM_2D, DIM_3D).optional(),
})

/** A draw segment as it was stored before the points were packed. */
export interface LegacyDrawShapeSegment {
  type: "free" | "straight"
  points: { x: number; y: number; z?: number }[]
}

/**
 * Convert segments whose points are still stored as objects into packed ones.
 *
 * Documents written before packing existed carry the old shape; this is what a
 * draw shape's migration calls so those strokes are stored compactly from then
 * on. Segments that are already packed are returned as they are, so running it
 * twice is safe.
 */
export function compressLegacySegments(
  segments: readonly (LegacyDrawShapeSegment | TLDrawShapeSegment)[],
): TLDrawShapeSegment[] {
  return segments.map((segment) => {
    if (typeof segment.points === "string") return segment as TLDrawShapeSegment
    const points = segment.points as { x: number; y: number; z?: number }[]
    return {
      type: segment.type,
      points: b64Vecs.encodePoints(points.map((point) => ({ x: point.x, y: point.y, z: point.z ?? 0.5 }))),
      dim: DIM_3D,
    }
  })
}
