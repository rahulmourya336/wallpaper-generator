import { resolveParams } from '../engine/compositor'
import { PALETTES } from '../engine/palette'
import { FAMILIES, getFamily, rendererOr } from '../engine/registry'
import { groupedPresets, resolveSize } from '../export/presets'
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

export function ControlRail({ id, hidden }: { id?: string; hidden?: boolean } = {}): React.JSX.Element {
  const state = useStudio()
  const renderer = rendererOr(state.styleId)
  const family = getFamily(state.categoryId) ?? FAMILIES[0]
  const resolved = resolveParams(renderer.schema, state.params)
  const availablePalettes = PALETTES.filter((p) => renderer.palettes.includes(p.id))
  const size = resolveSize(state.exportPreset)

  /**
   * A palette the previous style allowed but this one does not stays in state,
   * so switching back restores it. The compositor already falls back to its
   * seeded pick in the meantime, so the select has to show Auto rather than an
   * option that is not in the list and leave the control looking blank.
   */
  const shownPalette = availablePalettes.some((p) => p.id === state.paletteId)
    ? state.paletteId
    : AUTO_PALETTE

  return (
    <aside id={id} className="rail" aria-label="Composition controls" hidden={hidden}>
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
            value={shownPalette}
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
              {size.width}&times;{size.height}
            </output>
          </label>
          <select
            id="preset"
            value={size.id}
            onChange={(e) => actions.setExportPreset(e.currentTarget.value)}
          >
            {groupedPresets().map(([group, items]) => (
              <optgroup key={group} label={group}>
                {items.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </optgroup>
            ))}
            {/* a custom size set in the export dialog has no preset to match,
                and without this the select renders with nothing selected */}
            {size.custom ? <option value={size.id}>{size.label}</option> : null}
          </select>
        </div>
      </div>
    </aside>
  )
}
