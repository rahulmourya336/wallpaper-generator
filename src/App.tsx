import { useState } from 'react'
import { BottomSheet } from './ui/BottomSheet'
import type { Snap } from './ui/BottomSheet'
import { Browser } from './ui/Browser'
import { Canvas } from './ui/Canvas'
import { ControlRail } from './ui/ControlRail'
import { ExportDialog } from './ui/ExportDialog'
import { StagePills } from './ui/StagePills'
import { MOBILE_QUERY, useMediaQuery } from './ui/useMediaQuery'
import { actions, useStudio } from './state/useStudio'
import { rendererOr } from './engine/registry'
import { getFamily } from './engine/registry'

const PEEK_HEIGHT = 176

function RailToggle({ open, onToggle }: { open: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className="rail-toggle"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="control-rail"
      aria-label={open ? 'Collapse the control rail' : 'Expand the control rail'}
      title={open ? 'Focus mode' : 'Show controls'}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d={open ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} />
      </svg>
    </button>
  )
}

export function App(): React.JSX.Element {
  const state = useStudio()
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const [exporting, setExporting] = useState(false)
  const [snap, setSnap] = useState<Snap>('peek')
  const [browsing, setBrowsing] = useState(true)

  const openExport = () => setExporting(true)
  const renderer = rendererOr(state.styleId)
  const family = getFamily(state.categoryId)

  return (
    <div
      className={`app${isMobile ? ' app--mobile' : ''}`}
      style={{ '--peek-h': `${PEEK_HEIGHT}px` } as React.CSSProperties}
    >
      {isMobile ? null : (
        <header className="topbar">
          <div className="topbar__brand">
            <span className="topbar__mark" aria-hidden="true" />
            <h1 className="topbar__title">Wallpaper Studio</h1>
          </div>
          <p className="topbar__now">
            <span className="topbar__crumb">{family?.name}</span>
            <span className="topbar__sep" aria-hidden="true" />
            <span className="topbar__crumb topbar__crumb--strong">{renderer.name}</span>
          </p>
          <button
            type="button"
            className="topbar__toggle"
            onClick={() => setBrowsing((v) => !v)}
            aria-pressed={browsing}
          >
            {browsing ? 'Hide gallery' : 'Browse styles'}
          </button>
        </header>
      )}

      {isMobile ? (
        <main className="studio studio--mobile">
          <h1 className="visually-hidden">Wallpaper Studio: generative wallpapers</h1>
          <section className="stage stage--bleed" aria-label="Wallpaper preview">
            <div className="stage__canvas">
              <Canvas />
              <StagePills onExport={openExport} />
            </div>
          </section>
          <BottomSheet
            snap={snap}
            onSnapChange={setSnap}
            peekHeight={PEEK_HEIGHT}
            label="Browse and tune"
          >
            <Browser />
            <ControlRail />
          </BottomSheet>
        </main>
      ) : (
        <main className={`studio${state.focusMode ? ' studio--focus' : ''}`}>
          <section className="stage" aria-label="Wallpaper preview">
            <div className="stage__canvas">
              <Canvas />
              <StagePills onExport={openExport} />
            </div>
            {browsing ? <Browser /> : null}
          </section>
          <RailToggle
            open={!state.focusMode}
            onToggle={() => actions.setFocusMode(!state.focusMode)}
          />
          <ControlRail id="control-rail" hidden={state.focusMode} />
        </main>
      )}

      <ExportDialog open={exporting} onClose={() => setExporting(false)} />
    </div>
  )
}
