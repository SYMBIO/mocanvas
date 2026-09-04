import { VERTEX_FLOATS, type CameraState, type FrameBuffers } from "@mocanvas/wasm"
import type { DrawOptions, RenderBackend, TextureOptions, TextureSource } from "./backend"
import { forEachDrawBatch } from "./clip"

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec4 a_color;
uniform vec3 u_cam;   // x, y, zoom
uniform vec2 u_vp;    // viewport size in CSS px
out vec2 v_uv;
out vec4 v_color;
void main() {
  vec2 screen = (a_pos + u_cam.xy) * u_cam.z;
  vec2 clip = screen / u_vp * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
}`

// Textures are stored premultiplied; the vertex colour is straight alpha and is
// premultiplied here. Solid batches sample the 1×1 white texture (a no-op).
const FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec4 v_color;
uniform sampler2D u_tex;
out vec4 o_color;
void main() {
  vec4 t = texture(u_tex, v_uv);
  o_color = vec4(v_color.rgb * v_color.a, v_color.a) * t;
}`

const BYTES_PER_VERTEX = VERTEX_FLOATS * 4

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)
  if (!sh) throw new Error("mocanvas: cannot create shader")
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`mocanvas: shader compile failed: ${log}`)
  }
  return sh
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0
}

function sourceSize(source: TextureSource): [number, number] {
  if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) return [source.displayWidth, source.displayHeight]
  if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) return [source.videoWidth, source.videoHeight]
  const s = source as { width: number; height: number }
  return [s.width, s.height]
}

/** WebGL2 backend: one interleaved VBO, one IBO, one program, one draw call per batch. */
export class WebGL2Backend implements RenderBackend {
  readonly kind = "webgl2" as const
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly vao: WebGLVertexArrayObject
  private readonly vbo: WebGLBuffer
  private readonly ibo: WebGLBuffer
  private readonly uCam: WebGLUniformLocation
  private readonly uVp: WebGLUniformLocation
  /** Texture 0: 1×1 opaque white, so solid batches use the same shader. */
  private readonly whiteTex: WebGLTexture
  private readonly textures = new Map<number, WebGLTexture>()
  private vboBytes = 0
  private iboBytes = 0
  private width = 1
  private height = 1
  private pixelWidth = 1
  private pixelHeight = 1
  private dpr = 1
  private disposed = false

  constructor(readonly canvas: HTMLCanvasElement, options: { antialias?: boolean } = {}) {
    const gl = canvas.getContext("webgl2", {
      antialias: options.antialias ?? true,
      premultipliedAlpha: true,
      alpha: true,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
      desynchronized: true,
    })
    if (!gl) throw new Error("mocanvas: WebGL2 is not available")
    this.gl = gl

    const vs = compile(gl, gl.VERTEX_SHADER, VERT)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    const program = gl.createProgram()
    if (!program) throw new Error("mocanvas: cannot create program")
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`mocanvas: program link failed: ${gl.getProgramInfoLog(program)}`)
    }
    this.program = program
    this.uCam = gl.getUniformLocation(program, "u_cam")!
    this.uVp = gl.getUniformLocation(program, "u_vp")!
    gl.useProgram(program)
    gl.uniform1i(gl.getUniformLocation(program, "u_tex"), 0)

    const vao = gl.createVertexArray()
    const vbo = gl.createBuffer()
    const ibo = gl.createBuffer()
    if (!vao || !vbo || !ibo) throw new Error("mocanvas: cannot create buffers")
    this.vao = vao
    this.vbo = vbo
    this.ibo = ibo

    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, BYTES_PER_VERTEX, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, BYTES_PER_VERTEX, 8)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, BYTES_PER_VERTEX, 16)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
    gl.bindVertexArray(null)

    const white = gl.createTexture()
    if (!white) throw new Error("mocanvas: cannot create texture")
    this.whiteTex = white
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, white)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.SCISSOR_TEST)
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.dpr = dpr
    const pw = Math.max(1, Math.round(width * dpr))
    const ph = Math.max(1, Math.round(height * dpr))
    this.pixelWidth = pw
    this.pixelHeight = ph
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw
      this.canvas.height = ph
    }
    this.gl.viewport(0, 0, pw, ph)
  }

  uploadTexture(id: number, source: TextureSource, opts: TextureOptions = {}): void {
    if (this.disposed) return
    if (id === 0) throw new Error("mocanvas: texture id 0 is reserved")
    const gl = this.gl
    let tex = this.textures.get(id)
    if (!tex) {
      const t = gl.createTexture()
      if (!t) throw new Error("mocanvas: cannot create texture")
      tex = t
      this.textures.set(id, tex)
    }
    const [w, h] = sourceSize(source)
    const mip = isPowerOfTwo(w) && isPowerOfTwo(h)
    const smooth = opts.smooth ?? true
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    // The blend mode expects premultiplied colour; let the browser premultiply on upload.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, opts.premultiplied ? 0 : 1)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, smooth ? gl.LINEAR : gl.NEAREST)
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, smooth ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST_MIPMAP_NEAREST)
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, smooth ? gl.LINEAR : gl.NEAREST)
    }
  }

  deleteTexture(id: number): void {
    const tex = this.textures.get(id)
    if (!tex) return
    this.textures.delete(id)
    if (!this.disposed) this.gl.deleteTexture(tex)
  }

  draw(frame: FrameBuffers, camera: CameraState, options: DrawOptions): void {
    if (this.disposed) return
    const gl = this.gl
    const [r, g, b, a] = options.background
    gl.disable(gl.SCISSOR_TEST)
    gl.clearColor(r * a, g * a, b * a, a)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (frame.indices.length === 0) return

    gl.useProgram(this.program)
    gl.uniform3f(this.uCam, camera.x, camera.y, camera.z)
    gl.uniform2f(this.uVp, this.width, this.height)
    gl.bindVertexArray(this.vao)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    const vBytes = frame.vertices.byteLength
    if (vBytes > this.vboBytes) {
      this.vboBytes = Math.max(vBytes, this.vboBytes * 2)
      gl.bufferData(gl.ARRAY_BUFFER, this.vboBytes, gl.DYNAMIC_DRAW)
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, frame.vertices)

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo)
    const iBytes = frame.indices.byteLength
    if (iBytes > this.iboBytes) {
      this.iboBytes = Math.max(iBytes, this.iboBytes * 2)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.iboBytes, gl.DYNAMIC_DRAW)
    }
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, frame.indices)

    // Scissor rects arrive top-down in device px; GL scissor is bottom-left based.
    const ph = this.pixelHeight
    gl.activeTexture(gl.TEXTURE0)
    let boundTex: WebGLTexture | null = null
    let scissoring = false
    forEachDrawBatch(frame.batches, camera, this.dpr, this.pixelWidth, ph, (b) => {
      const sc = b.scissor
      if (sc) {
        if (!scissoring) {
          gl.enable(gl.SCISSOR_TEST)
          scissoring = true
        }
        gl.scissor(sc.x, ph - (sc.y + sc.h), sc.w, sc.h)
      } else if (scissoring) {
        gl.disable(gl.SCISSOR_TEST)
        scissoring = false
      }

      const tex = (b.texture !== 0 ? this.textures.get(b.texture) : undefined) ?? this.whiteTex
      if (tex !== boundTex) {
        gl.bindTexture(gl.TEXTURE_2D, tex)
        boundTex = tex
      }
      gl.drawElements(gl.TRIANGLES, b.count, gl.UNSIGNED_INT, b.first * 4)
    })
    if (scissoring) gl.disable(gl.SCISSOR_TEST)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const gl = this.gl
    for (const tex of this.textures.values()) gl.deleteTexture(tex)
    this.textures.clear()
    gl.deleteTexture(this.whiteTex)
    gl.deleteBuffer(this.vbo)
    gl.deleteBuffer(this.ibo)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.program)
    // Do not lose the context here: the same canvas element may be re-used by a
    // remount (React StrictMode double-invokes effects).
  }
}

/**
 * Create the synchronous WebGL2 backend. For WebGPU (async device setup) or
 * automatic selection use `createBackendAsync` from `./createBackend`.
 */
export function createBackend(canvas: HTMLCanvasElement): RenderBackend {
  return new WebGL2Backend(canvas)
}
