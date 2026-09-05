/**
 * A reactive `Map`.
 *
 * Reading one key subscribes to that key alone, so a computed that looks up a
 * single entry is not woken by every unrelated write. Reading the map's shape
 * (`size`, iteration, a miss on `get`) subscribes to the key set instead, so a
 * later insert or delete does wake it.
 */
import { atom, getWithoutCapture, transact, UNINITIALIZED, type Atom, type Uninitialized } from "./core"

/** A reactive map from `K` to `V`, backed by one atom per key. */
export class AtomMap<K, V> {
	private readonly atoms = new Map<K, Atom<V | Uninitialized>>()
	/**
	 * Bumped whenever a key is added or removed. Anything that depends on which
	 * keys exist — `size`, iteration, a `get` that missed — reads this, so it is
	 * invalidated by an insert without being invalidated by every value write.
	 */
	private readonly keyEpoch: Atom<number>

	constructor(
		readonly name: string,
		entries?: Iterable<readonly [K, V]>,
	) {
		this.keyEpoch = atom(`${name}:keys`, 0)
		if (entries) {
			for (const [key, value] of entries) {
				this.atoms.set(key, atom(`${name}:${String(key)}`, value as V | Uninitialized))
			}
		}
	}

	/** The value for `key`, or `undefined` when there is none. */
	get(key: K): V | undefined {
		const a = this.atoms.get(key)
		if (!a) {
			// Depend on the key set, so inserting `key` later invalidates this read.
			this.keyEpoch.get()
			return undefined
		}
		const value = a.get()
		return value === UNINITIALIZED ? undefined : value
	}

	/** Whether `key` has a value. */
	has(key: K): boolean {
		const a = this.atoms.get(key)
		if (!a) {
			this.keyEpoch.get()
			return false
		}
		return a.get() !== UNINITIALIZED
	}

	/** Set `key`, returning the map so calls can be chained. */
	set(key: K, value: V): this {
		const a = this.atoms.get(key)
		if (a) {
			// One transaction, so a subscriber that reads both the value and the key
			// set (`size`, iteration) is notified once rather than twice.
			transact(() => {
				const wasAbsent = getWithoutCapture(a) === UNINITIALIZED
				a.set(value)
				if (wasAbsent) this.keyEpoch.update((n) => n + 1)
			})
		} else {
			this.atoms.set(key, atom(`${this.name}:${String(key)}`, value as V | Uninitialized))
			this.keyEpoch.update((n) => n + 1)
		}
		return this
	}

	/**
	 * The value for `key`, inserting `defaultValue` first if there is none.
	 *
	 * `defaultValue` is always evaluated by the caller; use
	 * {@link AtomMap.getOrInsertComputed} when producing it is expensive.
	 */
	getOrInsert(key: K, defaultValue: V): V {
		const existing = this.peek(key)
		if (existing !== UNINITIALIZED) return existing
		this.set(key, defaultValue)
		return defaultValue
	}

	/**
	 * The value for `key`, inserting `create()` first if there is none.
	 * `create` runs **only** when the key is absent.
	 */
	getOrInsertComputed(key: K, create: (key: K) => V): V {
		const existing = this.peek(key)
		if (existing !== UNINITIALIZED) return existing
		const value = create(key)
		this.set(key, value)
		return value
	}

	/**
	 * The value for `key`, or `UNINITIALIZED` when there is none — the one read
	 * that can tell a stored `undefined` apart from a missing key. Subscribes the
	 * same way {@link AtomMap.get} does.
	 */
	private peek(key: K): V | Uninitialized {
		const a = this.atoms.get(key)
		if (!a) {
			this.keyEpoch.get()
			return UNINITIALIZED
		}
		return a.get()
	}

	/** Replace `key`'s value with `fn` applied to it. Throws if `key` is absent. */
	update(key: K, fn: (prev: V) => V): V {
		const a = this.atoms.get(key)
		const prev = a ? getWithoutCapture(a) : UNINITIALIZED
		if (!a || prev === UNINITIALIZED) {
			throw new Error(`AtomMap ${this.name}: no entry for ${String(key)}`)
		}
		const next = fn(prev)
		a.set(next)
		return next
	}

	/** Remove `key`. Returns whether it was there. */
	delete(key: K): boolean {
		const a = this.atoms.get(key)
		if (!a || getWithoutCapture(a) === UNINITIALIZED) return false
		transact(() => {
			// The atom is kept and emptied rather than dropped, so anything already
			// subscribed to this key is notified of the removal.
			a.set(UNINITIALIZED)
			this.keyEpoch.update((n) => n + 1)
		})
		return true
	}

	/**
	 * Remove several keys at once, in one transaction. Returns the keys that
	 * were actually there.
	 *
	 * Deleting in a loop wakes every dependent once per key; a bulk delete —
	 * clearing a selection, dropping a page's shapes — should wake them once.
	 */
	deleteMany(keys: Iterable<K>): [K, V][] {
		const deleted: [K, V][] = []
		transact(() => {
			for (const key of keys) {
				const a = this.atoms.get(key)
				if (!a) continue
				const previous = getWithoutCapture(a)
				if (previous === UNINITIALIZED) continue
				a.set(UNINITIALIZED)
				deleted.push([key, previous])
			}
			if (deleted.length > 0) this.keyEpoch.update((n) => n + 1)
		})
		return deleted
	}

	get [Symbol.toStringTag](): string {
		return "AtomMap"
	}

	/** Remove every entry. */
	clear(): void {
		transact(() => {
			let removedAny = false
			for (const a of this.atoms.values()) {
				if (getWithoutCapture(a) === UNINITIALIZED) continue
				a.set(UNINITIALIZED)
				removedAny = true
			}
			if (removedAny) this.keyEpoch.update((n) => n + 1)
		})
	}

	/** How many entries the map holds. */
	get size(): number {
		this.keyEpoch.get()
		let n = 0
		for (const a of this.atoms.values()) if (a.get() !== UNINITIALIZED) n++
		return n
	}

	/** The live keys, in insertion order. */
	*keys(): IterableIterator<K> {
		this.keyEpoch.get()
		for (const [key, a] of this.atoms) {
			if (a.get() !== UNINITIALIZED) yield key
		}
	}

	/** The live values, in insertion order. */
	*values(): IterableIterator<V> {
		this.keyEpoch.get()
		for (const a of this.atoms.values()) {
			const value = a.get()
			if (value !== UNINITIALIZED) yield value
		}
	}

	/** The live entries, in insertion order. */
	*entries(): IterableIterator<[K, V]> {
		this.keyEpoch.get()
		for (const [key, a] of this.atoms) {
			const value = a.get()
			if (value !== UNINITIALIZED) yield [key, value]
		}
	}

	[Symbol.iterator](): IterableIterator<[K, V]> {
		return this.entries()
	}

	forEach(fn: (value: V, key: K, map: AtomMap<K, V>) => void, thisArg?: unknown): void {
		for (const [key, value] of this.entries()) fn.call(thisArg, value, key, this)
	}
}
