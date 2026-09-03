import { describe, expect, it } from "vitest"
import { atom, computed, react, reactor, transact, unsafe__withoutCapture } from "./index"

describe("react", () => {
	it("runs immediately and re-runs when a dependency changes", () => {
		const a = atom("a", 1)
		const seen: number[] = []
		const stop = react("r", () => seen.push(a.get()))
		expect(seen).toEqual([1])
		a.set(2)
		expect(seen).toEqual([1, 2])
		stop()
	})

	it("stops re-running once disposed", () => {
		const a = atom("a", 1)
		let runs = 0
		const stop = react("r", () => {
			a.get()
			runs++
		})
		stop()
		a.set(2)
		expect(runs).toBe(1)
		stop() // idempotent
	})

	it("does not re-run when a computed dependency recomputes to an equal value", () => {
		const a = atom("a", 1)
		const sign = computed("sign", () => Math.sign(a.get()))
		let runs = 0
		const stop = react("r", () => {
			sign.get()
			runs++
		})
		a.set(2)
		a.set(3)
		expect(runs).toBe(1)
		a.set(-1)
		expect(runs).toBe(2)
		stop()
	})

	it("runs exactly once for several atoms written in one transaction, seeing all new values", () => {
		const x = atom("x", 0)
		const y = atom("y", 0)
		const seen: Array<[number, number]> = []
		const stop = react("r", () => seen.push([x.get(), y.get()]))
		transact(() => {
			x.set(1)
			y.set(2)
			expect(seen).toHaveLength(1)
		})
		expect(seen).toEqual([
			[0, 0],
			[1, 2],
		])
		stop()
	})

	it("tracks dependencies dynamically", () => {
		const flag = atom("flag", true)
		const a = atom("a", "a")
		const b = atom("b", "b")
		let runs = 0
		const stop = react("r", () => {
			runs++
			if (flag.get()) a.get()
			else b.get()
		})
		b.set("b2")
		expect(runs).toBe(1)
		flag.set(false)
		expect(runs).toBe(2)
		a.set("a2")
		expect(runs).toBe(2)
		b.set("b3")
		expect(runs).toBe(3)
		stop()
	})

	it("does not depend on signals read inside unsafe__withoutCapture", () => {
		const a = atom("a", 1)
		const b = atom("b", 1)
		let runs = 0
		const stop = react("r", () => {
			runs++
			a.get()
			unsafe__withoutCapture(() => b.get())
		})
		b.set(2)
		expect(runs).toBe(1)
		a.set(2)
		expect(runs).toBe(2)
		stop()
	})

	it("batches writes made inside a reaction so dependents run once", () => {
		const trigger = atom("trigger", 0)
		const x = atom("x", 0)
		const y = atom("y", 0)
		const seen: Array<[number, number]> = []
		const stopWriter = react("writer", () => {
			const t = trigger.get()
			x.set(t)
			y.set(t * 2)
		})
		const stopReader = react("reader", () => seen.push([x.get(), y.get()]))
		trigger.set(1)
		expect(seen).toEqual([
			[0, 0],
			[1, 2],
		])
		stopWriter()
		stopReader()
	})

	it("lets a reaction chain through another reaction's writes without extra runs", () => {
		const a = atom("a", 0)
		const b = atom("b", 0)
		const runsB: number[] = []
		const stopA = react("a->b", () => b.set(a.get() + 1))
		const stopB = react("b", () => runsB.push(b.get()))
		a.set(1)
		a.set(2)
		expect(runsB).toEqual([1, 2, 3])
		stopA()
		stopB()
	})

	it("uses scheduleEffect for re-runs, deduplicating pending executions", () => {
		const a = atom("a", 0)
		const queue: Array<() => void> = []
		const seen: number[] = []
		const stop = react("r", () => seen.push(a.get()), { scheduleEffect: (execute) => queue.push(execute) })
		expect(seen).toEqual([0]) // first run is synchronous
		a.set(1)
		a.set(2)
		expect(queue).toHaveLength(1)
		expect(seen).toEqual([0])
		queue.shift()!()
		expect(seen).toEqual([0, 2])
		a.set(2)
		expect(queue).toHaveLength(0)
		a.set(3)
		stop()
		queue.shift()!() // scheduled before stop; must be a no-op now
		expect(seen).toEqual([0, 2])
	})

	it("skips a scheduled execution if the dependency went back to its old value", () => {
		const a = atom("a", 0)
		const sign = computed("sign", () => Math.sign(a.get()))
		const queue: Array<() => void> = []
		let runs = 0
		const stop = react(
			"r",
			() => {
				sign.get()
				runs++
			},
			{ scheduleEffect: (execute) => queue.push(execute) }
		)
		a.set(5)
		a.set(0)
		queue.shift()!()
		expect(runs).toBe(1)
		stop()
	})

	it("continues running other reactions when one throws, then rethrows", () => {
		const a = atom("a", 0)
		let goodRuns = 0
		const stopBad = react("bad", () => {
			if (a.get() > 0) throw new Error("boom")
		})
		const stopGood = react("good", () => {
			a.get()
			goodRuns++
		})
		expect(() => a.set(1)).toThrow("boom")
		expect(goodRuns).toBe(2)
		stopBad()
		stopGood()
	})

	it("rolls back writes made by a reaction that throws", () => {
		const trigger = atom("trigger", 0)
		const out = atom("out", "initial")
		const stop = react("r", () => {
			const t = trigger.get()
			if (t === 0) return
			out.set("partial")
			throw new Error("fail")
		})
		expect(() => trigger.set(1)).toThrow("fail")
		expect(out.get()).toBe("initial")
		stop()
	})

	it("does not observe its own first-run writes as a dependency change", () => {
		const a = atom("a", 0)
		let runs = 0
		const stop = react("r", () => {
			runs++
			a.set(a.get() + 1)
		})
		expect(runs).toBe(1)
		expect(a.get()).toBe(1)
		stop()
	})

	it("detects reactions that endlessly invalidate themselves", () => {
		const a = atom("a", 0)
		const stop = react("loop", () => {
			a.get()
			a.update((v) => v + 1)
		})
		expect(() => a.set(100)).toThrow(/Reaction loop/)
		stop()
		// The runtime is usable afterwards.
		const b = atom("b", 0)
		const seen: number[] = []
		const stopB = react("b", () => seen.push(b.get()))
		b.set(1)
		expect(seen).toEqual([0, 1])
		stopB()
	})
})

describe("reactor", () => {
	it("does nothing until started and stops cleanly", () => {
		const a = atom("a", 1)
		const seen: number[] = []
		const r = reactor("r", () => seen.push(a.get()))
		expect(seen).toEqual([])
		expect(r.scheduler.isActive).toBe(false)
		r.start()
		expect(seen).toEqual([1])
		expect(r.scheduler.isActive).toBe(true)
		a.set(2)
		expect(seen).toEqual([1, 2])
		r.stop()
		a.set(3)
		expect(seen).toEqual([1, 2])
		r.start()
		expect(seen).toEqual([1, 2, 3])
		r.stop()
	})

	it("ignores repeated start calls", () => {
		const a = atom("a", 1)
		let runs = 0
		const r = reactor("r", () => {
			a.get()
			runs++
		})
		r.start()
		r.start()
		expect(runs).toBe(1)
		r.stop()
	})

	it("exposes the scheduler so effects can be pulled manually", () => {
		const a = atom("a", 1)
		let runs = 0
		const queue: Array<() => void> = []
		const r = reactor(
			"r",
			() => {
				a.get()
				runs++
			},
			{ scheduleEffect: (execute) => queue.push(execute) }
		)
		r.start()
		a.set(2)
		expect(runs).toBe(1)
		r.scheduler.execute()
		expect(runs).toBe(2)
		r.scheduler.execute() // nothing changed
		expect(runs).toBe(2)
		queue.shift()!() // the queued execution has nothing left to do
		expect(runs).toBe(2)
		r.stop()
	})
})
