/**
 * WebGL2 setup and capability detection.
 *
 * The CPU pipeline stays the floor. Everything here reports failure rather
 * than throwing, and every failure path ends with the caller falling back —
 * a missing float-render extension on some older mobile GPU has to degrade to
 * a slower correct picture, not to a blank canvas.
 */

export type Gpu = {
  gl: WebGL2RenderingContext
  canvas: HTMLCanvasElement
  /** float render targets; without them the field cannot carry real distances */
  float: boolean
  /** linear filtering of those targets, for the bloom chain */
  floatLinear: boolean
  quad: WebGLBuffer
}

export type Program = {
  program: WebGLProgram
  uniforms: Record<string, WebGLUniformLocation | null>
}

let shared: Gpu | null = null
let unavailable = false

export function gpuAvailable(): boolean {
  if (unavailable) return false
  return acquire() !== null
}

/**
 * One context for the whole app.
 *
 * Browsers cap live WebGL contexts somewhere around sixteen and silently drop
 * the oldest when the cap is passed. The stage alone shows three compositions
 * and the filmstrip more, so a context per composition would start losing
 * them mid-session; instead one context renders into an offscreen target and
 * the result is copied out to each consumer's own 2D canvas.
 */
export function acquire(): Gpu | null {
  if (shared) return shared
  if (unavailable) return null
  if (typeof document === 'undefined') {
    unavailable = true
    return null
  }
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  })
  if (!gl) {
    unavailable = true
    return null
  }

  const float = gl.getExtension('EXT_color_buffer_float') !== null
  const floatLinear = gl.getExtension('OES_texture_float_linear') !== null
  if (!float) {
    // Without float targets the distance field would have to be packed into
    // eight bits per channel, which quantises it far too coarsely for cone
    // marching to produce a usable penumbra. Not worth a degraded GPU path.
    unavailable = true
    return null
  }

  const quad = gl.createBuffer()
  if (!quad) {
    unavailable = true
    return null
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)

  shared = { gl, canvas, float, floatLinear, quad }
  return shared
}

export function compile(gl: WebGL2RenderingContext, vs: string, fs: string, names: string[]): Program | null {
  const make = (type: number, src: string): WebGLShader | null => {
    const s = gl.createShader(type)
    if (!s) return null
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      if (import.meta.env.DEV) console.error('[gpu] shader failed', gl.getShaderInfoLog(s))
      gl.deleteShader(s)
      return null
    }
    return s
  }

  const v = make(gl.VERTEX_SHADER, vs)
  const f = make(gl.FRAGMENT_SHADER, fs)
  if (!v || !f) return null

  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, v)
  gl.attachShader(program, f)
  gl.bindAttribLocation(program, 0, 'aPos')
  gl.linkProgram(program)
  gl.deleteShader(v)
  gl.deleteShader(f)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (import.meta.env.DEV) console.error('[gpu] link failed', gl.getProgramInfoLog(program))
    return null
  }

  const uniforms: Record<string, WebGLUniformLocation | null> = {}
  for (const n of names) uniforms[n] = gl.getUniformLocation(program, n)
  return { program, uniforms }
}

export type Target = {
  fbo: WebGLFramebuffer
  textures: WebGLTexture[]
  depth: WebGLRenderbuffer | null
  width: number
  height: number
}

export function makeTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  count: number,
  opts: { float?: boolean; depth?: boolean; linear?: boolean } = {},
): Target | null {
  const fbo = gl.createFramebuffer()
  if (!fbo) return null
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)

  const textures: WebGLTexture[] = []
  const buffers: number[] = []
  for (let i = 0; i < count; i++) {
    const tex = gl.createTexture()
    if (!tex) return null
    gl.bindTexture(gl.TEXTURE_2D, tex)
    const internal = opts.float ? gl.RGBA16F : gl.RGBA8
    const type = opts.float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, type, null)
    const filter = opts.linear ? gl.LINEAR : gl.NEAREST
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0)
    textures.push(tex)
    buffers.push(gl.COLOR_ATTACHMENT0 + i)
  }
  gl.drawBuffers(buffers)

  let depth: WebGLRenderbuffer | null = null
  if (opts.depth) {
    depth = gl.createRenderbuffer()
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth)
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth)
  }

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    if (import.meta.env.DEV) console.error('[gpu] incomplete framebuffer')
    return null
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return { fbo, textures, depth, width, height }
}

export function disposeTarget(gl: WebGL2RenderingContext, t: Target): void {
  for (const tex of t.textures) gl.deleteTexture(tex)
  if (t.depth) gl.deleteRenderbuffer(t.depth)
  gl.deleteFramebuffer(t.fbo)
}

/**
 * Noise, generated on the CPU from the seeded generator and uploaded.
 *
 * Never a hash function in the shader. Float behaviour differs between
 * drivers, so shader-side noise would make the output hardware-dependent and
 * every golden image would be a coin toss. This is the one source of
 * randomness the GPU path has, and it comes from the same generator as
 * everything else.
 */
export function uploadNoise(
  gl: WebGL2RenderingContext,
  rand: () => number,
  size = 256,
): WebGLTexture | null {
  const tex = gl.createTexture()
  if (!tex) return null
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.floor(rand() * 256)
    data[i + 1] = Math.floor(rand() * 256)
    data[i + 2] = Math.floor(rand() * 256)
    data[i + 3] = 255
  }
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
  return tex
}
