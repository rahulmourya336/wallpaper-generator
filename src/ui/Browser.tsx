import { memo, useMemo } from 'react'
import { FAMILIES, getFamily, rendererOr } from '../engine/registry'
import { makeRng, seedFrom } from '../engine/rng'
import { resolveSize } from '../export/presets'
import { actions, useStudio } from '../state/useStudio'
import { CompositionView } from './CompositionView'
import { paramsKey, renderComposition, useDebouncedValue } from './useComposition'

/**
 * The browse surface.
 *
 * This used to be a single row of six sibling styles rendered at one seed and
 * one palette, which meant every suggestion looked like a variation of the
 * thing already on screen. Two rows fix that: the first is the ten categories,
 * each previewing its own colour pool and composition habits, and the second
 * is everything inside the chosen category plus a set of alternative seeds.
 *
 * Categories render at a fixed seed of their own rather than the current one,
 * so the row is a stable menu of what each family looks like rather than ten
 * more takes on the current picture.
 */

const CATEGORY_SEED = 'g7k2wq'
const VARIANTS = 6

type CellProps = {
  styleId: string
  seed: string
  paletteId: string
  params: Record<string, number | string>
  aspect: number
  quality: number
  label: string
  sub?: string
  active: boolean
  onPick: () => void
  size: 'cat' | 'style'
}

const Cell = memo(function Cell(props: CellProps) {
  const { aspect, label, sub, active, onPick, size } = props
  const width = size === 'cat' ? 240 : 340
  const height = Math.max(1, Math.round(width / aspect))
  const key = paramsKey(props.params)

  const result = useMemo(
    () =>
      renderComposition({
        styleId: props.styleId, seed: props.seed, paletteId: props.paletteId,
        params: props.params, width, height, quality: props.quality,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.styleId, props.seed, props.paletteId, key, width, height, props.quality],
  )

  return (
    <li className="browse__item">
      <button
        type="button"
        className={`browse__btn browse__btn--${size}${active ? ' is-active' : ''}`}
        onClick={onPick}
        aria-current={active ? 'true' : undefined}
        title={sub ? `${label}: ${sub}` : label}
      >
        <span
          className="browse__frame"
          style={{ aspectRatio: `${aspect}`, background: result.palette.ground }}
        >
          <CompositionView result={result} fit="slice" />
        </span>
        <span className="browse__label">{label}</span>
        {sub ? <span className="browse__sub">{sub}</span> : null}
      </button>
    </li>
  )
})

export function Browser(): React.JSX.Element {
  const state = useStudio()
  const size = resolveSize(state.exportPreset)
  const aspect = size.width / size.height
  const params = useDebouncedValue(state.params, 220)
  const family = getFamily(state.categoryId) ?? FAMILIES[0]

  // stable for a given seed, so the row does not reshuffle while you look at it
  const variants = useMemo(() => {
    const rng = makeRng(state.seed, 'variants')
    return Array.from({ length: VARIANTS }, () => seedFrom(rng))
  }, [state.seed])

  return (
    <div className="browse">
      <section className="browse__group" aria-label="Categories">
        <h2 className="browse__title">Categories</h2>
        <ul className="browse__row">
          {FAMILIES.map((fam) => {
            const first = fam.renderers[0]
            if (!first) return null
            return (
              <Cell
                key={fam.id}
                styleId={first.id}
                seed={CATEGORY_SEED}
                paletteId="auto"
                params={{}}
                aspect={aspect}
                quality={0.2}
                label={fam.name}
                active={fam.id === state.categoryId}
                onPick={() => actions.setStyle(first.id)}
                size="cat"
              />
            )
          })}
        </ul>
      </section>

      <section className="browse__group" aria-label={`Styles in ${family?.name ?? ''}`}>
        <h2 className="browse__title">
          {family?.name} styles
          <span className="browse__hint">same seed, restyled</span>
        </h2>
        <ul className="browse__row">
          {(family?.renderers ?? []).map((r) => (
            <Cell
              key={r.id}
              styleId={r.id}
              seed={state.seed}
              paletteId={state.paletteId}
              params={params}
              aspect={aspect}
              quality={0.25}
              label={r.name}
              active={r.id === state.styleId}
              onPick={() => actions.setStyle(r.id)}
              size="style"
            />
          ))}
        </ul>
      </section>

      <section className="browse__group" aria-label="Other compositions in this style">
        <h2 className="browse__title">
          More {rendererOr(state.styleId).name}
          <span className="browse__hint">same style, new composition</span>
        </h2>
        <ul className="browse__row">
          {variants.map((seed) => (
            <Cell
              key={seed}
              styleId={state.styleId}
              seed={seed}
              paletteId={state.paletteId}
              params={params}
              aspect={aspect}
              quality={0.25}
              label={seed}
              active={false}
              onPick={() => actions.setSeed(seed)}
              size="style"
            />
          ))}
        </ul>
      </section>
    </div>
  )
}
