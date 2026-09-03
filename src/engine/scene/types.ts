import type { Path } from './path'
import type { SdfShape } from './sdf'

/**
 * The scene graph.
 *
 * A renderer's job stops at describing what is in the frame. It says where a
 * form is, how far away it is, what it is made of, and how it answers to
 * light. It does not say what colour that comes out as, how soft its shadow
 * is, or whether it is in focus — those are consequences, and consequences
 * belong to the pipeline where they can be decided once for all ten families.
 *
 * Two fields carry most of the weight.
 *
 * `plane` is the depth of the node, 0 far to 1 near, and it drives atmospheric
 * falloff, blur tier, shadow softness, contact darkening and grade weight from
 * one number. Renderers set it and then stop thinking about depth entirely.
 *
 * `tone` is presence, not colour: 0 is barely separated from the ground, 1 is
 * the strongest structural value. Keeping colour out of the graph is what
 * makes a real grade possible — a node that has already committed to a hex
 * string cannot be regraded, only re-tinted.
 */

export type Geom =
  /**
   * A distance field, which is the only kind the GPU path can draw.
   *
   * It carries strictly more than an outline: how far every point in the plane
   * is from the form, not just where its edge is. Occlusion, soft shadow,
   * thickness and antialiasing all fall out of that, and none of them are
   * available from a path. A family emits this when its forms are analytic
   * enough to express as primitives, and keeps a path alongside for the CPU
   * and vector backends.
   */
  | { k: 'sdf'; shape: SdfShape; path?: Path }
  | { k: 'path'; path: Path }
  | { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rot: number }
  | { k: 'poly'; pts: Float64Array; closed: boolean }
  /** many small marks sharing one material; kept dense rather than as N nodes */
  | { k: 'points'; pts: Float64Array; r: Float64Array }

/**
 * Materials, not colours.
 *
 * Five was the brief and five does not cover the catalogue as it stands. Foam,
 * Mercury and Oil Slick are all transparent films that accumulate colour at a
 * rim; Colonnade, Nested Arches and Ribbed Vault are all shaded masses lit
 * from one side. Those two want to be materials rather than each family
 * reinventing a gradient, so there are seven.
 */
export type Material =
  /** clean fill, subtle edge darkening */
  | { k: 'matte'; edgeDark: number }
  /** stroke edges bleed into the substrate, weight varies along the path */
  | { k: 'ink'; bleed: number; pressure: number }
  /** cyan, magenta and yellow plates each misregister independently */
  | { k: 'screen'; spread: number }
  /** ink density mottling, roller streaks along one axis */
  | { k: 'riso'; mottle: number; streak: number }
  /** contributes to the bloom pass */
  | { k: 'emissive'; intensity: number }
  /** transparent, colour piling up where the line of sight runs along it */
  | { k: 'film'; rim: number; iridescence: number }
  /** a solid lit from the composition's one light source */
  | { k: 'mass'; facing: number }

export type MaterialId = Material['k']

/**
 * Whether the node is cut to the focal form.
 *
 * This has to be its own axis. The old four-layer scene conflated clipping
 * with draw order, and the price was five renderers pushing identical content
 * into two layers at different opacities to get a form that both reads at the
 * edge and continues past it. Clipping is a masking question; depth is
 * `plane`; they are unrelated and are now stored that way.
 */
export type Mask = 'none' | 'inside' | 'outside'

export type Node = {
  geom: Geom
  /** 0 far .. 1 near */
  plane: number
  material: Material
  /** 0 barely present .. 1 strongest structural value */
  tone: number
  /** stroke width in design units; ignored by materials that fill */
  weight?: number
  /** filled unless this is set */
  stroke?: boolean
  mask: Mask
  light: { receives: boolean; casts: boolean; emissive: number }
  /** stable per-node jitter, so hand quality survives a re-render */
  seedRef: number
  /** multiplies the resolved alpha; for genuinely translucent passes only */
  alpha?: number
}

export type SceneGraph = {
  nodes: Node[]
  /**
   * Ambient colour bias for the whole frame, 0 neutral. The grade pass reads
   * it; a renderer that wants a warmer composition asks for one here rather
   * than warming three hundred fills itself.
   */
  warmth?: number
}

/** Defaults, so a renderer only states what it actually cares about. */
export function node(
  geom: Geom,
  plane: number,
  material: Material,
  tone: number,
  rest: Partial<Omit<Node, 'geom' | 'plane' | 'material' | 'tone'>> = {},
): Node {
  return {
    geom,
    plane,
    material,
    tone,
    mask: rest.mask ?? 'none',
    light: rest.light ?? { receives: true, casts: true, emissive: 0 },
    seedRef: rest.seedRef ?? 0,
    ...(rest.weight !== undefined ? { weight: rest.weight } : {}),
    ...(rest.stroke !== undefined ? { stroke: rest.stroke } : {}),
    ...(rest.alpha !== undefined ? { alpha: rest.alpha } : {}),
  }
}
