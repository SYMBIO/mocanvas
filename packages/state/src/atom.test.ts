import { describe, expect, it } from "vitest"
import {
	EMPTY_ARRAY,
	UNINITIALIZED,
	atom,
	computed,
	getGlobalEpoch,
	isAtom,
	isComputed,
	isSignal,
	react,
} from "./index"

describe("atom", () => {
	it("stores and returns values", () => {
		const a = atom("a", 1)
		expect(a.name).toBe("a")
		expect(a.get()).toBe(1)
		expect(a.set(2)).toBe(2)
		expect(a.get()).toBe(2)
	})

	it("update derives the next value from the previous one", () => {
		const a = atom("a", 10)
		expect(a.update((prev) => prev * 2)).toBe(20)
		expect(a.get()).toBe(20)
	})

	it("advances the global epoch and lastChangedEpoch on every change", () => {
		const a = atom("a", 0)
		const before = getGlobalEpoch()
		expect(a.lastChangedEpoch).toBeLessThanOrEqual(before)
		a.set(1)
		expect(getGlobalEpoch()).toBe(before + 1)
		expect(a.lastChangedEpoch).toBe(before + 1)
		a.set(2)
		expect(a.lastChangedEpoch).toBe(before + 2)
	})

	it("ignores writes of an equal value", () => {
		const a = atom("a", 1)
		const epoch = a.lastChangedEpoch
		const global = getGlobalEpoch()
		let runs = 0
		const stop = react("r", () => {
			a.get()
			runs++
		})
		a.set(1)
		expect(a.lastChangedEpoch).toBe(epoch)
		expect(getGlobalEpoch()).toBe(global)
		expect(runs).toBe(1)
		stop()
	})

	it("uses Object.is by default so NaN is stable", () => {
		const a = atom("a", NaN)
		const epoch = a.lastChangedEpoch
		a.set(NaN)
		expect(a.lastChangedEpoch).toBe(epoch)
	})

	it("honours a custom isEqual", () => {
		const a = atom("point", { x: 1, y: 2 }, { isEqual: (p, q) => p.x === q.x && p.y === q.y })
		const first = a.get()
		let runs = 0
		const stop = react("r", () => {
			a.get()
			runs++
		})
		a.set({ x: 1, y: 2 })
		expect(a.get()).toBe(first)
		expect(runs).toBe(1)
		a.set({ x: 2, y: 2 })
		expect(a.get()).not.toBe(first)
		expect(runs).toBe(2)
		stop()
	})

	it("returns the existing value when the write is a no-op", () => {
		const list = [1]
		const a = atom("a", list, { isEqual: (x, y) => x.length === y.length })
		expect(a.set([2])).toBe(list)
	})
})

describe("type guards and constants", () => {
	it("identifies atoms and computeds", () => {
		const a = atom("a", 1)
		const c = computed("c", () => a.get())
		expect(isSignal(a)).toBe(true)
		expect(isSignal(c)).toBe(true)
		expect(isAtom(a)).toBe(true)
		expect(isAtom(c)).toBe(false)
		expect(isComputed(c)).toBe(true)
		expect(isComputed(a)).toBe(false)
		expect(isSignal({ get: () => 1, name: "fake", lastChangedEpoch: 0 })).toBe(false)
		expect(isSignal(null)).toBe(false)
		expect(isSignal(undefined)).toBe(false)
	})

	it("exposes a frozen EMPTY_ARRAY and a unique UNINITIALIZED symbol", () => {
		expect(Object.isFrozen(EMPTY_ARRAY)).toBe(true)
		expect(EMPTY_ARRAY.length).toBe(0)
		expect(typeof UNINITIALIZED).toBe("symbol")
	})
})
