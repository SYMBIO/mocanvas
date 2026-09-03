import { describe, expect, it } from "vitest"
import { atom, computed, react, transact, transaction } from "./index"

describe("transact", () => {
	it("returns the callback's result", () => {
		expect(transact(() => 42)).toBe(42)
	})

	it("defers reactions until the outermost transaction commits", () => {
		const a = atom("a", 0)
		const b = atom("b", 0)
		let runs = 0
		const stop = react("r", () => {
			a.get()
			b.get()
			runs++
		})
		transact(() => {
			a.set(1)
			transact(() => {
				b.set(1)
				expect(runs).toBe(1)
			})
			expect(runs).toBe(1)
			a.set(2)
		})
		expect(runs).toBe(2)
		stop()
	})

	it("exposes written values to reads inside the transaction", () => {
		const a = atom("a", 0)
		transact(() => {
			a.set(1)
			expect(a.get()).toBe(1)
		})
	})

	it("rolls back and rethrows when the callback throws", () => {
		const a = atom("a", 0)
		let runs = 0
		const stop = react("r", () => {
			a.get()
			runs++
		})
		expect(() =>
			transact(() => {
				a.set(1)
				throw new Error("nope")
			})
		).toThrow("nope")
		expect(a.get()).toBe(0)
		// The rollback is itself a write, so dependents may run once more, but
		// they only ever observe the restored value.
		expect(runs).toBeLessThanOrEqual(2)
		stop()
	})

	it("leaves an outer transaction usable after an inner one throws", () => {
		const a = atom("a", 0)
		const b = atom("b", 0)
		transact(() => {
			a.set(1)
			try {
				transact(() => {
					b.set(1)
					throw new Error("inner")
				})
			} catch {
				// swallowed
			}
			expect(b.get()).toBe(0)
			expect(a.get()).toBe(1)
		})
		expect(a.get()).toBe(1)
		expect(b.get()).toBe(0)
	})
})

describe("transaction", () => {
	it("rollback restores every atom written in the transaction", () => {
		const a = atom("a", 1)
		const b = atom("b", "x")
		const c = computed("c", () => `${a.get()}${b.get()}`)
		transaction((rollback) => {
			a.set(2)
			a.set(3)
			b.set("y")
			expect(c.get()).toBe("3y")
			rollback()
			expect(a.get()).toBe(1)
			expect(b.get()).toBe("x")
			expect(c.get()).toBe("1x")
		})
		expect(a.get()).toBe(1)
		expect(b.get()).toBe("x")
	})

	it("keeps writes made after a rollback", () => {
		const a = atom("a", 1)
		transaction((rollback) => {
			a.set(2)
			rollback()
			a.set(3)
		})
		expect(a.get()).toBe(3)
	})

	it("rollback in a nested transaction only affects its own writes", () => {
		const outer = atom("outer", 0)
		const inner = atom("inner", 0)
		transaction(() => {
			outer.set(1)
			transaction((rollback) => {
				inner.set(1)
				outer.set(2)
				rollback()
			})
			expect(outer.get()).toBe(1)
			expect(inner.get()).toBe(0)
		})
		expect(outer.get()).toBe(1)
		expect(inner.get()).toBe(0)
	})

	it("an outer rollback undoes committed nested writes", () => {
		const a = atom("a", 0)
		const b = atom("b", 0)
		transaction((rollback) => {
			a.set(1)
			transact(() => b.set(1))
			rollback()
		})
		expect(a.get()).toBe(0)
		expect(b.get()).toBe(0)
	})

	it("runs reactions at most once after a rolled back transaction and they see restored values", () => {
		const a = atom("a", 0)
		const seen: number[] = []
		const stop = react("r", () => seen.push(a.get()))
		transaction((rollback) => {
			a.set(1)
			a.set(2)
			rollback()
		})
		expect(seen.length).toBeLessThanOrEqual(2)
		expect(seen.every((v) => v === 0)).toBe(true)
		stop()
	})

	it("throws if rollback is called after the transaction ended", () => {
		let escaped: (() => void) | null = null
		transaction((rollback) => {
			escaped = rollback
		})
		expect(() => escaped!()).toThrow(/already ended/)
	})

	it("returns the callback's result", () => {
		expect(transaction(() => "done")).toBe("done")
	})

	it("rollback restores atoms with custom equality without spurious writes", () => {
		const a = atom("a", { v: 1 }, { isEqual: (x, y) => x.v === y.v })
		const original = a.get()
		const epochBefore = a.lastChangedEpoch
		transaction((rollback) => {
			a.set({ v: 2 })
			a.set({ v: 1 }) // back to an equal value before rollback
			rollback()
		})
		expect(a.get().v).toBe(1)
		expect(a.get()).not.toBe(original) // the equal object written later is kept
		expect(a.lastChangedEpoch).toBeGreaterThan(epochBefore)
	})
})
