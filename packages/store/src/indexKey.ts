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

/* ---- jitter -------------------------------------------------------------
 *
 * Plain fractional indexing is a pure function of its two neighbours, so two
 * clients inserting in the same gap generate the *same* key — not rarely, but
 * every single time. A record's `index` is one register to a last-writer-wins
 * merge, so the two shapes end up claiming one position and the merge keeps
 * one of them. Appending a few random digits makes the keys differ while
 * staying in the same gap, which is what makes concurrent insertion safe.
 *
 * The alphabet deliberately omits "0": a key may not end in the smallest digit
 * (`fractional-indexing` rejects it), and excluding it outright is cheaper than
 * checking the last character and costs a negligible amount of entropy —
 * 61^6 is about 5.1e10 per gap.
 * ------------------------------------------------------------------------- */

const JITTER_DIGITS = "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const JITTER_LENGTH = 6

/**
 * Whether generated keys carry jitter. `null` means "work it out".
 *
 * Jitter is what makes concurrent insertion safe, and it also makes every
 * generated key unpredictable — which is exactly wrong for a test that compares
 * two records, or replays an operation through two implementations and asserts
 * they agree. A consumer without a way to turn it off has to weaken those tests
 * until they stop checking `index` at all, losing the assertion they were
 * written for.
 *
 * So it is off under test by default, and forceable either way.
 */
let jitterOverride: boolean | null = null

/** Read an env var without assuming there is a `process`; there is not, in a browser. */
function env(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return proc?.env?.[name]
}

/**
 * Whether jitter is on right now.
 *
 * Resolution order: an explicit {@link setIndexJitterEnabled} wins; then
 * `MOCANVAS_INDEX_JITTER`, which is how you force it in a runner that does not
 * set `NODE_ENV` or in one that sets it to `test` when you did not want that;
 * then `NODE_ENV === "test"` turns it off. Otherwise on.
 */
export function isIndexJitterEnabled(): boolean {
  if (jitterOverride !== null) return jitterOverride
  const forced = env("MOCANVAS_INDEX_JITTER")
  if (forced !== undefined) return !(forced === "0" || forced === "false" || forced === "off")
  return env("NODE_ENV") !== "test"
}

/**
 * Turn jitter on or off for the rest of this process; `null` restores the
 * default resolution above.
 *
 * Tests of the jitter *itself* have to force it on — under a test runner it is
 * off, which is the whole point — so they call this and restore afterwards.
 *
 * ```ts
 * beforeAll(() => setIndexJitterEnabled(true))
 * afterAll(() => setIndexJitterEnabled(null))
 * ```
 *
 * Process-wide rather than per-call because the helpers are free functions
 * reached from everywhere, including inside `Editor`; threading an option
 * through every call site would leave the ones that matter untouched.
 */
export function setIndexJitterEnabled(enabled: boolean | null): void {
  jitterOverride = enabled
}

function randomJitterChar(maxExclusive?: string): string {
  // When `key` is a prefix of `above`, the first jittered character has to be
  // strictly below the character `above` continues with, or the jittered key
  // would sort past it. Anything after that first character is then free.
  const pool = maxExclusive === undefined ? JITTER_DIGITS : [...JITTER_DIGITS].filter((c) => c < maxExclusive).join("")
  if (pool.length === 0) return ""
  return pool[Math.floor(Math.random() * pool.length)]!
}

/**
 * `key` with random digits appended, still strictly between its neighbours.
 *
 * Returns `key` unchanged when there is no room — `above` continues with the
 * smallest digit, so no suffix fits underneath it. That is the one case where
 * two clients can still collide, and it is vanishingly rarer than the every-time
 * collision it replaces.
 */
function withJitter(key: string, above: string | undefined): IndexKey {
  if (!isIndexJitterEnabled()) return key as IndexKey
  // `key` already sorts below `above`. If they differ *inside* `key` then any
  // suffix keeps that difference, and only the prefix case needs a bound.
  const bounded = above !== undefined && above.startsWith(key)
  const first = randomJitterChar(bounded ? above[key.length] : undefined)
  if (first === "") return key as IndexKey
  let out = key + first
  for (let i = 1; i < JITTER_LENGTH; i++) out += randomJitterChar()
  return out as IndexKey
}

/**
 * Generate a key strictly between `below` and `above`; either may be omitted.
 * Throws when `below >= above`.
 *
 * Jittered — see the note above {@link JITTER_DIGITS}. Two calls with the same
 * arguments return *different* keys, both in the same gap, which is what lets
 * two clients insert at one position without one of them being merged away.
 */
export function getIndexBetween(below?: IndexKey | undefined, above?: IndexKey | undefined): IndexKey {
  assertOrdered(below, above)
  return withJitter(generateKeyBetween(below ?? null, above ?? null), above)
}

/** Generate a key strictly above `below` (or a first key when omitted). Jittered. */
export function getIndexAbove(below?: IndexKey | undefined): IndexKey {
  return withJitter(generateKeyBetween(below ?? null, null), undefined)
}

/** Generate a key strictly below `above` (or a first key when omitted). Jittered. */
export function getIndexBelow(above?: IndexKey | undefined): IndexKey {
  return withJitter(generateKeyBetween(null, above ?? null), above)
}

/**
 * Jitter a run of keys without disturbing their order.
 *
 * Each key is bounded by the *next* one rather than by the outer `above`: two
 * keys in a run are often prefixes of one another, and jittering one past its
 * successor would reorder the run it belongs to.
 */
function withJitterEach(keys: string[], above: string | undefined): IndexKey[] {
  const out: IndexKey[] = []
  for (let i = 0; i < keys.length; i++) {
    out.push(withJitter(keys[i]!, i + 1 < keys.length ? keys[i + 1] : above))
  }
  return out
}

/** Generate `n` sorted keys strictly between `below` and `above`. Jittered. */
export function getIndicesBetween(
  below: IndexKey | undefined,
  above: IndexKey | undefined,
  n: number,
): IndexKey[] {
  assertOrdered(below, above)
  return withJitterEach(generateNKeysBetween(below ?? null, above ?? null, n), above)
}

/** Generate `n` sorted keys strictly above `below`. Jittered. */
export function getIndicesAbove(below: IndexKey | undefined, n: number): IndexKey[] {
  return withJitterEach(generateNKeysBetween(below ?? null, null, n), undefined)
}

/** Generate `n` sorted keys strictly below `above`. Jittered. */
export function getIndicesBelow(above: IndexKey | undefined, n: number): IndexKey[] {
  return withJitterEach(generateNKeysBetween(null, above ?? null, n), above)
}

/**
 * The key a run of indices starts from when the caller names none.
 *
 * `a1`, not {@link ZERO_INDEX_KEY}. `a0` is the bottom of the key space — the
 * thing you generate *above* — and handing it out as a real index leaves
 * nothing underneath to insert before. Every other first-index path in this
 * workspace settled on the `a1` bucket; this was the last one that had not.
 */
export const START_INDEX_KEY = "a1" as IndexKey

/**
 * `start`, followed by `n` freshly generated keys above it.
 *
 * **`n` counts the NEW keys, so the array is `n + 1` long.** `start` is an
 * index you already have and is echoed back verbatim — unjittered, because it
 * is an input rather than something this generated:
 *
 * ```ts
 * getIndices(3, "a1") // ["a1", "a2…", "a3…", "a4…"]
 * getIndices(0)       // ["a1"] — a start and nothing after it
 * ```
 *
 * This used to return `n` keys of which `start` was the first, so
 * `getIndices(1)` generated nothing at all, and the default start was `a0`. Both
 * were wrong against the helper of this name that migrating code is written
 * against, in the quiet way: same name, same argument shape, an answer one
 * bucket off and one element short. COMPAT.md's rule for exactly this case is
 * that an undocumented helper behaving almost-right is worse than one that is
 * absent and reported by the compiler.
 */
export function getIndices(n: number, start: IndexKey = START_INDEX_KEY): IndexKey[] {
  validateIndexKey(start)
  if (n <= 0) return [start]
  return [start, ...getIndicesAbove(start, n)]
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
