import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { rendererOr } from '../engine/registry'
import {
  PREVIEW_RATIOS, groupForRatio, groupedPresets, makeCustomId, resolveSize, safeZones,
} from '../export/presets'
import { FORMATS, checkSize, downloadBlob, filenameFor, runExport } from '../export/rasterize'
import type { ExportFormat, ExportPhase } from '../export/rasterize'
import { AUTO_PALETTE, actions, useStudio } from '../state/useStudio'
import { renderComposition } from './useComposition'

/**
 * The three ratio previews are re-rendered, not cropped.
 *
 * Cropping would be a lie: the field functions are resolution and aspect
 * dependent, so exporting at a different ratio produces a different
 * composition, not the same one with its edges trimmed. Showing the actual
 * output at each ratio is what lets the user pick before committing.
 */

const PREVIEW_WIDTH = 420

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
  const paramKey = JSON.stringify(props.params)
  const aspect = width / height
  const renderW = PREVIEW_WIDTH
  const renderH = Math.round(renderW / aspect)

  const result = useMemo(
    () =>
      renderComposition({
        styleId: props.styleId, seed: props.seed, paletteId: props.paletteId,
        params: props.params, width: renderW, height: renderH, quality: 0.25,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.styleId, props.seed, props.paletteId, paramKey, renderW, renderH],
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
    <figure className={`crop${active ? ' is-active' : ''}`}>
      <div className="crop__frame" style={{ aspectRatio: `${aspect}`, background: result.palette.ground }}>
        {result.paint ? (
          <canvas
            ref={canvasRef}
            className="crop__raster"
            width={result.width}
            height={result.height}
            aria-hidden="true"
          />
        ) : null}
        <div
          className="crop__svg"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: result.svg }}
        />
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

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const state = useStudio()
  const ref = useRef<HTMLDialogElement | null>(null)
  const size = resolveSize(state.exportPreset)

  const [format, setFormat] = useState<ExportFormat>('png')
  const [scale, setScale] = useState(1)
  const [showSafeZones, setShowSafeZones] = useState(false)
  const [custom, setCustom] = useState({ width: size.width, height: size.height })
  const [phase, setPhase] = useState<ExportPhase>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) node.showModal()
    if (!open && node.open) node.close()
  }, [open])

  const check = checkSize(size.width, size.height, scale)
  const busy = phase === 'composing' || phase === 'rasterizing' || phase === 'encoding'

  // A typed value outside the range is kept in the field but not applied, so
  // the message has to say so — silently ignoring it looks like a dead input.
  const customValid = (v: number) => Number.isFinite(v) && v >= 16 && v <= 16384
  const customError =
    size.custom && !(customValid(custom.width) && customValid(custom.height))
      ? 'Each edge must be between 16 and 16,384px. Showing the last valid size.'
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
      const req = {
        styleId: state.styleId,
        seed: state.seed,
        params: state.params,
        width: size.width,
        height: size.height,
        scale,
        format,
        ...(state.paletteId !== AUTO_PALETTE ? { paletteId: state.paletteId } : {}),
      }
      const out = await runExport(req, setPhase)
      downloadBlob(out.blob, out.filename)
      setPhase('done')
      window.setTimeout(() => setPhase('idle'), 2500)
    } catch (e) {
      setPhase('error')
      setError(e instanceof Error ? e.message : 'Export failed.')
    }
  }

  const phaseLabel: Record<ExportPhase, string> = {
    idle: '',
    composing: 'Rendering at full size…',
    rasterizing: 'Rasterising…',
    encoding: 'Encoding…',
    done: 'Saved',
    error: 'Failed',
  }

  return (
    <dialog
      className="export"
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="export-title"
    >
      <div className="export__head">
        <h2 id="export-title">Export wallpaper</h2>
        <button type="button" className="export__close" onClick={onClose} aria-label="Close export dialog">
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
              params={state.params}
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
            <label className="control__head" htmlFor="export-size"><span>Size</span></label>
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
                      {p.label} — {p.width}×{p.height}
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
                <label className="control__head" htmlFor="export-w"><span>Width</span></label>
                <input
                  id="export-w" type="number" min={16} max={16384} value={custom.width}
                  onChange={(e) => commitCustom(Number(e.currentTarget.value) || 0, custom.height)}
                />
              </div>
              <div className="control">
                <label className="control__head" htmlFor="export-h"><span>Height</span></label>
                <input
                  id="export-h" type="number" min={16} max={16384} value={custom.height}
                  onChange={(e) => commitCustom(custom.width, Number(e.currentTarget.value) || 0)}
                />
              </div>
            </div>
            {customError ? <p className="export__dims is-bad">{customError}</p> : null}
            </div>
          ) : null}

          <div className="control">
            <span className="control__head"><span>Format</span></span>
            <div className="chips" role="radiogroup" aria-label="File format">
              {FORMATS.map((fmt) => (
                <button
                  key={fmt.id}
                  type="button"
                  role="radio"
                  aria-checked={format === fmt.id}
                  className={`chip${format === fmt.id ? ' is-active' : ''}`}
                  onClick={() => setFormat(fmt.id)}
                >
                  {fmt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="control">
            <label className="control__head" htmlFor="export-scale">
              <span>Scale</span>
              <output htmlFor="export-scale">{scale.toFixed(1)}×</output>
            </label>
            <input
              id="export-scale" type="range" min={1} max={4} step={0.5} value={scale}
              disabled={format === 'svg'}
              onChange={(e) => setScale(Number(e.currentTarget.value))}
            />
            <p className={`export__dims${check.ok ? '' : ' is-bad'}`}>
              {format === 'svg' ? (
                <>Vector — {size.width}&times;{size.height} viewBox, scales to any size</>
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
          {filenameFor({ styleId: state.styleId, seed: state.seed, format }, check.width, check.height)}
        </p>
        <div className="export__actions">
          <span className={`export__phase${phase === 'error' ? ' is-bad' : ''}`} role="status">
            {error ?? phaseLabel[phase]}
          </span>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void onExport()}
            disabled={busy || (!check.ok && format !== 'svg')}
          >
            {busy ? 'Working…' : `Download ${rendererOr(state.styleId).name}`}
          </button>
        </div>
      </div>
    </dialog>
  )
}
