/**
 * Tolerant prop reads for the default shape utils.
 *
 * A shape can reach a util with props that do not match its declared shape:
 * a file written by another editor, a record hand-built by an integrator, a
 * partial update. Geometry and rendering must survive that, so the utils read
 * through these helpers rather than trusting the declared types (and rather
 * than sprinkling `?.` and `??` over every access).
 *
 * Each helper takes the shape's props object and returns a usable value of the
 * expected kind, falling back to the util's default when the stored value is
 * missing or of the wrong type.
 */

import { richTextToPlainText, type EnumStyleProp } from "@mocanvas/editor"

type Props = Record<string, unknown>

/** A shape's props as a bag of unknowns, tolerating a missing or non-object `props`. */
export function propsOf(shape: { props?: unknown }): Props {
  const props = shape.props
  return typeof props === "object" && props !== null && !Array.isArray(props) ? (props as Props) : {}
}

export function readString(props: unknown, key: string, fallback: string): string {
  const value = (props as Props | undefined)?.[key]
  return typeof value === "string" ? value : fallback
}

/** A string prop constrained to a known set; anything else falls back. */
export function readEnum<T extends string>(props: unknown, key: string, allowed: readonly T[], fallback: T): T {
  const value = (props as Props | undefined)?.[key]
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/** A style prop's value, validated against the style's own set of values. */
export function readStyle<T extends string>(props: unknown, key: string, style: EnumStyleProp<T>, fallback: T = style.defaultValue): T {
  return readEnum(props, key, style.values, fallback)
}

export function readNumber(props: unknown, key: string, fallback: number): number {
  const value = (props as Props | undefined)?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

export function readBoolean(props: unknown, key: string, fallback: boolean): boolean {
  const value = (props as Props | undefined)?.[key]
  return typeof value === "boolean" ? value : fallback
}

/**
 * A shape's label. Prefers `props.text`; a record that still carries a
 * rich-text document (one that skipped the load-time normalization) is
 * flattened here so it renders rather than throwing.
 */
export function readText(props: unknown, key = "text"): string {
  const bag = props as Props | undefined
  const value = bag?.[key]
  if (typeof value === "string") return value
  const rich = bag?.["richText"]
  return rich === undefined || rich === null ? "" : richTextToPlainText(rich)
}

/** A `{ x, y }` prop, with each coordinate falling back independently. */
export function readPoint(props: unknown, key: string, fallback: { x: number; y: number }): { x: number; y: number } {
  const value = (props as Props | undefined)?.[key]
  if (typeof value !== "object" || value === null) return fallback
  return { x: readNumber(value, "x", fallback.x), y: readNumber(value, "y", fallback.y) }
}

/** An array prop; a missing or non-array value reads as empty. */
export function readArray(props: unknown, key: string): unknown[] {
  const value = (props as Props | undefined)?.[key]
  return Array.isArray(value) ? value : []
}

/** A record-of-objects prop (a line's points, say); anything else reads as empty. */
export function readRecord(props: unknown, key: string): Record<string, unknown> {
  const value = (props as Props | undefined)?.[key]
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
