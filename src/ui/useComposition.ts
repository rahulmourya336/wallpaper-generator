import { useEffect, useState } from 'react'
import { compose } from '../engine/compositor'
import type { ComposeResult } from '../engine/compositor'
import { rendererOr } from '../engine/registry'
import { AUTO_PALETTE } from '../state/useStudio'
import type { StudioState } from '../state/useStudio'

export type CompositionRequest = {
  styleId: string
  seed: string
  paletteId: string
  params: Record<string, number | string>
  width: number
  height: number
  quality?: number
}

/**
 * Stable key for a params bag. Object key order follows insertion, so a bag
 * rebuilt from the URL hash and one built by moving sliders can serialise
 * differently while meaning the same thing; sorting makes memo and cache keys
 * agree with the compositor, which ignores order entirely.
 */
export function paramsKey(params: Record<string, number | string>): string {
  const keys = Object.keys(params).sort()
  let out = ''
  for (const k of keys) out += `${k}=${String(params[k])};`
  return out
}

function compositionKey(req: CompositionRequest): string {
  return [
    req.styleId, req.seed, req.paletteId,
    req.width, req.height, req.quality ?? 1,
    paramsKey(req.params),
  ].join('|')
}

/**
 * Small LRU over composed results. Compositions are pure in their request, so
 * revisiting one is free: switching styles back and forth in the filmstrip,
 * stepping back through shuffles with the browser's back button, and reopening
 * the export dialog all hit the cache instead of recomposing.
 *
 * Sized to hold the whole browse tray plus the canvas and the export previews.
 * Thumbnails are small; only the main-canvas entries carry real weight, and
 * there are only ever a handful of those in flight.
 */
// The browse tray alone holds twenty-odd cells; at 24 the cache thrashed and
// every seed change recomposed the whole tray from scratch.
const CACHE_LIMIT = 72
const cache = new Map<string, ComposeResult>()

export function renderComposition(req: CompositionRequest): ComposeResult {
  const key = compositionKey(req)
  const hit = cache.get(key)
  if (hit) {
    // refresh recency
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }

  const input: Parameters<typeof compose>[0] = {
    renderer: rendererOr(req.styleId),
    seed: req.seed,
    params: req.params,
    dims: { width: req.width, height: req.height },
    quality: req.quality ?? 1,
  }
  if (req.paletteId !== AUTO_PALETTE) input.paletteId = req.paletteId

  const result = compose(input)
  cache.set(key, result)
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return result
}

/**
 * Cap for the main canvas's internal render size.
 *
 * The preview composes at (near) export resolution and is scaled down by CSS
 * rather than composed at display size. Renderers work in design units, so a
 * display-sized render would put every stroke below one device pixel and the
 * preview would read far lighter than the file it produces.
 */
export const PREVIEW_MAX_SHORT = 1100

/**
 * Short-edge target for a preview that is going to be flattened to a bitmap.
 *
 * A vector preview is resolution independent — the browser draws it at whatever
 * the device has — so 1100 is only ever a sampling density there. A bitmap has
 * to carry its own resolution, and a phone at three device pixels per CSS pixel
 * will show every one of them, so the flattened path sizes itself against the
 * screen instead of a constant.
 *
 * Two things stop that becoming its own problem. The ratio is capped well below
 * a modern phone's, because past about two and a half the difference stops
 * being visible on a photograph-like image and only costs memory. And the
 * answer is quantised, because it feeds a cache key: an address bar sliding
 * away changes the viewport by a few pixels, and without the step every one of
 * those would recompose the whole deck.
 */
const RASTER_STEP = 160

/**
 * And a ceiling on the buffer, not just on the edge.
 *
 * A short edge alone says nothing about how much memory a composition costs: a
 * modern phone preset is well over two to one, so the short edge that looks
 * modest produces a buffer twice the size you would guess. Bounding the area is
 * what keeps a handful of live rasters inside a phone's budget whatever shape
 * of screen is being exported for.
 */
const RASTER_MAX_PIXELS = 1_900_000

/**
 * And a much tighter one where the picture is computed per pixel.
 *
 * The two backends want opposite things from resolution. A vector family draws
 * hairlines, so pixels are what stop it going soft, and they cost nothing to
 * add — the SVG is the same size whatever it is rasterised into. The post
 * pipeline is the other way round: it allocates a stack of full-frame buffers
 * and blurs them, so its cost is the pixel count, and its output — lit, soft,
 * gradient-heavy — is the kind of image that upscales without anyone noticing.
 *
 * Measured on the one family that runs through it, paint time goes 574ms at
 * nineteen hundred thousand pixels to 206ms at six hundred thousand, and stops
 * improving below about four hundred thousand — there is a fixed cost in the
 * blur passes that no amount of shrinking removes. This sits just above that
 * knee. It matters more than the ratio suggests, because that family is the
 * default style: three of these paint on every cold load.
 */
const PER_PIXEL_MAX_SHORT = 620

export function rasterShortEdge(aspect = 1, perPixel = false): number {
  if (typeof window === 'undefined') return PREVIEW_MAX_SHORT
  const css = Math.min(window.innerWidth, window.innerHeight)
  const want = css * Math.min(window.devicePixelRatio || 1, 2.5)
  const stepped = Math.max(900, Math.min(1600, Math.ceil(want / RASTER_STEP) * RASTER_STEP))

  // short * (short * ratio-of-long-to-short) is the area; solve it for short
  const longOverShort = aspect > 1 ? aspect : 1 / aspect
  const byArea = Math.sqrt(RASTER_MAX_PIXELS / (longOverShort > 0 ? longOverShort : 1))
  const cap = perPixel ? Math.min(PER_PIXEL_MAX_SHORT, stepped) : stepped
  return Math.max(480, Math.min(cap, Math.floor(byArea)))
}

/** The same, kept current across rotation and address-bar changes. */
export function useRasterShortEdge(aspect: number, perPixel: boolean): number {
  const [edge, setEdge] = useState(() => rasterShortEdge(aspect, perPixel))
  useEffect(() => {
    const onResize = () => setEdge(rasterShortEdge(aspect, perPixel))
    onResize()
    window.addEventListener('resize', onResize, { passive: true })
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [aspect, perPixel])
  return edge
}

/** Fit a target aspect ratio inside a measured box. */
export function fitAspect(
  box: { width: number; height: number },
  aspect: number,
  maxShort = 900,
): { width: number; height: number } {
  if (box.width <= 0 || box.height <= 0 || !Number.isFinite(aspect) || aspect <= 0) {
    return { width: 0, height: 0 }
  }
  let w = box.width
  let h = w / aspect
  if (h > box.height) {
    h = box.height
    w = h * aspect
  }
  const short = Math.min(w, h)
  if (short > maxShort) {
    const k = maxShort / short
    w *= k
    h *= k
  }
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) }
}

/** Debounced composition for the main canvas: ~60ms after the last input. */
export function useDebouncedComposition(
  req: CompositionRequest | null,
  delay = 60,
): ComposeResult | null {
  const key = req ? compositionKey(req) : ''
  const [result, setResult] = useState<ComposeResult | null>(null)

  useEffect(() => {
    if (!req || req.width < 2 || req.height < 2) return
    // A cached request needs no debounce: it is already paid for, and waiting
    // makes the back button and repeated style switches feel laggy for nothing.
    if (cache.has(key)) {
      setResult(renderComposition(req))
      return
    }
    const id = window.setTimeout(() => setResult(renderComposition(req)), delay)
    return () => window.clearTimeout(id)
    // key captures every field of req that affects the output
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delay])

  return result
}

/**
 * Trailing-edge debounce for a value. The filmstrip needs this: its thumbnails
 * memoise on the params object, so an undebounced slider drag re-renders six
 * compositions per frame and stalls the control it is reacting to.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(id)
  }, [value, delay])
  return settled
}

export type { StudioState }
