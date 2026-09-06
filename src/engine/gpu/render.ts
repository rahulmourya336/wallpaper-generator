import { makeRng } from '../rng'
import { hexToRgb255 } from '../oklab'
import { mixHex } from '../palette'
import { MAX_LEAVES, packShape, shapeBounds } from '../scene/sdf'
import type { SdfShape } from '../scene/sdf'
import type { Node, SceneGraph } from '../scene/types'
import type { RenderContext } from '../types'
import type { LayoutPlan } from '../layout'
import type { Character } from '../character'
import {
  acquire, compile, disposeTarget, makeTarget, uploadNoise,
} from './context'
import type { Gpu, Program, Target } from './context'
import {
  BLUR_FS, BRIGHT_FS, COMPOSITE_FS, DOF_FS, FIELD_FS, FULLSCREEN_VS, LIGHT_FS, QUAD_VS,
} from './glsl'

/**
 * The GPU render path.
 *
 * The CPU pipeline reached its ceiling in a specific place: it could only
 * approximate light, because a stroke has no idea what is next to it. A
 * contact shadow was an offset copy, occlusion was not attempted, and depth of
 * field had to be quantised into three tiers because whole buffers were being
 * blurred. All three are the same limitation — no spatial knowledge — and a
 * distance field is exactly that knowledge, so all three stop being
 * approximations at once.
 *
 * The shape of the frame:
 *
 *   field pass    one draw per node over its own bounds, writing a G-buffer
 *                 of albedo, normal, plane, thickness and distance. Depth is
 *                 the distance, so the union between nodes resolves in the
 *                 depth test and each pixel keeps the nearest form's material.
 *   light pass    occlusion, cone-marched shadow and subsurface, all as reads
 *                 of that field.
 *   dof           a real circle-of-confusion gather.
 *   bloom         bright-pass and a two-tap chain, the wide tap tinted warm
 *                 for halation.
 *   composite     grade, vignette, grain.
 *
 * One WebGL context is shared for the whole app and results are copied out to
 * each consumer's 2D canvas, because browsers cap live contexts at around
 * sixteen and silently drop the oldest past that.
 */

const UNIFORMS_FIELD = [
  'uRect', 'uFieldToClip', 'uLeafA', 'uLeafB', 'uKind', 'uOp', 'uCount', 'uSmoothK',
  'uAlbedo', 'uMaterial', 'uPlane', 'uEmissive', 'uUnit', 'uBevel', 'uDepthRange',
  'uCutA', 'uCutB', 'uCutKind', 'uCutOp', 'uCutCount',
]
const UNIFORMS_LIGHT = [
  'uAlbedo', 'uSurface', 'uField', 'uNoise', 'uRes', 'uLight', 'uGround', 'uInk',
  'uAccent', 'uUnit', 'uAo', 'uShadow', 'uSss', 'uFocus', 'uDofStrength',
  'uFocusUv', 'uSkyTop', 'uSkyGlow', 'uAmbient', 'uDirect',
]
const UNIFORMS_DOF = ['uColor', 'uSurface', 'uRes', 'uFocus', 'uStrength', 'uBand']
const UNIFORMS_BRIGHT = ['uColor', 'uField', 'uThreshold']
const UNIFORMS_BLUR = ['uColor', 'uDir']
const UNIFORMS_COMPOSITE = [
  'uColor', 'uBloom', 'uWide', 'uNoise', 'uRes', 'uVigCentre',
  'uVignette', 'uGrain', 'uBloomAmt', 'uWarmth',
]

type Programs = {
  field: Program
  light: Program
  dof: Program
  bright: Program
  blur: Program
  composite: Program
}

let programs: Programs | null = null
let programsFailed = false

function getPrograms(gl: WebGL2RenderingContext): Programs | null {
  if (programs) return programs
  if (programsFailed) return null
  const field = compile(gl, QUAD_VS, FIELD_FS, UNIFORMS_FIELD)
  const light = compile(gl, FULLSCREEN_VS, LIGHT_FS, UNIFORMS_LIGHT)
  const dof = compile(gl, FULLSCREEN_VS, DOF_FS, UNIFORMS_DOF)
  const bright = compile(gl, FULLSCREEN_VS, BRIGHT_FS, UNIFORMS_BRIGHT)
  const blur = compile(gl, FULLSCREEN_VS, BLUR_FS, UNIFORMS_BLUR)
  const composite = compile(gl, FULLSCREEN_VS, COMPOSITE_FS, UNIFORMS_COMPOSITE)
  if (!field || !light || !dof || !bright || !blur || !composite) {
    programsFailed = true
    return null
  }
  programs = { field, light, dof, bright, blur, composite }
  return programs
}

/** Nodes the GPU can draw. Anything without an SDF is not one of them. */
function sdfNodes(graph: SceneGraph): Array<{ node: Node; shape: SdfShape }> {
  const out: Array<{ node: Node; shape: SdfShape }> = []
  for (const n of graph.nodes) {
    if (n.geom.k === 'sdf') out.push({ node: n, shape: n.geom.shape })
  }
  return out
}

export function graphIsGpuReady(graph: SceneGraph): boolean {
  return graph.nodes.length > 0 && graph.nodes.every((n) => n.geom.k === 'sdf')
}

/**
 * Field space to clip space.
 *
 * The layout transform turns and scales the whole field behind the subject, so
 * the shader is handed the composed matrix and evaluates the distance field in
 * field units. Distances therefore stay in the units the renderer authored
 * them in, which is what keeps a 4x export identical to the preview instead of
 * a scaled copy of it.
 */
function fieldToClip(plan: LayoutPlan, w: number, h: number): Float32Array {
  const rad = (plan.rotate * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const sx = (plan.flip ? -1 : 1) * plan.zoom
  const sy = plan.zoom
  const mx = w / 2
  const my = h / 2

  // translate(mid) rotate scale translate(-mid), then pixels to clip
  const a = c * sx, b = s * sx
  const cc = -s * sy, d = c * sy
  const e = mx - (a * mx + cc * my)
  const f = my - (b * mx + d * my)

  // column-major 3x3 for WebGL
  return new Float32Array([
    (a * 2) / w, (b * -2) / h, 0,
    (cc * 2) / w, (d * -2) / h, 0,
    (e * 2) / w - 1, (f * -2) / h + 1, 1,
  ])
}

export type GpuInput = {
  ctx: RenderContext
  graph: SceneGraph
  plan: LayoutPlan
  character: Character
  quality: number
}

let noiseTex: WebGLTexture | null = null
let noiseSeed = ''

function noiseFor(gpu: Gpu, seed: string): WebGLTexture | null {
  if (noiseTex && noiseSeed === seed) return noiseTex
  if (noiseTex) gpu.gl.deleteTexture(noiseTex)
  const rng = makeRng(seed, 'gpu-noise')
  noiseTex = uploadNoise(gpu.gl, () => rng.next())
  noiseSeed = seed
  return noiseTex
}

const rgb = (hex: string): [number, number, number] => {
  const c = hexToRgb255(hex)
  return [c.r / 255, c.g / 255, c.b / 255]
}

/**
 * Render a graph and return a painter that copies the result onto a 2D canvas.
 *
 * Returns null when anything is unavailable or fails, and every caller treats
 * that as "use the CPU path". The GPU path is never allowed to be the reason
 * a composition does not appear.
 */
export function renderGpu(input: GpuInput): ((c: CanvasRenderingContext2D) => void) | null {
  const gpu = acquire()
  if (!gpu) return null
  const { gl } = gpu
  const progs = getPrograms(gl)
  if (!progs) return null

  const { ctx, graph, plan, character, quality } = input
  const items = sdfNodes(graph)
  if (items.length === 0) return null

  const w = ctx.w
  const h = ctx.h
  const draft = quality < 0.5

  gpu.canvas.width = w
  gpu.canvas.height = h

  const bw = Math.max(1, w >> 2)
  const bh = Math.max(1, h >> 2)
  const ww = Math.max(1, bw >> 2)
  const wh = Math.max(1, bh >> 2)

  // Allocated together and torn down together. A failure anywhere means the
  // whole frame falls back to the CPU path rather than rendering half of it.
  const made: Target[] = []
  const alloc = (tw: number, th: number, count: number, o: Parameters<typeof makeTarget>[4]) => {
    const t = makeTarget(gl, tw, th, count, o)
    if (t) made.push(t)
    return t
  }
  const GB = alloc(w, h, 3, { float: true, depth: true })
  const LIT = alloc(w, h, 1, { float: true, linear: true })
  const DOF = alloc(w, h, 1, { float: true, linear: true })
  const BRIGHT = alloc(bw, bh, 1, { float: true, linear: true })
  const BA = alloc(bw, bh, 1, { float: true, linear: true })
  const BB = alloc(bw, bh, 1, { float: true, linear: true })
  const WA = alloc(ww, wh, 1, { float: true, linear: true })
  const WB = alloc(ww, wh, 1, { float: true, linear: true })

  if (!GB || !LIT || !DOF || !BRIGHT || !BA || !BB || !WA || !WB) {
    for (const t of made) disposeTarget(gl, t)
    return null
  }

  const noise = noiseFor(gpu, ctx.seed)
  const m3 = fieldToClip(plan, w, h)
  const pxPerUnit = ctx.u(1)

  // focus follows the emissive node, which is the subject by construction
  const emissive = graph.nodes.filter((n) => n.light.emissive > 0)
  const focus = emissive.length
    ? emissive.reduce((s, n) => s + n.plane, 0) / emissive.length
    : 0.55

  // reusable packing buffers, so fifty nodes do not allocate fifty times
  const leafA = new Float32Array(MAX_LEAVES * 4)
  const leafB = new Float32Array(MAX_LEAVES * 4)
  const kinds = new Int32Array(MAX_LEAVES)
  const ops = new Int32Array(MAX_LEAVES)
  const cutA = new Float32Array(MAX_LEAVES * 4)
  const cutB = new Float32Array(MAX_LEAVES * 4)
  const cutKinds = new Int32Array(MAX_LEAVES)
  const cutOps = new Int32Array(MAX_LEAVES)

  // --- field pass ---------------------------------------------------------
  gl.bindFramebuffer(gl.FRAMEBUFFER, GB.fbo)
  gl.viewport(0, 0, w, h)
  gl.disable(gl.BLEND)
  gl.enable(gl.DEPTH_TEST)
  gl.depthFunc(gl.LESS)
  gl.clearColor(0, 0, 0, 0)
  gl.clearDepth(1)
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

  gl.useProgram(progs.field.program)
  gl.bindBuffer(gl.ARRAY_BUFFER, gpu.quad)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  const fu = progs.field.uniforms
  gl.uniformMatrix3fv(fu['uFieldToClip'] ?? null, false, m3)
  gl.uniform1f(fu['uUnit'] ?? null, pxPerUnit)
  gl.uniform1f(fu['uDepthRange'] ?? null, ctx.n(ctx.short))

  // The bevel is the width of the turn-over at a form's edge. Wide, every
  // mass reads as an inflated pillow; narrow, it reads as a slab with a lit
  // arris, which is what masonry is.
  const bevel = 9

  for (const { node, shape } of items) {
    const n = packShape(shape, leafA, leafB, kinds, ops)
    if (n === 0) continue
    const b = shapeBounds(shape)
    // a margin so the bevel and the antialias band are inside the quad
    const pad = bevel * 1.5 + 4 / Math.max(pxPerUnit, 1e-4)
    gl.uniform4f(fu['uRect'] ?? null, b.x0 - pad, b.y0 - pad, b.x1 + pad, b.y1 + pad)
    gl.uniform4fv(fu['uLeafA'] ?? null, leafA)
    gl.uniform4fv(fu['uLeafB'] ?? null, leafB)
    gl.uniform1iv(fu['uKind'] ?? null, kinds)
    gl.uniform1iv(fu['uOp'] ?? null, ops)
    gl.uniform1i(fu['uCount'] ?? null, n)
    gl.uniform1f(fu['uSmoothK'] ?? null, shape.k)

    const cutCount = shape.cut
      ? packShape({ leaves: shape.cut.leaves, ops: shape.cut.ops, k: shape.k }, cutA, cutB, cutKinds, cutOps)
      : 0
    gl.uniform4fv(fu['uCutA'] ?? null, cutA)
    gl.uniform4fv(fu['uCutB'] ?? null, cutB)
    gl.uniform1iv(fu['uCutKind'] ?? null, cutKinds)
    gl.uniform1iv(fu['uCutOp'] ?? null, cutOps)
    gl.uniform1i(fu['uCutCount'] ?? null, cutCount)

    const tone = Math.max(0, Math.min(1, node.tone * (0.5 + 0.5 * node.plane)))
    const isEmissive = node.material.k === 'emissive'
    /**
     * Albedo carries the same lift the CPU material gave it.
     *
     * A mass there was a gradient from ramp(tone * 1.3 + 0.12) down to a dark;
     * albedo is what light multiplies, so handing the shader the un-lifted
     * bottom of that range and then multiplying by an ambient term under one
     * takes every solid in the frame to near-black.
     */
    const base = isEmissive
      ? mixHex(ctx.palette.accent, ctx.ramp(1), 0.3)
      : ctx.ramp(Math.min(1, tone * 1.3 + 0.12))

    /**
     * Translucency has to be resolved into albedo.
     *
     * A deferred G-buffer is opaque by construction: one material wins each
     * pixel, so there is nowhere for a node's alpha to go. The coursing is
     * declared at about half alpha because it is a joint in stone rather than
     * a line drawn on it, and rendering it opaque turned every mass into
     * hatching. Mixing toward the middle of the ramp is what a half-alpha mark
     * over its own surroundings would have come out as, and it costs nothing.
     */
    const hex = mixHex(ctx.ramp(0.42), base, Math.max(0, Math.min(1, node.alpha ?? 1)))
    const [r, g, bl] = rgb(hex)
    gl.uniform3f(fu['uAlbedo'] ?? null, r, g, bl)
    gl.uniform1f(fu['uMaterial'] ?? null, node.material.k === 'mass' ? 0.25 : isEmissive ? 0.75 : 0.5)
    gl.uniform1f(fu['uPlane'] ?? null, node.plane)
    gl.uniform1f(fu['uEmissive'] ?? null, node.light.emissive)
    gl.uniform1f(fu['uBevel'] ?? null, node.material.k === 'ink' ? 3 : bevel)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  gl.disable(gl.DEPTH_TEST)

  const fullscreen = (p: Program, target: Target, bind: () => void) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
    gl.viewport(0, 0, target.width, target.height)
    gl.useProgram(p.program)
    bind()
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  const tex = (unit0: number, t: WebGLTexture, loc: WebGLUniformLocation | null) => {
    gl.activeTexture(gl.TEXTURE0 + unit0)
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.uniform1i(loc, unit0)
  }

  // --- light pass ---------------------------------------------------------
  const lu = progs.light.uniforms
  const ground = rgb(ctx.palette.ground)
  const ink = rgb(ctx.palette.ink)
  const accent = rgb(ctx.palette.accent)
  fullscreen(progs.light, LIT, () => {
    tex(0, GB.textures[0] as WebGLTexture, lu['uAlbedo'] ?? null)
    tex(1, GB.textures[1] as WebGLTexture, lu['uSurface'] ?? null)
    tex(2, GB.textures[2] as WebGLTexture, lu['uField'] ?? null)
    if (noise) tex(3, noise, lu['uNoise'] ?? null)
    gl.uniform2f(lu['uRes'] ?? null, w, h)
    // The light direction on screen, which is where the marcher walks. The
    // g-buffer was rasterised through the layout transform, so this pass reads
    // screen pixels and wants the screen-space light — not `ctx.light`, which
    // is the same source expressed in the field's own rotated, mirrored frame.
    gl.uniform2f(lu['uLight'] ?? null, ctx.screenLight.dx, -ctx.screenLight.dy)
    gl.uniform3f(lu['uGround'] ?? null, ground[0], ground[1], ground[2])
    gl.uniform3f(lu['uInk'] ?? null, ink[0], ink[1], ink[2])
    gl.uniform3f(lu['uAccent'] ?? null, accent[0], accent[1], accent[2])
    gl.uniform1f(lu['uUnit'] ?? null, pxPerUnit)
    gl.uniform1f(lu['uAo'] ?? null, draft ? 0 : 0.85)
    gl.uniform1f(lu['uShadow'] ?? null, draft ? 0 : 0.9)
    gl.uniform1f(lu['uSss'] ?? null, draft ? 0 : 0.3)
    gl.uniform1f(lu['uFocus'] ?? null, focus)
    gl.uniform1f(lu['uDofStrength'] ?? null, 1)
    gl.uniform2f(lu['uFocusUv'] ?? null, plan.screen.cx / w, plan.screen.cy / h)
    // The CPU path put five blurred ellipses over the ground and screened
    // them at two-thirds alpha, which lifted the whole frame well off the
    // ground colour. A sky that only leans a little toward the ramp leaves
    // every composition sitting in the bottom of its own range.
    const skyTop = rgb(mixHex(ctx.palette.ground, ctx.ramp(0.55), 0.62))
    const skyGlow = rgb(mixHex(ctx.palette.ground, ctx.ramp(0.78), 0.58))
    gl.uniform3f(lu['uSkyTop'] ?? null, skyTop[0], skyTop[1], skyTop[2])
    gl.uniform3f(lu['uSkyGlow'] ?? null, skyGlow[0], skyGlow[1], skyGlow[2])
    gl.uniform1f(lu['uAmbient'] ?? null, 0.68)
    gl.uniform1f(lu['uDirect'] ?? null, 1.05)
  })

  // --- depth of field ------------------------------------------------------
  const du = progs.dof.uniforms
  fullscreen(progs.dof, DOF, () => {
    tex(0, LIT.textures[0] as WebGLTexture, du['uColor'] ?? null)
    tex(1, GB.textures[1] as WebGLTexture, du['uSurface'] ?? null)
    gl.uniform2f(du['uRes'] ?? null, w, h)
    gl.uniform1f(du['uFocus'] ?? null, focus)
    // Enough to separate the planes, not enough to soften the subject. The
    // gather is per pixel and continuous, so a little goes much further here
    // than the tier blur it replaces.
    gl.uniform1f(du['uStrength'] ?? null, draft ? 0 : 0.55)
    gl.uniform1f(du['uBand'] ?? null, 0.34)
  })

  // --- bloom ---------------------------------------------------------------
  const bu = progs.bright.uniforms
  fullscreen(progs.bright, BRIGHT, () => {
    tex(0, DOF.textures[0] as WebGLTexture, bu['uColor'] ?? null)
    tex(1, GB.textures[2] as WebGLTexture, bu['uField'] ?? null)
    gl.uniform1f(bu['uThreshold'] ?? null, 0.78)
  })

  const blu = progs.blur.uniforms
  const blurPass = (from: Target, to: Target, dx: number, dy: number) => {
    fullscreen(progs.blur, to, () => {
      tex(0, from.textures[0] as WebGLTexture, blu['uColor'] ?? null)
      gl.uniform2f(blu['uDir'] ?? null, dx / to.width, dy / to.height)
    })
  }
  blurPass(BRIGHT, BA, 1, 0)
  blurPass(BA, BB, 0, 1)
  // the wide tap, at a quarter again, is the halation source
  blurPass(BB, WA, 2, 0)
  blurPass(WA, WB, 0, 2)

  // --- composite -----------------------------------------------------------
  const cu = progs.composite.uniforms
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, w, h)
  gl.useProgram(progs.composite.program)
  tex(0, DOF.textures[0] as WebGLTexture, cu['uColor'] ?? null)
  tex(1, BB.textures[0] as WebGLTexture, cu['uBloom'] ?? null)
  tex(2, WB.textures[0] as WebGLTexture, cu['uWide'] ?? null)
  if (noise) tex(3, noise, cu['uNoise'] ?? null)
  gl.uniform2f(cu['uRes'] ?? null, w, h)
  gl.uniform2f(cu['uVigCentre'] ?? null, plan.screen.cx / w, plan.screen.cy / h)
  gl.uniform1f(cu['uVignette'] ?? null, character.vignette)
  gl.uniform1f(cu['uGrain'] ?? null, draft ? 0 : 0.028 * character.grain)
  gl.uniform1f(cu['uBloomAmt'] ?? null, draft ? 0.1 : 0.2 * character.bloom)
  gl.uniform1f(cu['uWarmth'] ?? null, graph.warmth ?? 0)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  gl.flush()

  // Copy out immediately. The shared context is about to be reused by the next
  // composition, and its drawing buffer is not preserved between frames.
  const snapshot = document.createElement('canvas')
  snapshot.width = w
  snapshot.height = h
  const sc = snapshot.getContext('2d')
  if (sc) sc.drawImage(gpu.canvas, 0, 0)

  for (const t of made) disposeTarget(gl, t)

  return (out: CanvasRenderingContext2D) => {
    out.setTransform(1, 0, 0, 1, 0, 0)
    out.drawImage(snapshot, 0, 0)
  }
}
