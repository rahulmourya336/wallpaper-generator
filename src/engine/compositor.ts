import { makeRng } from './rng'
import { makeNoise } from './noise'
import { getPalette, mixHex, rampAt } from './palette'
import { palettePool, pickPaletteId } from './palette-pick'
import type { Palette } from './palette'
import { characterOf } from './character'
import { fieldTransform, pickLayout, planLayout } from './layout'
import type { LayoutId, LayoutPlan } from './layout'
import { atmosphere, bloomed, formGradients, groundFill, lightDefs, shade, sheen } from './light'
import { attrs, clamp, el, f, group, lerp } from './svg'
import { resolveToScene } from './scene/svg-backend'
import { canRaster, countPrimitives, renderGraph } from './pipeline/render'
import { graphIsGpuReady, renderGpu } from './gpu/render'
import { gpuEnabled } from './gpu/flag'
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
  /**
   * `paint` is the complete image and `svg` is a vector approximation of it.
   *
   * Set for families on the scene graph, whose film pass — ordered dithering,
   * chroma-aware grain, a perceptual grade — has no SVG expression. Consumers
   * must show the raster and keep the vector for SVG download only.
   */
  raster: boolean
  /** which path actually drew it; shown in the export dialog and dev overlay */
  backend: 'gpu' | 'cpu' | 'vector'
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
  const layoutRng = root.fork('layout')
  const focalRng = root.fork('focal')
  const lightRng = root.fork('light')
  const noiseRng = root.fork('noise')

  // --- palette: the family's pool, biased to the style's declared mode -----
  const pool = palettePool(renderer)
  const chosenId = pickPaletteId(renderer, seed, input.paletteId, params)
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
    character.subjectScale,
  )
  const focal = plan.focals[0] as Focal
  const focals = plan.focals

  // One light source, kept in the upper half so every shadow falls downward.
  const angle = lightRng.range(-Math.PI * 0.82, -Math.PI * 0.18)
  const screenLight = { angle, dx: Math.cos(angle), dy: Math.sin(angle) }

  /**
   * The same light, turned into the field's own frame.
   *
   * One vector was being read in two coordinate systems. The ground, the
   * shade, the sheen and the atmosphere are laid down in screen space; every
   * renderer's shading, and the cast shadow filter, live inside the layout
   * transform, which turns the field by up to 44 degrees and mirrors it half
   * the time. So half the catalogue was lit from two directions at once — the
   * specular sweep on the left of the screen and the shadow the subject threw
   * falling to the right of it — and the eye reads that as "shaded by a
   * filter" rather than as lit. Undoing the transform once, here, is what
   * makes one light source read as one light source.
   */
  const light = toFieldLight(screenLight, plan)

  const noise = makeNoise(noiseRng)

  const falloffK = typeof params['falloff'] === 'number' ? (params['falloff'] as number) : 0.55
  const falloffR = short * (0.45 + 0.95 * falloffK)
  // Falloff answers to the nearest focal, so a twin layout gets two centres of
  // interest rather than one plus a shape sitting in a dead part of the field.
  //
  // The floor is what stops the far field ending at a circle. Clamped to zero,
  // everything past `falloffR` was not thin, it was absent, so a quiet
  // composition had a hard circular boundary with uniform nothing outside it —
  // a circle of emptiness rather than deliberate negative space. Three percent
  // is a whisper: sub-pixel marks and opacities a viewer reads as air.
  const decay = (x: number, y: number) => {
    let best = 0
    for (const foc of focals) {
      const d = clamp(1 - (Math.hypot(x - foc.cx, y - foc.cy) / falloffR) ** 1.6, 0, 1)
      if (d > best) best = d
    }
    return Math.max(best, 0.03)
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
    screenLight,
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
    density: (x, y) => {
      /**
       * How fast the field empties, decided by the category's direction.
       *
       * A floor here meant every renderer kept sprinkling out to the corners
       * forever, and one fixed curve meant a woven cloth thinned toward its
       * edges exactly like a night sky. At 0 the field is even to the frame
       * edge, which is the only honest answer for a macro texture; above 1 the
       * ground goes genuinely bare and the marks gather, which is what the
       * quiet direction is for.
       */
      const k = character.falloff
      const d = decay(x, y)
      const s = d * d * (3 - 2 * d)
      const shaped = k <= 1 ? 1 - k * (1 - s) : Math.pow(s, k)
      const ground = (1 - 0.1 * Math.min(k, 1)) * shaped
      /**
       * The subject is a band, not a step.
       *
       * This used to return a hard 1 anywhere `contains` was true, and the step
       * across the silhouette is large — for the atmospheric default it jumps
       * from about two thirds to one. Every renderer that gates its sample
       * count on density printed that jump as a circular seam sitting exactly
       * on the form edge: the ring in the dot field, the ring in the starfield.
       * Fading it over the outer tenth of the form keeps the subject dense and
       * costs the seam.
       */
      let core = 0
      for (const foc of focals) {
        const q = smoothstep(1.12, 0.94, foc.norm(x, y))
        if (q > core) core = q
      }
      return ground + (1 - ground) * core
    },
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
    ramp: (t) => rampAt(palette, 0.04 + 0.96 * clamp(t, 0, 1)),
  }

  /**
   * Two backends, one contract.
   *
   * A ported family emits a scene graph and knows nothing about SVG; the
   * vector backend resolves it. An unported one still emits SVG source
   * directly. Everything downstream of this line is identical for both, which
   * is what lets the catalogue migrate a family at a time instead of in one
   * jump.
   */
  const graph = renderer.build ? renderer.build(ctx) : null
  const scene: Scene = graph ? resolveToScene(ctx, graph) : (renderer.render as (c: RenderContext) => Scene)(ctx)

  if (import.meta.env.DEV && graph) {
    const prims = countPrimitives(graph)
    if (prims < 400) console.warn(`[budget] ${renderer.id} emitted ${prims} primitives (under 400)`)
    if (prims > 6000) console.warn(`[budget] ${renderer.id} emitted ${prims} primitives (over 6000)`)
  }

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

  /**
   * A graph family renders through the post pipeline when a canvas is
   * available, and falls back to its own vector approximation when one is not
   * — which is the case in the headless sweeps and will be the case in CI.
   * The fallback is a real picture, not a placeholder, which is what makes it
   * safe to depend on.
   */
  const useRaster = graph !== null && canRaster()

  const result: ComposeResult = {
    svg, inner, width: w, height: h, palette, layout: plan.id, truncated,
    raster: useRaster,
    backend: 'vector',
  }

  /**
   * Three backends, in descending order of what they can do.
   *
   * The GPU path needs a graph whose every node carries a distance field, a
   * WebGL2 context with float render targets, and the flag left on. Any one of
   * those missing falls through to the CPU pipeline, and no canvas at all
   * falls through to the vector approximation. Each fallback is a real
   * picture, which is what makes it safe to depend on them: the floor stays a
   * correct composition, only a less lit one.
   */
  if (useRaster && graph) {
    if (gpuEnabled() && graphIsGpuReady(graph)) {
      const painter = renderGpu({ ctx, graph, plan, character, quality })
      if (painter) {
        result.paint = painter
        result.backend = 'gpu'
        return result
      }
    }
    result.paint = renderGraph({ ctx, graph, plan, character, quality })
    result.backend = 'cpu'
  } else if (scene.paint) {
    result.paint = (c: CanvasRenderingContext2D) => scene.paint?.(c, ctx)
    result.backend = 'cpu'
  }
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
  /**
   * The vignette is shaped to the frame, not to a circle.
   *
   * A circle whose radius reaches the far corner puts the long edges of a
   * portrait frame at four tenths of the way out — below the first meaningful
   * stop — so the "vignette" was two or four dark smudges in the corners with
   * completely open long sides. Measuring the vertical distance in units of the
   * horizontal one squashes the falloff onto the aspect, and the gradient
   * transform stretches it back, so all four edges sit at the same place on the
   * ramp. It multiplies rather than laying flat navy over the picture, which
   * greyed the shadows instead of deepening them; multiply is stronger at equal
   * alpha, so the peak comes down to compensate.
   */
  const vigAspect = h / w
  const vignetteR = Math.hypot(Math.max(sx, w - sx), Math.max(sy, h - sy) / vigAspect)
  const vignetteColor = mixHex(p.ink, '#0A0C12', 0.55)
  const vig = (a: number) => (a * character.vignette).toFixed(3)

  const defs: string[] = [
    el('clipPath', { id: `${uid}-in`, clipPathUnits: 'userSpaceOnUse' },
      el('path', { d: formPath })),
    // inverse clip: the canvas rect plus every focal subpath, resolved evenodd
    el('clipPath', { id: `${uid}-out`, clipPathUnits: 'userSpaceOnUse' },
      el('path', { d: `M0 0H${f(w)}V${f(h)}H0Z${formPath}`, 'clip-rule': 'evenodd' })),
    el('radialGradient',
      {
        id: `${uid}-vig`, gradientUnits: 'userSpaceOnUse', cx: sx, cy: sy, r: vignetteR,
        gradientTransform:
          `translate(${f(sx)} ${f(sy)}) scale(1 ${f(vigAspect)}) translate(${f(-sx)} ${f(-sy)})`,
      },
      el('stop', { offset: '0', 'stop-color': vignetteColor, 'stop-opacity': 0 }) +
      el('stop', { offset: '0.5', 'stop-color': vignetteColor, 'stop-opacity': vig(0.04) }) +
      el('stop', { offset: '0.82', 'stop-color': vignetteColor, 'stop-opacity': vig(0.18) }) +
      el('stop', { offset: '1', 'stop-color': vignetteColor, 'stop-opacity': vig(0.34) })),
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

  /**
   * stage 4: the focal form.
   *
   * It used to carry a misregistered outline, a hairline stroke offset toward
   * the light. That was the single clearest tell that these were diagrams: a
   * shape with a line around it is a symbol of a thing, where a shape with a
   * shadow under it is a thing.
   *
   * What replaced it was barely better: one opaque path filled with a mix of
   * the ground and the bottom of the ramp. At the fills the directions actually
   * ask for that mix IS the ground — so the pass painted ground colour over the
   * lit ground, the shade, the atmosphere and everything in `scene.behind`,
   * punching a flat, dead, hard-edged hole through all of it and erasing the
   * halos and the inner detail that were drawn to pass behind the form. With no
   * shading on it at all it disagreed with the light by construction, which is
   * the same clip-art tell arriving by a different route.
   *
   * So: a mix of nothing is not a shape, it is an eraser, and that case is
   * skipped outright. What is left TINTS what is under it rather than replacing
   * it, and carries a light model — a gradient along the light, a rim on the
   * lit side, an occlusion into the shadowed limb.
   */
  if (renderer.mode !== 'canvas' && character.formFill >= 0.03) {
    defs.push(...formGradients(ctx, uid, character))
    for (const foc of focals) {
      // The subject sits above the field, so it casts onto it — except where
      // the direction is printed rather than photographed, and a soft shadow
      // under a flat shape is the single clearest way to break that. The
      // shadow is clipped to outside the form because the form no longer hides
      // its own shadow: it is a tint now, and would show it straight through.
      if (character.cast) {
        field.push(el('g', { 'clip-path': `url(#${uid}-out)` },
          el('path', { d: foc.path, fill: p.ink, filter: `url(#${uid}-cast)` })))
      }
      field.push(el('path', {
        d: foc.path,
        fill: p.ramp[0],
        'fill-opacity': character.formFill.toFixed(3),
      }))
      field.push(el('path', { d: foc.path, fill: `url(#${uid}-form)` }))
      field.push(el('path', { d: foc.path, fill: `url(#${uid}-form-occ)` }))
    }
    // The rim is clipped to the form so it reads as an inner edge catching the
    // light rather than as an outline drawn around a symbol.
    field.push(group({ 'clip-path': `url(#${uid}-in)`, fill: 'none' },
      focals.map((foc) => el('path', {
        d: foc.path,
        stroke: `url(#${uid}-form-rim)`,
        'stroke-width': ctx.u(3.2),
      }))))
  }

  // stage 5: the field at full density, clipped to the form
  field.push(group({ 'clip-path': `url(#${uid}-in)` }, scene.subject))

  // stage 6: ghost geometry, where the direction admits construction lines at
  // all. On a flat print or a macro texture they read as leftovers.
  if (character.ghosts > 0 && ctx.fork('ghost-gate').bool(character.ghosts)) {
    field.push(group({ fill: 'none' }, ghostGeometry(ctx)))
  }

  /**
   * stage 7: elements crossing over the form edge.
   *
   * Gated the same way the subject's own shadow is. This was unconditional, so
   * every front element in every composition got a drop shadow — including the
   * printed and macro directions, which declare `cast: false` precisely because
   * they are flat. That is the grey band trailing each hero vein in the marble
   * and the halo around the terrazzo chips: a smudge where the direction asked
   * for none.
   */
  field.push(
    character.cast
      ? group({ filter: `url(#${uid}-lift)` }, scene.front)
      : group({}, scene.front),
  )

  // stage 8: the single accent
  if (scene.accent) field.push(bloomed(scene.accent, uid, character, p))

  const transform = fieldTransform(plan, w, h)
  const layers: string[] = []

  // stage 1: ground, in screen space so the transform cannot expose bare edges
  if (renderer.mode !== 'canvas') {
    layers.push(groundFill(ctx, uid, character.ground === 'flat'))
    layers.push(shade(ctx, uid, character))
    layers.push(atmosphere(ctx, uid, plan, character))
  }
  layers.push(transform ? el('g', { transform }, field.join('')) : field.join(''))

  // The multiply half of the light model has to reach the same pixels the
  // screen half does. Below the field `shade` only ever darkened bare ground,
  // so the artwork was lifted by the sheen and deepened by nothing and every
  // frame settled into the middle of its value range with nothing genuinely
  // dark in it. This second, weaker pass puts the unlit quadrant across the
  // picture as well as under it.
  layers.push(shade(ctx, uid, character, 0.55))
  layers.push(sheen(ctx, uid, character))

  // vignette and grain: screen space, never rotated
  layers.push(el('rect', { x: 0, y: 0, width: w, height: h, fill: `url(#${uid}-vig)` }))
  layers.push(el('rect', {
    x: 0, y: 0, width: w, height: h,
    fill: `url(#${uid}-grain)`,
    // Halved. At a tenth the grain read as a filter laid over the picture, and
    // on a phone at three device pixels per point it read as noise.
    opacity: ((p.mode === 'light' ? 0.04 : 0.05) * character.grain).toFixed(3),
    style: 'mix-blend-mode:overlay',
  }))

  return `<defs>${defs.join('')}</defs><g style="isolation:isolate">${layers.join('')}</g>`
}

/**
 * Hairline arcs extending well past the solid form. The cheapest way to make a
 * composition look intentional rather than generated — and the easiest to get
 * wrong, because it was the literal "uniform hairlines with no structure"
 * complaint in the shared layer.
 *
 * It drew nought to two arcs, so a third of the frames that ran it got nothing
 * and a third got one lone line. With one the radius lerp divided by zero-plus-
 * one and collapsed to the base radius, so that lone line landed right on the
 * focal silhouette: a misregistered outline arc, exactly what stage 4 dropped
 * its outline to avoid. Every arc was one sub-pixel width at one flat opacity
 * with round caps, so both ends stopped dead in mid-air.
 *
 * A family of marks instead: enough of them to read as a system, widths spread
 * hard with one clearly dominant, and each one tapered to nothing at both ends
 * so it passes through the frame rather than starting and stopping in it.
 */
function ghostGeometry(ctx: RenderContext): string[] {
  const rng = ctx.fork('ghost')
  const { focal } = ctx
  const base = Math.max(focal.rx, focal.ry)
  const out: string[] = []
  const count = rng.int(3, 5)
  const lead = rng.int(0, count - 1)
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.45 : i / (count - 1)
    const r = base * lerp(1.06, 2.35, t) * rng.range(0.94, 1.08)
    const dominant = i === lead
    const opacity = (dominant ? 0.3 : lerp(0.2, 0.06, t)) * rng.range(0.85, 1.15)
    const tone = ctx.ramp(rng.range(0.45, 0.75))
    const width = dominant ? ctx.u(rng.range(1.7, 2.4)) : ctx.u(rng.range(0.4, 0.9))
    /**
     * Arcs only. A closed ring reads as a drawn object — a second subject
     * competing with the focal form it is supposed to be sitting behind —
     * where an arc reads as something passing through the frame. The full
     * circle used to come up on a coin flip and was the louder half of a pass
     * whose whole job is to be barely noticed.
     */
    const a0 = rng.range(0, Math.PI * 2)
    const a1 = a0 + rng.range(Math.PI * 0.45, Math.PI * 1.5)
    const x0 = focal.cx + Math.cos(a0) * r
    const y0 = focal.cy + Math.sin(a0) * r
    const x1 = focal.cx + Math.cos(a1) * r
    const y1 = focal.cy + Math.sin(a1) * r
    const id = `${ctx.uid}-gh${i}`
    // The taper is in the stroke paint, along the chord: a flat opacity with a
    // cap on it is a line that begins and ends inside the picture, which is
    // what made these read as leftover construction lines.
    out.push(el('linearGradient',
      { id, gradientUnits: 'userSpaceOnUse', x1: x0, y1: y0, x2: x1, y2: y1 },
      el('stop', { offset: '0', 'stop-color': tone, 'stop-opacity': 0 }) +
      el('stop', { offset: '0.5', 'stop-color': tone, 'stop-opacity': opacity.toFixed(3) }) +
      el('stop', { offset: '1', 'stop-color': tone, 'stop-opacity': 0 })))
    out.push(el('path', {
      d:
        `M${f(x0)} ${f(y0)}` +
        `A${f(r)} ${f(r)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${f(x1)} ${f(y1)}`,
      stroke: `url(#${id})`,
      'stroke-width': width,
      'stroke-linecap': 'butt',
    }))
  }
  return out
}

/**
 * The screen-space light, expressed in the field's frame.
 *
 * The layout transform is `rotate` then a possibly mirrored `scale` about the
 * canvas centre, so a field vector reaches the screen as R(rotate)·S(flip)·v.
 * Inverting that is what a renderer needs to shade a form so that its lit side
 * comes out facing the light once the field has been turned. Uniform scale
 * drops out; only the rotation and the mirror matter.
 */
function toFieldLight(
  l: { angle: number; dx: number; dy: number },
  plan: LayoutPlan,
): { angle: number; dx: number; dy: number } {
  const rad = (plan.rotate * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = (l.dx * cos + l.dy * sin) * (plan.flip ? -1 : 1)
  const dy = -l.dx * sin + l.dy * cos
  return { angle: Math.atan2(dy, dx), dx, dy }
}

/** Hermite fade between two edges; `e0` may sit above `e1` to run downward. */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h | 0
}
