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
