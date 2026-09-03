import { describe, expect, it } from "vitest"
import { UNINITIALIZED, atom, computed, react, transact, unsafe__withoutCapture } from "./index"

describe("computed", () => {
	it("is lazy: does not evaluate until read", () => {
		const a = atom("a", 1)
		let evaluations = 0
		const c = computed("c", () => {
			evaluations++
			return a.get() * 2
		})
		expect(evaluations).toBe(0)
		expect(c.get()).toBe(2)
		expect(evaluations).toBe(1)
	})

	it("caches the value while dependencies are unchanged", () => {
		const a = atom("a", 1)
		const other = atom("other", 0)
		let evaluations = 0
		const c = computed("c", () => {
			evaluations++
			return a.get() + 1
		})
		c.get()
		c.get()
		c.get()
		expect(evaluations).toBe(1)
		other.set(5) // unrelated write
		expect(c.get()).toBe(2)
		expect(evaluations).toBe(1)
		a.set(2)
		expect(c.get()).toBe(3)
		expect(evaluations).toBe(2)
	})

	it("passes UNINITIALIZED on first evaluation and the previous value afterwards", () => {
		const a = atom("a", 1)
		const seen: unknown[] = []
		const c = computed<number>("c", (prev) => {
			seen.push(prev)
			return a.get()
		})
		c.get()
		a.set(2)
		c.get()
		expect(seen).toEqual([UNINITIALIZED, 1])
	})

	it("keeps lastChangedEpoch when the recomputed value is equal", () => {
		const a = atom("a", 1)
		let evaluations = 0
		let downstream = 0
		const parity = computed("parity", () => {
			evaluations++
			return a.get() % 2
		})
		const label = computed("label", () => {
			downstream++
			return parity.get() === 0 ? "even" : "odd"
		})
		expect(label.get()).toBe("odd")
		const epoch = parity.lastChangedEpoch
		a.set(3)
		expect(label.get()).toBe("odd")
		expect(evaluations).toBe(2)
		expect(downstream).toBe(1)
		expect(parity.lastChangedEpoch).toBe(epoch)
		a.set(4)
		expect(label.get()).toBe("even")
		expect(downstream).toBe(2)
		expect(parity.lastChangedEpoch).toBeGreaterThan(epoch)
	})

	it("supports a custom isEqual", () => {
		const a = atom("a", [1, 2, 3])
		let downstream = 0
		const sorted = computed("sorted", () => [...a.get()].sort(), {
			isEqual: (x, y) => x.length === y.length && x.every((v, i) => v === y[i]),
		})
		const joined = computed("joined", () => {
			downstream++
			return sorted.get().join(",")
		})
		expect(joined.get()).toBe("1,2,3")
		a.set([3, 2, 1])
		expect(joined.get()).toBe("1,2,3")
		expect(downstream).toBe(1)
	})

	it("switches dependencies dynamically", () => {
		const useFirst = atom("useFirst", true)
		const first = atom("first", "a")
		const second = atom("second", "b")
		let evaluations = 0
		const picked = computed("picked", () => {
			evaluations++
			return useFirst.get() ? first.get() : second.get()
		})
		const values: string[] = []
		const stop = react("r", () => values.push(picked.get()))
		expect(values).toEqual(["a"])

		second.set("b2") // not a dependency yet
		expect(evaluations).toBe(1)
		expect(values).toEqual(["a"])

		useFirst.set(false)
		expect(values).toEqual(["a", "b2"])
		expect(evaluations).toBe(2)

		first.set("a2") // no longer a dependency
		expect(evaluations).toBe(2)
		expect(values).toEqual(["a", "b2"])

		second.set("b3")
		expect(values).toEqual(["a", "b2", "b3"])
		stop()
	})

	it("resolves a diamond without glitches or duplicate evaluations", () => {
		const a = atom("a", 1)
		const counts = { b: 0, c: 0, d: 0 }
		const b = computed("b", () => {
			counts.b++
			return a.get() + 1
		})
		const c = computed("c", () => {
			counts.c++
			return a.get() * 10
		})
		const d = computed("d", () => {
			counts.d++
			return { b: b.get(), c: c.get(), a: a.get() }
		})
		const observed: Array<{ b: number; c: number; a: number }> = []
		const stop = react("r", () => observed.push(d.get()))

		a.set(2)
		a.set(3)

		expect(observed).toEqual([
			{ b: 2, c: 10, a: 1 },
			{ b: 3, c: 20, a: 2 },
			{ b: 4, c: 30, a: 3 },
		])
		expect(counts).toEqual({ b: 3, c: 3, d: 3 })
		stop()
	})

	it("is never observed in an inconsistent state inside a reaction", () => {
		const x = atom("x", 0)
		const y = atom("y", 0)
		const sum = computed("sum", () => x.get() + y.get())
		const diff = computed("diff", () => x.get() - y.get())
		const checks: string[] = []
		const stop = react("r", () => {
			// With x === y both must agree.
			checks.push(`${sum.get()}/${diff.get()}`)
		})
		transact(() => {
			x.set(5)
			y.set(5)
		})
		expect(checks).toEqual(["0/0", "10/0"])
		stop()
	})

	it("works through deep chains with a live observer", () => {
		const a = atom("a", 0)
		let chain = computed("c0", () => a.get())
		const evaluations: number[] = []
		for (let i = 1; i <= 20; i++) {
			const prev = chain
			const idx = i
			evaluations[idx] = 0
			chain = computed(`c${i}`, () => {
				evaluations[idx]!++
				return prev.get() + 1
			})
		}
		const results: number[] = []
		const stop = react("r", () => results.push(chain.get()))
		expect(results).toEqual([20])
		a.set(1)
		a.set(2)
		expect(results).toEqual([20, 21, 22])
		expect(evaluations.slice(1).every((n) => n === 3)).toBe(true)
		stop()
	})

	it("stays correct after its observers go away and come back", () => {
		const a = atom("a", 1)
		const c = computed("c", () => a.get() * 2)
		const stop = react("r", () => c.get())
		a.set(2)
		stop()
		a.set(3)
		expect(c.get()).toBe(6)
		a.set(4)
		const values: number[] = []
		const stop2 = react("r2", () => values.push(c.get()))
		a.set(5)
		expect(values).toEqual([8, 10])
		stop2()
	})

	it("recomputes only the affected branch when a live observer reads several computeds", () => {
		const a = atom("a", 1)
		const b = atom("b", 1)
		const counts = { ca: 0, cb: 0 }
		const ca = computed("ca", () => {
			counts.ca++
			return a.get()
		})
		const cb = computed("cb", () => {
			counts.cb++
			return b.get()
		})
		const stop = react("r", () => {
			ca.get()
			cb.get()
		})
		a.set(2)
		a.set(3)
		expect(counts).toEqual({ ca: 3, cb: 1 })
		b.set(2)
		expect(counts).toEqual({ ca: 3, cb: 2 })
		stop()
	})

	it("detects cycles", () => {
		let self: ReturnType<typeof computed<number>>
		self = computed<number>("self", () => self.get() + 1)
		expect(() => self.get()).toThrow(/Cycle detected/)
	})

	it("propagates errors and retries on the next read", () => {
		const a = atom("a", 0)
		const c = computed("c", () => {
			if (a.get() === 0) throw new Error("zero")
			return 1 / a.get()
		})
		expect(() => c.get()).toThrow("zero")
		expect(() => c.get()).toThrow("zero")
		a.set(2)
		expect(c.get()).toBe(0.5)
	})

	it("ignores reads made inside unsafe__withoutCapture", () => {
		const tracked = atom("tracked", 1)
		const untracked = atom("untracked", 100)
		let evaluations = 0
		const c = computed("c", () => {
			evaluations++
			return tracked.get() + unsafe__withoutCapture(() => untracked.get())
		})
		const stop = react("r", () => c.get())
		expect(evaluations).toBe(1)
		untracked.set(200)
		expect(evaluations).toBe(1)
		expect(c.get()).toBe(101) // stale by design
		tracked.set(2)
		expect(c.get()).toBe(202)
		expect(evaluations).toBe(2)
		stop()
	})

	it("can be read inside a transaction and sees intermediate values", () => {
		const a = atom("a", 1)
		const c = computed("c", () => a.get() * 2)
		transact(() => {
			a.set(2)
			expect(c.get()).toBe(4)
			a.set(3)
			expect(c.get()).toBe(6)
		})
		expect(c.get()).toBe(6)
	})
})
