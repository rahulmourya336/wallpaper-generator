import { compose } from '../engine/compositor'
import type { ComposeResult } from '../engine/compositor'
import { rendererOr } from '../engine/registry'
import { MAX_EXPORT_EDGE, MAX_EXPORT_PIXELS } from './presets'

export type ExportFormat = 'png' | 'jpeg' | 'svg'

export const FORMATS: ReadonlyArray<{ id: ExportFormat; label: string; ext: string; mime: string }> = [
  { id: 'png', label: 'PNG', ext: 'png', mime: 'image/png' },
  { id: 'jpeg', label: 'JPEG', ext: 'jpg', mime: 'image/jpeg' },
  { id: 'svg', label: 'SVG', ext: 'svg', mime: 'image/svg+xml' },
]

export const JPEG_QUALITY = 0.92

export type ExportRequest = {
  styleId: string
  seed: string
  paletteId?: string
  params: Record<string, number | string>
  width: number
  height: number
  scale: number
  format: ExportFormat
}

export type ExportPhase = 'idle' | 'composing' | 'rasterizing' | 'encoding' | 'done' | 'error'

export type SizeCheck =
  | { ok: true; width: number; height: number; pixels: number }
  | { ok: false; reason: string; width: number; height: number; pixels: number }

/** Browsers refuse to allocate beyond a few hundred megapixels, silently. */
export function checkSize(width: number, height: number, scale: number): SizeCheck {
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  const pixels = w * h
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 16 || h < 16) {
    return { ok: false, reason: 'Dimensions must be at least 16px.', width: w, height: h, pixels }
  }
  if (w > MAX_EXPORT_EDGE || h > MAX_EXPORT_EDGE) {
    return {
      ok: false,
      reason: `Each edge must be ${MAX_EXPORT_EDGE.toLocaleString()}px or less.`,
      width: w, height: h, pixels,
    }
  }
  if (pixels > MAX_EXPORT_PIXELS) {
    return {
      ok: false,
      reason: `That is ${(pixels / 1e6).toFixed(0)} megapixels; the cap is ${MAX_EXPORT_PIXELS / 1e6}.`,
      width: w, height: h, pixels,
    }
  }
  return { ok: true, width: w, height: h, pixels }
}

export function filenameFor(req: Pick<ExportRequest, 'styleId' | 'seed' | 'format'>, w: number, h: number): string {
  const ext = FORMATS.find((f) => f.id === req.format)?.ext ?? 'png'
  return `wallpaper-${req.styleId}-${req.seed}-${w}x${h}.${ext}`
}

/**
 * Let the browser paint the progress state before the next blocking step.
 *
 * Raced against a timer rather than awaiting the frame outright: a backgrounded
 * tab gets no rendering opportunities, so an export started and then switched
 * away from would wait on a callback that never runs. There is nothing to paint
 * in that case anyway — the timer is the correct path, not a fallback.
 */
const yieldToPaint = () =>
  new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    requestAnimationFrame(() => setTimeout(finish, 0))
    setTimeout(finish, 80)
  })

function paintToCanvas(result: ComposeResult): HTMLCanvasElement | null {
  if (!result.paint) return null
  const canvas = document.createElement('canvas')
  canvas.width = result.width
  canvas.height = result.height
  const c = canvas.getContext('2d')
  if (!c) return null
  result.paint(c)
  return canvas
}

/**
 * Canvas families paint outside the SVG, so an SVG download would arrive
 * missing its ground. Embedding the painted buffer as an <image> keeps the
 * vector download complete for every style; everything above it stays vector.
 */
function inlineCanvasLayer(result: ComposeResult): string {
  const canvas = paintToCanvas(result)
  if (!canvas) return result.svg
  const href = canvas.toDataURL('image/png')
  const image =
    `<image x="0" y="0" width="${result.width}" height="${result.height}" ` +
    `preserveAspectRatio="none" href="${href}"/>`
  return result.svg.replace(/(<g style="isolation:isolate">)/, `${image}$1`)
}

export async function runExport(
  req: ExportRequest,
  onPhase?: (phase: ExportPhase) => void,
): Promise<{ blob: Blob; filename: string; width: number; height: number }> {
  const size = checkSize(req.width, req.height, req.scale)
  if (!size.ok) throw new Error(size.reason)

  onPhase?.('composing')
  await yieldToPaint()

  // Re-render at the export dimensions. Upscaling the preview would keep the
  // preview's element density, and the field functions are resolution
  // dependent — the result would be a sparser composition blown up.
  const result = compose({
    renderer: rendererOr(req.styleId),
    seed: req.seed,
    params: req.params,
    dims: { width: size.width, height: size.height },
    quality: Math.max(1, req.scale),
    budgetMs: 20_000,
    ...(req.paletteId ? { paletteId: req.paletteId } : {}),
  })

  const filename = filenameFor(req, size.width, size.height)

  if (req.format === 'svg') {
    onPhase?.('encoding')
    await yieldToPaint()
    const svg = inlineCanvasLayer(result)
    return {
      blob: new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      filename, width: size.width, height: size.height,
    }
  }

  onPhase?.('rasterizing')
  await yieldToPaint()

  const svgBlob = new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()

    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const c = canvas.getContext('2d', { alpha: req.format === 'png' })
    if (!c) throw new Error('Could not allocate a canvas that size.')

    // JPEG has no alpha; without a ground the transparent areas come out black
    if (req.format === 'jpeg') {
      c.fillStyle = result.palette.ground
      c.fillRect(0, 0, size.width, size.height)
    }
    const painted = paintToCanvas(result)
    if (painted) c.drawImage(painted, 0, 0, size.width, size.height)
    c.drawImage(img, 0, 0, size.width, size.height)

    onPhase?.('encoding')
    await yieldToPaint()

    const mime = req.format === 'jpeg' ? 'image/jpeg' : 'image/png'
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, mime, req.format === 'jpeg' ? JPEG_QUALITY : undefined)
    })
    if (!blob) throw new Error('The browser could not encode an image that size.')
    return { blob, filename, width: size.width, height: size.height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // revoke on the next turn; revoking synchronously races the download in Safari
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
