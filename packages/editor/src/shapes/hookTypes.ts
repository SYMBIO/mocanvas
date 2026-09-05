/**
 * The small argument and result types the {@link ShapeUtil} hooks take.
 *
 * They live here rather than in `ShapeUtil.ts` so that a util importing one of
 * them — to type an override's parameter — does not have to import the base
 * class it is already extending, and so the base class file stays about the
 * class.
 */
import type { ComponentType } from "react"
import type { UnknownShape } from "../records/base"
import type { BindingCanBindOptions } from "../bindings/BindingUtil"

/**
 * Why a shape is being asked whether it can be laid out.
 *
 * The alignment operations are one question with several answers: a connector
 * follows the shapes it joins and must not be aligned itself, but it *can* be
 * packed along with them, and a shape locked to its aspect ratio can be aligned
 * but not stretched. Passing the operation lets one method answer all of them.
 */
export interface TLShapeUtilCanBeLaidOutOpts {
  type: "align" | "distribute" | "flip" | "pack" | "stack" | "stretch"
  /** Every shape in the operation, including this one. */
  shapes?: readonly UnknownShape[]
}

/**
 * The documented name for what {@link ShapeUtil.canBind} is asked.
 *
 * Same object as {@link BindingCanBindOptions}, which is the name the binding
 * side of the same question uses; both are exported so neither side has to
 * import the other's vocabulary.
 */
export type TLShapeUtilCanBindOpts<
  From extends UnknownShape = UnknownShape,
  To extends UnknownShape = UnknownShape,
> = BindingCanBindOptions<From, To>

/**
 * A `<defs>` entry a shape needs present in the canvas SVG — a gradient, a
 * filter, a marker, a pattern.
 *
 * Definitions are collected across every registered util, de-duplicated by
 * `key`, and rendered once for the whole canvas: ten thousand arrows share one
 * arrowhead marker rather than carrying one each. `key` is therefore the
 * identity of the definition, not of the shape, and two utils that return the
 * same key must mean the same definition.
 */
export interface TLShapeUtilCanvasSvgDef {
  key: string
  component: ComponentType
}

/**
 * How a shape's props are blended between two versions of it, for
 * {@link ShapeUtil.getInterpolatedProps}.
 *
 * `t` runs `0` (entirely the start shape) to `1` (entirely the end shape) and
 * may be outside that range when an easing overshoots, so an implementation
 * should not assume it is clamped.
 */
export type TLInterpolationProgress = number

/** Linear blend, the interpolation almost every numeric prop wants. */
export function lerp(a: number, b: number, t: TLInterpolationProgress): number {
  return a + (b - a) * t
}
