/**
 * A reactive `Set`.
 *
 * The counterpart of {@link AtomMap} for membership: asking whether one value
 * is in the set subscribes to that value alone, so a computed that watches a
 * single id is not woken every time an unrelated one is added. Reading the
 * set's shape (`size`, iteration) subscribes to the membership epoch instead.
 *
 * That split is the whole reason to reach for this over a plain `Set` in an
 * atom: `atom("selection", new Set(...))` invalidates every reader on every
 * change, however small.
 */
import { atom, getWithoutCapture, transact, type Atom } from "./core"

/** A reactive set of `T`, backed by one boolean atom per member. */
export class AtomSet<T> {
	/**
	 * One atom per value ever seen. A removed value keeps its atom, holding
	 * `false`, so anything already subscribed to that value is told it left
	 * rather than silently going stale.
	 */
	private readonly atoms = new Map<T, Atom<boolean>>()
	/** Bumped whenever membership changes, for readers of the set's shape. */
	private readonly membershipEpoch: Atom<number>

	constructor(
		readonly name: string,
		values?: Iterable<T>,
	) {
		this.membershipEpoch = atom(`${name}:members`, 0)
		if (values) {
			for (const value of values) this.atoms.set(value, atom(`${name}:${String(value)}`, true))
		}
	}

	get [Symbol.toStringTag](): string {
		return "AtomSet"
	}

	/** Whether `value` is a member. */
	has(value: T): boolean {
		const a = this.atoms.get(value)
		if (!a) {
			// Depend on membership, so adding `value` later invalidates this read.
			this.membershipEpoch.get()
			return false
		}
		return a.get()
	}

	/** Add `value`, returning the set so calls can be chained. */
	add(value: T): this {
		const a = this.atoms.get(value)
		if (a) {
			if (getWithoutCapture(a)) return this
			// One transaction, so a reader of both the member and the set's shape
			// is notified once rather than twice.
			transact(() => {
				a.set(true)
				this.membershipEpoch.update((n) => n + 1)
			})
		} else {
			this.atoms.set(value, atom(`${this.name}:${String(value)}`, true))
			this.membershipEpoch.update((n) => n + 1)
		}
		return this
	}

	/** Remove `value`. Returns whether it was a member. */
	delete(value: T): boolean {
		const a = this.atoms.get(value)
		if (!a || !getWithoutCapture(a)) return false
		transact(() => {
			a.set(false)
			this.membershipEpoch.update((n) => n + 1)
		})
		return true
	}

	/** Remove every member. */
	clear(): void {
		transact(() => {
			let removedAny = false
			for (const a of this.atoms.values()) {
				if (!getWithoutCapture(a)) continue
				a.set(false)
				removedAny = true
			}
			if (removedAny) this.membershipEpoch.update((n) => n + 1)
		})
	}

	/** How many members the set holds. */
	get size(): number {
		this.membershipEpoch.get()
		let n = 0
		for (const a of this.atoms.values()) if (a.get()) n++
		return n
	}

	/** The live members, in insertion order. */
	*keys(): IterableIterator<T> {
		this.membershipEpoch.get()
		for (const [value, a] of this.atoms) if (a.get()) yield value
	}

	/** The live members, in insertion order. Same as {@link AtomSet.keys}, as on `Set`. */
	values(): IterableIterator<T> {
		return this.keys()
	}

	/** `[value, value]` pairs, as on `Set`. */
	*entries(): IterableIterator<[T, T]> {
		for (const value of this.keys()) yield [value, value]
	}

	[Symbol.iterator](): IterableIterator<T> {
		return this.keys()
	}

	forEach(fn: (value: T, value2: T, set: AtomSet<T>) => void, thisArg?: unknown): void {
		for (const value of this.keys()) fn.call(thisArg, value, value, this)
	}
}
