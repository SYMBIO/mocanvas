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

export const UNINITIALIZED: unique symbol = Symbol("UNINITIALIZED")
export type Uninitialized = typeof UNINITIALIZED

export const EMPTY_ARRAY: readonly [] = Object.freeze([]) as unknown as readonly []

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Signal<T> {
	readonly name: string
	get(): T
	lastChangedEpoch: number
}

export interface Atom<T> extends Signal<T> {
	set(value: T): T
	update(fn: (prev: T) => T): T
}

export interface Computed<T> extends Signal<T> {
	/** Epoch at which the cached value was last verified against its parents. */
	readonly lastCheckedEpoch: number
}

export interface AtomOptions<T> {
	isEqual?: (a: T, b: T) => boolean
}

export interface ComputedOptions<T> {
	isEqual?: (a: T, b: T) => boolean
}

export interface ReactOptions {
	/**
	 * Called whenever the effect needs to (re)run after its first run. The
	 * default runs `execute` synchronously. Supply e.g. a requestAnimationFrame
	 * wrapper to batch effect runs per frame.
	 */
	scheduleEffect?: (execute: () => void) => void
}

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
	parents: Set<SignalNode>
	prevParents: Set<SignalNode>
	__notify(): void
}

/** An atom as seen by the transaction log (method syntax keeps T bivariant). */
interface RollbackTarget {
	__restore(value: unknown): void
}

/** Anything that can be read and can have dependents (atoms, computeds). */
interface SignalNode<T = unknown> extends Signal<T> {
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

class AtomImpl<T> implements SignalNode<T>, Atom<T> {
	readonly name: string
	lastChangedEpoch: number = globalEpoch
	readonly children = new Set<Dependent>()
	private value: T
	private readonly isEqual: (a: T, b: T) => boolean

	constructor(name: string, value: T, isEqual: ((a: T, b: T) => boolean) | undefined) {
		this.name = name
		this.value = value
		this.isEqual = isEqual ?? defaultIsEqual
	}

	get(): T {
		if (activeDependent !== null) activeDependent.parents.add(this)
		return this.value
	}

	set(value: T): T {
		if (this.isEqual(this.value, value)) return this.value
		if (currentTx !== null) currentTx.record(this, this.value)
		this.__write(value)
		if (currentTx === null) flushPending()
		return value
	}

	update(fn: (prev: T) => T): T {
		return this.set(fn(this.value))
	}

	/** Restores a value during rollback; skips the write when already equal. */
	__restore(value: T): void {
		if (this.isEqual(this.value, value)) return
		this.__write(value)
	}

	private __write(value: T): void {
		globalEpoch++
		this.value = value
		this.lastChangedEpoch = globalEpoch
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

export function atom<T>(name: string, initialValue: T, options?: AtomOptions<T>): Atom<T> {
	return new AtomImpl(name, initialValue, options?.isEqual)
}

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

class ComputedImpl<T> implements SignalNode<T>, Computed<T>, Dependent {
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
	private readonly fn: (prev: T | Uninitialized) => T
	private readonly isEqual: (a: T, b: T) => boolean

	constructor(
		name: string,
		fn: (prev: T | Uninitialized) => T,
		isEqual: ((a: T, b: T) => boolean) | undefined
	) {
		this.name = name
		this.fn = fn
		this.isEqual = isEqual ?? defaultIsEqual
	}

	get(): T {
		if (activeDependent !== null) activeDependent.parents.add(this)
		this.__refresh()
		return this.value as T
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
		const outer = beginCapture(this)
		let next: T
		try {
			next = this.fn(prev)
		} finally {
			endCapture(this, outer, this.children.size > 0)
			this.isComputing = false
		}
		if (prev === UNINITIALIZED || !this.isEqual(prev as T, next)) {
			this.value = next
			this.lastChangedEpoch = epoch
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

export function computed<T>(
	name: string,
	fn: (prev: T | Uninitialized) => T,
	options?: ComputedOptions<T>
): Computed<T> {
	return new ComputedImpl(name, fn, options?.isEqual)
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
