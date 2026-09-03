import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing"

/**
 * A fractional index: an order key that sorts lexicographically (plain string
 * comparison) and between which new keys can always be generated.
 */
export type IndexKey = string & { __brand: "indexKey" }

/** The conventional first key. */
export const ZERO_INDEX_KEY = "a0" as IndexKey

function assertOrdered(below: IndexKey | undefined, above: IndexKey | undefined) {
  if (below !== undefined && above !== undefined && !(below < above)) {
    throw new Error(`Index keys out of order: ${JSON.stringify(below)} must be below ${JSON.stringify(above)}`)
  }
}

/** Generate a key strictly between `below` and `above`; either may be omitted. Throws when `below >= above`. */
export function getIndexBetween(below?: IndexKey | undefined, above?: IndexKey | undefined): IndexKey {
  assertOrdered(below, above)
  return generateKeyBetween(below ?? null, above ?? null) as IndexKey
}

/** Generate a key strictly above `below` (or a first key when omitted). */
export function getIndexAbove(below?: IndexKey | undefined): IndexKey {
  return generateKeyBetween(below ?? null, null) as IndexKey
}

/** Generate a key strictly below `above` (or a first key when omitted). */
export function getIndexBelow(above?: IndexKey | undefined): IndexKey {
  return generateKeyBetween(null, above ?? null) as IndexKey
}

/** Generate `n` sorted keys strictly between `below` and `above`. */
export function getIndicesBetween(
  below: IndexKey | undefined,
  above: IndexKey | undefined,
  n: number,
): IndexKey[] {
  assertOrdered(below, above)
  return generateNKeysBetween(below ?? null, above ?? null, n) as IndexKey[]
}

/** Generate `n` sorted keys strictly above `below`. */
export function getIndicesAbove(below: IndexKey | undefined, n: number): IndexKey[] {
  return generateNKeysBetween(below ?? null, null, n) as IndexKey[]
}

/** Generate `n` sorted keys strictly below `above`. */
export function getIndicesBelow(above: IndexKey | undefined, n: number): IndexKey[] {
  return generateNKeysBetween(null, above ?? null, n) as IndexKey[]
}

/**
 * Generate `n` sorted keys, the first of which is `start` (default `a0`).
 * Useful when creating `n` items at once.
 */
export function getIndices(n: number, start: IndexKey = ZERO_INDEX_KEY): IndexKey[] {
  if (n <= 0) return []
  validateIndexKey(start)
  return [start, ...getIndicesAbove(start, n - 1)]
}

/** Return a sorted copy of `items` ordered by their `index` (stable). */
export function sortByIndex<T extends { index: IndexKey }>(items: readonly T[]): T[] {
  return items
    .map((item, i) => [item, i] as const)
    .sort(([a, ai], [b, bi]) => {
      if (a.index < b.index) return -1
      if (a.index > b.index) return 1
      return ai - bi
    })
    .map(([item]) => item)
}

/** Compare two keys: negative, zero, or positive. */
export function compareIndexKeys(a: IndexKey, b: IndexKey): number {
  return a < b ? -1 : a > b ? 1 : 0
}

const BASE_62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const IS_DIGIT = new Uint8Array(128)
for (let i = 0; i < BASE_62.length; i++) IS_DIGIT[BASE_62.charCodeAt(i)] = 1

/**
 * Length of the integer part (head marker included) encoded by a head
 * character, or -1 when the character is not a head marker.
 * `a`..`z` mark positive integer parts of length 2..27, `Z`..`A` negative ones.
 */
function integerPartLength(head: number): number {
  if (head >= 97 && head <= 122) return head - 97 + 2 // a..z
  if (head >= 65 && head <= 90) return 90 - head + 2 // A..Z
  return -1
}

/**
 * Throws if `key` is not a well-formed fractional index key: a head marker,
 * enough base-62 integer digits for that head, then an optional fraction of
 * base-62 digits that does not end in `0`.
 * Narrows the type on success.
 */
export function validateIndexKey(key: string): asserts key is IndexKey {
  const fail = (why: string): never => {
    throw new Error(`Invalid index key ${JSON.stringify(key)}: ${why}`)
  }
  if (typeof key !== "string" || key.length === 0) fail("empty")
  const intLen = integerPartLength(key.charCodeAt(0))
  if (intLen < 0) fail("bad head marker")
  if (key.length < intLen) fail(`integer part needs ${intLen - 1} digits`)
  for (let i = 1; i < key.length; i++) {
    const c = key.charCodeAt(i)
    if (c > 127 || IS_DIGIT[c] !== 1) fail(`bad digit at ${i}`)
  }
  if (key.length > intLen && key.endsWith("0")) fail("fraction ends in 0")
}

/** Non-throwing variant of `validateIndexKey`. */
export function isIndexKey(key: unknown): key is IndexKey {
  if (typeof key !== "string") return false
  try {
    validateIndexKey(key)
    return true
  } catch {
    return false
  }
}
