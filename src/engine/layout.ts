import type { Rng } from './rng'
import { makeFocal } from './focal'
import type { Focal, FocalKind } from './types'
import { f } from './svg'

/**
 * Composition archetypes.
 *
 * Every style used to place its focal form the same way: one shape, a little
 * off centre, at roughly a third of the short edge. The seed moved things
 * around inside that arrangement but never changed the arrangement itself,
 * which is exactly why a hundred shuffles read as one picture rearranged.
 *
 * A layout decides three things the renderers never see: where the subject
 * sits on screen, how big it is relative to the frame, and how the whole field
 * is rotated and scaled behind it. Those are the variables that make two
 * compositions look like different pictures rather than different seeds.
 */
export type LayoutId =
  | 'centre'
  | 'low'
  | 'thirds'
  | 'horizon'
  | 'macro'
  | 'edge'
  | 'twin'
  | 'diagonal'

export const LAYOUT_IDS: readonly LayoutId[] = [
  'centre', 'low', 'thirds', 'horizon', 'macro', 'edge', 'twin', 'diagonal',
]

export type LayoutPlan = {
  id: LayoutId
  /** in field space; focals[0] is the subject renderers aim at */
  focals: Focal[]
  /** degrees, applied to the field about the canvas centre */
  rotate: number
  /** scale, applied to the field about the canvas centre */
  zoom: number
  /** mirrored horizontally; free variety for anything asymmetric */
  flip: boolean
  /** where the subject lands on screen, for the vignette and safe-zone rules */
  screen: { cx: number; cy: number; r: number }
}

type Box = { w: number; h: number; short: number; aspect: number }

/**
 * Scale needed for a field rotated by `deg` to still cover the frame.
 *
 * Rotating the field about the canvas centre swings the corners inward and
 * exposes bare ground in the gaps. This is the standard cover factor, and it
 * is why rotation and zoom cannot be chosen independently.
 */
function coverZoom(deg: number, w: number, h: number): number {
  const r = (Math.abs(deg) * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return Math.max((w * c + h * s) / w, (h * c + w * s) / h)
}

/**
 * The quiet band. On a portrait screen the clock and notifications sit across
 * the top third, so no layout may put the subject's centre there. Landscape
 * has no such constraint, so it gets the whole middle to play with.
 */
function subjectBand(box: Box): [number, number] {
  return box.aspect < 1 ? [0.5, 0.8] : [0.38, 0.68]
}

type Spec = {
  /** screen position as a fraction of the frame */
  cx: [number, number]
  cy: [number, number]
  /** screen radius as a fraction of the short edge */
  r: [number, number]
  rotate: [number, number]
  /** extra zoom on top of whatever the rotation demands */
  zoom: [number, number]
  twin?: boolean
}

const SPECS: Record<LayoutId, (box: Box) => Spec> = {
  // the classic: subject seated a little below the middle
  centre: (box) => ({
    cx: [0.42, 0.58],
    cy: bandOf(box, 0.02, 0.34),
    r: [0.3, 0.44],
    rotate: [-6, 6],
    zoom: [1, 1.22],
  }),
  // subject dropped low, most of the frame given to open ground
  low: (box) => ({
    cx: [0.36, 0.64],
    cy: bandOf(box, 0.6, 1),
    r: [0.34, 0.5],
    rotate: [-8, 8],
    zoom: [1, 1.28],
  }),
  // pushed hard to one side
  thirds: (box) => ({
    cx: [0.2, 0.34],
    cy: bandOf(box, 0.15, 0.7),
    r: [0.28, 0.44],
    rotate: [-13, 13],
    zoom: [1, 1.3],
  }),
  // wide and shallow, sitting on a line
  horizon: (box) => ({
    cx: [0.4, 0.6],
    cy: bandOf(box, 0.1, 0.5),
    r: [0.44, 0.66],
    rotate: [-4, 4],
    zoom: [1, 1.2],
  }),
  // right in close: the subject overruns the frame
  macro: (box) => ({
    cx: [0.34, 0.66],
    cy: bandOf(box, 0, 0.6),
    r: [0.5, 0.85],
    rotate: [-12, 12],
    zoom: [1.35, 1.95],
  }),
  // half of the subject is off the frame
  edge: (box) => ({
    cx: [0.02, 0.16],
    cy: bandOf(box, 0.1, 0.75),
    r: [0.44, 0.68],
    rotate: [-10, 10],
    zoom: [1.05, 1.4],
  }),
  // two subjects, unequal
  twin: (box) => ({
    cx: [0.26, 0.4],
    cy: bandOf(box, 0.1, 0.6),
    r: [0.24, 0.36],
    rotate: [-7, 7],
    zoom: [1, 1.25],
    twin: true,
  }),
  // the field runs on a slant
  diagonal: (box) => ({
    cx: [0.38, 0.62],
    cy: bandOf(box, 0.1, 0.6),
    r: [0.32, 0.5],
    rotate: [19, 44],
    zoom: [1, 1.3],
  }),
}

/** Map [0,1] within the layout's own range onto the frame's quiet-safe band. */
function bandOf(box: Box, lo: number, hi: number): [number, number] {
  const [from, to] = subjectBand(box)
  return [from + (to - from) * lo, from + (to - from) * hi]
}

export function pickLayout(rng: Rng, weights: Partial<Record<LayoutId, number>>): LayoutId {
  const entries = LAYOUT_IDS.map((id) => [id, weights[id] ?? 0] as const).filter(([, w]) => w > 0)
  const pool = entries.length ? entries : LAYOUT_IDS.map((id) => [id, 1] as const)
  const total = pool.reduce((sum, [, w]) => sum + w, 0)
  let roll = rng.next() * total
  for (const [id, w] of pool) {
    roll -= w
    if (roll <= 0) return id
  }
  return pool[pool.length - 1]?.[0] ?? 'centre'
}

/**
 * `subjectScale` is the direction's say in how big the subject is.
 *
 * The layouts describe an arrangement — where the subject sits and how the
 * field is turned — and every one of them asked for a radius between a quarter
 * and four fifths of the short edge. That band is why the catalogue read as one
 * idea: whatever the style, the subject came out the same size. Scaling here
 * rather than inside each layout keeps the arrangement intact and lets a
 * category be composed close or far without a second set of layouts.
 */
export function planLayout(
  id: LayoutId,
  rng: Rng,
  box: Box,
  kind: FocalKind,
  secondKind: FocalKind,
  subjectScale: readonly [number, number] = [1, 1],
): LayoutPlan {
  const spec = SPECS[id](box)
  const screenCx = box.w * rng.range(spec.cx[0], spec.cx[1])
  const screenCy = box.h * rng.range(spec.cy[0], spec.cy[1])
  const screenR =
    box.short * rng.range(spec.r[0], spec.r[1]) * rng.range(subjectScale[0], subjectScale[1])
  const rotate = rng.range(spec.rotate[0], spec.rotate[1]) * (rng.bool() ? 1 : -1)
  const zoom = Math.max(coverZoom(rotate, box.w, box.h), rng.range(spec.zoom[0], spec.zoom[1]))
  const flip = rng.bool(0.5)

  // The transform runs about the canvas centre, so a screen position maps back
  // into field space by undoing the rotation and the scale about that centre.
  const midX = box.w / 2
  const midY = box.h / 2
  const rad = (-rotate * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const toField = (sx: number, sy: number): [number, number] => {
    const dx = (sx - midX) / zoom
    const dy = (sy - midY) / zoom
    return [midX + dx * cos - dy * sin, midY + dx * sin + dy * cos]
  }

  const [fx, fy] = toField(screenCx, screenCy)
  const fieldR = screenR / zoom
  const ry =
    kind === 'arch' ? fieldR * rng.range(1.3, 1.75)
    : kind === 'portal' ? fieldR * rng.range(1.15, 1.5)
    : fieldR * rng.range(0.9, 1.2)

  const focals = [makeFocal(kind, fx, fy, fieldR, ry)]

  if (spec.twin) {
    // the companion sits away from the subject and reads smaller, so the pair
    // has a clear hierarchy rather than looking like a mistake
    const away = rng.range(0.42, 0.62) * box.w
    const sx2 = Math.min(box.w * 0.94, screenCx + away)
    const sy2 = screenCy + box.h * rng.range(-0.12, 0.12)
    const [gx, gy] = toField(sx2, sy2)
    const r2 = (screenR * rng.range(0.42, 0.7)) / zoom
    focals.push(makeFocal(secondKind, gx, gy, r2, r2 * rng.range(0.9, 1.3)))
  }

  return {
    id,
    focals,
    rotate,
    zoom,
    flip,
    screen: { cx: screenCx, cy: screenCy, r: screenR },
  }
}

/** The field transform, about the canvas centre. */
export function fieldTransform(plan: LayoutPlan, w: number, h: number): string | undefined {
  if (!plan.flip && Math.abs(plan.rotate) < 0.01 && Math.abs(plan.zoom - 1) < 0.001) return undefined
  const midX = w / 2
  const midY = h / 2
  return (
    `translate(${f(midX)} ${f(midY)}) rotate(${f(plan.rotate)}) ` +
    `scale(${f(plan.flip ? -plan.zoom : plan.zoom)} ${f(plan.zoom)}) ` +
    `translate(${f(-midX)} ${f(-midY)})`
  )
}
