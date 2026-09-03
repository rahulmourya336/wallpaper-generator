import { useEffect, useMemo } from 'react'
import { resolveSize } from '../export/presets'
import { rendererOr } from '../engine/registry'
import { useStudio } from '../state/useStudio'
import { CompositionView } from './CompositionView'
import { PREVIEW_MAX_SHORT, fitAspect, useDebouncedComposition } from './useComposition'
import { useElementSize } from './useElementSize'

export function Canvas(): React.JSX.Element {
  const state = useStudio()
  const [boxRef, box] = useElementSize<HTMLDivElement>()
  const size = resolveSize(state.exportPreset)
  const renderer = rendererOr(state.styleId)
  const aspect = size.width / size.height

  /** what the compositor actually draws, so line weights match the export */
  const render = useMemo(
    () => fitAspect({ width: size.width, height: size.height }, aspect, PREVIEW_MAX_SHORT),
    [size.width, size.height, aspect],
  )

  const result = useDebouncedComposition(
    box.width > 1 && render.width > 1
      ? {
          styleId: state.styleId,
          seed: state.seed,
          paletteId: state.paletteId,
          params: state.params,
          width: render.width,
          height: render.height,
        }
      : null,
  )

  /**
   * The frame follows the composition that is actually on screen, not the
   * ratio that was just picked. Sizing it from the pending aspect stretches
   * the previous render for the length of the debounce every time the size
   * preset changes.
   */
  const shown = result ? result.width / result.height : aspect
  const display = useMemo(() => fitAspect(box, shown), [box, shown])

  /**
   * Publish the composition's own colours to the chrome. The studio around the
   * canvas was the same grey whatever was on it, which is a large part of why
   * the app read as bland: the artwork is the only thing with a voice, so the
   * interface should borrow it rather than ignore it.
   */
  useEffect(() => {
    if (!result) return
    const root = document.documentElement
    root.style.setProperty('--art-accent', result.palette.accent)
    root.style.setProperty('--art-ground', result.palette.ground)
    root.style.setProperty('--art-ramp', result.palette.ramp[3])
  }, [result])

  const label = `${renderer.name} wallpaper, seed ${state.seed}, ${size.width} by ${size.height} pixels`

  return (
    <div className="canvas-fit" ref={boxRef}>
      {result && display.width > 1 ? (
        <figure
          className="canvas-frame"
          style={{
            width: display.width,
            height: display.height,
            background: result.palette.ground,
          }}
        >
          <CompositionView result={result} label={label} />
        </figure>
      ) : (
        <div
          className="canvas-frame canvas-frame--empty"
          style={{ aspectRatio: `${aspect}` }}
          aria-hidden="true"
        />
      )}
    </div>
  )
}
