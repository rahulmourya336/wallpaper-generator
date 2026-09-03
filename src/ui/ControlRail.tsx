import { resolveParams } from '../engine/compositor'
import { PALETTES } from '../engine/palette'
import { FAMILIES, getFamily, rendererOr } from '../engine/registry'
import { groupedPresets, presetOr } from '../export/presets'
import { AUTO_PALETTE, actions, useStudio } from '../state/useStudio'
import type { ParamSpec } from '../engine/types'

function RangeControl({ spec, value }: { spec: Extract<ParamSpec, { type: 'range' }>; value: number }) {
  const id = `p-${spec.key}`
  return (
    <div className="control">
      <label className="control__head" htmlFor={id}>
        <span>{spec.label}</span>
        <output htmlFor={id}>{value.toFixed(2)}</output>
      </label>
      <input
        id={id}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => actions.setParam(spec.key, Number(e.currentTarget.value))}
      />
    </div>
  )
}

function SelectControl({ spec, value }: { spec: Extract<ParamSpec, { type: 'select' }>; value: string }) {
  const id = `p-${spec.key}`
  return (
    <div className="control">
      <label className="control__head" htmlFor={id}>
        <span>{spec.label}</span>
      </label>
      <select id={id} value={value} onChange={(e) => actions.setParam(spec.key, e.currentTarget.value)}>
        {spec.options.map((o) => (
          <option key={o} value={o}>
            {o.replace(/(^|-)(\w)/g, (_, sep: string, c: string) => (sep ? ' ' : '') + c.toUpperCase())}
          </option>
        ))}
      </select>
    </div>
  )
}

export function ControlRail(): React.JSX.Element {
  const state = useStudio()
  const renderer = rendererOr(state.styleId)
  const family = getFamily(state.categoryId) ?? FAMILIES[0]
  const resolved = resolveParams(renderer.schema, state.params)
  const availablePalettes = PALETTES.filter((p) => renderer.palettes.includes(p.id))

  return (
    <aside className="rail" aria-label="Composition controls">
      <div className="rail__section">
        <div className="control">
          <label className="control__head" htmlFor="category">
            <span>Category</span>
          </label>
          <select
            id="category"
            value={state.categoryId}
            onChange={(e) => {
              const next = getFamily(e.currentTarget.value)
              if (next?.renderers[0]) actions.setStyle(next.renderers[0].id)
            }}
          >
            {FAMILIES.map((fam) => (
              <option key={fam.id} value={fam.id}>{fam.name}</option>
            ))}
          </select>
        </div>

        <div className="control">
          <label className="control__head" htmlFor="style">
            <span>Style</span>
          </label>
          <select
            id="style"
            value={state.styleId}
            onChange={(e) => actions.setStyle(e.currentTarget.value)}
          >
            {(family?.renderers ?? []).map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>

        <div className="control">
          <label className="control__head" htmlFor="palette">
            <span>Palette</span>
          </label>
          <select
            id="palette"
            value={state.paletteId}
            onChange={(e) => actions.setPalette(e.currentTarget.value)}
          >
            <option value={AUTO_PALETTE}>Auto (from seed)</option>
            {availablePalettes.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="rail__section">
        <h2 className="rail__title">{renderer.name}</h2>
        {renderer.schema.map((spec) =>
          spec.type === 'range' ? (
            <RangeControl key={spec.key} spec={spec} value={Number(resolved[spec.key] ?? spec.default)} />
          ) : (
            <SelectControl key={spec.key} spec={spec} value={String(resolved[spec.key] ?? spec.default)} />
          ),
        )}
        <button type="button" className="btn btn--ghost" onClick={() => actions.resetParams()}>
          Reset parameters
        </button>
      </div>

      <div className="rail__section">
        <div className="control">
          <label className="control__head" htmlFor="preset">
            <span>Canvas ratio</span>
            <output htmlFor="preset">
              {presetOr(state.exportPreset).width}&times;{presetOr(state.exportPreset).height}
            </output>
          </label>
          <select
            id="preset"
            value={state.exportPreset}
            onChange={(e) => actions.setExportPreset(e.currentTarget.value)}
          >
            {groupedPresets().map(([group, items]) => (
              <optgroup key={group} label={group}>
                {items.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
    </aside>
  )
}
