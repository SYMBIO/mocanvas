import { describe, expect, it, vi } from "vitest"
import { AtomSet } from "./AtomSet"
import { AtomMap } from "./AtomMap"
import { react } from "./index"

describe("AtomSet", () => {
	it("behaves like a Set", () => {
		const set = new AtomSet<string>("s", ["a", "b"])
		expect(set.size).toBe(2)
		expect(set.has("a")).toBe(true)
		expect(set.has("z")).toBe(false)
		expect(set.add("c")).toBe(set)
		expect([...set]).toEqual(["a", "b", "c"])
		expect([...set.entries()]).toEqual([
			["a", "a"],
			["b", "b"],
			["c", "c"],
		])
		expect(set.delete("a")).toBe(true)
		expect(set.delete("a")).toBe(false)
		expect([...set.values()]).toEqual(["b", "c"])
		set.clear()
		expect(set.size).toBe(0)
	})

	it("visits every member with forEach", () => {
		const set = new AtomSet<string>("s", ["a", "b"])
		const seen: string[] = []
		set.forEach((value, value2, self) => {
			expect(value2).toBe(value)
			expect(self).toBe(set)
			seen.push(value)
		})
		expect(seen).toEqual(["a", "b"])
	})

	it("wakes a reader of one member only when that member changes", () => {
		const set = new AtomSet<string>("s", ["a"])
		const run = vi.fn()
		const stop = react("has-a", () => {
			set.has("a")
			run()
		})
		expect(run).toHaveBeenCalledTimes(1)

		// An unrelated member: the reader must not wake.
		set.add("b")
		expect(run).toHaveBeenCalledTimes(1)

		set.delete("a")
		expect(run).toHaveBeenCalledTimes(2)
		stop()
	})

	it("wakes a reader that was watching a member added later", () => {
		const set = new AtomSet<string>("s")
		const run = vi.fn()
		const stop = react("has-a", () => {
			set.has("a")
			run()
		})
		expect(run).toHaveBeenCalledTimes(1)
		set.add("a")
		expect(run).toHaveBeenCalledTimes(2)
		stop()
	})

	it("wakes a reader of the set's shape once per membership change", () => {
		const set = new AtomSet<string>("s")
		const sizes: number[] = []
		const stop = react("size", () => sizes.push(set.size))
		set.add("a")
		set.add("a")
		expect(sizes).toEqual([0, 1])
		stop()
	})

	it("identifies itself", () => {
		expect(Object.prototype.toString.call(new AtomSet("s"))).toBe("[object AtomSet]")
	})
})

describe("AtomMap.deleteMany", () => {
	it("returns the entries that were there", () => {
		const map = new AtomMap<string, number>("m", [
			["a", 1],
			["b", 2],
		])
		expect(map.deleteMany(["a", "missing"])).toEqual([["a", 1]])
		expect([...map.keys()]).toEqual(["b"])
	})

	it("wakes a reader of the map's shape once, not once per key", () => {
		const map = new AtomMap<string, number>("m", [
			["a", 1],
			["b", 2],
			["c", 3],
		])
		const sizes: number[] = []
		const stop = react("size", () => sizes.push(map.size))
		map.deleteMany(["a", "b", "c"])
		expect(sizes).toEqual([3, 0])
		stop()
	})

	it("does nothing, and wakes nobody, when no key was present", () => {
		const map = new AtomMap<string, number>("m", [["a", 1]])
		const sizes: number[] = []
		const stop = react("size", () => sizes.push(map.size))
		expect(map.deleteMany(["x", "y"])).toEqual([])
		expect(sizes).toEqual([1])
		stop()
	})

	it("identifies itself", () => {
		expect(Object.prototype.toString.call(new AtomMap("m"))).toBe("[object AtomMap]")
	})
})
