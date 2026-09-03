import type { Focal, FocalKind } from './types'
import { circlePath, ellipsePath, f } from './svg'

/**
 * The single dominant form. Placement is compositor-owned so no family can
 * break the rule that the top third of a portrait composition stays quiet —
 * that is where the clock and notifications sit.
 */
export function makeFocal(kind: FocalKind, cx: number, cy: number, rx: number, ry: number): Focal {
  switch (kind) {
    case 'circle':
    case 'disc': {
      const r = Math.min(rx, ry)
      return {
        kind, cx, cy, rx: r, ry: r,
        path: circlePath(cx, cy, r),
        contains: (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r,
      }
    }
    case 'ellipse':
      return {
        kind, cx, cy, rx, ry,
        path: ellipsePath(cx, cy, rx, ry),
        contains: (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1,
      }
    case 'diamond':
      return {
        kind, cx, cy, rx, ry,
        path: `M${f(cx)} ${f(cy - ry)}L${f(cx + rx)} ${f(cy)}L${f(cx)} ${f(cy + ry)}L${f(cx - rx)} ${f(cy)}Z`,
        contains: (x, y) => Math.abs(x - cx) / rx + Math.abs(y - cy) / ry <= 1,
      }
    case 'arch': {
      const w = Math.min(rx, ry * 0.85)
      const top = cy - ry
      const spring = top + w
      const bottom = cy + ry
      return {
        kind, cx, cy, rx: w, ry,
        path:
          `M${f(cx - w)} ${f(bottom)}L${f(cx - w)} ${f(spring)}` +
          `A${f(w)} ${f(w)} 0 0 1 ${f(cx + w)} ${f(spring)}` +
          `L${f(cx + w)} ${f(bottom)}Z`,
        contains: (x, y) => {
          if (Math.abs(x - cx) > w || y > bottom || y < top) return false
          if (y >= spring) return true
          return (x - cx) ** 2 + (y - spring) ** 2 <= w * w
        },
      }
    }
  }
}
