import { afterEach, describe, expect, it, vi } from "vitest"
import {
	atom,
	computed,
	getComputedInstance,
	isUninitialized,
	localStorageAtom,
	whyAmIRunning,
} from "./core"
import { RESET_VALUE, withDiff } from "./diff"

describe("diff-carrying atoms", () => {
	it("answers getDiffSince with RESET_VALUE when it keeps no history", () => {
		const a = atom("a", 1)
		const before = a.lastChangedEpoch
		a.set(2)
		expect(a.getDiffSince(before)).toBe(RESET_VALUE)
	})

	it("returns an empty list when nothing changed since the epoch", () => {
		const a = atom("a", 1)
		expect(a.getDiffSince(a.lastChangedEpoch)).toEqual([])
	})

	it("records the diffs computeDiff produces, oldest first", () => {
		const a = atom<number, number>("a", 0, {
			historyLength: 10,
			computeDiff: (prev, next) => next - prev,
		})
		const start = a.lastChangedEpoch
		a.set(3)
		a.set(7)
		expect(a.getDiffSince(start)).toEqual([3, 4])
	})

	it("forgets diffs that fall out of the buffer", () => {
		const a = atom<number, number>("a", 0, {
			historyLength: 2,
			computeDiff: (prev, next) => next - prev,
		})
		const start = a.lastChangedEpoch
		a.set(1)
		a.set(2)
		a.set(3)
		expect(a.getDiffSince(start)).toBe(RESET_VALUE)
	})

	it("gives up on history when a change cannot be described", () => {
		const a = atom<number, number>("a", 0, {
			historyLength: 10,
			computeDiff: (prev, next) => (next > 100 ? RESET_VALUE : next - prev),
		})
		const start = a.lastChangedEpoch
		a.set(1)
		a.set(999)
		expect(a.getDiffSince(start)).toBe(RESET_VALUE)
	})
})

describe("diff-carrying computeds", () => {
	it("carries the diff a derivation returns with withDiff", () => {
		const source = atom("source", [1])
		const doubled = computed<number[], number[]>(
			"doubled",
			(prev) => {
				const next = source.get().map((n) => n * 2)
				if (isUninitialized(prev)) return next
				return withDiff(next, next.slice(prev.length))
			},
			{ historyLength: 10 },
		)
		expect(doubled.get()).toEqual([2])
		const epoch = doubled.lastChangedEpoch
		source.set([1, 2])
		expect(doubled.get()).toEqual([2, 4])
		expect(doubled.getDiffSince(epoch)).toEqual([[4]])
	})

	it("hands the derivation the epoch its previous value was produced at", () => {
		const source = atom<number, number>("source", 0, {
			historyLength: 10,
			computeDiff: (prev, next) => next - prev,
		})
		const seen: (number[] | typeof RESET_VALUE)[] = []
		const sum = computed<number>("sum", (prev, lastComputedEpoch) => {
			if (isUninitialized(prev)) {
				source.get()
				return 0
			}
			const diffs = source.getDiffSince(lastComputedEpoch)
			seen.push(diffs)
			if (diffs === RESET_VALUE) return source.get()
			return prev + diffs.reduce((a, b) => a + b, 0)
		})
		expect(sum.get()).toBe(0)
		source.set(5)
		expect(sum.get()).toBe(5)
		source.set(9)
		expect(sum.get()).toBe(9)
		expect(seen).toEqual([[5], [4]])
	})

	it("records no diff for the first computation", () => {
		const source = atom("source", 1)
		const c = computed<number, number>("c", () => source.get(), { historyLength: 4 })
		c.get()
		expect(c.getDiffSince(-1)).toBe(RESET_VALUE)
	})
})

describe("isUninitialized", () => {
	it("is true only for the marker", () => {
		expect(isUninitialized(undefined)).toBe(false)
		expect(isUninitialized(null)).toBe(false)
		const c = computed<boolean>("c", (prev) => isUninitialized(prev))
		expect(c.get()).toBe(true)
	})
})

describe("getComputedInstance", () => {
	it("returns the same computed for the same object and property", () => {
		const source = atom("source", 1)
		const object = {
			get doubled() {
				return source.get() * 2
			},
		}
		const first = getComputedInstance(object, "doubled")
		expect(getComputedInstance(object, "doubled")).toBe(first)
		expect(first.get()).toBe(2)
		source.set(4)
		expect(first.get()).toBe(8)
	})

	it("keeps separate instances per object", () => {
		const a = { value: 1 }
		const b = { value: 2 }
		expect(getComputedInstance(a, "value")).not.toBe(getComputedInstance(b, "value"))
	})
})

describe("whyAmIRunning", () => {
	it("names the dependency that changed", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {})
		const source = atom("thePalette", 1)
		const c = computed("theDerivation", () => {
			const value = source.get()
			whyAmIRunning()
			return value
		})
		c.get()
		source.set(2)
		c.get()
		const output = log.mock.calls.map((call) => String(call[0])).join("\n")
		expect(output).toContain("theDerivation is running because")
		expect(output).toContain("thePalette changed")
		log.mockRestore()
	})

	it("warns rather than throwing outside a tracked run", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		whyAmIRunning()
		expect(warn).toHaveBeenCalled()
		warn.mockRestore()
	})
})

describe("localStorageAtom", () => {
	/** The tests run in node, which has no `localStorage`; this is the whole contract. */
	function installFakeStorage(initial: Record<string, string> = {}): Map<string, string> {
		const entries = new Map(Object.entries(initial))
		const fake = {
			getItem: (key: string) => entries.get(key) ?? null,
			setItem: (key: string, value: string) => {
				entries.set(key, value)
			},
			removeItem: (key: string) => {
				entries.delete(key)
			},
		}
		vi.stubGlobal("localStorage", fake)
		return entries
	}

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it("reads an existing value and writes changes back", () => {
		const entries = installFakeStorage({ "mocanvas.test.pref": JSON.stringify("dark") })
		const a = localStorageAtom("mocanvas.test.pref", "light")
		expect(a.get()).toBe("dark")
		a.set("light")
		expect(JSON.parse(entries.get("mocanvas.test.pref")!)).toBe("light")
	})

	it("falls back to the default when the stored value is unreadable", () => {
		installFakeStorage({ "mocanvas.test.broken": "{not json" })
		expect(localStorageAtom("mocanvas.test.broken", 7).get()).toBe(7)
	})

	it("is an ordinary atom when there is no storage at all", () => {
		const a = localStorageAtom("mocanvas.test.none", 1)
		expect(a.get()).toBe(1)
		a.set(2)
		expect(a.get()).toBe(2)
	})
})
