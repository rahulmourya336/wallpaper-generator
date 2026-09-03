import type { Rng } from './rng'
import type { Palette } from './palette'

export type Dimensions = { width: number; height: number }

export type FamilyId =
  | 'geometric' | 'organic' | 'retro-pop' | 'atmospheric' | 'technical'
  | 'cosmic' | 'textile' | 'architectural' | 'liquid' | 'cellular'

export type FocalKind = 'arch' | 'circle' | 'diamond' | 'ellipse' | 'disc'

export type Focal = {
  kind: FocalKind
  cx: number
  cy: number
  rx: number
  ry: number
  /** clip geometry in px user space */
  path: string
  /** cheap analytic test — never path hit-testing, this runs thousands of times */
  contains(x: number, y: number): boolean
}

export type ParamSpec =
  | { key: string; label: string; type: 'range'; min: number; max: number; step: number; default: number }
  | { key: string; label: string; type: 'select'; options: readonly string[]; default: string }

export type ParamSchema = readonly ParamSpec[]

export type ParamValues = Readonly<Record<string, number | string>>

/**
 * Everything a renderer is allowed to know. Renderers supply a field function
 * and a focal-adjacent shape; the compositor owns masking, occlusion order,
 * ghost geometry, vignette and grain.
 */
export type RenderContext = {
  seed: string
  /** the per-sample stream, fork('field'). Draw counts here may vary with quality. */
  rng: Rng
  /** derive a stream whose draw count must NOT vary with quality (skeleton decisions) */
  fork(salt: string): Rng

  w: number
  h: number
  aspect: number
  /** min(w, h) */
  short: number
  /** design units -> px. A "2px" stroke is u(2); never write a pixel literal. */
  u(units: number): number
  /** px -> design units. Noise must be sampled in design space or the
   *  composition changes shape between the thumbnail and the 4x export. */
  n(px: number): number

  /** 0.25 filmstrip | 1 canvas | 1..4 export */
  quality: number
  /** wall-clock budget check; packing and growth loops must poll this */
  expired(): boolean

  palette: Palette
  focal: Focal
  /** one light source per composition; every shadow agrees with it */
  light: { angle: number; dx: number; dy: number }

  /** 1 at the focal centre, decaying toward the far corner */
  falloff(x: number, y: number): number
  /** falloff combined with the inside/outside focal density step */
  density(x: number, y: number): number
  /** [-1, 1] */
  noise2(x: number, y: number): number
  fbm(x: number, y: number, octaves?: number): number

  num(key: string): number
  str(key: string): string
  /** 0 = barely present, 1 = strongest structural value */
  ramp(t: number): string
}

/**
 * Renderers emit SVG source, not React elements. A composition is 300-600
 * primitives and the filmstrip draws six of them per debounce; reconciling
 * that through React costs more than the render itself.
 */
export type Scene = {
  /** far field, clipped to the inverse of the focal form */
  back: string[]
  /** passes behind the focal form */
  behind: string[]
  /** clipped to the focal form, full density */
  subject: string[]
  /** crosses over the focal edge and off the canvas */
  front: string[]
  defs?: string[]
  /** exactly one bright element per composition */
  accent?: string
  /** canvas families (aurora) paint here; the compositor still owns grain */
  paint?: (c: CanvasRenderingContext2D, ctx: RenderContext) => void
}

export type Renderer = {
  id: string
  name: string
  family: FamilyId
  /** at least half the styles in every family must be dark */
  dark: boolean
  /** palette ids this style is designed against; the first is its default */
  palettes: readonly string[]
  focals: readonly FocalKind[]
  sampler: 'field' | 'grid'
  mode?: 'svg' | 'canvas'
  schema: ParamSchema
  render(ctx: RenderContext): Scene
}

export type Family = {
  id: FamilyId
  name: string
  renderers: readonly Renderer[]
}
