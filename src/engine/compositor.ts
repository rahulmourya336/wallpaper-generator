import { makeRng } from './rng'
import { makeNoise } from './noise'
import { getPalette, mixHex, PALETTES, rampAt, suitsMode, withAlpha } from './palette'
import type { Palette } from './palette'
import { characterOf } from './character'
import { fieldTransform, pickLayout, planLayout } from './layout'
import type { LayoutId, LayoutPlan } from './layout'
import { atmosphere, bloomed, groundFill, lightDefs, sheen } from './light'
import { attrs, circlePath, clamp, el, f, group, lerp } from './svg'
import type {
  Dimensions, Focal, FocalKind, ParamSchema, ParamValues, RenderContext, Renderer, Scene,
} from './types'

export type ComposeInput = {
  renderer: Renderer
  seed: string
  params: ParamValues
  dims: Dimensions
  /** caller-chosen palette; falls back to the family pool */
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
  layout: LayoutId
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

/**
 * Wall-clock budget by sample density. The thumbnail figure is deliberately
 * tight: the filmstrip renders several compositions in one synchronous pass,
 * so a generous budget puts a visible stall on every style switch. Renderers
 * bail out of growth loops gracefully, and at thumbnail scale the missing
 * elements are not visible.
 */
function defaultBudget(quality: number): number {
  if (quality <= 0.4) return 20
  if (quality <= 1.2) return 260
  return 20_000
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
  const aspect = w / h
  const params = resolveParams(renderer.schema, input.params)
  const character = characterOf(renderer.family)

  // Stage streams. Skeleton decisions must never share a stream with per-sample
  // draws, or the filmstrip thumbnail would show a different composition from
  // the canvas it is meant to restyle.
  const root = makeRng(seed, renderer.id)
  const paletteRng = root.fork('palette')
  const layoutRng = root.fork('layout')
  const focalRng = root.fork('focal')
  const lightRng = root.fork('light')
  const noiseRng = root.fork('noise')

  // --- palette: the family's pool, biased to the style's declared mode -----
  const pool = character.palettes.length ? character.palettes : PALETTES.map((p) => p.id)
  const requested = input.paletteId
  const fromParams = typeof params['palette'] === 'string' ? (params['palette'] as string) : undefined
  const preferred = pool.filter((id) => {
    const p = getPalette(id)
    return p ? suitsMode(p, renderer.dark) : false
  })
  const chosenId =
    requested && pool.includes(requested) ? requested
    : fromParams && pool.includes(fromParams) ? fromParams
    : preferred.length && paletteRng.bool(0.78) ? paletteRng.pick(preferred)
    : paletteRng.pick(pool)
  const palette = getPalette(chosenId) ?? (getPalette(pool[0] as string) as Palette)

  // --- layout: where the subject sits, and how the field is turned ---------
  const formParam = params['form']
  const kind: FocalKind =
    typeof formParam === 'string' && formParam !== 'auto'
      ? (formParam as FocalKind)
      : focalRng.pick(renderer.focals)
  const layoutId = pickLayout(layoutRng, character.layouts)
  const plan = planLayout(
    layoutId,
    layoutRng,
    { w, h, short, aspect },
    kind,
    focalRng.pick(renderer.focals),
  )
  const focal = plan.focals[0] as Focal
  const focals = plan.focals

  // One light source, kept in the upper half so every shadow falls downward.
  const angle = lightRng.range(-Math.PI * 0.82, -Math.PI * 0.18)
  const light = { angle, dx: Math.cos(angle), dy: Math.sin(angle) }

  const noise = makeNoise(noiseRng)

  const falloffK = typeof params['falloff'] === 'number' ? (params['falloff'] as number) : 0.55
  const falloffR = short * (0.45 + 0.95 * falloffK)
  // Falloff answers to the nearest focal, so a twin layout gets two centres of
  // interest rather than one plus a shape sitting in a dead part of the field.
  const decay = (x: number, y: number) => {
    let best = 0
    for (const foc of focals) {
      const d = clamp(1 - (Math.hypot(x - foc.cx, y - foc.cy) / falloffR) ** 1.6, 0, 1)
      if (d > best) best = d
    }
    return best
  }
  const inside = (x: number, y: number) => {
    for (const foc of focals) if (foc.contains(x, y)) return true
    return false
  }

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const deadline = now() + (input.budgetMs ?? defaultBudget(quality))
  let truncated = false

  const ctx: RenderContext = {
    seed,
    uid: `c${(hashString(`${seed}:${renderer.id}`) >>> 0).toString(36)}`,
    rng: root.fork('field'),
    fork: (salt) => root.fork(salt),
    w, h, aspect, short,
    u: (units) => (units * short) / 1000,
    n: (px) => (px * 1000) / short,
    // Zoom magnifies the field, so the same element count covers less of the
    // screen. Without a matching lift in sample density a close crop arrives as
    // an empty frame with three lines in it. The budget still keys off the
    // caller's quality, so this cannot blow the render time out.
    quality: quality * plan.zoom,
    expired: () => {
      if (now() > deadline) {
        truncated = true
        return true
      }
      return false
    },
    palette,
    focal,
    focals,
    anchor: { x: focal.cx / w, y: focal.cy / h },
    baseline: Math.max(h * 0.45, Math.min(h * 0.86, focal.cy + focal.ry * 0.5)),
    light,
    falloff: decay,
    /**
     * Subject and ground, with a floor.
     *
     * A quarter density outside the form was tuned when every composition put
     * its subject near the middle, so the falloff always covered most of the
     * frame. Once layouts push the subject low, to an edge, or right out of
     * the middle, whole regions fall to almost nothing and the picture arrives
     * as bare ground with a detail in one corner. The step is still clearly
     * readable; it just no longer bottoms out.
     */
    density: (x, y) => (inside(x, y) ? 1 : 0.42) * (0.52 + 0.48 * decay(x, y)),
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
    /**
     * Ramp with a floor under it.
     *
     * ramp[0] is defined as barely separating from the ground, and renderers
     * reach for the bottom of the ramp for ambient structure and then draw it
     * at a fifth opacity. On the lightest palettes that still reads; on the
     * darkest it is the ground exactly, which is how a composition with four
     * hundred elements in it arrives looking empty. Lifting the low end keeps
     * every ambient mark on the right side of visible without touching the
     * strong values, where the ramp still ends exactly where it did.
     */
    ramp: (t) => rampAt(palette, 0.12 + 0.88 * clamp(t, 0, 1)),
  }

  const scene: Scene = renderer.render(ctx)

  if (import.meta.env.DEV && !scene.accent && renderer.mode !== 'canvas') {
    console.warn(`[compositor] ${renderer.id} produced no accent element`)
  }

  const inner = assemble(ctx, scene, renderer, plan)

  /**
   * Renderers now declare their own gradients and filters, and they share the
   * uid namespace with the compositor's. A renderer that picks a name the
   * compositor already uses does not error — the document simply resolves both
   * references to whichever came first, and the result is a filter quietly
   * doing the wrong job somewhere in the frame. That is invisible in review
   * and obvious here, so it is checked here.
   */
  if (import.meta.env.DEV) {
    const ids = inner.match(/ id="([^"]+)"/g) ?? []
    if (ids.length !== new Set(ids).size) {
      const seen = new Set<string>()
      const dupes = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)))
      console.warn(`[compositor] ${renderer.id} declares duplicate ids: ${[...new Set(dupes)].join(', ')}`)
    }
  }
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"' +
    attrs({
      width: w,
      height: h,
      viewBox: `0 0 ${w} ${h}`,
      preserveAspectRatio: 'xMidYMid slice',
    }) +
    `>${inner}</svg>`

  const result: ComposeResult = {
    svg, inner, width: w, height: h, palette, layout: plan.id, truncated,
  }
  if (scene.paint) result.paint = (c: CanvasRenderingContext2D) => scene.paint?.(c, ctx)
  return result
}

function assemble(
  ctx: RenderContext,
  scene: Scene,
  renderer: Renderer,
  plan: LayoutPlan,
): string {
  const { w, h, short, palette: p, focals } = ctx
  const character = characterOf(renderer.family)
  const uid = ctx.uid
  const formPath = focals.map((foc) => foc.path).join('')

  // --- stage 0: defs -------------------------------------------------------
  // The vignette centres on where the subject lands ON SCREEN, which is not
  // where it lives in field space once the field is rotated and scaled.
  const sx = plan.screen.cx
  const sy = plan.screen.cy
  const vignetteR = Math.hypot(Math.max(sx, w - sx), Math.max(sy, h - sy))
  const vignetteColor = mixHex(p.ink, '#0A0C12', 0.55)
  const vig = (a: number) => (a * character.vignette).toFixed(3)

  const defs: string[] = [
    el('clipPath', { id: `${uid}-in`, clipPathUnits: 'userSpaceOnUse' },
      el('path', { d: formPath })),
    // inverse clip: the canvas rect plus every focal subpath, resolved evenodd
    el('clipPath', { id: `${uid}-out`, clipPathUnits: 'userSpaceOnUse' },
      el('path', { d: `M0 0H${f(w)}V${f(h)}H0Z${formPath}`, 'clip-rule': 'evenodd' })),
    el('radialGradient',
      { id: `${uid}-vig`, gradientUnits: 'userSpaceOnUse', cx: sx, cy: sy, r: vignetteR },
      el('stop', { offset: '0', 'stop-color': vignetteColor, 'stop-opacity': 0 }) +
      el('stop', { offset: '0.5', 'stop-color': vignetteColor, 'stop-opacity': vig(0.05) }) +
      el('stop', { offset: '0.82', 'stop-color': vignetteColor, 'stop-opacity': vig(0.22) }) +
      el('stop', { offset: '1', 'stop-color': vignetteColor, 'stop-opacity': vig(0.42) })),
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
    ...lightDefs(ctx, uid, character),
    ...(scene.defs ?? []),
  ]

  // --- the field: everything the layout transform applies to ---------------
  const field: string[] = []

  // stage 2: far field, outside the focal form
  field.push(group({ 'clip-path': `url(#${uid}-out)` }, scene.back))

  // stage 3: elements passing behind the focal form
  field.push(group({}, scene.behind))

  // stage 4: the focal form, with a misregistered outline
  if (renderer.mode !== 'canvas') {
    const off = ctx.u(2.6)
    for (const foc of focals) {
      field.push(
        // the subject sits above the field, so it casts onto it
        el('g', { filter: `url(#${uid}-cast)` },
          el('path', { d: foc.path, fill: mixHex(p.ground, p.ramp[0], character.formFill) })) +
          el('path', {
            d: foc.path,
            fill: 'none',
            stroke: withAlpha(ctx.ramp(0.7), 0.55),
            'stroke-width': ctx.u(1.6),
            transform: `translate(${f(off * ctx.light.dx)} ${f(-off * ctx.light.dy)})`,
          }),
      )
    }
  }

  // stage 5: the field at full density, clipped to the form
  field.push(group({ 'clip-path': `url(#${uid}-in)` }, scene.subject))

  // stage 6: ghost geometry
  field.push(group({ fill: 'none' }, ghostGeometry(ctx)))

  // stage 7: elements crossing over the form edge
  field.push(group({ filter: `url(#${uid}-lift)` }, scene.front))

  // stage 8: the single accent
  if (scene.accent) field.push(bloomed(scene.accent, uid, character))

  const transform = fieldTransform(plan, w, h)
  const layers: string[] = []

  // stage 1: ground, in screen space so the transform cannot expose bare edges
  if (renderer.mode !== 'canvas') {
    layers.push(groundFill(ctx, uid))
    layers.push(atmosphere(ctx, uid, plan, character))
  }
  layers.push(transform ? el('g', { transform }, field.join('')) : field.join(''))

  layers.push(sheen(ctx, uid, character))

  // vignette and grain: screen space, never rotated
  layers.push(el('rect', { x: 0, y: 0, width: w, height: h, fill: `url(#${uid}-vig)` }))
  layers.push(el('rect', {
    x: 0, y: 0, width: w, height: h,
    fill: `url(#${uid}-grain)`,
    opacity: ((p.mode === 'light' ? 0.075 : 0.1) * character.grain).toFixed(3),
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
