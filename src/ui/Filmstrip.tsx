import { memo, useEffect, useMemo, useRef } from 'react'
import { filmstripStyles } from '../engine/registry'
import { resolveSize } from '../export/presets'
import { actions, useStudio } from '../state/useStudio'
import { renderComposition } from './useComposition'
import type { Renderer } from '../engine/types'

/**
 * The filmstrip renders live at the current seed. Static previews would defeat
 * the point: clicking a thumbnail keeps the seed and the parameters and swaps
 * only the style, so the strip is a preview of *this* composition restyled,
 * not a catalogue of what the style looks like in general.
 *
 * Thumbnails render at a quarter sample density and memoise on
 * (styleId, seed, palette, params) — without that the strip re-renders six
 * compositions on every slider frame and stalls the main canvas.
 */

const THUMB_SHORT = 380
const COUNT = 6

type ThumbProps = {
  renderer: Renderer
  seed: string
  paletteId: string
  params: Record<string, number | string>
  aspect: number
}

const Thumb = memo(function Thumb({ renderer, seed, paletteId, params, aspect }: ThumbProps) {
  const width = THUMB_SHORT
  const height = Math.round(width / aspect)
  const paramKey = JSON.stringify(params)

  const result = useMemo(
    () =>
      renderComposition({
        styleId: renderer.id, seed, paletteId, params, width, height, quality: 0.25,
      }),
    // paramKey stands in for params; the rest are primitives
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [renderer.id, seed, paletteId, paramKey, width, height],
  )

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
    <li className="strip__item">
      <button
        type="button"
        className="strip__btn"
        onClick={() => actions.setStyle(renderer.id)}
        title={`${renderer.name} — same composition, restyled`}
      >
        <span
          className="strip__frame"
          style={{ aspectRatio: `${aspect}`, background: result.palette.ground }}
        >
          {result.paint ? (
            <canvas
              ref={canvasRef}
              className="strip__raster"
              width={result.width}
              height={result.height}
              aria-hidden="true"
            />
          ) : null}
          <span
            className="strip__svg"
            aria-hidden="true"
            dangerouslySetInnerHTML={{
              __html: result.svg.replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" '),
            }}
          />
        </span>
        <span className="strip__label">{renderer.name}</span>
      </button>
    </li>
  )
})

export function Filmstrip(): React.JSX.Element {
  const state = useStudio()
  const preset = resolveSize(state.exportPreset)
  const aspect = preset.width / preset.height
  const styles = useMemo(() => filmstripStyles(state.styleId, COUNT), [state.styleId])

  return (
    <nav className="strip" aria-label="Restyle this composition">
      <ul className="strip__list">
        {styles.map((renderer) => (
          <Thumb
            key={renderer.id}
            renderer={renderer}
            seed={state.seed}
            paletteId={state.paletteId}
            params={state.params}
            aspect={aspect}
          />
        ))}
      </ul>
    </nav>
  )
}
