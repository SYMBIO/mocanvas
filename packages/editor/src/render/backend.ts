import type { CameraState, FrameBuffers } from "@mocanvas/wasm"

export type RGBA = [number, number, number, number]

export interface DrawOptions {
  /** Clear color, normalized. */
  background: RGBA
}

/** A GPU backend that can draw one engine frame. Implementations: WebGL2 (now), WebGPU (later). */
export interface RenderBackend {
  readonly kind: "webgl2" | "webgpu"
  /** Resize the drawing buffer. Sizes are CSS pixels; `dpr` is the device pixel ratio. */
  resize(width: number, height: number, dpr: number): void
  draw(frame: FrameBuffers, camera: CameraState, options: DrawOptions): void
  dispose(): void
}
