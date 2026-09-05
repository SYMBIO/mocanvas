/**
 * Fine-grained reactive signals.
 *
 * Model
 * -----
 * - A single global epoch counter advances on every atom write.
 * - Every signal remembers `lastChangedEpoch`, the epoch of the write that
 *   last changed its value.
 * - Computeds are lazy and pull-based: `get()` verifies the cached value by
 *   comparing the `lastChangedEpoch` of each recorded parent against the
 *   epoch at which the computed was last verified (`lastCheckedEpoch`).
 *   Recomputation happens only when a parent actually changed.
 * - Reactions (effects) are push-notified: an atom write walks the children
 *   graph and marks reachable reactions pending. Pending reactions execute
 *   once, after the outermost transaction commits, and re-check their
 *   dependencies' epochs before running so that equal computed values never
 *   trigger a run.
 * - Dependency tracking uses a single "active dependent" slot that behaves
 *   like a capture stack through the native call stack (save/restore).
 */

import {
	HistoryBuffer,
	isWithDiff,
	RESET_VALUE,
	type ComputeDiff,
	type ResetValue,
	type WithDiff,
} from "./diff"

export const UNINITIALIZED: unique symbol = Symbol("UNINITIALIZED")
export type Uninitialized = typeof UNINITIALIZED

/**
 * Whether a computed's `prev` argument is the "no previous value yet" marker.
 *
 * A derivation that patches its previous result has to tell the first run apart
 * from every later one; `prev` is {@link UNINITIALIZED} exactly then.
 *
 * ```ts
 * computed('ids', (prev) => (isUninitialized(prev) ? build() : patch(prev)))
 * ```
 */
export function isUninitialized(value: unknown): value is Uninitialized {
	return value === UNINITIALIZED
}

export const EMPTY_ARRAY: readonly [] = Object.freeze([]) as unknown as readonly []

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Signal<T, Diff = unknown> {
	readonly name: string
	get(): T
	lastChangedEpoch: number
	/**
	 * Every diff this signal recorded after `epoch`, oldest first.
	 *
	 * A signal only keeps diffs when it was given a `historyLength`; without
	 * one — or when the change is further back than the buffer reaches, or was
	 * never expressible as a diff — the answer is {@link RESET_VALUE}, meaning
	 * "give up and read the value".
	 */
	getDiffSince(epoch: number): Diff[] | ResetValue
}

export interface Atom<T, Diff = unknown> extends Signal<T, Diff> {
	set(value: T): T
	update(fn: (prev: T) => T): T
}

export interface Computed<T, Diff = unknown> extends Signal<T, Diff> {
	/** Epoch at which the cached value was last verified against its parents. */
	readonly lastCheckedEpoch: number
}

export interface AtomOptions<T, Diff = unknown> {
	isEqual?: (a: T, b: T) => boolean
	/**
	 * How many recent changes to remember as diffs. Omit — the default — and
	 * the atom keeps none and always answers `getDiffSince` with
	 * {@link RESET_VALUE}.
	 */
	historyLength?: number
	/** Derives the diff between two values; see {@link ComputeDiff}. */
	computeDiff?: ComputeDiff<T, Diff>
}

export interface ComputedOptions<T, Diff = unknown> {
	isEqual?: (a: T, b: T) => boolean
	/**
	 * How many recent changes to remember as diffs. The derivation supplies
	 * each diff itself by returning `withDiff(value, diff)`; a plain return
	 * value records "this change has no diff".
	 */
	historyLength?: number
	/**
	 * Derives the diff between two values when the derivation returned a bare
	 * value rather than a {@link WithDiff}. Optional; see {@link ComputeDiff}.
	 */
	computeDiff?: ComputeDiff<T, Diff>
}

/**
 * How an effect is (re)scheduled once its dependencies change.
 *
 * Shared by `react`, `reactor` and anything else driving an
 * {@link EffectScheduler}, so a host can batch effect runs per animation frame
 * instead of running them synchronously inside the write that caused them.
 */
export interface EffectSchedulerOptions {
	/**
	 * Called whenever the effect needs to (re)run after its first run. The
	 * default runs `execute` synchronously. Supply e.g. a requestAnimationFrame
	 * wrapper to batch effect runs per frame.
	 */
	scheduleEffect?: (execute: () => void) => void
}

/** @see {@link EffectSchedulerOptions} — the name `react()` documents. */
export type ReactOptions = EffectSchedulerOptions

export interface EffectScheduler {
	readonly name: string
	readonly isActive: boolean
	readonly lastRunEpoch: number
	/** Runs the effect now if any dependency changed since its last run. */
	execute(): void
}

export interface Reactor {
	start(): void
	stop(): void
	readonly scheduler: EffectScheduler
}

// ---------------------------------------------------------------------------
// Internal graph node contracts
// ---------------------------------------------------------------------------

/** Anything that records parents while it runs (computeds, effects). */
interface Dependent {
	readonly name: string
	parents: Set<SignalNode>
	prevParents: Set<SignalNode>
	__notify(): void
	/**
	 * The epoch this dependent's cached work is current as of. A parent whose
	 * `lastChangedEpoch` is newer than this is a reason the dependent re-ran —
	 * which is exactly what {@link whyAmIRunning} reports.
	 */
	__referenceEpoch(): number
}

/** An atom as seen by the transaction log (method syntax keeps T bivariant). */
interface RollbackTarget {
	__restore(value: unknown): void
}

/** Anything that can be read and can have dependents (atoms, computeds). */
interface SignalNode<T = unknown> extends Signal<T, any> {
	__addChild(child: Dependent): void
	__removeChild(child: Dependent): void
	/** Bring the value up to date without recording a dependency. */
	__refresh(): void
}

// ---------------------------------------------------------------------------
// Global runtime state
// ---------------------------------------------------------------------------

let globalEpoch = 0
let activeDependent: Dependent | null = null
let currentTx: TxLevel | null = null
let isFlushing = false
const pendingEffects = new Set<EffectBase>()
const flushScratch: EffectBase[] = []
const MAX_FLUSH_ROUNDS = 10_000

export function getGlobalEpoch(): number {
	return globalEpoch
}

function defaultIsEqual(a: unknown, b: unknown): boolean {
	return Object.is(a, b)
}

// ---------------------------------------------------------------------------
// Dependency capture
// ---------------------------------------------------------------------------

/**
 * Starts recording parents into `d.parents`. The previous parent set is kept
 * in `d.prevParents` so `endCapture` can diff subscriptions. Both sets are
 * reused across runs; no allocation happens unless the sets grow.
 */
function beginCapture(d: Dependent): Dependent | null {
	const outer = activeDependent
	const recycled = d.prevParents
	d.prevParents = d.parents
	d.parents = recycled
	recycled.clear()
	activeDependent = d
	return outer
}

/**
 * Stops recording. When `attached` is true the dependent is live in the
 * graph, so subscriptions are diffed: dropped parents forget the dependent,
 * new parents learn about it.
 */
function endCapture(d: Dependent, outer: Dependent | null, attached: boolean): void {
	activeDependent = outer
	const prev = d.prevParents
	const next = d.parents
	if (attached) {
		for (const p of prev) if (!next.has(p)) p.__removeChild(d)
		for (const p of next) if (!prev.has(p)) p.__addChild(d)
	}
	prev.clear()
}

/** Runs `fn` without recording any dependencies for the current dependent. */
export function unsafe__withoutCapture<T>(fn: () => T): T {
	const outer = activeDependent
	activeDependent = null
	try {
		return fn()
	} finally {
		activeDependent = outer
	}
}

/** Reads a signal without recording a dependency (closure-free helper). */
export function getWithoutCapture<T>(signal: Signal<T>): T {
	const outer = activeDependent
	activeDependent = null
	try {
		return signal.get()
	} finally {
		activeDependent = outer
	}
}

// ---------------------------------------------------------------------------
// Atom
// ---------------------------------------------------------------------------

class AtomImpl<T, Diff = unknown> implements SignalNode<T>, Atom<T, Diff> {
	readonly name: string
	lastChangedEpoch: number = globalEpoch
	readonly children = new Set<Dependent>()
	private value: T
	private readonly isEqual: (a: T, b: T) => boolean
	private readonly history: HistoryBuffer<Diff> | null
	private readonly computeDiff: ComputeDiff<T, Diff> | null

	constructor(
		name: string,
		value: T,
		isEqual: ((a: T, b: T) => boolean) | undefined,
		historyLength: number | undefined,
		computeDiff: ComputeDiff<T, Diff> | undefined
	) {
		this.name = name
		this.value = value
		this.isEqual = isEqual ?? defaultIsEqual
		this.history = historyLength === undefined ? null : new HistoryBuffer<Diff>(historyLength)
		this.computeDiff = computeDiff ?? null
	}

	get(): T {
		if (activeDependent !== null) activeDependent.parents.add(this)
		return this.value
	}

	set(value: T): T {
		if (this.isEqual(this.value, value)) return this.value
		if (currentTx !== null) currentTx.record(this, this.value)
		this.__write(value, this.diffFor(this.value, value))
		if (currentTx === null) flushPending()
		return value
	}

	update(fn: (prev: T) => T): T {
		return this.set(fn(this.value))
	}

	getDiffSince(epoch: number): Diff[] | ResetValue {
		// Reading the diffs is reading the signal: a dependent that patches its
		// result from them must be woken by the next change just the same.
		this.get()
		if (epoch >= this.lastChangedEpoch) return []
		return this.history === null ? RESET_VALUE : this.history.getChangesSince(epoch)
	}

	/** Restores a value during rollback; skips the write when already equal. */
	__restore(value: T): void {
		if (this.isEqual(this.value, value)) return
		// A rollback is not a change anyone can patch towards: the diffs that
		// led here are being undone, so the history stops being answerable.
		this.__write(value, RESET_VALUE)
	}

	private diffFor(previous: T, next: T): Diff | ResetValue {
		if (this.history === null || this.computeDiff === null) return RESET_VALUE
		return this.computeDiff(previous, next, this.lastChangedEpoch, globalEpoch + 1)
	}

	private __write(value: T, diff: Diff | ResetValue): void {
		const fromEpoch = this.lastChangedEpoch
		globalEpoch++
		this.value = value
		this.lastChangedEpoch = globalEpoch
		this.history?.pushEntry(fromEpoch, globalEpoch, diff)
		for (const child of this.children) child.__notify()
	}

	__addChild(child: Dependent): void {
		this.children.add(child)
	}

	__removeChild(child: Dependent): void {
		this.children.delete(child)
	}

	__refresh(): void {
		// Atoms are always fresh.
	}
}

export function atom<T, Diff = unknown>(
	name: string,
	initialValue: T,
	options?: AtomOptions<T, Diff>
): Atom<T, Diff> {
	return new AtomImpl<T, Diff>(
		name,
		initialValue,
		options?.isEqual,
		options?.historyLength,
		options?.computeDiff
	)
}

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

class ComputedImpl<T, Diff = unknown> implements SignalNode<T>, Computed<T, Diff>, Dependent {
	readonly name: string
	lastChangedEpoch = -1
	lastCheckedEpoch = -1
	/**
	 * Epoch of the most recent push notification received while attached.
	 * While the computed has children it is subscribed to all of its parents,
	 * so "no notification since the last check" proves the cache is fresh
	 * without walking the parent list.
	 */
	private notifiedEpoch = -1
	parents = new Set<SignalNode>()
	prevParents = new Set<SignalNode>()
	readonly children = new Set<Dependent>()
	private value: T | Uninitialized = UNINITIALIZED
	private isComputing = false
	private readonly fn: (prev: T | Uninitialized, lastComputedEpoch: number) => T | WithDiff<T, Diff>
	private readonly isEqual: (a: T, b: T) => boolean
	private readonly history: HistoryBuffer<Diff> | null
	private readonly computeDiff: ComputeDiff<T, Diff> | null

	constructor(
		name: string,
		fn: (prev: T | Uninitialized, lastComputedEpoch: number) => T | WithDiff<T, Diff>,
		isEqual: ((a: T, b: T) => boolean) | undefined,
		historyLength: number | undefined,
		computeDiff: ComputeDiff<T, Diff> | undefined
	) {
		this.name = name
		this.fn = fn
		this.isEqual = isEqual ?? defaultIsEqual
		this.history = historyLength === undefined ? null : new HistoryBuffer<Diff>(historyLength)
		this.computeDiff = computeDiff ?? null
	}

	get(): T {
		if (activeDependent !== null) activeDependent.parents.add(this)
		this.__refresh()
		return this.value as T
	}

	getDiffSince(epoch: number): Diff[] | ResetValue {
		// Bring the value up to date first: the diffs being asked for may not
		// have been produced yet.
		this.get()
		if (epoch >= this.lastChangedEpoch) return []
		return this.history === null ? RESET_VALUE : this.history.getChangesSince(epoch)
	}

	__referenceEpoch(): number {
		return this.lastCheckedEpoch
	}

	__refresh(): void {
		const epoch = globalEpoch
		if (this.lastCheckedEpoch === epoch) return
		if (this.value !== UNINITIALIZED) {
			if (this.children.size > 0 && this.notifiedEpoch <= this.lastCheckedEpoch) {
				this.lastCheckedEpoch = epoch
				return
			}
			let changed = false
			for (const p of this.parents) {
				p.__refresh()
				if (p.lastChangedEpoch > this.lastCheckedEpoch) {
					changed = true
					break
				}
			}
			if (!changed) {
				this.lastCheckedEpoch = epoch
				return
			}
		}
		this.recompute()
	}

	private recompute(): void {
		if (this.isComputing) {
			throw new Error(`Cycle detected while evaluating computed "${this.name}"`)
		}
		this.isComputing = true
		const epoch = globalEpoch
		const prev = this.value
		// The epoch this computed's cached value was produced at. A derivation
		// that patches `prev` asks its parents for the diffs recorded since.
		const lastComputedEpoch = this.lastCheckedEpoch
		const outer = beginCapture(this)
		let returned: T | WithDiff<T, Diff>
		try {
			returned = this.fn(prev, lastComputedEpoch)
		} finally {
			endCapture(this, outer, this.children.size > 0)
			this.isComputing = false
		}

		// A derivation that knows how its result changed says so by returning
		// `withDiff(value, diff)`; a bare value falls back to `computeDiff`,
		// and failing that records "this change cannot be described".
		let next: T
		let diff: Diff | ResetValue = RESET_VALUE
		if (isWithDiff<T, Diff>(returned)) {
			next = returned.value
			diff = returned.diff
		} else {
			next = returned
		}

		if (prev === UNINITIALIZED || !this.isEqual(prev as T, next)) {
			if (this.history !== null && diff === RESET_VALUE && this.computeDiff !== null && prev !== UNINITIALIZED) {
				diff = this.computeDiff(prev as T, next, this.lastChangedEpoch, epoch)
			}
			const fromEpoch = this.lastChangedEpoch
			this.value = next
			this.lastChangedEpoch = epoch
			this.history?.pushEntry(fromEpoch, epoch, prev === UNINITIALIZED ? RESET_VALUE : diff)
		}
		this.lastCheckedEpoch = epoch
	}

	__notify(): void {
		if (this.notifiedEpoch === globalEpoch) return
		this.notifiedEpoch = globalEpoch
		for (const child of this.children) child.__notify()
	}

	__addChild(child: Dependent): void {
		this.children.add(child)
		if (this.children.size === 1) {
			// Becoming live: anything that happened while detached was not
			// pushed to us, so force a parent walk on the next refresh unless
			// we were verified at the current epoch.
			this.notifiedEpoch = globalEpoch
			for (const p of this.parents) p.__addChild(this)
		}
	}

	__removeChild(child: Dependent): void {
		if (this.children.delete(child) && this.children.size === 0) {
			for (const p of this.parents) p.__removeChild(this)
		}
	}
}

export function computed<T, Diff = unknown>(
	name: string,
	fn: (prev: T | Uninitialized, lastComputedEpoch: number) => T | WithDiff<T, Diff>,
	options?: ComputedOptions<T, Diff>
): Computed<T, Diff> {
	return new ComputedImpl<T, Diff>(
		name,
		fn,
		options?.isEqual,
		options?.historyLength,
		options?.computeDiff
	)
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

abstract class EffectBase implements Dependent {
	readonly name: string
	parents = new Set<SignalNode>()
	prevParents = new Set<SignalNode>()
	lastRunEpoch = -1
	isActive = false

	constructor(name: string) {
		this.name = name
	}

	__notify(): void {
		if (this.isActive) pendingEffects.add(this)
	}

	__referenceEpoch(): number {
		return this.lastRunEpoch
	}

	/** Called by the flush loop once per batch of changes. */
	abstract __schedule(): void

	protected attachToParents(): void {
		for (const p of this.parents) p.__addChild(this)
	}

	protected detachFromParents(): void {
		for (const p of this.parents) p.__removeChild(this)
	}

	/** True when any parent changed after this effect last ran. */
	protected depsChanged(): boolean {
		const since = this.lastRunEpoch
		for (const p of this.parents) {
			p.__refresh()
			if (p.lastChangedEpoch > since) return true
		}
		return false
	}
}

class Reaction extends EffectBase implements EffectScheduler {
	private isScheduled = false
	private readonly fn: () => void
	private readonly scheduleEffect: ((execute: () => void) => void) | null
	private readonly boundExecute: () => void

	constructor(name: string, fn: () => void, scheduleEffect: ((execute: () => void) => void) | null) {
		super(name)
		this.fn = fn
		this.scheduleEffect = scheduleEffect
		this.boundExecute = () => this.execute()
	}

	start(): void {
		if (this.isActive) return
		this.isActive = true
		this.lastRunEpoch = -1
		this.execute()
	}

	stop(): void {
		if (!this.isActive) return
		this.detachFromParents()
		this.parents.clear()
		this.isActive = false
		this.isScheduled = false
		this.lastRunEpoch = -1
	}

	__schedule(): void {
		if (this.isScheduled) return
		this.isScheduled = true
		if (this.scheduleEffect !== null) this.scheduleEffect(this.boundExecute)
		else this.execute()
	}

	execute(): void {
		this.isScheduled = false
		if (!this.isActive) return
		if (this.lastRunEpoch !== -1 && !this.depsChanged()) return
		// Writes made by the effect are batched and flushed after it returns.
		const tx = beginTx()
		const outer = beginCapture(this)
		this.lastRunEpoch = globalEpoch
		try {
			this.fn()
		} catch (error) {
			endCapture(this, outer, this.isActive)
			abortTx(tx)
			throw error
		}
		endCapture(this, outer, this.isActive)
		commitTx(tx)
	}
}

export function react(name: string, fn: () => void, options?: ReactOptions): () => void {
	const reaction = new Reaction(name, fn, options?.scheduleEffect ?? null)
	reaction.start()
	return () => reaction.stop()
}

export function reactor(name: string, fn: () => void, options?: ReactOptions): Reactor {
	const reaction = new Reaction(name, fn, options?.scheduleEffect ?? null)
	return {
		scheduler: reaction,
		start: () => reaction.start(),
		stop: () => reaction.stop(),
	}
}

/**
 * Dependency tracker for externally driven executions (e.g. a UI render).
 *
 * The host calls `track(fn)` to run `fn` with dependency capture, and
 * `subscribe(listener)` to be told when any captured dependency changes.
 * `getSnapshot()` returns a version number that increments on each such
 * change, which makes the tracker a drop-in external store for React's
 * `useSyncExternalStore`. Subscribing and unsubscribing repeatedly (as strict
 * mode does) is safe: captured parents are kept across unsubscribe so the next
 * subscribe re-attaches to them.
 */
export class RenderTracker extends EffectBase {
	private version = 0
	private listener: (() => void) | null = null

	constructor(name: string) {
		super(name)
	}

	__schedule(): void {
		this.execute()
	}

	private execute(): void {
		if (!this.isActive || this.lastRunEpoch === -1) return
		if (!this.depsChanged()) return
		this.bump()
	}

	private bump(): void {
		this.version++
		if (this.listener !== null) this.listener()
	}

	/** Runs `fn(a, b)` while recording every signal read as a dependency. */
	track<A, B, R>(fn: (a: A, b: B) => R, a: A, b: B): R {
		const outer = beginCapture(this)
		this.lastRunEpoch = globalEpoch
		try {
			return fn(a, b)
		} finally {
			endCapture(this, outer, this.isActive)
		}
	}

	readonly getSnapshot = (): number => this.version

	readonly subscribe = (listener: () => void): (() => void) => {
		this.listener = listener
		if (!this.isActive) {
			this.isActive = true
			this.attachToParents()
		}
		// Changes between the tracked run and this subscription were not
		// observed; report them now so the host re-runs.
		if (this.lastRunEpoch !== -1 && this.depsChanged()) this.bump()
		return this.unsubscribe
	}

	readonly unsubscribe = (): void => {
		if (!this.isActive) return
		this.listener = null
		this.isActive = false
		this.detachFromParents()
	}
}

/**
 * Calls `onChange` whenever `signal`'s value changes. The initial subscription
 * does not call `onChange`. Returns an unsubscribe function.
 */
export function subscribeToSignal(signal: Signal<unknown>, onChange: () => void): () => void {
	let initial = true
	const reaction = new Reaction(
		`subscribe(${signal.name})`,
		() => {
			signal.get()
			if (initial) initial = false
			else onChange()
		},
		null
	)
	reaction.start()
	return () => reaction.stop()
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

class TxLevel {
	readonly parent: TxLevel | null
	log: Map<RollbackTarget, unknown> | null = null
	open = true

	constructor(parent: TxLevel | null) {
		this.parent = parent
	}

	/** Remembers the first pre-write value of each atom touched in this level. */
	record(atom: RollbackTarget, previous: unknown): void {
		if (this.log === null) this.log = new Map()
		else if (this.log.has(atom)) return
		this.log.set(atom, previous)
	}
}

function beginTx(): TxLevel {
	const tx = new TxLevel(currentTx)
	currentTx = tx
	return tx
}

function commitTx(tx: TxLevel): void {
	tx.open = false
	currentTx = tx.parent
	if (tx.log !== null && tx.parent !== null) {
		// Nested transactions merge into the outer one so an outer rollback
		// can still undo writes made by an already-committed inner level.
		const parent = tx.parent
		if (parent.log === null) parent.log = tx.log
		else for (const [atom, prev] of tx.log) if (!parent.log.has(atom)) parent.log.set(atom, prev)
		tx.log = null
	}
	if (currentTx === null) flushPending()
}

function rollbackTx(tx: TxLevel): void {
	if (!tx.open) throw new Error("Cannot roll back a transaction that has already ended")
	const log = tx.log
	if (log === null) return
	tx.log = null
	for (const [atom, prev] of log) atom.__restore(prev)
}

function abortTx(tx: TxLevel): void {
	rollbackTx(tx)
	tx.open = false
	currentTx = tx.parent
	if (currentTx === null) flushPending()
}

/**
 * Batches atom writes: dependents are notified as writes happen, but effects
 * run once, after the outermost transaction commits. If `fn` throws, writes
 * made inside the transaction are rolled back and the error is rethrown.
 */
export function transact<T>(fn: () => T): T {
	const tx = beginTx()
	let result: T
	try {
		result = fn()
	} catch (error) {
		abortTx(tx)
		throw error
	}
	commitTx(tx)
	return result
}

/**
 * Like `transact`, but `fn` receives a `rollback` function that restores every
 * atom written inside this transaction (including committed nested ones) to
 * the value it had when this transaction began. The transaction stays open
 * after a rollback, so further writes are recorded again.
 */
export function transaction<T>(fn: (rollback: () => void) => T): T {
	const tx = beginTx()
	let result: T
	try {
		result = fn(() => rollbackTx(tx))
	} catch (error) {
		abortTx(tx)
		throw error
	}
	commitTx(tx)
	return result
}

/**
 * Runs every pending effect. Effects that become pending while flushing
 * (because an effect wrote an atom) are picked up by the next round. A bound
 * on rounds turns an effect that keeps invalidating itself into an error.
 */
function flushPending(): void {
	if (isFlushing || currentTx !== null || pendingEffects.size === 0) return
	isFlushing = true
	let firstError: unknown = pendingEffects // sentinel that can never be thrown
	let rounds = 0
	try {
		while (pendingEffects.size > 0) {
			if (++rounds > MAX_FLUSH_ROUNDS) {
				pendingEffects.clear()
				throw new Error(
					`Reaction loop detected: effects kept invalidating each other for ${MAX_FLUSH_ROUNDS} rounds`
				)
			}
			const batch = flushScratch
			for (const effect of pendingEffects) batch.push(effect)
			pendingEffects.clear()
			for (let i = 0; i < batch.length; i++) {
				try {
					batch[i]!.__schedule()
				} catch (error) {
					if (firstError === pendingEffects) firstError = error
				}
			}
			batch.length = 0
		}
	} finally {
		flushScratch.length = 0
		isFlushing = false
	}
	if (firstError !== pendingEffects) throw firstError
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isSignal(value: unknown): value is Signal<unknown> {
	return value instanceof AtomImpl || value instanceof ComputedImpl
}

export function isAtom(value: unknown): value is Atom<unknown> {
	return value instanceof AtomImpl
}

export function isComputed(value: unknown): value is Computed<unknown> {
	return value instanceof ComputedImpl
}

// ---------------------------------------------------------------------------
// Debugging
// ---------------------------------------------------------------------------

/**
 * Log why the computed or effect that is running right now was re-run.
 *
 * Drop a call inside a derivation or a `react` body and the next run prints the
 * dependencies it captured, marking the ones that changed since its previous
 * run. That is the question a signals bug almost always reduces to — "who woke
 * this up?" — and it cannot be answered from a breakpoint, because the parent
 * set only exists while the body is executing.
 *
 * Outside a tracked execution it warns and does nothing.
 */
export function whyAmIRunning(): void {
	const dependent = activeDependent
	if (dependent === null) {
		console.warn("[state] whyAmIRunning() was called outside of a computed or effect")
		return
	}
	const since = dependent.__referenceEpoch()
	const changed: string[] = []
	const unchanged: string[] = []
	// `parents` is the set captured SO FAR in this run — reads that happen after
	// this call are not in it yet, which is the honest answer to "what have I
	// depended on up to here".
	for (const parent of dependent.parents) {
		;(parent.lastChangedEpoch > since ? changed : unchanged).push(parent.name)
	}
	const lines = [`[state] ${dependent.name} is running because:`]
	for (const name of changed) lines.push(`  ${name} changed`)
	for (const name of unchanged) lines.push(`  ${name} (unchanged)`)
	if (changed.length === 0 && unchanged.length === 0) lines.push("  (no dependencies captured yet)")
	console.log(lines.join("\n"))
}

/**
 * The {@link Computed} that memoizes `object[propertyName]`, creating it on
 * first use.
 *
 * A getter on a class is re-evaluated on every read; wrapping it once per
 * instance turns it into a cached derivation that other signals can depend on,
 * without the class having to hold the `Computed` itself. The instance is
 * remembered per object and per property, so repeated calls return the same
 * signal and the cache is actually shared.
 *
 * ```ts
 * const $bounds = getComputedInstance(shapeUtil, "bounds")
 * $bounds.get()
 * ```
 *
 * SEMANTICS-ASSUMED: the docs describe this as fetching the computed instance
 * behind a property. mocanvas has no `@computed` property decorator, so the
 * lazily created wrapper is what a decorator would otherwise have installed —
 * one `Computed` per object/property that reads the property with dependency
 * capture. The object is held weakly, so this never keeps an editor alive.
 */
const computedInstances = new WeakMap<object, Map<PropertyKey, Computed<unknown>>>()

export function getComputedInstance<Obj extends object, Prop extends keyof Obj>(
	object: Obj,
	propertyName: Prop
): Computed<Obj[Prop]> {
	let byProperty = computedInstances.get(object)
	if (!byProperty) {
		byProperty = new Map()
		computedInstances.set(object, byProperty)
	}
	const existing = byProperty.get(propertyName)
	if (existing) return existing as Computed<Obj[Prop]>
	const created = computed<Obj[Prop]>(
		`${object.constructor?.name ?? "object"}.${String(propertyName)}`,
		() => object[propertyName]
	)
	byProperty.set(propertyName, created as Computed<unknown>)
	return created
}

// ---------------------------------------------------------------------------
// Persisted atoms
// ---------------------------------------------------------------------------

/**
 * An atom whose value outlives the page: it is read from `localStorage` when
 * created and written back whenever it changes.
 *
 * Use it for preferences the app owns rather than the document — a chosen
 * theme, whether the debug panel is open. Document state belongs in the store.
 *
 * The value is stored as JSON under `key`. When `localStorage` is unavailable
 * (server rendering, a browser with site data blocked, a private window that
 * throws on write) this degrades to an ordinary in-memory atom rather than
 * failing: a preference is never worth breaking a render over.
 *
 * SEMANTICS-ASSUMED: values are serialized with `JSON.stringify`, unparseable
 * stored values fall back to `initialValue`, and a `storage` event from another
 * tab updates the atom — the behaviour that makes a persisted preference
 * actually behave like one shared piece of state. The docs name the function
 * but do not pin the encoding.
 */
export function localStorageAtom<T>(key: string, initialValue: T, options?: AtomOptions<T>): Atom<T> {
	const storage = (): Storage | null => {
		try {
			return typeof localStorage === "undefined" ? null : localStorage
		} catch {
			return null
		}
	}

	let start = initialValue
	const store = storage()
	if (store !== null) {
		try {
			const raw = store.getItem(key)
			if (raw !== null) start = JSON.parse(raw) as T
		} catch {
			start = initialValue
		}
	}

	const result = atom<T>(key, start, options)
	const write = (value: T): void => {
		const s = storage()
		if (s === null) return
		try {
			s.setItem(key, JSON.stringify(value))
		} catch {
			// Quota exceeded or storage disabled mid-session: keep the in-memory value.
		}
	}

	// `react` runs immediately, which also writes the initial value back — so a
	// key that was never set gets its default persisted, and a later read in
	// another tab sees the same thing this one does.
	react(`localStorageAtom(${key})`, () => write(result.get()))

	if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
		window.addEventListener("storage", (event: StorageEvent) => {
			if (event.key !== key || event.newValue === null) return
			try {
				result.set(JSON.parse(event.newValue) as T)
			} catch {
				// Another tab wrote something we cannot read; keep ours.
			}
		})
	}

	return result
}
