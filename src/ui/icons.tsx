import type { FamilyId } from '../engine/types'
import type { Palette } from '../engine/palette'

/**
 * One glyph per category, drawn from the same vocabulary the family renders
 * with, so the dropdown shows what the category does instead of naming it.
 */
const FAMILY_PATHS: Record<FamilyId, React.ReactNode> = {
  geometric: <><path d="M3 15V9a5 5 0 0 1 10 0v6" /><path d="M6 15v-6a2 2 0 0 1 4 0v6" /></>,
  organic: <><path d="M2 11c3-4 5 3 7-1s4 2 5-2" /><path d="M2 14c3-4 5 3 7-1s4 2 5-2" /></>,
  'retro-pop': <><path d="M2 5h12" /><path d="M2 8.5h12" /><path d="M2 12h12" /><circle cx="8" cy="8.5" r="3.2" /></>,
  atmospheric: <><path d="M3 12c1-5 3-7 5-7s4 2 5 7" /><path d="M5 13c.6-4 2-6 3-6s2.4 2 3 6" /></>,
  technical: <><path d="M2 8h4V4h4v4h4" /><circle cx="6" cy="8" r="1.1" /><circle cx="10" cy="8" r="1.1" /></>,
  cosmic: <><circle cx="8" cy="8" r="3.6" /><ellipse cx="8" cy="8" rx="6.4" ry="2.1" /></>,
  textile: <><path d="M2 5h12M2 8h12M2 11h12" /><path d="M5 2v12M8 2v12M11 2v12" /></>,
  architectural: <><path d="M2 14V7h4v7" /><path d="M6 14V4h4v10" /><path d="M10 14V9h4v5" /></>,
  liquid: <><circle cx="8" cy="8" r="2" /><circle cx="8" cy="8" r="4.2" /><circle cx="8" cy="8" r="6.2" /></>,
  cellular: <><circle cx="5.5" cy="6" r="3" /><circle cx="10.5" cy="9.5" r="3.4" /><circle cx="11" cy="4" r="1.8" /></>,
  // a prism with the fan leaving it
  prismatic: <><path d="M6.5 2.5 2 13h9L6.5 2.5Z" /><path d="M11.5 6h3M11.5 8.5h3M11.5 11h3" /></>,
  // a lit tube over its broken reflection
  nocturne: <><path d="M3 9.5a5 5 0 0 1 10 0" /><path d="M3 13h2.5M7.5 13h1.5M11 13h2" /></>,
  // three cut layers, each sitting on the one behind
  papercut: <><path d="M1.5 6.5c3-2.5 5 2 6.5 0s3.5-2 6.5 0" /><path d="M1.5 9.5c3-2.5 5 2 6.5 0s3.5-2 6.5 0" /><path d="M1.5 12.5c3-2.5 5 2 6.5 0s3.5-2 6.5 0" /></>,
  // a loaded stroke, and the seal under it
  ink: <><path d="M2.5 3c2.5.5 5.5 3.5 5 8.5" /><rect x="10" y="10" width="4" height="4" rx="0.7" /></>,
  // an agate: nested bands round a core
  mineral: <><path d="M8 2c3.6 0 6 2.6 6 6s-2.4 6-6 6-6-2.6-6-6 2.4-6 6-6Z" /><path d="M8 5.2c1.9 0 3.2 1.2 3.2 2.8S9.9 10.8 8 10.8 4.8 9.6 4.8 8 6.1 5.2 8 5.2Z" /></>,
}

export function FamilyIcon({ family }: { family: FamilyId }): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {FAMILY_PATHS[family]}
    </svg>
  )
}

/** A palette shown as what it is: its ground, its range, and its accent. */
export function PaletteSwatch({ palette }: { palette: Palette }): React.JSX.Element {
  return (
    <span className="swatch" aria-hidden="true" style={{ background: palette.ground }}>
      <span style={{ background: palette.ramp[1] }} />
      <span style={{ background: palette.ramp[3] }} />
      <span style={{ background: palette.accent }} />
    </span>
  )
}

export function AutoSwatch(): React.JSX.Element {
  return (
    <span className="swatch swatch--auto" aria-hidden="true">
      <span /><span /><span />
    </span>
  )
}

export function DeviceIcon({ group }: { group: 'Phone' | 'Tablet' | 'Desktop' }): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {group === 'Phone' ? (
        <rect x="5" y="2" width="6" height="12" rx="1.4" />
      ) : group === 'Tablet' ? (
        <rect x="3.5" y="2.5" width="9" height="11" rx="1.2" />
      ) : (
        <><rect x="1.5" y="3" width="13" height="8.5" rx="1.2" /><path d="M6 14h4" /></>
      )}
    </svg>
  )
}
