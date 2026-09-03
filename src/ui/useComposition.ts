import { useEffect, useMemo, useState } from 'react'
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

export function renderComposition(req: CompositionRequest): ComposeResult {
  const input: Parameters<typeof compose>[0] = {
    renderer: rendererOr(req.styleId),
    seed: req.seed,
    params: req.params,
    dims: { width: req.width, height: req.height },
    quality: req.quality ?? 1,
  }
  if (req.paletteId !== AUTO_PALETTE) input.paletteId = req.paletteId
  return compose(input)
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
  if (box.width <= 0 || box.height <= 0) return { width: 0, height: 0 }
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
  const key = req
    ? JSON.stringify([req.styleId, req.seed, req.paletteId, req.params, req.width, req.height, req.quality])
    : ''
  const [result, setResult] = useState<ComposeResult | null>(null)

  useEffect(() => {
    if (!req || req.width < 2 || req.height < 2) return
    const id = window.setTimeout(() => setResult(renderComposition(req)), delay)
    return () => window.clearTimeout(id)
    // key captures every field of req that affects the output
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delay])

  return result
}

/** Memoised low-density render for filmstrip thumbnails. */
export function useThumbnail(req: CompositionRequest): ComposeResult {
  const key = JSON.stringify([req.styleId, req.seed, req.paletteId, req.params, req.width, req.height])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => renderComposition({ ...req, quality: 0.25 }), [key])
}

export type { StudioState }
