import { describe, expect, it } from "vitest"
import {
  compareIndexKeys,
  getIndexAbove,
  getIndexBelow,
  getIndexBetween,
  getIndices,
  getIndicesAbove,
  getIndicesBelow,
  getIndicesBetween,
  isIndexKey,
  setIndexJitterEnabled,
  sortByIndex,
  START_INDEX_KEY,
  validateIndexKey,
  ZERO_INDEX_KEY,
  type IndexKey,
} from "./indexKey"
import { compareZKeys, indexKeyToZKey, zKeyToBigInt, ZKEY_SIGNIFICANT_DIGITS } from "./zkey"

function isStrictlySorted(keys: readonly string[]) {
  for (let i = 1; i < keys.length; i++) if (!(keys[i - 1]! < keys[i]!)) return false
  return true
}

/** Deterministic PRNG so failures are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

describe("fractional index keys", () => {
  it("has a zero key", () => {
    expect(ZERO_INDEX_KEY).toBe("a0")
    validateIndexKey(ZERO_INDEX_KEY)
  })

  it("generates a key between two keys", () => {
    const a = ZERO_INDEX_KEY
    const b = getIndexAbove(a)
    const mid = getIndexBetween(a, b)
    expect(a < mid && mid < b).toBe(true)
  })

  it("generates keys above and below, including from nothing", () => {
    const first = getIndexBetween()
    validateIndexKey(first)
    expect(getIndexAbove(first) > first).toBe(true)
    expect(getIndexBelow(first) < first).toBe(true)
  })

  it("gives two 'first' keys that differ, because every generated key is jittered", () => {
    setIndexJitterEnabled(true)
    try {
    // This used to assert `getIndexAbove() === getIndexBelow()`, which encoded
    // the absence of jitter — the property that let two clients inserting in
    // the same gap mint the same key and lose one of the two records to the
    // merge. They are still both first keys; they are no longer the same one.
    const a = getIndexAbove()
    const b = getIndexBelow()
    expect(a).not.toBe(b)
    validateIndexKey(a)
    validateIndexKey(b)
    expect(a.startsWith("a0")).toBe(true)
    expect(b.startsWith("a0")).toBe(true)
    } finally {
      setIndexJitterEnabled(null)
    }
  })

  it("throws when below >= above", () => {
    expect(() => getIndexBetween("a1" as IndexKey, "a0" as IndexKey)).toThrow()
    expect(() => getIndexBetween("a1" as IndexKey, "a1" as IndexKey)).toThrow()
  })

  it("getIndices returns the start plus n NEW keys, so n + 1 in all", () => {
    // `n` counts what is generated, not what comes back: `start` is an index
    // the caller already has. The old contract returned `n` keys *including*
    // start, which made `getIndices(1)` generate nothing at all.
    const keys = getIndices(5)
    expect(keys).toHaveLength(6)
    expect(keys[0]).toBe(START_INDEX_KEY)
    expect(isStrictlySorted(keys)).toBe(true)

    const fromB = getIndices(3, "b10" as IndexKey)
    expect(fromB).toHaveLength(4)
    expect(fromB[0]).toBe("b10")
    expect(isStrictlySorted(fromB)).toBe(true)
  })

  it("starts at a1 by default, not at the bottom of the key space", () => {
    // `a0` is what you generate above; handing it out as a real index leaves
    // nothing underneath to insert before.
    expect(START_INDEX_KEY).toBe("a1")
    expect(getIndices(2)[0]).toBe("a1")
    expect(getIndexBelow(getIndices(2)[0]!) < "a1").toBe(true)
  })

  it("returns just the start when nothing is asked for", () => {
    expect(getIndices(0)).toEqual([START_INDEX_KEY])
    expect(getIndices(-1)).toEqual([START_INDEX_KEY])
    expect(getIndices(0, "b10" as IndexKey)).toEqual(["b10"])
  })

  it("echoes the start verbatim rather than jittering it", () => {
    // It is an input, not something this generated — and a caller matching it
    // against the index it passed in must find it unchanged.
    for (let i = 0; i < 50; i++) expect(getIndices(3, "a1V" as IndexKey)[0]).toBe("a1V")
  })

  it("getIndicesBetween / Above / Below", () => {
    const lo = ZERO_INDEX_KEY
    const hi = getIndexAbove(lo)
    const between = getIndicesBetween(lo, hi, 10)
    expect(between).toHaveLength(10)
    expect(isStrictlySorted([lo, ...between, hi])).toBe(true)

    const above = getIndicesAbove(hi, 4)
    expect(isStrictlySorted([hi, ...above])).toBe(true)

    const below = getIndicesBelow(lo, 4)
    expect(isStrictlySorted([...below, lo])).toBe(true)

    expect(getIndicesBetween(undefined, undefined, 3)).toHaveLength(3)
  })

  it("sortByIndex sorts by key and is stable", () => {
    const [k1, k2, k3] = getIndices(3)
    const items = [
      { name: "c", index: k3! },
      { name: "a1", index: k1! },
      { name: "b", index: k2! },
      { name: "a2", index: k1! },
    ]
    const sorted = sortByIndex(items)
    expect(sorted.map((i) => i.name)).toEqual(["a1", "a2", "b", "c"])
    expect(items[0]!.name).toBe("c") // not mutated
  })

  it("validates keys", () => {
    expect(() => validateIndexKey("")).toThrow()
    expect(() => validateIndexKey("a0" + "0")).toThrow() // trailing zero in fraction
    expect(() => validateIndexKey("!!")).toThrow()
    expect(() => validateIndexKey("a")).toThrow()
    expect(isIndexKey("a0")).toBe(true)
    expect(isIndexKey("Zz")).toBe(true)
    expect(isIndexKey("a0V")).toBe(true)
    expect(isIndexKey(42)).toBe(false)
    expect(isIndexKey("hello world")).toBe(false)
  })

  it("compareIndexKeys", () => {
    expect(compareIndexKeys("a0" as IndexKey, "a1" as IndexKey)).toBe(-1)
    expect(compareIndexKeys("a1" as IndexKey, "a0" as IndexKey)).toBe(1)
    expect(compareIndexKeys("a0" as IndexKey, "a0" as IndexKey)).toBe(0)
  })
})

describe("indexKeyToZKey", () => {
  it("returns two uint32 words", () => {
    const [lo, hi] = indexKeyToZKey(ZERO_INDEX_KEY)
    for (const w of [lo, hi]) {
      expect(Number.isInteger(w)).toBe(true)
      expect(w).toBeGreaterThanOrEqual(0)
      expect(w).toBeLessThanOrEqual(0xffff_ffff)
    }
  })

  it("orders across head markers (negative, short, long integer parts)", () => {
    const keys = ["Yzz", "Zz", "a0", "a0V", "a1", "az", "b10", "b1z", "c100", "zzzzzzzzzzzzzzzzzzzzzzzzzzz"] as IndexKey[]
    expect(isStrictlySorted(keys)).toBe(true)
    const z = keys.map((k) => zKeyToBigInt(indexKeyToZKey(k)))
    for (let i = 1; i < z.length; i++) expect(z[i]! > z[i - 1]!).toBe(true)
    expect(z[z.length - 1]! < 2n ** 64n).toBe(true)
  })

  it("is strictly monotonic over a large set of short keys", () => {
    const keys = [...getIndicesBelow(ZERO_INDEX_KEY, 1000), ...getIndices(5000)]
    expect(isStrictlySorted(keys)).toBe(true)
    const z = keys.map((k) => indexKeyToZKey(k))
    for (let i = 1; i < z.length; i++) {
      expect(compareZKeys(z[i - 1]!, z[i]!)).toBe(-1)
    }
  })

  it("property: random insertions stay monotonic (strict while keys are short)", () => {
    const random = rng(12345)
    const keys: IndexKey[] = getIndices(50)
    for (let step = 0; step < 4000; step++) {
      const r = random()
      if (r < 0.1) {
        keys.push(getIndexAbove(keys[keys.length - 1]))
      } else if (r < 0.2) {
        keys.unshift(getIndexBelow(keys[0]))
      } else {
        const i = Math.floor(random() * (keys.length - 1))
        keys.splice(i + 1, 0, getIndexBetween(keys[i], keys[i + 1]))
      }
    }
    expect(isStrictlySorted(keys)).toBe(true)

    let ties = 0
    for (let i = 1; i < keys.length; i++) {
      const a = keys[i - 1]!
      const b = keys[i]!
      const cmp = compareZKeys(indexKeyToZKey(a), indexKeyToZKey(b))
      expect(cmp).toBeLessThanOrEqual(0)
      if (cmp === 0) {
        ties++
        // Ties are only allowed when the keys agree on all significant digits.
        expect(a.slice(0, 1 + ZKEY_SIGNIFICANT_DIGITS)).toBe(b.slice(0, 1 + ZKEY_SIGNIFICANT_DIGITS))
      } else if (a.length <= 1 + ZKEY_SIGNIFICANT_DIGITS && b.length <= 1 + ZKEY_SIGNIFICANT_DIGITS) {
        expect(cmp).toBe(-1)
      }
    }
    // Sanity: the random walk produced some deep keys but ties should be rare.
    expect(ties).toBeLessThan(keys.length / 10)
  })

  it("rejects malformed keys", () => {
    expect(() => indexKeyToZKey("" as IndexKey)).toThrow()
    expect(() => indexKeyToZKey("!0" as IndexKey)).toThrow()
    expect(() => indexKeyToZKey("a!" as IndexKey)).toThrow()
  })
})
