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
// Imported from the module rather than through `../text`, which would close a
// cycle back through the label components.
import { isRichText, toRichText, type RichText } from "../text/rich-text"

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
 * A shape's label as plain text.
 *
 * A label has two spellings on the record — `props.richText`, the document the
 * store keeps, and `props.text`, its flattened form — and this reconciles them
 * through {@link readRichText} so the two readers can never disagree about what
 * a shape says.
 *
 * `key` names a *plain-text-only* prop (a frame's `name`); only the default
 * `"text"` participates in the reconciliation, because only it has a rich
 * counterpart.
 */
export function readText(props: unknown, key = "text"): string {
  if (key !== "text") return readString(props, key, "")
  return richTextToPlainText(readRichText(props))
}

/**
 * A shape's label as a rich-text document — the reader every other label read
 * goes through.
 *
 * A record can carry either spelling, or both, or both *disagreeing*: a v5
 * writer sets `props.richText` and leaves `props.text` at its default, a
 * pre-v5 writer does the reverse, and a partial update touches one without the
 * other. So the rule is stated once, here:
 *
 * 1. a rich-text document that actually says something wins — it is the
 *    canonical spelling and the only one that can carry formatting;
 * 2. otherwise a non-empty `props.text` is lifted into a document;
 * 3. otherwise the label is empty, and the stored document (if any) is kept so
 *    an empty-but-structured document survives a round trip.
 *
 * An empty label is one empty paragraph, which is what this format spells
 * "nothing typed yet" — never a document with no content at all.
 */
export function readRichText(props: unknown, key = "richText"): RichText {
  const value = (props as Props | undefined)?.[key]
  const stored = isRichText(value) ? value : null
  if (stored !== null && richTextToPlainText(stored).length > 0) return stored
  const text = (props as Props | undefined)?.["text"]
  if (typeof text === "string" && text.length > 0) return toRichText(text)
  return stored ?? toRichText("")
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
