/**
 * Small general-purpose helpers that the editor exposes because shape utils and
 * host apps need exactly the same ones the editor uses internally.
 *
 * Nothing here knows about the editor. Anything that does belongs in a module
 * named after the thing it knows about.
 */

/**
 * Round `n` to `precision` decimal places, without the float dust that a naive
 * `Math.round(n * 100) / 100` leaves behind.
 *
 * Every number that reaches the persisted document goes through this: a
 * coordinate written as `0.30000000000000004` is a diff against a peer who
 * wrote `0.3`, and a sync layer cannot tell that apart from a real edit.
 */
export function toFixed(n: number, precision = 2): number {
  // `toFixed` rounds in decimal rather than in binary, which is the point;
  // `+` turns the string straight back into a number without a second rounding.
  return +n.toFixed(precision)
}

/**
 * Whether `n` is a number a geometry routine may safely divide by, compare or
 * persist: finite, not `NaN`, and inside the range where a `double` still has
 * enough mantissa left to be meaningful at canvas scale.
 *
 * SEMANTICS-ASSUMED: the bound. The docs name the predicate but not its
 * threshold, so it is derived from what the check is *for* — a page coordinate
 * beyond `Number.MAX_SAFE_INTEGER` can no longer represent its own integer part
 * exactly, at which point snapping, hit testing and bounds arithmetic all stop
 * agreeing with each other. A shape that far out is a corrupt record, not a
 * distant one.
 */
export function isSafeFloat(n: unknown): boolean {
  return typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER
}

/**
 * The distinct values of `array`, in first-seen order.
 *
 * Order matters at the call sites this exists for — the list of fonts a page
 * needs, the parents shapes were dropped onto — so this is not a `Set` round
 * trip written the short way.
 */
export function uniq<T>(array: Iterable<T>): T[] {
  const seen = new Set<T>()
  const out: T[] = []
  for (const item of array) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

/**
 * A name that is not already taken: `"Page"` becomes `"Page 1"`, then
 * `"Page 2"`, and `"Page 2"` itself becomes `"Page 3"`.
 *
 * Used wherever a duplicate has to be given a name a human would have chosen —
 * duplicating a page, a frame, an exported file.
 *
 * SEMANTICS-ASSUMED: a trailing integer on `name` is treated as a counter and
 * continued rather than being kept and appended to, so duplicating `"Page 2"`
 * twice gives `"Page 3"` and `"Page 4"` rather than `"Page 2 1"` and
 * `"Page 2 2"`. The docs pin neither; this is the behaviour every file manager
 * has trained people to expect.
 */
export function getIncrementedName(name: string, others: Iterable<string>): string {
  const taken = new Set(others)
  if (!taken.has(name)) return name

  const match = /^(.*?)(\d+)$/.exec(name)
  const stem = (match?.[1] ?? name).replace(/\s+$/, "")
  let n = match ? Number(match[2] ?? 0) : 1

  let candidate = `${stem} ${n}`
  while (taken.has(candidate)) {
    n += 1
    candidate = `${stem} ${n}`
  }
  return candidate
}

/**
 * The keys of `T` that may be omitted.
 *
 * The two halves of an options bag, at the type level: pair this with
 * {@link RequiredKeys} to split one interface into "what a caller must supply"
 * and "what has a default", which is how an options type and its defaults
 * object are kept in step without restating either.
 */
export type OptionalKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? K : never
}[keyof T]

/** The keys of `T` that a caller has to supply. The complement of {@link OptionalKeys}. */
export type RequiredKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? never : K
}[keyof T]
