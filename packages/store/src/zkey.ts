import type { IndexKey } from "./indexKey"

/**
 * Convert a fractional index key into a 64-bit unsigned sortable integer,
 * returned as two uint32 words `[lo, hi]` for transport into WASM memory.
 *
 * Key anatomy (fractional-indexing spec): the first character is a *head*
 * marker drawn from `A..Z` (negative integer parts, `Z` shortest) and `a..z`
 * (positive integer parts, `a` shortest). It encodes the length of the
 * integer part; the remaining characters are base-62 digits (integer digits
 * followed by fractional digits, no trailing `0` in the fraction).
 *
 * Because the head already sorts integer parts by length and sign, the
 * lexicographic order of two keys is: head rank first, then the digit string
 * compared as a zero-padded fixed-point fraction. We encode exactly that:
 *
 *   zkey = headRank * 62^10 + Σ digit[i] * 62^(9 - i)      for i in 0..9
 *
 * with headRank in 0..51 (`A`=0 … `Z`=25, `a`=26 … `z`=51). The maximum value
 * is 52 * 62^10 - 1 ≈ 4.36e18 < 2^64, so it fits in 64 bits. Ten base-62
 * digits after the head are significant; keys that agree on those ten digits
 * tie, which only happens for keys sharing a long common prefix.
 */

const BASE_62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const HEADS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

/** Number of base-62 digits (after the head marker) that affect the zkey. */
export const ZKEY_SIGNIFICANT_DIGITS = 10

const DIGIT_VALUE = new Int8Array(128).fill(-1)
for (let i = 0; i < BASE_62.length; i++) DIGIT_VALUE[BASE_62.charCodeAt(i)] = i

const HEAD_RANK = new Int8Array(128).fill(-1)
for (let i = 0; i < HEADS.length; i++) HEAD_RANK[HEADS.charCodeAt(i)] = i

const B = 62n
const B10 = B ** BigInt(ZKEY_SIGNIFICANT_DIGITS)
const MASK_32 = 0xffff_ffffn

export type ZKey = readonly [lo: number, hi: number]

export function indexKeyToZKey(key: IndexKey): [lo: number, hi: number] {
  if (key.length === 0) throw new Error("Cannot convert an empty index key")
  const headRank = HEAD_RANK[key.charCodeAt(0)] ?? -1
  if (headRank < 0) throw new Error(`Invalid index key head in ${JSON.stringify(key)}`)

  let fraction = 0n
  const n = Math.min(key.length - 1, ZKEY_SIGNIFICANT_DIGITS)
  for (let i = 0; i < n; i++) {
    const d = DIGIT_VALUE[key.charCodeAt(i + 1)] ?? -1
    if (d < 0) throw new Error(`Invalid index key digit in ${JSON.stringify(key)}`)
    fraction = fraction * B + BigInt(d)
  }
  // Pad remaining digit positions with zero so shorter keys sort first.
  for (let i = n; i < ZKEY_SIGNIFICANT_DIGITS; i++) fraction *= B

  const value = BigInt(headRank) * B10 + fraction
  const lo = Number(value & MASK_32)
  const hi = Number((value >> 32n) & MASK_32)
  return [lo, hi]
}

/** Recombine a zkey into a BigInt (mostly for tests and debugging). */
export function zKeyToBigInt([lo, hi]: ZKey): bigint {
  return (BigInt(hi) << 32n) | BigInt(lo)
}

/** Compare two zkeys as unsigned 64-bit integers. */
export function compareZKeys(a: ZKey, b: ZKey): number {
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1
  return 0
}
