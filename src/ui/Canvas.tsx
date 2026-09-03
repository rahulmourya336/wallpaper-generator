import { useEffect, useMemo, useRef } from 'react'
import { presetOr } from '../export/presets'
import { rendererOr } from '../engine/registry'
import { useStudio } from '../state/useStudio'
import { PREVIEW_MAX_SHORT, fitAspect, useDebouncedComposition } from './useComposition'
import { useElementSize } from './useElementSize'

export function Canvas(): React.JSX.Element {
  const state = useStudio()
  const [boxRef, box] = useElementSize<HTMLDivElement>()
  const preset = presetOr(state.exportPreset)
  const renderer = rendererOr(state.styleId)
  const aspect = preset.width / preset.height

  /** what the browser lays out */
  const display = useMemo(() => fitAspect(box, aspect), [box, aspect])
  /** what the compositor actually draws, so line weights match the export */
  const render = useMemo(
    () => fitAspect({ width: preset.width, height: preset.height }, aspect, PREVIEW_MAX_SHORT),
    [preset.width, preset.height, aspect],
  )

  const result = useDebouncedComposition(
    display.width > 1
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

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const node = canvasRef.current
    if (!node || !result?.paint) return
    node.width = result.width
    node.height = result.height
    const c = node.getContext('2d')
    if (!c) return
    c.clearRect(0, 0, result.width, result.height)
    result.paint(c)
  }, [result])

  const label = `${renderer.name} wallpaper, seed ${state.seed}, ${preset.width} by ${preset.height} pixels`
  const boxStyle = { width: display.width, height: display.height }

  return (
    <div className="canvas-fit" ref={boxRef}>
      {result && display.width > 1 ? (
        <figure
          className="canvas-frame"
          style={{ ...boxStyle, background: result.palette.ground }}
        >
          {result.paint ? (
            <canvas
              ref={canvasRef}
              className="canvas-raster"
              style={boxStyle}
              aria-hidden="true"
            />
          ) : null}
          <svg
            className="canvas-svg"
            role="img"
            aria-label={label}
            style={boxStyle}
            viewBox={`0 0 ${result.width} ${result.height}`}
            xmlns="http://www.w3.org/2000/svg"
            dangerouslySetInnerHTML={{ __html: result.inner }}
          />
          <figcaption className="visually-hidden">{label}</figcaption>
        </figure>
      ) : (
        <div className="canvas-frame canvas-frame--empty" aria-hidden="true" />
      )}
    </div>
  )
}
