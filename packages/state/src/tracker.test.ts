import { describe, expect, it } from "vitest"
import { RenderTracker, atom, computed, subscribeToSignal, transact } from "./index"

/**
 * These tests exercise the primitives behind the React hooks without a DOM:
 * `subscribeToSignal` powers `useValue`, and `RenderTracker` powers `track`
 * via `useSyncExternalStore` (render -> subscribe -> change -> re-render).
 */

describe("subscribeToSignal", () => {
	it("does not fire on subscribe, fires on each change, stops on unsubscribe", () => {
		const a = atom("a", 0)
		let calls = 0
		const unsubscribe = subscribeToSignal(a, () => calls++)
		expect(calls).toBe(0)
		a.set(1)
		expect(calls).toBe(1)
		transact(() => {
			a.set(2)
			a.set(3)
		})
		expect(calls).toBe(2)
		unsubscribe()
		a.set(4)
		expect(calls).toBe(2)
	})

	it("only fires when a computed's value really changes", () => {
		const a = atom("a", 1)
		const positive = computed("positive", () => a.get() > 0)
		let calls = 0
		const unsubscribe = subscribeToSignal(positive, () => calls++)
		a.set(2)
		expect(calls).toBe(0)
		a.set(-1)
		expect(calls).toBe(1)
		unsubscribe()
	})
})

describe("RenderTracker", () => {
	function renderWith(tracker: RenderTracker, fn: () => unknown) {
		return tracker.track((f: () => unknown) => f(), fn, undefined)
	}

	it("captures dependencies during a tracked run and notifies after subscribing", () => {
		const a = atom("a", 1)
		const tracker = new RenderTracker("Component")
		let notified = 0

		expect(renderWith(tracker, () => a.get())).toBe(1)
		const v0 = tracker.getSnapshot()

		const unsubscribe = tracker.subscribe(() => notified++)
		expect(notified).toBe(0)
		expect(tracker.getSnapshot()).toBe(v0)

		a.set(2)
		expect(notified).toBe(1)
		expect(tracker.getSnapshot()).toBe(v0 + 1)

		unsubscribe()
		a.set(3)
		expect(notified).toBe(1)
	})

	it("does not attach to the graph before subscribing (discarded renders leak nothing)", () => {
		const a = atom("a", 1)
		const tracker = new RenderTracker("Component")
		renderWith(tracker, () => a.get())
		let notified = 0
		// Never subscribed: a change must not reach the tracker.
		a.set(2)
		expect(notified).toBe(0)
		expect((a as unknown as { children: Set<unknown> }).children.size).toBe(0)
		tracker.subscribe(() => notified++)
		expect((a as unknown as { children: Set<unknown> }).children.size).toBe(1)
		tracker.unsubscribe()
		expect((a as unknown as { children: Set<unknown> }).children.size).toBe(0)
	})

	it("reports changes that happened between the render and the subscription", () => {
		const a = atom("a", 1)
		const tracker = new RenderTracker("Component")
		renderWith(tracker, () => a.get())
		const v0 = tracker.getSnapshot()
		a.set(2)
		let notified = 0
		tracker.subscribe(() => notified++)
		expect(notified).toBe(1)
		expect(tracker.getSnapshot()).toBe(v0 + 1)
		tracker.unsubscribe()
	})

	it("survives strict-mode style unsubscribe/resubscribe without a re-render", () => {
		const a = atom("a", 1)
		const tracker = new RenderTracker("Component")
		renderWith(tracker, () => a.get())
		let notified = 0
		const unsubscribe = tracker.subscribe(() => notified++)
		unsubscribe()
		tracker.subscribe(() => notified++)
		a.set(2)
		expect(notified).toBe(1)
		tracker.unsubscribe()
	})

	it("re-diffs dependencies on every tracked run while subscribed", () => {
		const flag = atom("flag", true)
		const a = atom("a", "a")
		const b = atom("b", "b")
		const tracker = new RenderTracker("Component")
		const render = () => (flag.get() ? a.get() : b.get())
		let notified = 0
		renderWith(tracker, render)
		tracker.subscribe(() => notified++)

		b.set("b2")
		expect(notified).toBe(0)

		flag.set(false)
		expect(notified).toBe(1)
		renderWith(tracker, render) // the host re-renders in response

		a.set("a2")
		expect(notified).toBe(1)
		b.set("b3")
		expect(notified).toBe(2)
		tracker.unsubscribe()
		expect((a as unknown as { children: Set<unknown> }).children.size).toBe(0)
		expect((b as unknown as { children: Set<unknown> }).children.size).toBe(0)
	})

	it("ignores equal computed results and batches transactions into one notification", () => {
		const a = atom("a", 1)
		const b = atom("b", 1)
		const even = computed("even", () => a.get() % 2 === 0)
		const tracker = new RenderTracker("Component")
		let notified = 0
		renderWith(tracker, () => [even.get(), b.get()])
		tracker.subscribe(() => notified++)
		a.set(3)
		expect(notified).toBe(0)
		transact(() => {
			a.set(4)
			b.set(2)
		})
		expect(notified).toBe(1)
		tracker.unsubscribe()
	})

	it("passes the render arguments through and returns the render result", () => {
		const tracker = new RenderTracker("Component")
		const result = tracker.track((props: { n: number }, ref: string) => `${props.n}:${ref}`, { n: 7 }, "ref")
		expect(result).toBe("7:ref")
	})
})
