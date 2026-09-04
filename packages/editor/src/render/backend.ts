import type { CameraState, FrameBuffers } from "@mocanvas/wasm"

export type RGBA = [number, number, number, number]

export interface DrawOptions {
  /** Clear color, normalized. */
  background: RGBA
}

/** Anything the GPU can sample as a texture. */
export type TextureSource = TexImageSource | ImageData

export interface TextureOptions {
  /**
   * Whether `source` already holds premultiplied alpha. Defaults to `false`;
   * the upload always produces a premultiplied texture, matching the blend mode.
   */
  premultiplied?: boolean
  /** Bilinear filtering (default `true`). `false` gives nearest-neighbour sampling. */
  smooth?: boolean
}

/** A GPU backend that can draw one engine frame. Implementations: WebGL2 (now), WebGPU (later). */
export interface RenderBackend {
  readonly kind: "webgl2" | "webgpu"
  /** Resize the drawing buffer. Sizes are CSS pixels; `dpr` is the device pixel ratio. */
  resize(width: number, height: number, dpr: number): void
  /**
   * Draw one frame. Batches are bound to the texture named by their texture
   * word (0 = solid colour) and, when they carry a clip rect, scissored to it.
   */
  draw(frame: FrameBuffers, camera: CameraState, options: DrawOptions): void
  /**
   * Create or replace the texture with host id `id` (must be non-zero; 0 is the
   * built-in solid texture). Shapes reference it through `StyleWords.texture`.
   */
  uploadTexture(id: number, source: TextureSource, opts?: TextureOptions): void
  /** Release a texture. Batches still referencing `id` fall back to solid colour. */
  deleteTexture(id: number): void
  dispose(): void
}
