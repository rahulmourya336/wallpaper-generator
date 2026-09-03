import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { rendererOr } from '../engine/registry'
import {
  PREVIEW_RATIOS, groupForRatio, groupedPresets, makeCustomId, resolveSize, safeZones,
} from '../export/presets'
import { FORMATS, checkSize, downloadBlob, filenameFor, runExport } from '../export/rasterize'
import type { ExportFormat, ExportPhase } from '../export/rasterize'
import { AUTO_PALETTE, actions, useStudio } from '../state/useStudio'
import { CompositionView } from './CompositionView'
import { paramsKey, renderComposition, useDebouncedValue } from './useComposition'

/**
 * The three ratio previews are re-rendered, not cropped.
 *
 * Cropping would be a lie: the field functions are resolution and aspect
 * dependent, so exporting at a different ratio produces a different
 * composition, not the same one with its edges trimmed. Showing the actual
 * output at each ratio is what lets the user pick before committing.
 */

const PREVIEW_WIDTH = 420
const MIN_EDGE = 16
const MAX_EDGE = 16384

type PreviewProps = {
  styleId: string
  seed: string
  paletteId: string
  params: Record<string, number | string>
  width: number
  height: number
  label: string
  showSafeZones: boolean
  active: boolean
}

const RatioPreview = memo(function RatioPreview(props: PreviewProps) {
  const { width, height, label, showSafeZones, active } = props
  const key = paramsKey(props.params)
  const aspect = width / height
  const renderW = PREVIEW_WIDTH
  const renderH = Math.max(1, Math.round(renderW / aspect))

  const result = useMemo(
    () =>
      renderComposition({
        styleId: props.styleId, seed: props.seed, paletteId: props.paletteId,
        params: props.params, width: renderW, height: renderH, quality: 0.25,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.styleId, props.seed, props.paletteId, key, renderW, renderH],
  )

  return (
    <figure className={`crop${active ? ' is-active' : ''}`}>
      <div
        className="crop__frame"
        style={{ aspectRatio: `${aspect}`, background: result.palette.ground }}
      >
        <CompositionView result={result} />
        {showSafeZones ? (
          <div className="crop__zones" aria-hidden="true">
            {safeZones(groupForRatio(width, height)).map((z) => (
              <span
                key={z.label}
                className="crop__zone"
                style={{ top: `${z.from * 100}%`, height: `${(z.to - z.from) * 100}%` }}
              >
                <span className="crop__zone-label">{z.label}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <figcaption className="crop__cap">
        {label} <span>{width}&times;{height}</span>
      </figcaption>
    </figure>
  )
})

const PHASE_LABEL: Record<ExportPhase, string> = {
  idle: '',
  composing: 'Rendering at full size…',
  rasterizing: 'Rasterising…',
  encoding: 'Encoding…',
  done: 'Saved',
  error: 'Failed',
}

export function ExportDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const state = useStudio()
  const ref = useRef<HTMLDialogElement | null>(null)
  const doneTimer = useRef(0)
  const size = resolveSize(state.exportPreset)

  const [format, setFormat] = useState<ExportFormat>('png')
  const [scale, setScale] = useState(1)
  const [showSafeZones, setShowSafeZones] = useState(false)
  const [custom, setCustom] = useState({ width: size.width, height: size.height })
  const [phase, setPhase] = useState<ExportPhase>('idle')
  const [error, setError] = useState<string | null>(null)

  // previews follow the sliders rather than racing them, same as the filmstrip
  const previewParams = useDebouncedValue(state.params, 200)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) {
      node.showModal()
      // a dialog reopened after a failure should not still be showing it
      setPhase('idle')
      setError(null)
      setCustom({ width: size.width, height: size.height })
    }
    if (!open && node.open) node.close()
    // deliberately keyed on `open` only: re-syncing on every size change would
    // fight the user while they are typing a custom size
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => () => window.clearTimeout(doneTimer.current), [])

  /**
   * SVG ignores scale: it composes once at the nominal size and the viewBox
   * does the rest. Feeding the slider value through anyway made the dialog
   * quote 1x dimensions while the exporter composed at 4x.
   */
  const effectiveScale = format === 'svg' ? 1 : scale
  const check = checkSize(size.width, size.height, effectiveScale)
  const busy = phase === 'composing' || phase === 'rasterizing' || phase === 'encoding'

  // A typed value outside the range is kept in the field but not applied, so
  // the message has to say so; silently ignoring it looks like a dead input.
  const customValid = (v: number) => Number.isFinite(v) && v >= MIN_EDGE && v <= MAX_EDGE
  const customError =
    size.custom && !(customValid(custom.width) && customValid(custom.height))
      ? `Each edge must be between ${MIN_EDGE} and ${MAX_EDGE.toLocaleString()}px. Showing the last valid size.`
      : null

  const commitCustom = (width: number, height: number) => {
    setCustom({ width, height })
    if (customValid(width) && customValid(height)) {
      actions.setExportPreset(makeCustomId(width, height))
    }
  }

  const onExport = async () => {
    setError(null)
    try {
      const out = await runExport(
        {
          styleId: state.styleId,
          seed: state.seed,
          params: state.params,
          width: size.width,
          height: size.height,
          scale: effectiveScale,
          format,
          ...(state.paletteId !== AUTO_PALETTE ? { paletteId: state.paletteId } : {}),
        },
        setPhase,
      )
      downloadBlob(out.blob, out.filename)
      setPhase('done')
      window.clearTimeout(doneTimer.current)
      doneTimer.current = window.setTimeout(() => setPhase('idle'), 2500)
    } catch (e) {
      setPhase('error')
      setError(e instanceof Error ? e.message : 'Export failed.')
    }
  }

  return (
    <dialog
      className="export"
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="export-title"
    >
      {/* Contents exist only while the dialog is open. Left mounted, the three
          ratio previews recompose on every seed, style and parameter change
          behind a dialog nobody is looking at, putting three extra
          compositions on the path of every slider move. */}
      {!open ? null : (
      <>
      <div className="export__head">
        <h2 id="export-title">Export wallpaper</h2>
        <button
          type="button"
          className="export__close"
          onClick={onClose}
          aria-label="Close export dialog"
        >
          &times;
        </button>
      </div>

      <div className="export__body">
        <div className="export__crops" role="group" aria-label="Preview at each device ratio">
          {PREVIEW_RATIOS.map((r) => (
            <RatioPreview
              key={r.id}
              styleId={state.styleId}
              seed={state.seed}
              paletteId={state.paletteId}
              params={previewParams}
              width={r.width}
              height={r.height}
              label={r.label}
              showSafeZones={showSafeZones}
              active={groupForRatio(size.width, size.height) === r.label}
            />
          ))}
        </div>

        <label className="export__toggle">
          <input
            type="checkbox"
            checked={showSafeZones}
            onChange={(e) => setShowSafeZones(e.currentTarget.checked)}
          />
          <span>Show lock screen safe zones</span>
        </label>

        <div className="export__fields">
          <div className="control">
            <label className="control__head" htmlFor="export-size">
              <span>Size</span>
            </label>
            <select
              id="export-size"
              value={size.custom ? 'custom' : size.id}
              onChange={(e) => {
                const v = e.currentTarget.value
                if (v === 'custom') commitCustom(custom.width, custom.height)
                else actions.setExportPreset(v)
              }}
            >
              {groupedPresets().map(([group, items]) => (
                <optgroup key={group} label={group}>
                  {items.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} · {p.width}×{p.height}
                    </option>
                  ))}
                </optgroup>
              ))}
              <option value="custom">Custom…</option>
            </select>
          </div>

          {size.custom ? (
            <div className="export__custom-group">
              <div className="export__custom">
                <div className="control">
                  <label className="control__head" htmlFor="export-w">
                    <span>Width</span>
                  </label>
                  <input
                    id="export-w"
                    type="number"
                    min={MIN_EDGE}
                    max={MAX_EDGE}
                    value={custom.width}
                    onChange={(e) => commitCustom(Number(e.currentTarget.value) || 0, custom.height)}
                  />
                </div>
                <div className="control">
                  <label className="control__head" htmlFor="export-h">
                    <span>Height</span>
                  </label>
                  <input
                    id="export-h"
                    type="number"
                    min={MIN_EDGE}
                    max={MAX_EDGE}
                    value={custom.height}
                    onChange={(e) => commitCustom(custom.width, Number(e.currentTarget.value) || 0)}
                  />
                </div>
              </div>
              {customError ? <p className="export__dims is-bad">{customError}</p> : null}
            </div>
          ) : null}

          <div className="control">
            <span className="control__head">
              <span id="export-format-label">Format</span>
            </span>
            {/* real radios, so arrow keys and screen readers work without help */}
            <div className="chips" role="radiogroup" aria-labelledby="export-format-label">
              {FORMATS.map((fmt) => (
                <label key={fmt.id} className={`chip${format === fmt.id ? ' is-active' : ''}`}>
                  <input
                    className="visually-hidden"
                    type="radio"
                    name="export-format"
                    value={fmt.id}
                    checked={format === fmt.id}
                    onChange={() => setFormat(fmt.id)}
                  />
                  <span>{fmt.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="control">
            <label className="control__head" htmlFor="export-scale">
              <span>Scale</span>
              <output htmlFor="export-scale">{effectiveScale.toFixed(1)}×</output>
            </label>
            <input
              id="export-scale"
              type="range"
              min={1}
              max={4}
              step={0.5}
              value={scale}
              disabled={format === 'svg'}
              onChange={(e) => setScale(Number(e.currentTarget.value))}
            />
            <p className={`export__dims${check.ok ? '' : ' is-bad'}`}>
              {format === 'svg' ? (
                <>
                  Vector · {size.width}&times;{size.height} viewBox, scales to any size
                </>
              ) : (
                <>
                  {check.width}&times;{check.height} px · {(check.pixels / 1e6).toFixed(1)} MP
                  {check.ok ? '' : ` · ${check.reason}`}
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="export__foot">
        <p className="export__file">
          {filenameFor(
            { styleId: state.styleId, seed: state.seed, format },
            check.width,
            check.height,
          )}
        </p>
        <div className="export__actions">
          <span
            className={`export__phase${phase === 'error' ? ' is-bad' : ''}`}
            role="status"
            aria-live="polite"
          >
            {error ?? PHASE_LABEL[phase]}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void onExport()}
            disabled={busy || !check.ok}
          >
            {busy ? 'Working…' : `Download ${rendererOr(state.styleId).name}`}
          </button>
        </div>
      </div>
      </>
      )}
    </dialog>
  )
}
