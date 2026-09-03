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
export function CompositionView({
  result,
  label,
  fit = 'meet',
}: {
  result: ComposeResult
  /** accessible name; without one the view is treated as decorative */
  label?: string
  /** 'meet' fits the whole composition, 'slice' fills the box and crops */
  fit?: 'meet' | 'slice'
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const node = canvasRef.current
    if (!node || !result.paint) return
    const c = node.getContext('2d')
    if (!c) return
    c.clearRect(0, 0, result.width, result.height)
    result.paint(c)
  }, [result])

  return (
    <>
      {result.paint ? (
        <canvas
          ref={canvasRef}
          className="composition__raster"
          width={result.width}
          height={result.height}
          aria-hidden="true"
        />
      ) : null}
      {result.raster ? null : (
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
