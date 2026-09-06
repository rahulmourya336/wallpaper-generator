import type { Focal, FocalKind } from './types'
import { circlePath, ellipsePath, f } from './svg'

/**
 * The dominant form. Placement is layout-owned (see `layout.ts`) so no family
 * can break the rule that the top third of a portrait composition stays quiet,
 * which is where the clock and notifications sit.
 *
 * Every kind carries `norm` alongside `contains`, and the two must agree:
 * `contains` is exactly `norm <= 1`. The continuous form is what lets the
 * compositor fade the field across the silhouette instead of stepping it, so
 * the edge of the form stops printing itself as a seam in the dot field.
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
        norm: (x, y) => Math.hypot(x - cx, y - cy) / r,
      }
    }
    case 'ellipse':
      return {
        kind, cx, cy, rx, ry,
        path: ellipsePath(cx, cy, rx, ry),
        contains: (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1,
        norm: (x, y) => Math.hypot((x - cx) / rx, (y - cy) / ry),
      }
    case 'diamond':
      return {
        kind, cx, cy, rx, ry,
        path: `M${f(cx)} ${f(cy - ry)}L${f(cx + rx)} ${f(cy)}L${f(cx)} ${f(cy + ry)}L${f(cx - rx)} ${f(cy)}Z`,
        contains: (x, y) => Math.abs(x - cx) / rx + Math.abs(y - cy) / ry <= 1,
        norm: (x, y) => Math.abs(x - cx) / rx + Math.abs(y - cy) / ry,
      }
    case 'lens': {
      // a vesica: two arcs meeting at points, top and bottom
      const bulge = rx * 1.35
      return {
        kind, cx, cy, rx, ry,
        path:
          `M${f(cx)} ${f(cy - ry)}` +
          `A${f(bulge)} ${f(ry * 1.6)} 0 0 1 ${f(cx)} ${f(cy + ry)}` +
          `A${f(bulge)} ${f(ry * 1.6)} 0 0 1 ${f(cx)} ${f(cy - ry)}Z`,
        // the analytic test only has to be close; it gates thousands of samples
        contains: (x, y) => ((x - cx) / (rx * 0.86)) ** 2 + ((y - cy) / ry) ** 2 <= 1,
        norm: (x, y) => Math.hypot((x - cx) / (rx * 0.86), (y - cy) / ry),
      }
    }
    case 'portal': {
      // a rounded slab: straight sides, generous corners, sits like a doorway
      const r = Math.min(rx, ry) * 0.42
      return {
        kind, cx, cy, rx, ry,
        path:
          `M${f(cx - rx + r)} ${f(cy - ry)}H${f(cx + rx - r)}` +
          `A${f(r)} ${f(r)} 0 0 1 ${f(cx + rx)} ${f(cy - ry + r)}` +
          `V${f(cy + ry - r)}A${f(r)} ${f(r)} 0 0 1 ${f(cx + rx - r)} ${f(cy + ry)}` +
          `H${f(cx - rx + r)}A${f(r)} ${f(r)} 0 0 1 ${f(cx - rx)} ${f(cy + ry - r)}` +
          `V${f(cy - ry + r)}A${f(r)} ${f(r)} 0 0 1 ${f(cx - rx + r)} ${f(cy - ry)}Z`,
        contains: (x, y) => Math.abs(x - cx) <= rx && Math.abs(y - cy) <= ry,
        norm: (x, y) => Math.max(Math.abs(x - cx) / rx, Math.abs(y - cy) / ry),
      }
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
        // the jambs are a box, the head is a circle on the springing line
        norm: (x, y) =>
          y >= spring
            ? Math.max(Math.abs(x - cx) / w, (y - cy) / ry)
            : Math.hypot(x - cx, y - spring) / w,
      }
    }
  }
}
