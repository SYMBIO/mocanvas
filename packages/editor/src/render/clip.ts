import { BATCH_WORDS, readClip, type CameraState, type ClipRect } from "@mocanvas/wasm"

/**
 * An axis-aligned rectangle in device pixels with a top-down `y` (origin at
 * the top-left corner of the canvas), as used by WebGPU's `setScissorRect`.
 * WebGL2's `scissor` is bottom-left based: pass `canvasH - (y + h)` as its `y`.
 */
export interface DeviceRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Map a page-space clip rect to device pixels: `(p + cam) * zoom * dpr`,
 * clamped to the canvas. Returns `null` when nothing of the rect is visible,
 * in which case the batch can be skipped entirely. The result is snapped
 * outward (floor / ceil) so partially covered pixels stay visible.
 *
 * Shared by the WebGL2 and WebGPU backends so both scissor identically.
 */
export function mapClipToDeviceRect(clip: ClipRect, camera: CameraState, dpr: number, canvasW: number, canvasH: number): DeviceRect | null {
  const s = camera.z * dpr
  const ox = camera.x * s
  const oy = camera.y * s
  const x0 = Math.max(0, Math.floor(clip[0] * s + ox))
  const x1 = Math.min(canvasW, Math.ceil(clip[2] * s + ox))
  const y0 = Math.max(0, Math.floor(clip[1] * s + oy))
  const y1 = Math.min(canvasH, Math.ceil(clip[3] * s + oy))
  if (!(x1 > x0 && y1 > y0)) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** One draw-call worth of the frame, already mapped to device space. */
export interface DrawBatch {
  /** First index into `FrameBuffers.indices`. */
  first: number
  /** Number of indices. */
  count: number
  /** Host texture id, 0 = solid colour (white texture). */
  texture: number
  /** Device-space scissor, or `null` for the whole canvas. */
  scissor: DeviceRect | null
  /** Isolation group, 0 for an ordinary batch. See `Batch.isolate`. */
  isolate: number
}

/**
 * Walk the batch words of a frame and hand each drawable batch to `visit`.
 * Batches whose clip rect maps to nothing on screen are dropped, as are empty
 * batches. Pure: no GPU calls, so both backends and the tests share it.
 */
export function forEachDrawBatch(batches: Uint32Array, camera: CameraState, dpr: number, canvasW: number, canvasH: number, visit: (batch: DrawBatch) => void): void {
  const out: DrawBatch = { first: 0, count: 0, texture: 0, scissor: null, isolate: 0 }
  for (let i = 0; i + BATCH_WORDS <= batches.length; i += BATCH_WORDS) {
    const count = batches[i + 1]!
    if (count === 0) continue
    const clip = readClip(batches, i + 3)
    let scissor: DeviceRect | null = null
    if (clip) {
      scissor = mapClipToDeviceRect(clip, camera, dpr, canvasW, canvasH)
      if (!scissor) continue
    }
    out.first = batches[i]!
    out.count = count
    out.texture = batches[i + 2]!
    out.scissor = scissor
    out.isolate = batches[i + 7]!
    visit(out)
  }
}
