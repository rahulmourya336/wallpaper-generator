import { clamp, el, f, lerp, smooth } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import { capCell } from '../../sampling'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * The net of light on the floor of a pool.
 *
 * Caustics are not a texture, they are an accounting identity: a wavy surface
 * bends light, and wherever the surface squeezes a patch of the floor into a
 * smaller patch, the same light lands in less space and that spot is brighter.
 * So this warps a lattice through the noise field and measures how much each
 * cell shrank — brightness is the reciprocal of the area, and nothing else.
 * The bright folds fall out where the warp folds, which is where they fall out
 * in a swimming pool, and it is the reason this reads as light rather than as
 * a decorated grid.
 *
 * What is drawn is emphatically NOT the lattice. Emitting one segment per
 * lattice edge shows the quad topology, corners and all, and the result reads
 * as a deformed fishing net — the picture becomes the scaffolding rather than
 * what the scaffolding measured. Instead each row and column is walked as a
 * continuous line and cut into runs wherever the light falls away, so what
 * survives is a set of curved filaments with the grid nowhere in them.
 */

const schema: ParamSchema = [
  { key: 'scale', label: 'Cell size', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.5 },
  { key: 'warp', label: 'Refraction', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.58 },
  { key: 'focus', label: 'Focus', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.62 },
  { key: 'dispersion', label: 'Dispersion', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'lens', 'circle', 'ellipse'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, n, palette, focal } = ctx
  const scaleK = ctx.num('scale')
  const warpK = ctx.num('warp')
  const focusK = ctx.num('focus')
  const dispK = ctx.num('dispersion')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const cell = capCell(ctx, u(lerp(120, 52, scaleK)), 2200)
  const amp = u(lerp(34, 145, warpK))
  const wave = lerp(500, 165, warpK)
  const phase = skel.range(0, 400)

  // Two independent noise reads, one per axis. One read used for both would
  // shear the lattice along a single diagonal instead of folding it.
  const warp = (x: number, y: number): [number, number] => {
    const dx = ctx.fbm((n(x) + phase) / wave, (n(y) - phase) / wave, 3)
    const dy = ctx.fbm((n(x) - phase * 1.7) / wave, (n(y) + phase * 0.6) / wave, 3)
    return [x + dx * amp, y + dy * amp]
  }

  // one cell of bleed, so the net never ends on a clean interior edge
  const cols = Math.ceil(w / cell) + 3
  const rows = Math.ceil(h / cell) + 3
  const px = new Float64Array(cols * rows)
  const py = new Float64Array(cols * rows)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const [wx, wy] = warp((i - 1) * cell, (j - 1) * cell)
      px[j * cols + i] = wx
      py[j * cols + i] = wy
    }
  }

  /**
   * The cut is on compression, and it has to be well above one.
   *
   * A cell that has not been squeezed has a concentration of exactly one, and
   * across a smooth warp the median cell is almost exactly that — measured over
   * a frame, the distribution runs 0.5 to 3.9 with half of it sitting between
   * 0.83 and 1.30. So a threshold anywhere near one keeps every cell, every row
   * and column survives, and the picture is the lattice again however smoothly
   * it is drawn. Cutting at the third quartile is what leaves only the folds.
   *
   * Distance from the subject must NOT enter this decision. Folding it in was
   * the original mistake: it turned a question about the surface into a
   * question about the composition, and dragged the threshold down to where
   * everything passed. Falloff belongs on the opacity, where it dims a filament
   * that exists rather than inventing one that does not.
   */
  const CUT = lerp(1.34, 1.06, focusK)

  const flat = cell * cell
  // concentration per cell; the trace takes the brightest cell around a node
  const bright = new Float64Array((cols - 1) * (rows - 1))
  let hottest = 0
  let hotAt = 0

  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i
      const b = a + 1
      const c = a + cols + 1
      const d = a + cols
      // shoelace over the warped quad
      const area = Math.abs(
        (px[a] as number) * ((py[b] as number) - (py[d] as number)) +
        (px[b] as number) * ((py[c] as number) - (py[a] as number)) +
        (px[c] as number) * ((py[d] as number) - (py[b] as number)) +
        (px[d] as number) * ((py[a] as number) - (py[c] as number)),
      ) / 2
      const conc = clamp(flat / Math.max(area, flat * 0.06), 0, 6)
      const k = j * (cols - 1) + i
      bright[k] = conc
      if (conc > hottest) {
        hottest = conc
        hotAt = k
      }
    }
  }

  const cellAt = (i: number, j: number): number =>
    i < 0 || j < 0 || i >= cols - 1 || j >= rows - 1 ? 0 : (bright[j * (cols - 1) + i] as number)

  /**
   * A run is cut into overlapping chunks, each with its own brightness.
   *
   * Giving the whole run one weight forces a bad choice: cut hard and the
   * filaments come apart into stubs that read as cracks; cut soft and every
   * lattice line survives and it is a net again. A caustic does neither — it is
   * one continuous fold that brightens and fades along its length, so the
   * weight has to vary *inside* the line. Chunks overlap by two samples so the
   * segments join without a seam.
   */
  const CHUNK = 5

  const emitRun = (pts: number[], vs: number[]): void => {
    const n = pts.length / 2
    if (n < 3) return
    for (let s = 0; s + 2 < n; s += CHUNK - 2) {
      const e = Math.min(n - 1, s + CHUNK - 1)
      let peak = 0
      for (let k = s; k <= e; k++) if ((vs[k] as number) > peak) peak = vs[k] as number
      const t = clamp((peak - CUT) / 1.05, 0, 1)
      if (t < 0.05) continue
      emitChunk(pts.slice(s * 2, (e + 1) * 2), t)
    }
  }

  const emitChunk = (pts: number[], t: number): void => {
    if (pts.length < 6) return
    const d = smooth(pts, 0.5)
    // where the chunk sits, so distance from the subject can dim it
    const mid = Math.floor(pts.length / 4) * 2
    const fall = 0.42 + 0.58 * ctx.falloff(pts[mid] as number, pts[mid + 1] as number)

    /**
     * Three passes with the same curve: a broad diffuse bloom, the filament,
     * and a hot core on only the brightest runs. A caustic is not a line, it is
     * a line with light spilling off it, and one stroke can only ever be one of
     * those two things.
     */
    const bloom = el('path', {
      d, fill: 'none', stroke: ctx.ramp(0.45),
      'stroke-width': u(lerp(4, 22, t)), 'stroke-linecap': 'round',
      opacity: ((0.05 + 0.16 * t) * fall).toFixed(3),
    })
    const line = el('path', {
      d, fill: 'none', stroke: ctx.ramp(0.42 + 0.58 * t),
      'stroke-width': u(lerp(0.9, 4.6, t)), 'stroke-linecap': 'round',
      opacity: ((0.3 + 0.65 * t) * fall).toFixed(3),
    })
    const core = t > 0.55
      ? el('path', {
          d, fill: 'none', stroke: ctx.ramp(1),
          'stroke-width': u(lerp(0.4, 1.5, t)), 'stroke-linecap': 'round',
          opacity: ((0.4 * (t - 0.55) / 0.45 + 0.35) * fall).toFixed(3),
        })
      : ''

    /**
     * The fringe: the filament again, displaced along its own normal, once
     * toward the top of the ramp and once toward the accent. There is no
     * wavelength in a palette, but a bright line with two differently coloured
     * shoulders is what the eye reads as split light.
     */
    let fringe = ''
    if (dispK > 0.05 && t > 0.4) {
      const off = u(1.4 + 5 * dispK) * t
      fringe =
        el('path', {
          d, fill: 'none', stroke: withAlpha(ctx.ramp(1), 0.22 * dispK * t),
          'stroke-width': u(1.3), transform: `translate(${f(off)} ${f(off * 0.4)})`,
        }) +
        el('path', {
          d, fill: 'none',
          stroke: withAlpha(mixHex(palette.accent, ctx.ramp(0.6), 0.45), 0.2 * dispK * t),
          'stroke-width': u(1.3), transform: `translate(${f(-off)} ${f(-off * 0.4)})`,
        })
    }

    const mark = bloom + fringe + line + core
    subject.push(mark)
    // sparser outside the form, so the density step reads without a second pass
    if (t > 0.45 || skel.bool(0.55)) back.push(mark)
  }

  /** Walk one line of the lattice, breaking it into bright runs. */
  const trace = (
    count: number,
    at: (k: number) => number,
    bright: (k: number) => number,
  ): void => {
    let pts: number[] = []
    let vs: number[] = []
    for (let k = 0; k < count; k++) {
      const v = bright(k)
      if (v < CUT) {
        emitRun(pts, vs)
        pts = []
        vs = []
        continue
      }
      const idx = at(k)
      const x = px[idx] as number
      const y = py[idx] as number
      // A run that has wandered well off frame is not worth carrying; cut it
      // so the surviving piece keeps its own shape instead of being dragged.
      if (x < -cell * 2 || x > w + cell * 2 || y < -cell * 2 || y > h + cell * 2) {
        emitRun(pts, vs)
        pts = []
        vs = []
        continue
      }
      pts.push(x, y)
      vs.push(v)
    }
    emitRun(pts, vs)
  }

  for (let j = 0; j < rows; j++) {
    if ((j & 7) === 0 && ctx.expired()) break
    trace(cols, (i) => j * cols + i, (i) => Math.max(cellAt(i - 1, j - 1), cellAt(i, j - 1), cellAt(i - 1, j), cellAt(i, j)))
  }
  for (let i = 0; i < cols; i++) {
    if ((i & 7) === 0 && ctx.expired()) break
    trace(rows, (j) => j * cols + i, (j) => Math.max(cellAt(i - 1, j - 1), cellAt(i, j - 1), cellAt(i - 1, j), cellAt(i, j)))
  }

  // The pooled light in the tightest cells, under the net rather than on it.
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const v = cellAt(i, j)
      if (v < 2.3) continue
      const a = j * cols + i
      const quad =
        `M${f(px[a] as number)} ${f(py[a] as number)}` +
        `L${f(px[a + 1] as number)} ${f(py[a + 1] as number)}` +
        `L${f(px[a + cols + 1] as number)} ${f(py[a + cols + 1] as number)}` +
        `L${f(px[a + cols] as number)} ${f(py[a + cols] as number)}Z`
      behind.push(el('path', {
        d: quad,
        fill: ctx.ramp(0.85),
        opacity: (0.05 + 0.11 * clamp((v - 2.3) / 1.6, 0, 1)).toFixed(3),
      }))
    }
  }

  // A shaft of light entering the water, crossing the form edge on its way in.
  const shaftA = skel.range(-0.55, 0.55) + Math.atan2(-ctx.light.dy, ctx.light.dx)
  const shaftLen = Math.hypot(w, h)
  const shaftW = u(skel.range(26, 62))
  const sx = focal.cx - Math.cos(shaftA) * shaftLen * 0.6
  const sy = focal.cy - Math.sin(shaftA) * shaftLen * 0.6
  front.push(el('path', {
    d:
      `M${f(sx - Math.sin(shaftA) * shaftW * 0.35)} ${f(sy + Math.cos(shaftA) * shaftW * 0.35)}` +
      `L${f(sx + Math.sin(shaftA) * shaftW * 0.35)} ${f(sy - Math.cos(shaftA) * shaftW * 0.35)}` +
      `L${f(focal.cx + Math.sin(shaftA) * shaftW)} ${f(focal.cy - Math.cos(shaftA) * shaftW)}` +
      `L${f(focal.cx - Math.sin(shaftA) * shaftW)} ${f(focal.cy + Math.cos(shaftA) * shaftW)}Z`,
    fill: withAlpha(ctx.ramp(1), 0.09),
  }))

  // --- the accent: the single brightest node in the net --------------------
  const hi = hotAt % (cols - 1)
  const hj = Math.floor(hotAt / (cols - 1))
  const ha = hj * cols + hi
  const ax = px[ha] as number
  const ay = py[ha] as number
  const accent =
    el('circle', { cx: ax, cy: ay, r: u(4.6), fill: palette.accent }) +
    el('circle', {
      cx: ax, cy: ay, r: u(13), fill: 'none',
      stroke: withAlpha(palette.accent, 0.4), 'stroke-width': u(1.4),
    }) +
    el('path', {
      d: `M${f(ax - u(26))} ${f(ay)}H${f(ax + u(26))}M${f(ax)} ${f(ay - u(26))}V${f(ay + u(26))}`,
      stroke: withAlpha(palette.accent, 0.5), 'stroke-width': u(1.2), fill: 'none',
    })

  return { back, behind, subject, front, accent }
}

export const causticWeb: Renderer = {
  id: 'caustic-web',
  name: 'Caustic Web',
  family: 'prismatic',
  dark: true,
  focals: ['lens', 'circle', 'ellipse'],
  sampler: 'grid',
  schema,
  render,
}
