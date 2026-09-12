import { describe, expect, it } from "vitest"
import {
  ZERO_INDEX_KEY,
  getIndexAbove,
  getIndexBelow,
  getIndexBetween,
  getIndicesAbove,
  getIndicesBetween,
  sortByIndex,
  validateIndexKey,
  type IndexKey,
} from "./indexKey"

/**
 * Jitter.
 *
 * Plain fractional indexing is a pure function of its neighbours, so two
 * clients inserting into the same gap produced the *same* key every time — and
 * `index` is one register to a last-writer-wins merge, so one of the two shapes
 * lost its position. These assert both halves: the keys differ, and they are
 * still in the gap they were asked for.
 */

const k = (s: string) => s as IndexKey

describe("concurrent inserts do not collide", () => {
  it("gives two clients different keys for the same gap", () => {
    const keys = new Set<string>()
    for (let i = 0; i < 500; i++) keys.add(getIndexBetween(ZERO_INDEX_KEY, k("a2")))
    expect(keys.size, "500 inserts into one gap should not repeat").toBeGreaterThan(450)
  })

  it("gives two clients different keys when appending", () => {
    const keys = new Set<string>()
    for (let i = 0; i < 500; i++) keys.add(getIndexAbove(k("a5")))
    expect(keys.size).toBeGreaterThan(450)
  })

  it("gives two clients different keys when prepending", () => {
    const keys = new Set<string>()
    for (let i = 0; i < 500; i++) keys.add(getIndexBelow(k("a5")))
    expect(keys.size).toBeGreaterThan(450)
  })
})

describe("jitter never breaks the ordering it was asked for", () => {
  it("stays strictly between its neighbours, including when the key is a prefix of the upper bound", () => {
    // The dangerous case: a plain key that is a prefix of `above`, where a
    // naively appended suffix sorts straight past it.
    const pairs: [IndexKey, IndexKey][] = [
      [k("a0"), k("a1")],
      [k("a0"), k("a0V")],
      [k("a1"), k("a1V")],
      [k("a1"), k("a11")],
      [k("a1"), k("a2")],
      [k("a1V"), k("a1W")],
      [k("Zz"), k("a0")],
    ]
    for (const [below, above] of pairs) {
      for (let i = 0; i < 200; i++) {
        const mid = getIndexBetween(below, above)
        expect(below < mid, `${below} < ${mid}`).toBe(true)
        expect(mid < above, `${mid} < ${above} (below was ${below})`).toBe(true)
        validateIndexKey(mid)
      }
    }
  })

  it("keeps a generated run in order, and inside its bounds", () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const run = getIndicesBetween(k("a0"), k("a2"), 8)
      expect(run).toHaveLength(8)
      for (const key of run) validateIndexKey(key)
      expect(sortByIndex(run.map((index) => ({ index })))).toEqual(run.map((index) => ({ index })))
      expect(run[0]! > "a0").toBe(true)
      expect(run.at(-1)! < "a2").toBe(true)
      expect(new Set(run).size).toBe(8)
    }
  })

  it("keeps an unbounded run in order", () => {
    const run = getIndicesAbove(k("a0"), 8)
    expect(sortByIndex(run.map((index) => ({ index })))).toEqual(run.map((index) => ({ index })))
    expect(new Set(run).size).toBe(8)
  })

  it("survives repeated insertion into the tightest gap it just made", () => {
    // Interleaving is the property that matters for a board two people are
    // reordering: every new key must land between the two it was given.
    let below = k("a0")
    let above = k("a1")
    for (let i = 0; i < 60; i++) {
      const mid = getIndexBetween(below, above)
      expect(below < mid && mid < above, `${below} < ${mid} < ${above}`).toBe(true)
      validateIndexKey(mid)
      // Alternate which side we tighten, so both bounds get exercised.
      if (i % 2 === 0) below = mid
      else above = mid
    }
  })

  it("produces keys a later call can still generate between", () => {
    const a = getIndexAbove(k("a0"))
    const b = getIndexAbove(a)
    const mid = getIndexBetween(a, b)
    expect(a < mid && mid < b).toBe(true)
  })

  it("never ends in the smallest digit, which the key format forbids", () => {
    for (let i = 0; i < 500; i++) {
      expect(getIndexAbove(k("a1")).endsWith("0")).toBe(false)
      expect(getIndexBetween(k("a0"), k("a2")).endsWith("0")).toBe(false)
    }
  })
})
