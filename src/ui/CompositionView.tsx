import { useEffect, useRef } from 'react'
import type { ComposeResult } from '../engine/compositor'

/**
 * Paints one composition into whatever positioned box the parent provides.
 *
 * A family on the scene graph paints the whole image into the canvas and its
 * SVG is only a fallback for the vector download, so the overlay is suppressed
 * for those; the older canvas families paint a layer the SVG sits on top of, so
 * every place that shows a composition needs the same three things: a canvas,
 * an effect that repaints it when the result changes, and the SVG overlay.
 * Keeping that in one component is what stops the main canvas, the filmstrip
 * and the export previews from drifting apart.
 */

/**
 * Rasterised copies, keyed by the result object itself.
 *
 * The compositor already caches results, so the same composition comes back as
 * the same object and there is no key to plumb through. What there does have to
 * be is a hard limit, and a much smaller one than the compositor's.
 *
 * A raster is a real allocation — a phone-shaped composition at device pixels is
 * eight megabytes of buffer — where a compose result is a string. Hanging these
 * off the compositor's cache, whether by a WeakMap or by matching its size,
 * would mean seventy-two of them alive at once and most of a gigabyte held by a
 * page whose job is to show three pictures. Only what is on screen and its
 * immediate neighbours is ever wanted back, so the shelf is small and evicting
 * releases the buffer rather than waiting for a collector to notice.
 */
const RASTER_LIMIT = 5
const rasters = new Map<ComposeResult, HTMLCanvasElement>()
const pending = new Map<ComposeResult, Promise<HTMLCanvasElement | null>>()

function keep(result: ComposeResult, canvas: HTMLCanvasElement): void {
  rasters.set(result, canvas)
  while (rasters.size > RASTER_LIMIT) {
    const oldest = rasters.keys().next().value
    if (oldest === undefined) break
    const dropped = rasters.get(oldest)
    rasters.delete(oldest)
    // zero the dimensions: it is the backing store, not the element, that costs
    if (dropped) {
      dropped.width = 0
      dropped.height = 0
    }
  }
}

function touch(result: ComposeResult): HTMLCanvasElement | undefined {
  const hit = rasters.get(result)
  if (!hit) return undefined
  rasters.delete(result)
  rasters.set(result, hit)
  return hit
}

/**
 * Flatten a composition into a single bitmap.
 *
 * The vector layer of a busy style is close to four thousand SVG nodes and
 * around half a megabyte of markup. Three of those live at once is a DOM the
 * browser has to lay out, style and composite on every frame of every gesture,
 * which is what a phone cannot afford: the drag it stalls is the one the user
 * is making. As a bitmap the same picture is one element the compositor moves
 * around for free.
 *
 * The cost is paid once, off the interaction path, and the picture is identical
 * — the browser rasterises the same SVG either way, this just does it eagerly
 * into a buffer instead of lazily into the page.
 */
async function rasterize(result: ComposeResult): Promise<HTMLCanvasElement | null> {
  const cached = touch(result)
  if (cached) return cached
  // Effects run twice in development, and a swipe can ask for a frame that is
  // already being flattened. Either way the work is done once.
  const inFlight = pending.get(result)
  if (inFlight) return inFlight

  const run = build(result)
  pending.set(result, run)
  try {
    return await run
  } finally {
    pending.delete(result)
  }
}

async function build(result: ComposeResult): Promise<HTMLCanvasElement | null> {
  const canvas = document.createElement('canvas')
  canvas.width = result.width
  canvas.height = result.height
  const c = canvas.getContext('2d')
  if (!c) return null

  // the painted layer sits under the vector one, the same order the DOM uses
  if (result.paint) result.paint(c)

  if (!result.raster) {
    const blob = new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    try {
      const img = new Image()
      img.decoding = 'async'
      img.src = url
      await img.decode()
      c.drawImage(img, 0, 0, result.width, result.height)
    } catch {
      // a decode failure leaves whatever the painted layer put down, which for
      // a graph family is the whole picture and for the rest is its ground
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  keep(result, canvas)
  return canvas
}

export function CompositionView({
  result,
  label,
  fit = 'meet',
  raster = false,
}: {
  result: ComposeResult
  /** accessible name; without one the view is treated as decorative */
  label?: string
  /** 'meet' fits the whole composition, 'slice' fills the box and crops */
  fit?: 'meet' | 'slice'
  /**
   * Flatten to a single bitmap instead of mounting the vector layer. Costs one
   * decode and saves the page several thousand live nodes, which is the right
   * trade wherever compositions are shown at once or moved by a gesture.
   */
  raster?: boolean
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const flatten = raster || result.raster

  useEffect(() => {
    const node = canvasRef.current
    if (!node) return
    const c = node.getContext('2d')
    if (!c) return

    if (!raster) {
      if (!result.paint) return
      c.clearRect(0, 0, result.width, result.height)
      result.paint(c)
      return
    }

    /**
     * The previous frame stays up until the new one is ready.
     *
     * Clearing first would flash the ground colour between two compositions on
     * every swipe and every slider tick, which reads as the app losing the
     * picture rather than replacing it. A cached raster blits synchronously, so
     * that only ever applies to a composition being flattened for the first
     * time.
     */
    let alive = true
    const blit = (from: HTMLCanvasElement) => {
      // an eviction between the request and its answer zeroes the buffer, and
      // drawing from a zero-sized source is an error rather than a no-op
      if (from.width < 1 || from.height < 1) return
      c.clearRect(0, 0, result.width, result.height)
      c.drawImage(from, 0, 0)
    }
    const cached = touch(result)
    if (cached) {
      blit(cached)
      return
    }
    void rasterize(result).then((cv) => {
      if (alive && cv) blit(cv)
    })
    return () => {
      alive = false
    }
  }, [result, raster])

  return (
    <>
      {flatten || result.paint ? (
        <canvas
          ref={canvasRef}
          className="composition__raster"
          width={result.width}
          height={result.height}
          {...(raster && label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
        />
      ) : null}
      {flatten ? null : (
      <svg
        className="composition__svg"
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${result.width} ${result.height}`}
        preserveAspectRatio={`xMidYMid ${fit}`}
        {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
        dangerouslySetInnerHTML={{ __html: result.inner }}
      />
      )}
    </>
  )
}
