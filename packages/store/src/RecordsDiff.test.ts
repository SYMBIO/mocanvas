import { describe, expect, it } from "vitest"
import type { BaseRecord, RecordId } from "./ids"
import {
  applyChangeToDiff,
  createEmptyRecordsDiff,
  isRecordsDiffEmpty,
  reverseRecordsDiff,
  squashRecordDiffs,
  type RecordsDiff,
} from "./RecordsDiff"

interface Item extends BaseRecord<"item", RecordId<Item>> {
  v: number
}
const item = (n: string, v: number): Item => ({ id: `item:${n}` as RecordId<Item>, typeName: "item", v })
const id = (n: string) => `item:${n}` as RecordId<Item>

describe("RecordsDiff helpers", () => {
  it("empty detection", () => {
    const d = createEmptyRecordsDiff<Item>()
    expect(isRecordsDiffEmpty(d)).toBe(true)
    d.added[id("a")] = item("a", 1)
    expect(isRecordsDiffEmpty(d)).toBe(false)
  })

  it("reverse swaps added/removed and flips updates", () => {
    const a = item("a", 1)
    const b0 = item("b", 1)
    const b1 = item("b", 2)
    const c = item("c", 1)
    const d: RecordsDiff<Item> = {
      added: { [id("a")]: a },
      updated: { [id("b")]: [b0, b1] },
      removed: { [id("c")]: c },
    } as RecordsDiff<Item>
    const r = reverseRecordsDiff(d)
    expect(r.removed[id("a")]).toBe(a)
    expect(r.added[id("c")]).toBe(c)
    expect(r.updated[id("b")]).toEqual([b1, b0])
    expect(reverseRecordsDiff(r)).toEqual(d)
  })

  describe("applyChangeToDiff squashing rules", () => {
    it("added + updated -> added(latest)", () => {
      const d = createEmptyRecordsDiff<Item>()
      const a0 = item("a", 0)
      const a1 = item("a", 1)
      applyChangeToDiff(d, id("a"), undefined, a0)
      applyChangeToDiff(d, id("a"), a0, a1)
      expect(d.added[id("a")]).toBe(a1)
      expect(isRecordsDiffEmpty({ ...d, added: {} } as RecordsDiff<Item>)).toBe(true)
    })

    it("added + removed -> nothing", () => {
      const d = createEmptyRecordsDiff<Item>()
      const a0 = item("a", 0)
      applyChangeToDiff(d, id("a"), undefined, a0)
      applyChangeToDiff(d, id("a"), a0, undefined)
      expect(isRecordsDiffEmpty(d)).toBe(true)
    })

    it("updated + updated -> updated[original, latest]", () => {
      const d = createEmptyRecordsDiff<Item>()
      const a0 = item("a", 0)
      const a1 = item("a", 1)
      const a2 = item("a", 2)
      applyChangeToDiff(d, id("a"), a0, a1)
      applyChangeToDiff(d, id("a"), a1, a2)
      expect(d.updated[id("a")]).toEqual([a0, a2])
    })

    it("updated back to the original -> nothing", () => {
      const d = createEmptyRecordsDiff<Item>()
      const a0 = item("a", 0)
      const a1 = item("a", 1)
      applyChangeToDiff(d, id("a"), a0, a1)
      applyChangeToDiff(d, id("a"), a1, a0)
      expect(isRecordsDiffEmpty(d)).toBe(true)
    })

    it("updated + removed -> removed(original)", () => {
      const d = createEmptyRecordsDiff<Item>()
      const a0 = item("a", 0)
      const a1 = item("a", 1)
      applyChangeToDiff(d, id("a"), a0, a1)
      applyChangeToDiff(d, id("a"), a1, undefined)
      expect(d.removed[id("a")]).toBe(a0)
      expect(d.updated[id("a")]).toBeUndefined()
    })

    it("removed + added -> updated (or nothing if identical)", () => {
      const d = createEmptyRecordsDiff<Item>()
      const a0 = item("a", 0)
      const a1 = item("a", 1)
      applyChangeToDiff(d, id("a"), a0, undefined)
      applyChangeToDiff(d, id("a"), undefined, a1)
      expect(d.updated[id("a")]).toEqual([a0, a1])
      expect(d.removed[id("a")]).toBeUndefined()

      const e = createEmptyRecordsDiff<Item>()
      applyChangeToDiff(e, id("a"), a0, undefined)
      applyChangeToDiff(e, id("a"), undefined, a0)
      expect(isRecordsDiffEmpty(e)).toBe(true)
    })
  })

  it("squashRecordDiffs merges a sequence of diffs", () => {
    const a0 = item("a", 0)
    const a1 = item("a", 1)
    const b0 = item("b", 0)
    const c0 = item("c", 0)
    const d1: RecordsDiff<Item> = {
      added: { [id("a")]: a0, [id("c")]: c0 },
      updated: {},
      removed: { [id("b")]: b0 },
    } as RecordsDiff<Item>
    const d2: RecordsDiff<Item> = {
      added: {},
      updated: { [id("a")]: [a0, a1] },
      removed: { [id("c")]: c0 },
    } as RecordsDiff<Item>
    const s = squashRecordDiffs([d1, d2])
    expect(s).toEqual({ added: { [id("a")]: a1 }, updated: {}, removed: { [id("b")]: b0 } })
    // inputs untouched
    expect(d1.added[id("c")]).toBe(c0)
  })
})
