import { memo, useMemo } from 'react'
import { filmstripStyles } from '../engine/registry'
import { resolveSize } from '../export/presets'
import { actions, useStudio } from '../state/useStudio'
import { CompositionView } from './CompositionView'
import { paramsKey, renderComposition, useDebouncedValue } from './useComposition'
import type { Renderer } from '../engine/types'

/**
 * The filmstrip renders live at the current seed. Static previews would defeat
 * the point: clicking a thumbnail keeps the seed and the parameters and swaps
 * only the style, so the strip is a preview of *this* composition restyled,
 * not a catalogue of what the style looks like in general.
 *
 * Thumbnails render at a quarter sample density and memoise on
 * (styleId, seed, palette, params). Without that the strip recomposes six
 * wallpapers on every slider frame and stalls the main canvas.
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
  const height = Math.max(1, Math.round(width / aspect))
  const key = paramsKey(params)

  const result = useMemo(
    () =>
      renderComposition({
        styleId: renderer.id, seed, paletteId, params, width, height, quality: 0.25,
      }),
    // key stands in for params; everything else here is a primitive
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [renderer.id, seed, paletteId, key, width, height],
  )

  return (
    <li className="strip__item">
      <button
        type="button"
        className="strip__btn"
        onClick={() => actions.setStyle(renderer.id)}
        aria-label={`Restyle as ${renderer.name}`}
        title={`${renderer.name}: same composition, restyled`}
      >
        <span
          className="strip__frame"
          style={{ aspectRatio: `${aspect}`, background: result.palette.ground }}
        >
          <CompositionView result={result} fit="slice" />
        </span>
        <span className="strip__label">{renderer.name}</span>
      </button>
    </li>
  )
})

export function Filmstrip(): React.JSX.Element {
  const state = useStudio()
  const size = resolveSize(state.exportPreset)
  const aspect = size.width / size.height
  const styles = useMemo(() => filmstripStyles(state.styleId, COUNT), [state.styleId])
  // trails the main canvas: six thumbnails per slider frame would stall it
  const params = useDebouncedValue(state.params, 200)

  return (
    <nav className="strip" aria-label="Restyle this composition">
      <ul className="strip__list">
        {styles.map((renderer) => (
          <Thumb
            key={renderer.id}
            renderer={renderer}
            seed={state.seed}
            paletteId={state.paletteId}
            params={params}
            aspect={aspect}
          />
        ))}
      </ul>
    </nav>
  )
}
