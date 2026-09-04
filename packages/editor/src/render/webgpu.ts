/// <reference types="@webgpu/types" />
import { VERTEX_FLOATS, type CameraState, type FrameBuffers } from "@mocanvas/wasm"
import type { DrawOptions, RenderBackend, TextureOptions, TextureSource } from "./backend"
import { forEachDrawBatch } from "./clip"

/**
 * Same maths as the WebGL2 shaders: page → screen (CSS px) → clip, y flipped.
 * Vertex colours are straight alpha and premultiplied here; textures are
 * stored premultiplied, so solid batches sample a 1×1 white texture (a no-op).
 */
const SHADER = /* wgsl */ `
struct Uniforms {
  cam: vec3<f32>, // x, y, zoom
  vp: vec2<f32>,  // viewport size in CSS px
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
};

@vertex
fn vs_main(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>, @location(2) color: vec4<f32>) -> VSOut {
  let screen = (pos + u.cam.xy) * u.cam.z;
  let clip = screen / u.vp * 2.0 - 1.0;
  var out: VSOut;
  out.pos = vec4<f32>(clip.x, -clip.y, 0.0, 1.0);
  out.uv = uv;
  out.color = color;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let t = textureSample(tex, samp, in.uv);
  return vec4<f32>(in.color.rgb * in.color.a, in.color.a) * t;
}
`

const BYTES_PER_VERTEX = VERTEX_FLOATS * 4
/** `Uniforms` is vec3 (offset 0) + vec2 (offset 16); struct size rounds up to 32. */
const UNIFORM_BYTES = 32

export interface WebGPUBackendOptions {
  /** Called once if the GPU device is lost (the backend marks itself disposed). */
  onError?: (error: Error) => void
  powerPreference?: GPUPowerPreference
}

interface TextureEntry {
  texture: GPUTexture
  bindGroup: GPUBindGroup
  width: number
  height: number
  smooth: boolean
}

function sourceSize(source: TextureSource): [number, number] {
  if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) return [source.displayWidth, source.displayHeight]
  if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) return [source.videoWidth, source.videoHeight]
  const s = source as { width: number; height: number }
  return [s.width, s.height]
}

/**
 * Create a WebGPU backend: adapter → device → `webgpu` canvas context with
 * premultiplied alpha and the preferred surface format. Rejects when WebGPU is
 * unavailable, so callers can fall back to WebGL2.
 *
 * The canvas context is only acquired after the device exists, so a rejection
 * never leaves the canvas bound to a context type WebGL2 could not reuse.
 */
export async function createWebGPUBackend(canvas: HTMLCanvasElement, options: WebGPUBackendOptions = {}): Promise<WebGPUBackend> {
  const gpu = typeof navigator !== "undefined" ? navigator.gpu : undefined
  if (!gpu) throw new Error("mocanvas: WebGPU is not available (navigator.gpu is undefined)")
  const adapter = await gpu.requestAdapter({ powerPreference: options.powerPreference ?? "high-performance" })
  if (!adapter) throw new Error("mocanvas: WebGPU is not available (no adapter)")
  const device = await adapter.requestDevice()
  return new WebGPUBackend(canvas, device, gpu.getPreferredCanvasFormat(), options)
}

/**
 * WebGPU backend: one vertex buffer, one index buffer, one render pipeline,
 * one bind group per texture, one `drawIndexed` per batch.
 *
 * Mipmaps are not generated (WebGPU has no `generateMipmap`); minified
 * textures use plain bilinear filtering.
 */
export class WebGPUBackend implements RenderBackend {
  readonly kind = "webgpu" as const
  private readonly context: GPUCanvasContext
  private readonly pipeline: GPURenderPipeline
  private readonly bindGroupLayout: GPUBindGroupLayout
  private readonly uniforms: GPUBuffer
  private readonly uniformData = new Float32Array(UNIFORM_BYTES / 4)
  private readonly linearSampler: GPUSampler
  private readonly nearestSampler: GPUSampler
  /** Texture 0: 1×1 opaque white, so solid batches use the same pipeline. */
  private readonly white: TextureEntry
  private readonly textures = new Map<number, TextureEntry>()
  private vbo: GPUBuffer | null = null
  private ibo: GPUBuffer | null = null
  private vboBytes = 0
  private iboBytes = 0
  private width = 1
  private height = 1
  private pixelWidth = 1
  private pixelHeight = 1
  private dpr = 1
  private disposed = false

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly device: GPUDevice,
    readonly format: GPUTextureFormat,
    options: WebGPUBackendOptions = {},
  ) {
    const context = canvas.getContext("webgpu")
    if (!context) throw new Error("mocanvas: cannot create a webgpu canvas context")
    this.context = context
    context.configure({ device, format, alphaMode: "premultiplied", usage: GPUTextureUsage.RENDER_ATTACHMENT })

    device.lost.then((info) => {
      if (this.disposed || info.reason === "destroyed") return
      this.disposed = true
      options.onError?.(new Error(`mocanvas: WebGPU device lost (${info.reason}): ${info.message}`))
    })

    this.bindGroupLayout = device.createBindGroupLayout({
      label: "mocanvas",
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float", viewDimension: "2d" } },
      ],
    })
    const module = device.createShaderModule({ label: "mocanvas", code: SHADER })
    const blend: GPUBlendComponent = { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
    this.pipeline = device.createRenderPipeline({
      label: "mocanvas",
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      vertex: {
        module,
        entryPoint: "vs_main",
        buffers: [
          {
            arrayStride: BYTES_PER_VERTEX,
            stepMode: "vertex",
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
              { shaderLocation: 1, offset: 8, format: "float32x2" },
              { shaderLocation: 2, offset: 16, format: "float32x4" },
            ],
          },
        ],
      },
      fragment: { module, entryPoint: "fs_main", targets: [{ format, blend: { color: blend, alpha: blend } }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
    })

    this.uniforms = device.createBuffer({ label: "mocanvas uniforms", size: UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.linearSampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" })
    this.nearestSampler = device.createSampler({ magFilter: "nearest", minFilter: "nearest", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" })

    const whiteTex = device.createTexture({
      label: "mocanvas white",
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture({ texture: whiteTex }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1])
    this.white = this.makeEntry(whiteTex, 1, 1, false)
  }

  private makeEntry(texture: GPUTexture, width: number, height: number, smooth: boolean): TextureEntry {
    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniforms } },
        { binding: 1, resource: smooth ? this.linearSampler : this.nearestSampler },
        { binding: 2, resource: texture.createView() },
      ],
    })
    return { texture, bindGroup, width, height, smooth }
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.dpr = dpr
    const max = this.device.limits.maxTextureDimension2D
    const pw = Math.min(max, Math.max(1, Math.round(width * dpr)))
    const ph = Math.min(max, Math.max(1, Math.round(height * dpr)))
    this.pixelWidth = pw
    this.pixelHeight = ph
    // The configured context picks up the new drawing-buffer size on the next getCurrentTexture().
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw
      this.canvas.height = ph
    }
  }

  uploadTexture(id: number, source: TextureSource, opts: TextureOptions = {}): void {
    if (this.disposed) return
    if (id === 0) throw new Error("mocanvas: texture id 0 is reserved")
    const [w, h] = sourceSize(source)
    const smooth = opts.smooth ?? true
    let entry = this.textures.get(id)
    if (entry && (entry.width !== w || entry.height !== h || entry.smooth !== smooth)) {
      entry.texture.destroy()
      entry = undefined
    }
    if (!entry) {
      const texture = this.device.createTexture({
        label: `mocanvas texture ${id}`,
        size: [Math.max(1, w), Math.max(1, h)],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      })
      entry = this.makeEntry(texture, w, h, smooth)
      this.textures.set(id, entry)
    }
    // The destination is always premultiplied to match the blend mode; the
    // browser premultiplies straight-alpha sources on the way in. Sources that
    // are already premultiplied (`opts.premultiplied`) are copied as-is.
    this.device.queue.copyExternalImageToTexture(
      { source: source as GPUCopyExternalImageSource, flipY: false },
      { texture: entry.texture, premultipliedAlpha: true, colorSpace: "srgb" },
      [w, h],
    )
  }

  deleteTexture(id: number): void {
    const entry = this.textures.get(id)
    if (!entry) return
    this.textures.delete(id)
    if (!this.disposed) entry.texture.destroy()
  }

  /** Ensure `buf` holds at least `bytes`, growing geometrically; returns the (possibly new) buffer. */
  private ensureBuffer(buf: GPUBuffer | null, capacity: number, bytes: number, usage: GPUBufferUsageFlags, label: string): [GPUBuffer, number] {
    if (buf && bytes <= capacity) return [buf, capacity]
    buf?.destroy()
    const size = Math.max(bytes, capacity * 2, 4096)
    return [this.device.createBuffer({ label, size, usage: usage | GPUBufferUsage.COPY_DST }), size]
  }

  draw(frame: FrameBuffers, camera: CameraState, options: DrawOptions): void {
    if (this.disposed) return
    const device = this.device
    const [r, g, b, a] = options.background
    const view = this.context.getCurrentTexture().createView()
    const encoder = device.createCommandEncoder({ label: "mocanvas frame" })
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, clearValue: { r: r * a, g: g * a, b: b * a, a }, loadOp: "clear", storeOp: "store" }],
    })

    if (frame.indices.length > 0) {
      const u = this.uniformData
      u[0] = camera.x
      u[1] = camera.y
      u[2] = camera.z
      u[4] = this.width
      u[5] = this.height
      device.queue.writeBuffer(this.uniforms, 0, u)
      ;[this.vbo, this.vboBytes] = this.ensureBuffer(this.vbo, this.vboBytes, frame.vertices.byteLength, GPUBufferUsage.VERTEX, "mocanvas vertices")
      ;[this.ibo, this.iboBytes] = this.ensureBuffer(this.ibo, this.iboBytes, frame.indices.byteLength, GPUBufferUsage.INDEX, "mocanvas indices")
      // Views over WASM memory: pass the backing buffer with explicit offsets so the
      // typed-array's `ArrayBufferLike` generic does not fight the WebGPU types.
      device.queue.writeBuffer(this.vbo, 0, frame.vertices.buffer as ArrayBuffer, frame.vertices.byteOffset, frame.vertices.byteLength)
      device.queue.writeBuffer(this.ibo, 0, frame.indices.buffer as ArrayBuffer, frame.indices.byteOffset, frame.indices.byteLength)

      pass.setPipeline(this.pipeline)
      pass.setVertexBuffer(0, this.vbo)
      pass.setIndexBuffer(this.ibo, "uint32")

      const pw = this.pixelWidth
      const ph = this.pixelHeight
      let boundGroup: GPUBindGroup | null = null
      let scissored = false
      forEachDrawBatch(frame.batches, camera, this.dpr, pw, ph, (batch) => {
        const sc = batch.scissor
        if (sc) {
          // WebGPU scissor is top-down in device px: identical to the mapped rect.
          pass.setScissorRect(sc.x, sc.y, sc.w, sc.h)
          scissored = true
        } else if (scissored) {
          pass.setScissorRect(0, 0, pw, ph)
          scissored = false
        }
        const entry = (batch.texture !== 0 ? this.textures.get(batch.texture) : undefined) ?? this.white
        if (entry.bindGroup !== boundGroup) {
          pass.setBindGroup(0, entry.bindGroup)
          boundGroup = entry.bindGroup
        }
        pass.drawIndexed(batch.count, 1, batch.first, 0, 0)
      })
    }

    pass.end()
    device.queue.submit([encoder.finish()])
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const entry of this.textures.values()) entry.texture.destroy()
    this.textures.clear()
    this.white.texture.destroy()
    this.vbo?.destroy()
    this.ibo?.destroy()
    this.uniforms.destroy()
    // Leave the canvas context configured: a remount (React StrictMode) reuses
    // the same canvas and reconfigures it with a fresh device.
    this.device.destroy()
  }
}
