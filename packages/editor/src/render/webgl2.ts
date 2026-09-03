import type { CameraState, FrameBuffers } from "@mocanvas/wasm"
import type { DrawOptions, RenderBackend } from "./backend"

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_color;
uniform vec3 u_cam;   // x, y, zoom
uniform vec2 u_vp;    // viewport size in CSS px
out vec4 v_color;
void main() {
  vec2 screen = (a_pos + u_cam.xy) * u_cam.z;
  vec2 clip = screen / u_vp * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_color = a_color;
}`

const FRAG = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 o_color;
void main() {
  o_color = vec4(v_color.rgb * v_color.a, v_color.a);
}`

const FLOATS_PER_VERTEX = 6
const BYTES_PER_VERTEX = FLOATS_PER_VERTEX * 4

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
  private vboBytes = 0
  private iboBytes = 0
  private width = 1
  private height = 1
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
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_VERTEX, 8)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
    gl.bindVertexArray(null)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    const pw = Math.max(1, Math.round(width * dpr))
    const ph = Math.max(1, Math.round(height * dpr))
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw
      this.canvas.height = ph
    }
    this.gl.viewport(0, 0, pw, ph)
  }

  draw(frame: FrameBuffers, camera: CameraState, options: DrawOptions): void {
    if (this.disposed) return
    const gl = this.gl
    const [r, g, b, a] = options.background
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

    const batches = frame.batches
    for (let i = 0; i + 3 <= batches.length; i += 3) {
      const first = batches[i]!
      const count = batches[i + 1]!
      // batches[i + 2] is the texture id; textures arrive in phase 3.
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, first * 4)
    }
    gl.bindVertexArray(null)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const gl = this.gl
    gl.deleteBuffer(this.vbo)
    gl.deleteBuffer(this.ibo)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.program)
    // Do not lose the context here: the same canvas element may be re-used by a
    // remount (React StrictMode double-invokes effects).
  }
}

/** Pick the best available backend for a canvas. */
export function createBackend(canvas: HTMLCanvasElement): RenderBackend {
  return new WebGL2Backend(canvas)
}
