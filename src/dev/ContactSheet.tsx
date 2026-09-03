import { useMemo, useState } from 'react'
import { FAMILIES } from '../engine/registry'
import { renderComposition } from '../ui/useComposition'
import { AUTO_PALETTE } from '../state/useStudio'

/**
 * Dev-only contact sheet at /?sheet — every registered style across a fixed
 * seed set. Output drawn from a distribution cannot be judged one sample at a
 * time: a single composition never tells you whether what you are seeing is
 * the design or the draw.
 */

const SEEDS = ['2109f7', 'zz01mm', 'k3f9qa', 'p0w2ne']

export function ContactSheet(): React.JSX.Element {
  const [seeds, setSeeds] = useState(SEEDS.join(','))
  const [w, setW] = useState(600)
  const [palette, setPalette] = useState(AUTO_PALETTE)
  const seedList = seeds.split(',').map((s) => s.trim()).filter(Boolean)
  const h = Math.round(w * (2556 / 1179))

  const rows = useMemo(
    () =>
      FAMILIES.map((fam) => ({
        fam,
        cells: fam.renderers.map((r) => ({
          renderer: r,
          items: seedList.map((seed) => {
            const t0 = performance.now()
            const res = renderComposition({
              styleId: r.id, seed, paletteId: palette, params: {}, width: w, height: h,
            })
            return { seed, res, ms: Math.round(performance.now() - t0) }
          }),
        })),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seeds, w, palette],
  )

  return (
    <div style={{ padding: 16, font: '12px ui-monospace, monospace', color: '#ddd' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, position: 'sticky', top: 0, background: '#0b0c0e', padding: '8px 0', zIndex: 5 }}>
        <label>seeds <input value={seeds} onChange={(e) => setSeeds(e.target.value)} size={40} /></label>
        <label>width <input type="number" value={w} step={100} onChange={(e) => setW(Number(e.target.value) || 600)} /></label>
        <label>palette <input value={palette} onChange={(e) => setPalette(e.target.value)} size={12} /></label>
      </div>
      {rows.map(({ fam, cells }) => (
        <section key={fam.id} style={{ marginBottom: 28 }}>
          <h2 style={{ font: '600 11px ui-sans-serif', letterSpacing: '0.16em', textTransform: 'uppercase', color: '#8d9199' }}>
            {fam.name}
          </h2>
          {cells.map(({ renderer, items }) => (
            <div key={renderer.id} style={{ marginBottom: 12 }}>
              <div style={{ color: '#8d9199', marginBottom: 4 }}>
                {renderer.id} · {renderer.dark ? 'dark' : 'light'} ·{' '}
                {items.map((i) => `${i.res.palette.id} ${i.ms}ms${i.res.truncated ? ' TRUNC' : ''}`).join(' | ')}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {items.map(({ seed, res }) => (
                  <div
                    key={seed}
                    style={{ position: 'relative', width: 150, aspectRatio: '1179 / 2556', overflow: 'hidden', background: res.palette.ground }}
                  >
                    {res.paint ? (
                      <canvas
                        width={res.width}
                        height={res.height}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                        ref={(node) => {
                          const c = node?.getContext('2d')
                          if (c) res.paint?.(c)
                        }}
                      />
                    ) : null}
                    <div
                      style={{ position: 'relative', width: '100%', height: '100%' }}
                      dangerouslySetInnerHTML={{
                        __html: res.svg.replace('<svg ', '<svg style="width:100%;height:100%;display:block" '),
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
