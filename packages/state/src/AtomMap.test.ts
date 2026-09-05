import { describe, expect, it, vi } from "vitest"
import { AtomMap } from "./AtomMap"
import { computed, react } from "./index"

describe("AtomMap", () => {
	it("behaves like a Map", () => {
		const map = new AtomMap<string, number>("m", [
			["a", 1],
			["b", 2],
		])
		expect(map.get("a")).toBe(1)
		expect(map.has("b")).toBe(true)
		expect(map.has("c")).toBe(false)
		expect(map.get("c")).toBeUndefined()
		expect(map.size).toBe(2)
		expect(map.set("c", 3)).toBe(map)
		expect(map.size).toBe(3)
		expect(map.delete("a")).toBe(true)
		expect(map.delete("a")).toBe(false)
		expect([...map.keys()]).toEqual(["b", "c"])
		expect([...map.values()]).toEqual([2, 3])
		expect([...map]).toEqual([
			["b", 2],
			["c", 3],
		])
		map.clear()
		expect(map.size).toBe(0)
		expect([...map.entries()]).toEqual([])
	})

	it("forEach visits live entries with the map as the third argument", () => {
		const map = new AtomMap<string, number>("m", [["a", 1]])
		const seen: [number, string, unknown][] = []
		map.forEach((value, key, m) => seen.push([value, key, m]))
		expect(seen).toEqual([[1, "a", map]])
	})

	describe("getOrInsert", () => {
		it("returns the existing value without overwriting it", () => {
			const map = new AtomMap<string, number>("m", [["a", 1]])
			expect(map.getOrInsert("a", 99)).toBe(1)
			expect(map.get("a")).toBe(1)
		})

		it("inserts and returns the default when the key is absent", () => {
			const map = new AtomMap<string, number>("m")
			expect(map.getOrInsert("a", 7)).toBe(7)
			expect(map.get("a")).toBe(7)
			expect(map.size).toBe(1)
		})

		it("treats a stored undefined as present", () => {
			const map = new AtomMap<string, number | undefined>("m", [["a", undefined]])
			expect(map.getOrInsert("a", 5)).toBeUndefined()
		})

		it("refills a deleted key", () => {
			const map = new AtomMap<string, number>("m", [["a", 1]])
			map.delete("a")
			expect(map.getOrInsert("a", 2)).toBe(2)
			expect(map.size).toBe(1)
		})
	})

	describe("getOrInsertComputed", () => {
		it("does NOT run the callback when the key is present", () => {
			const map = new AtomMap<string, number>("m", [["a", 1]])
			const create = vi.fn(() => 99)
			expect(map.getOrInsertComputed("a", create)).toBe(1)
			expect(create).not.toHaveBeenCalled()
		})

		it("runs the callback exactly once when the key is absent", () => {
			const map = new AtomMap<string, number>("m")
			const create = vi.fn((key: string) => key.length)
			expect(map.getOrInsertComputed("abc", create)).toBe(3)
			expect(map.getOrInsertComputed("abc", create)).toBe(3)
			expect(create).toHaveBeenCalledTimes(1)
			expect(create).toHaveBeenCalledWith("abc")
		})
	})

	it("update replaces a value and refuses a missing key", () => {
		const map = new AtomMap<string, number>("m", [["a", 1]])
		expect(map.update("a", (n) => n + 1)).toBe(2)
		expect(map.get("a")).toBe(2)
		expect(() => map.update("nope", (n) => n)).toThrow(/no entry for nope/)
	})

	describe("reactivity", () => {
		it("a reader of one key is not woken by a write to another", () => {
			const map = new AtomMap<string, number>("m", [
				["a", 1],
				["b", 2],
			])
			const seen: (number | undefined)[] = []
			const stop = react("watch a", () => seen.push(map.get("a")))
			expect(seen).toEqual([1])
			map.set("b", 20)
			expect(seen).toEqual([1])
			map.set("a", 10)
			expect(seen).toEqual([1, 10])
			stop()
		})

		it("a miss is invalidated when the key later appears", () => {
			const map = new AtomMap<string, number>("m")
			const seen: (number | undefined)[] = []
			const stop = react("watch a", () => seen.push(map.get("a")))
			expect(seen).toEqual([undefined])
			map.set("a", 1)
			expect(seen).toEqual([undefined, 1])
			map.delete("a")
			expect(seen).toEqual([undefined, 1, undefined])
			stop()
		})

		it("size and iteration track inserts and deletes", () => {
			const map = new AtomMap<string, number>("m")
			const sizes: number[] = []
			const stop = react("watch size", () => sizes.push(map.size))
			expect(sizes).toEqual([0])
			map.set("a", 1)
			map.set("b", 2)
			expect(sizes).toEqual([0, 1, 2])
			map.delete("a")
			expect(sizes).toEqual([0, 1, 2, 1])
			stop()
		})

		it("clear wakes key readers once", () => {
			const map = new AtomMap<string, number>("m", [
				["a", 1],
				["b", 2],
			])
			const seen: number[] = []
			const stop = react("watch size", () => seen.push(map.size))
			map.clear()
			expect(seen).toEqual([2, 0])
			// A second clear changes nothing, so nothing is notified.
			map.clear()
			expect(seen).toEqual([2, 0])
			stop()
		})

		it("works as a dependency of a computed", () => {
			const map = new AtomMap<string, number>("m", [["a", 1]])
			const doubled = computed("doubled", () => (map.get("a") ?? 0) * 2)
			expect(doubled.get()).toBe(2)
			map.set("a", 5)
			expect(doubled.get()).toBe(10)
		})
	})
})
