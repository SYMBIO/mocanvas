import { forwardRef, memo, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import type { ComponentType, ForwardedRef, ReactNode } from "react"
import {
	EMPTY_ARRAY,
	RenderTracker,
	atom,
	computed,
	getWithoutCapture,
	reactor,
	subscribeToSignal,
} from "./core"
import type { Atom, Computed, ComputedOptions, Signal } from "./core"

// ---------------------------------------------------------------------------
// Reading signals
// ---------------------------------------------------------------------------

interface SignalStore<T> {
	subscribe(onChange: () => void): () => void
	getSnapshot(): T
}

function useSignalStore<T>(signal: Signal<T>): SignalStore<T> {
	return useMemo<SignalStore<T>>(
		() => ({
			subscribe: (onChange) => subscribeToSignal(signal, onChange),
			// Reads must not be captured by an enclosing tracked render; the
			// subscription above already re-renders this component.
			getSnapshot: () => getWithoutCapture(signal),
		}),
		[signal]
	)
}

/**
 * Subscribes the component to a signal and returns its current value.
 * The three-argument form creates an inline computed that is recreated when
 * `deps` change.
 */
export function useValue<T>(signal: Signal<T>): T
export function useValue<T>(name: string, fn: () => T, deps: unknown[]): T
export function useValue<T>(
	nameOrSignal: string | Signal<T>,
	fn?: () => T,
	deps: unknown[] = EMPTY_ARRAY as unknown as unknown[]
): T {
	const isInline = typeof nameOrSignal === "string"
	const signal = useMemo<Signal<T>>(
		() => (isInline ? computed(nameOrSignal as string, fn as () => T) : (nameOrSignal as Signal<T>)),
		// The dependency list shape is stable per call site.
		isInline ? deps : [nameOrSignal]
	)
	const store = useSignalStore(signal)
	return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

// ---------------------------------------------------------------------------
// Creating signals
// ---------------------------------------------------------------------------

/** Creates an atom once for the lifetime of the component. */
export function useAtom<T>(name: string, initialValue: T | (() => T)): Atom<T> {
	const [value] = useState(() =>
		atom(
			name,
			typeof initialValue === "function" ? (initialValue as () => T)() : initialValue
		)
	)
	return value
}

/** Creates a computed, recreated whenever `deps` change. */
export function useComputed<T>(name: string, fn: () => T, deps: unknown[]): Computed<T>
export function useComputed<T>(
	name: string,
	fn: () => T,
	options: ComputedOptions<T>,
	deps: unknown[]
): Computed<T>
export function useComputed<T>(
	name: string,
	fn: () => T,
	optionsOrDeps: ComputedOptions<T> | unknown[],
	maybeDeps?: unknown[]
): Computed<T> {
	const hasOptions = !Array.isArray(optionsOrDeps)
	const options = hasOptions ? (optionsOrDeps as ComputedOptions<T>) : undefined
	const deps = hasOptions ? (maybeDeps ?? (EMPTY_ARRAY as unknown as unknown[])) : optionsOrDeps
	return useMemo(() => computed(name, fn, options), deps)
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function scheduleOnNextFrame(execute: () => void): void {
	if (typeof requestAnimationFrame === "function") requestAnimationFrame(execute)
	else setTimeout(execute, 0)
}

/**
 * Runs `fn` as a reaction for the lifetime of the component (or until `deps`
 * change). Re-runs are batched to the next animation frame.
 */
export function useReactor(name: string, fn: () => void, deps: unknown[]): void {
	useEffect(() => {
		const r = reactor(name, fn, { scheduleEffect: scheduleOnNextFrame })
		r.start()
		return () => r.stop()
	}, deps)
}

/** Like `useReactor` but re-runs synchronously as soon as a dependency changes. */
export function useQuickReactor(name: string, fn: () => void, deps: unknown[]): void {
	useEffect(() => {
		const r = reactor(name, fn)
		r.start()
		return () => r.stop()
	}, deps)
}

// ---------------------------------------------------------------------------
// Tracked components
// ---------------------------------------------------------------------------

const REACT_MEMO_TYPE = Symbol.for("react.memo")
const REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref")

type RenderFn<P> = (props: P, ref: ForwardedRef<unknown>) => ReactNode

function useTrackedRender<P>(name: string, render: RenderFn<P>, props: P, ref: ForwardedRef<unknown>): ReactNode {
	const [tracker] = useState(() => new RenderTracker(name))
	useSyncExternalStore(tracker.subscribe, tracker.getSnapshot, tracker.getSnapshot)
	return tracker.track(render, props, ref)
}

/**
 * Run `render` with signal tracking on, and re-render the calling component
 * whenever anything it read changes.
 *
 * This is the hook {@link track} is built from, exposed for the cases the
 * wrapper cannot cover: a component that only wants part of its body tracked,
 * a class component's render delegate, or a render function received as a
 * prop, where there is no component to wrap.
 *
 * ```tsx
 * function Panel({ shape }: { shape: TLShape }) {
 *   return useStateTracking("Panel", () => <span>{editor.getShapePageBounds(shape)?.w}</span>)
 * }
 * ```
 *
 * The name is for debugging only; it shows up in {@link whyAmIRunning} output.
 */
export function useStateTracking<T>(name: string, render: () => T): T {
	const [tracker] = useState(() => new RenderTracker(name))
	useSyncExternalStore(tracker.subscribe, tracker.getSnapshot, tracker.getSnapshot)
	return tracker.track(runRenderFn as (fn: () => T, unused: null) => T, render, null)
}

/** Adapts a zero-argument render to {@link RenderTracker.track}'s two-argument shape. */
function runRenderFn<T>(fn: () => T): T {
	return fn()
}

/**
 * Wraps a function component so that it re-renders whenever any signal read
 * during its render changes. The result is memoized on props. Supports plain
 * function components and components wrapped in `memo` and/or `forwardRef`.
 */
export function track<C extends ComponentType<any>>(Component: C): C {
	if (typeof Component === "function") {
		const fn = Component as unknown as {
			prototype?: { isReactComponent?: unknown }
			displayName?: string
			name?: string
		}
		const name = fn.displayName ?? fn.name ?? "TrackedComponent"
		if (fn.prototype?.isReactComponent) {
			throw new Error(`track(${name}): class components are not supported`)
		}
		const render = Component as unknown as (props: unknown) => ReactNode
		const Tracked = (props: unknown) => useTrackedRender(name, render, props, null)
		Tracked.displayName = name
		return memo(Tracked) as unknown as C
	}

	const exotic = Component as unknown as {
		$$typeof?: symbol
		type?: unknown
		render?: unknown
		compare?: unknown
		displayName?: string
	}

	if (exotic.$$typeof === REACT_MEMO_TYPE) {
		const inner = track(exotic.type as ComponentType<any>) as unknown as { type: ComponentType<any> }
		// `inner` is already memoized; reuse the caller's comparator if any.
		const compare = exotic.compare as ((a: unknown, b: unknown) => boolean) | undefined
		return (compare ? memo(inner.type, compare) : inner) as unknown as C
	}

	if (exotic.$$typeof === REACT_FORWARD_REF_TYPE) {
		const render = exotic.render as RenderFn<unknown>
		const name = exotic.displayName ?? (render as { name?: string }).name ?? "TrackedComponent"
		const Tracked = forwardRef<unknown, object>((props, ref) => useTrackedRender(name, render, props, ref))
		Tracked.displayName = name
		return memo(Tracked) as unknown as C
	}

	throw new Error("track() expects a function component, or one wrapped in memo() or forwardRef()")
}
