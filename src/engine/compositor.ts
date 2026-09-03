import { makeRng } from './rng'
import { makeNoise } from './noise'
import { getPalette, mixHex, PALETTES, rampAt, withAlpha } from './palette'
import type { Palette } from './palette'
import { makeFocal } from './focal'
import { attrs, circlePath, clamp, el, f, group, lerp } from './svg'
import type {
  Dimensions, FocalKind, ParamSchema, ParamValues, RenderContext, Renderer, Scene,
} from './types'

export type ComposeInput = {
  renderer: Renderer
  seed: string
  params: ParamValues
  dims: Dimensions
  /** caller-chosen palette; falls back to the renderer's own list */
  paletteId?: string
  /** 0.25 filmstrip | 1 canvas | 1..4 export */
  quality?: number
  budgetMs?: number
}

export type ComposeResult = {
  svg: string
  /** inner markup only, for injecting into a live <svg> without reparsing the root */
  inner: string
  width: number
  height: number
  palette: Palette
  paint?: (c: CanvasRenderingContext2D) => void
  /** true if a renderer bailed out of a growth loop on the time budget */
  truncated: boolean
}

/** Fill in defaults, clamp ranges, reject unknown select options. */
export function resolveParams(
  schema: ParamSchema,
  values: ParamValues,
): Record<string, number | string> {
  const out: Record<string, number | string> = {}
  for (const spec of schema) {
    const raw = values[spec.key]
    if (spec.type === 'range') {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
      out[spec.key] = Number.isFinite(n) ? clamp(n, spec.min, spec.max) : spec.default
    } else {
      out[spec.key] = typeof raw === 'string' && spec.options.includes(raw) ? raw : spec.default
    }
  }
  return out
}

function defaultBudget(quality: number): number {
  if (quality <= 0.4) return 45
  if (quality <= 1.2) return 260
  return 6000
}

const GRAIN_TILE = 256

/**
 * Grain cells across the short edge. Sub-linear in resolution: exponent 0 would
 * be strict WYSIWYG but leaves a 4K export looking chunky, exponent 1 makes the
 * preview smooth and the export gritty. 0.5 reads as film grain at both.
 */
function grainFrequency(short: number): number {
  const cells = 900 * (short / 1000) ** 0.5
  const cycles = Math.max(1, Math.round((cells / short) * GRAIN_TILE))
  return cycles / GRAIN_TILE
}

export function compose(input: ComposeInput): ComposeResult {
  const { renderer, seed, dims } = input
  const quality = input.quality ?? 1
  const w = Math.max(1, Math.round(dims.width))
  const h = Math.max(1, Math.round(dims.height))
  const short = Math.min(w, h)
  const params = resolveParams(renderer.schema, input.params)

  // Stage streams. Skeleton decisions must never share a stream with per-sample
  // draws, or the filmstrip thumbnail would show a different composition from
  // the canvas it is meant to restyle.
  const root = makeRng(seed, renderer.id)
  const paletteRng = root.fork('palette')
  const focalRng = root.fork('focal')
  const lightRng = root.fork('light')
  const noiseRng = root.fork('noise')

  const allowed = renderer.palettes.length ? renderer.palettes : PALETTES.map((p) => p.id)
  const requested = input.paletteId
  const fromParams = typeof params['palette'] === 'string' ? (params['palette'] as string) : undefined
  // Auto-pick leans to the style's declared mode: most people set dark
  // wallpapers, and a style declared dark should mostly land there.
  const preferred = allowed.filter((id) => getPalette(id)?.mode === (renderer.dark ? 'dark' : 'light'))
  const chosenId =
    requested && allowed.includes(requested) ? requested
    : fromParams && allowed.includes(fromParams) ? fromParams
    : preferred.length && paletteRng.bool(0.75) ? paletteRng.pick(preferred)
    : paletteRng.pick(allowed)
  const palette = getPalette(chosenId) ?? (getPalette(allowed[0] as string) as Palette)

  // Focal placement. Portrait centres sit below the notification band by
  // construction; no renderer gets the chance to violate it.
  const formParam = params['form']
  const kind: FocalKind =
    typeof formParam === 'string' && formParam !== 'auto'
      ? (formParam as FocalKind)
      : focalRng.pick(renderer.focals)
  const aspect = w / h
  const cx = w * focalRng.range(0.38, 0.62)
  const cy = h * (aspect < 1 ? focalRng.range(0.54, 0.72) : focalRng.range(0.46, 0.62))
  const baseR = short * focalRng.range(0.3, 0.42)
  const ry = kind === 'arch'
    ? baseR * focalRng.range(1.35, 1.8)
    : baseR * focalRng.range(0.92, 1.18)
  const focal = makeFocal(kind, cx, cy, baseR, ry)

  // One light source, kept in the upper half so every shadow falls downward.
  const angle = lightRng.range(-Math.PI * 0.82, -Math.PI * 0.18)
  const light = { angle, dx: Math.cos(angle), dy: Math.sin(angle) }

  const noise = makeNoise(noiseRng)

  const falloffK = typeof params['falloff'] === 'number' ? (params['falloff'] as number) : 0.55
  const falloffR = short * (0.45 + 0.95 * falloffK)
  const decay = (x: number, y: number) =>
    clamp(1 - (Math.hypot(x - cx, y - cy) / falloffR) ** 1.6, 0, 1)

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const deadline = now() + (input.budgetMs ?? defaultBudget(quality))
  let truncated = false

  const ctx: RenderContext = {
    seed,
    rng: root.fork('field'),
    fork: (salt) => root.fork(salt),
    w, h, aspect, short,
    u: (units) => (units * short) / 1000,
    n: (px) => (px * 1000) / short,
    quality,
    expired: () => {
      if (now() > deadline) {
        truncated = true
        return true
      }
      return false
    },
    palette,
    focal,
    light,
    falloff: decay,
    density: (x, y) => (focal.contains(x, y) ? 1 : 0.25) * (0.35 + 0.65 * decay(x, y)),
    noise2: noise.noise2,
    fbm: noise.fbm,
    num: (key) => {
      const v = params[key]
      return typeof v === 'number' ? v : 0
    },
    str: (key) => {
      const v = params[key]
      return typeof v === 'string' ? v : ''
    },
    ramp: (t) => rampAt(palette, t),
  }

  const scene: Scene = renderer.render(ctx)

  if (import.meta.env.DEV && !scene.accent && renderer.mode !== 'canvas') {
    console.warn(`[compositor] ${renderer.id} produced no accent element`)
  }

  const inner = assemble(ctx, scene, renderer)
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"' +
    attrs({
      width: w,
      height: h,
      viewBox: `0 0 ${w} ${h}`,
      preserveAspectRatio: 'xMidYMid slice',
    }) +
    `>${inner}</svg>`

  const result: ComposeResult = { svg, inner, width: w, height: h, palette, truncated }
  if (scene.paint) result.paint = (c: CanvasRenderingContext2D) => scene.paint?.(c, ctx)
  return result
}

function assemble(ctx: RenderContext, scene: Scene, renderer: Renderer): string {
  const { w, h, short, palette: p, focal } = ctx
  const uid = `c${(hashString(`${ctx.seed}:${renderer.id}`) >>> 0).toString(36)}`

  // --- stage 0: defs -------------------------------------------------------
  const vignetteR = Math.hypot(Math.max(focal.cx, w - focal.cx), Math.max(focal.cy, h - focal.cy))
  const vignetteColor = mixHex(p.ink, '#0A0C12', 0.55)

  const defs: string[] = [
    el('clipPath', { id: `${uid}-in`, clipPathUnits: 'userSpaceOnUse' },
      el('path', { d: focal.path })),
    // inverse clip: the canvas rect plus the focal subpath, resolved evenodd
    el('clipPath', { id: `${uid}-out`, clipPathUnits: 'userSpaceOnUse' },
      el('path', { d: `M0 0H${f(w)}V${f(h)}H0Z${focal.path}`, 'clip-rule': 'evenodd' })),
    el('radialGradient',
      { id: `${uid}-vig`, gradientUnits: 'userSpaceOnUse', cx: focal.cx, cy: focal.cy, r: vignetteR },
      el('stop', { offset: '0', 'stop-color': vignetteColor, 'stop-opacity': 0 }) +
      el('stop', { offset: '0.5', 'stop-color': vignetteColor, 'stop-opacity': 0.05 }) +
      el('stop', { offset: '0.82', 'stop-color': vignetteColor, 'stop-opacity': 0.22 }) +
      el('stop', { offset: '1', 'stop-color': vignetteColor, 'stop-opacity': 0.42 })),
    // Grain as a stitched tile behind a pattern: filter cost is constant in
    // canvas size, so a 4x export costs the same as a thumbnail.
    el('filter',
      {
        id: `${uid}-gf`, x: '0%', y: '0%', width: '100%', height: '100%',
        filterUnits: 'objectBoundingBox', 'color-interpolation-filters': 'sRGB',
      },
      el('feTurbulence', {
        type: 'fractalNoise',
        baseFrequency: grainFrequency(short),
        numOctaves: 3,
        seed: (hashString(ctx.seed) >>> 0) % 65536,
        stitchTiles: 'stitch',
        result: 't',
      }) +
      el('feColorMatrix', {
        in: 't', type: 'matrix',
        values: '0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 0 1',
      })),
    el('pattern',
      { id: `${uid}-grain`, patternUnits: 'userSpaceOnUse', width: GRAIN_TILE, height: GRAIN_TILE },
      el('rect', { width: GRAIN_TILE, height: GRAIN_TILE, filter: `url(#${uid}-gf)` })),
    ...(scene.defs ?? []),
  ]

  const layers: string[] = []

  // --- stage 1: ground -----------------------------------------------------
  if (renderer.mode !== 'canvas') {
    layers.push(el('rect', { x: 0, y: 0, width: w, height: h, fill: p.ground }))
  }

  // --- stage 2: far field, outside the focal form --------------------------
  layers.push(group({ 'clip-path': `url(#${uid}-out)` }, scene.back))

  // --- stage 3: elements passing behind the focal form ---------------------
  layers.push(group({}, scene.behind))

  // --- stage 4: the focal form, with a misregistered outline ---------------
  if (renderer.mode !== 'canvas') {
    const off = ctx.u(2.6)
    layers.push(
      el('path', { d: focal.path, fill: mixHex(p.ground, p.ramp[0], 0.55) }) +
        el('path', {
          d: focal.path,
          fill: 'none',
          stroke: withAlpha(ctx.ramp(0.7), 0.55),
          'stroke-width': ctx.u(1.6),
          transform: `translate(${f(off * ctx.light.dx)} ${f(-off * ctx.light.dy)})`,
        }),
    )
  }

  // --- stage 5: the field at full density, clipped to the form -------------
  layers.push(group({ 'clip-path': `url(#${uid}-in)` }, scene.subject))

  // --- stage 6: ghost geometry ---------------------------------------------
  layers.push(group({ fill: 'none' }, ghostGeometry(ctx)))

  // --- stage 7: elements crossing over the form edge -----------------------
  layers.push(group({}, scene.front))

  // --- stage 8: the single accent ------------------------------------------
  if (scene.accent) layers.push(scene.accent)

  // --- stage 9: vignette ---------------------------------------------------
  layers.push(el('rect', { x: 0, y: 0, width: w, height: h, fill: `url(#${uid}-vig)` }))

  // --- stage 10: grain -----------------------------------------------------
  layers.push(el('rect', {
    x: 0, y: 0, width: w, height: h,
    fill: `url(#${uid}-grain)`,
    opacity: p.mode === 'dark' ? 0.1 : 0.075,
    style: 'mix-blend-mode:overlay',
  }))

  return `<defs>${defs.join('')}</defs><g style="isolation:isolate">${layers.join('')}</g>`
}

/**
 * Hairline arcs and circles extending well past the solid form. The cheapest
 * way to make a composition look intentional rather than generated.
 */
function ghostGeometry(ctx: RenderContext): string[] {
  const rng = ctx.fork('ghost')
  const { focal } = ctx
  const base = Math.max(focal.rx, focal.ry)
  const out: string[] = []
  const count = rng.int(3, 6)
  for (let i = 0; i < count; i++) {
    const r = base * lerp(1.06, 2.35, i / Math.max(1, count - 1)) * rng.range(0.94, 1.08)
    const opacity = rng.range(0.4, 0.6) * (1 - 0.35 * (i / count))
    const stroke = withAlpha(ctx.ramp(rng.range(0.45, 0.75)), opacity)
    const width = ctx.u(rng.range(0.7, 1.3))
    if (rng.bool(0.45)) {
      out.push(el('path', { d: circlePath(focal.cx, focal.cy, r), stroke, 'stroke-width': width }))
      continue
    }
    const a0 = rng.range(0, Math.PI * 2)
    const a1 = a0 + rng.range(Math.PI * 0.45, Math.PI * 1.5)
    out.push(el('path', {
      d:
        `M${f(focal.cx + Math.cos(a0) * r)} ${f(focal.cy + Math.sin(a0) * r)}` +
        `A${f(r)} ${f(r)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ` +
        `${f(focal.cx + Math.cos(a1) * r)} ${f(focal.cy + Math.sin(a1) * r)}`,
      stroke,
      'stroke-width': width,
      'stroke-linecap': 'round',
    }))
  }
  return out
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h | 0
}
