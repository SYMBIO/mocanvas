import { useId } from "react"

/**
 * DOM ids that are safe to put in a URL fragment.
 *
 * SVG cross-references — `fill="url(#id)"`, `clip-path="url(#id)"`,
 * `mask="url(#id)"` — are parsed as URLs, so an id containing the characters
 * React's `useId` emits (`:r0:`) makes the reference invalid and the paint
 * silently disappears. Every id that will be referenced that way has to be
 * laundered first, which is what these three do.
 */

/** Characters a fragment identifier may contain, after laundering. */
const UNSAFE = /[^a-zA-Z0-9_-]/g

/**
 * A string that is safe to use as a fragment identifier — i.e. safe inside
 * `url(#…)`.
 *
 * Branded so it cannot be confused with an arbitrary string. That matters
 * because the failure mode of getting it wrong is silent: an SVG reference with
 * an invalid id is not an error, the paint simply does not appear, and it
 * happens only for some values of `useId()`.
 */
export type SafeId = string & { readonly __safeId: unique symbol }

/**
 * Make an arbitrary string usable as a fragment identifier, and prefix it so
 * it cannot start with a digit.
 */
export function sanitizeId(id: string): SafeId {
  return `mc_${id.replace(UNSAFE, "_")}` as SafeId
}

/** The internal spelling. Same function. */
const toSafeId = sanitizeId

/**
 * Add a suffix to a safe id and keep it safe.
 *
 * The pattern one id, several defs needs: `suffixSafeId(id, "clip")` and
 * `suffixSafeId(id, "shadow")` are distinct, stable, and both referencable.
 */
export function suffixSafeId(id: string, suffix: string): SafeId {
  return `${id}_${suffix.replace(UNSAFE, "_")}` as SafeId
}

/**
 * An id unique to this component instance, safe for `url(#…)`.
 *
 * Two mounts of the same component get different ids, which is what a
 * per-instance `<defs>` entry needs — otherwise the second mount's gradient
 * overwrites the first's.
 */
export function useUniqueSafeId(suffix?: string): SafeId {
  const id = toSafeId(useId())
  return suffix === undefined ? id : suffixSafeId(id, suffix)
}

/**
 * A stable id derived from a name, safe for `url(#…)`.
 *
 * The opposite case to {@link useUniqueSafeId}: every mount that passes the
 * same name gets the same id, so many shapes can reference one shared
 * `<defs>` entry rendered once by `SvgDefs`.
 */
export function useSharedSafeId(name: string): SafeId {
  return toSafeId(name)
}
