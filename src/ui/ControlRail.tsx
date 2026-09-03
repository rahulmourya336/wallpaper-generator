import { resolveParams } from '../engine/compositor'
import { PALETTES } from '../engine/palette'
import { characterOf } from '../engine/character'
import { FAMILIES, getFamily, rendererOr } from '../engine/registry'
import { PRESETS, resolveSize } from '../export/presets'
import { AUTO_PALETTE, actions, useStudio } from '../state/useStudio'
import { AutoSwatch, DeviceIcon, FamilyIcon, PaletteSwatch } from './icons'
import { Select } from './Select'
import type { Option } from './Select'
import type { ParamSpec } from '../engine/types'

function RangeControl({ spec, value }: { spec: Extract<ParamSpec, { type: 'range' }>; value: number }) {
  const id = `p-${spec.key}`
  return (
    <div className="field">
      <label className="field__head" htmlFor={id}>
        <span className="field__label">{spec.label}</span>
        <output className="field__meta" htmlFor={id}>{value.toFixed(2)}</output>
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

const title = (s: string) =>
  s.replace(/(^|-)(\w)/g, (_, sep: string, c: string) => (sep ? ' ' : '') + c.toUpperCase())

export function ControlRail({ id, hidden }: { id?: string; hidden?: boolean } = {}): React.JSX.Element {
  const state = useStudio()
  const renderer = rendererOr(state.styleId)
  const family = getFamily(state.categoryId) ?? FAMILIES[0]
  const resolved = resolveParams(renderer.schema, state.params)
  const pool = characterOf(renderer.family).palettes
  const availablePalettes = PALETTES.filter((p) => pool.includes(p.id))
  const size = resolveSize(state.exportPreset)

  /**
   * A palette the previous style allowed but this one does not stays in state,
   * so switching back restores it. The compositor already falls back to its
   * seeded pick meanwhile, so the control shows Auto rather than an option that
   * is not in the list, which would leave it looking blank.
   */
  const shownPalette = availablePalettes.some((p) => p.id === state.paletteId)
    ? state.paletteId
    : AUTO_PALETTE

  const categoryOptions: Option[] = FAMILIES.map((fam) => ({
    value: fam.id,
    label: fam.name,
    icon: <FamilyIcon family={fam.id} />,
    hint: `${fam.renderers.length}`,
  }))

  const styleOptions: Option[] = (family?.renderers ?? []).map((r) => ({
    value: r.id,
    label: r.name,
    icon: <FamilyIcon family={r.family} />,
  }))

  const paletteOptions: Option[] = [
    { value: AUTO_PALETTE, label: 'Auto', icon: <AutoSwatch />, hint: 'from seed' },
    ...availablePalettes.map((p) => ({
      value: p.id,
      label: p.name,
      icon: <PaletteSwatch palette={p} />,
    })),
  ]

  const sizeOptions: Option[] = PRESETS.map((p) => ({
    value: p.id,
    label: p.label,
    group: p.group,
    icon: <DeviceIcon group={p.group} />,
    hint: `${p.width}×${p.height}`,
  }))
  if (size.custom) {
    sizeOptions.push({
      value: size.id,
      label: size.label,
      group: 'Custom',
      icon: <DeviceIcon group="Desktop" />,
    })
  }

  return (
    <aside id={id} className="rail" aria-label="Composition controls" hidden={hidden}>
      <div className="rail__section">
        <Select
          id="category"
          label="Category"
          value={state.categoryId}
          options={categoryOptions}
          onChange={(v) => {
            const next = getFamily(v)
            if (next?.renderers[0]) actions.setStyle(next.renderers[0].id)
          }}
        />
        <Select
          id="style"
          label="Style"
          value={state.styleId}
          options={styleOptions}
          onChange={(v) => actions.setStyle(v)}
        />
        <Select
          id="palette"
          label="Colour"
          value={shownPalette}
          options={paletteOptions}
          onChange={(v) => actions.setPalette(v)}
        />
      </div>

      <div className="rail__section">
        <h2 className="rail__title">Tune</h2>
        {renderer.schema.map((spec) =>
          spec.type === 'range' ? (
            <RangeControl key={spec.key} spec={spec} value={Number(resolved[spec.key] ?? spec.default)} />
          ) : (
            <Select
              key={spec.key}
              id={`p-${spec.key}`}
              label={spec.label}
              value={String(resolved[spec.key] ?? spec.default)}
              options={spec.options.map((o) => ({ value: o, label: title(o) }))}
              onChange={(v) => actions.setParam(spec.key, v)}
            />
          ),
        )}
        <button type="button" className="btn btn--ghost" onClick={() => actions.resetParams()}>
          Reset
        </button>
      </div>

      <div className="rail__section">
        <Select
          id="preset"
          label="Screen"
          value={size.id}
          options={sizeOptions}
          onChange={(v) => actions.setExportPreset(v)}
          meta={`${size.width}×${size.height}`}
        />
      </div>
    </aside>
  )
}
