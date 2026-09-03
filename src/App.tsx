import { useState } from 'react'
import { BottomSheet } from './ui/BottomSheet'
import type { Snap } from './ui/BottomSheet'
import { ArtDirector } from './ui/ArtDirector'
import { ControlRail } from './ui/ControlRail'
import { ExportDialog } from './ui/ExportDialog'
import { Stage } from './ui/Stage'
import { StagePills } from './ui/StagePills'
import { MOBILE_QUERY, useMediaQuery } from './ui/useMediaQuery'
import { actions, useStudio } from './state/useStudio'
import { getFamily, rendererOr } from './engine/registry'

const PEEK_HEIGHT = 92

function RailToggle({ open, onToggle }: { open: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className="rail-toggle"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="control-rail"
      aria-label={open ? 'Collapse the controls' : 'Show the controls'}
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
  const [directing, setDirecting] = useState(false)
  const [snap, setSnap] = useState<Snap>('peek')

  const renderer = rendererOr(state.styleId)
  const family = getFamily(state.categoryId)

  return (
    <div
      className={`app${isMobile ? ' app--mobile' : ''}`}
      style={{ '--peek-h': `${PEEK_HEIGHT}px` } as React.CSSProperties}
    >
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__mark" aria-hidden="true" />
          <h1 className="topbar__title">Wallpaper Studio</h1>
        </div>
        <p className="topbar__now">
          <span>{family?.name}</span>
          <span className="topbar__sep" aria-hidden="true" />
          <span className="topbar__crumb--strong">{renderer.name}</span>
        </p>
        <button
          type="button"
          className="topbar__action"
          onClick={() => setDirecting(true)}
        >
          Art direction
        </button>
      </header>

      <main className={`studio${state.focusMode && !isMobile ? ' studio--focus' : ''}`}>
        <section className="stage" aria-label="Choose a wallpaper">
          <p className="stage__prompt">
            Pick the one you like
            <span>every design is one of a kind, shuffle for three more</span>
          </p>
          <Stage />
          <StagePills onExport={() => setExporting(true)} />
        </section>

        {isMobile ? (
          <BottomSheet
            snap={snap}
            onSnapChange={setSnap}
            peekHeight={PEEK_HEIGHT}
            label="Controls"
          >
            <ControlRail />
          </BottomSheet>
        ) : (
          <>
            <RailToggle
              open={!state.focusMode}
              onToggle={() => actions.setFocusMode(!state.focusMode)}
            />
            <ControlRail id="control-rail" hidden={state.focusMode} />
          </>
        )}
      </main>

      <ExportDialog open={exporting} onClose={() => setExporting(false)} />
      <ArtDirector open={directing} onClose={() => setDirecting(false)} />
    </div>
  )
}
