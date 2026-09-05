/**
 * Diff-carrying signals.
 *
 * A plain signal only says *that* it changed. Some consumers — the store's
 * incremental queries above all — need to know *what* changed, so that a
 * derived collection can be patched instead of rebuilt. A signal can therefore
 * keep a short history of diffs alongside its value, and a dependent that knows
 * the epoch of its own last run can ask for the diffs recorded since then.
 *
 * There are two ways to produce those diffs:
 *
 * - `atom(name, value, { historyLength, computeDiff })` — the atom derives the
 *   diff from the old and new values whenever it is written.
 * - `computed(name, fn, { historyLength })` where `fn` returns
 *   {@link withDiff}`(value, diff)` — the derivation already knows the diff and
 *   hands it over directly.
 *
 * History is finite. When a caller asks for diffs from further back than the
 * buffer reaches — or when the signal could not describe a change as a diff at
 * all — the answer is {@link RESET_VALUE}, meaning "start again from the
 * value".
 */

/**
 * "I cannot express this as a diff — read the value instead."
 *
 * Returned by {@link ComputeDiff} when a change has no meaningful diff, and by
 * `getDiffSince` when the requested epoch has fallen out of the history buffer.
 */
export const RESET_VALUE: unique symbol = Symbol("RESET_VALUE")

/** The type of {@link RESET_VALUE}, for signatures that mention it. */
export type ResetValue = typeof RESET_VALUE

/**
 * Derives the diff between two values of a signal.
 *
 * `lastComputedEpoch` and `currentEpoch` are passed so a derivation that keeps
 * its own history can decide the span is too wide to describe and bail out with
 * {@link RESET_VALUE}.
 */
export type ComputeDiff<Value, Diff> = (
  previousValue: Value,
  currentValue: Value,
  lastComputedEpoch: number,
  currentEpoch: number,
) => Diff | ResetValue

/**
 * A value paired with the diff that produced it, as returned from a computed
 * that knows how it changed. Construct one with {@link withDiff}.
 */
export class WithDiff<Value, Diff> {
  constructor(
    readonly value: Value,
    readonly diff: Diff,
  ) {}
}

/**
 * Return a value together with the diff describing how it changed.
 *
 * ```ts
 * const $ids = computed('ids', (prev) => {
 *   if (isUninitialized(prev)) return new Set(source.get())
 *   const next = new Set(source.get())
 *   return withDiff(next, { added: [...] , removed: [...] })
 * }, { historyLength: 10 })
 * ```
 */
export function withDiff<Value, Diff>(value: Value, diff: Diff): WithDiff<Value, Diff> {
  return new WithDiff(value, diff)
}

/** Whether `value` is a {@link WithDiff} wrapper rather than a bare value. */
export function isWithDiff<Value, Diff>(value: unknown): value is WithDiff<Value, Diff> {
  return value instanceof WithDiff
}

interface HistoryEntry<Diff> {
  /** The epoch the signal was at *before* this change. */
  readonly fromEpoch: number
  /** The epoch the signal reached with this change. */
  readonly toEpoch: number
  readonly diff: Diff
}

/**
 * A bounded ring of recent diffs.
 *
 * Only signals that were given a `historyLength` allocate one; everything else
 * answers `getDiffSince` with {@link RESET_VALUE} at no cost.
 */
export class HistoryBuffer<Diff> {
  private readonly entries: (HistoryEntry<Diff> | undefined)[]
  private index = 0
  /**
   * The earliest epoch this buffer can still answer for. Raised when an entry
   * is evicted (its change is no longer described) and when a change arrives
   * that has no diff at all.
   */
  private oldestSafeEpoch = -1

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`historyLength must be a positive integer, got ${String(capacity)}`)
    }
    this.entries = new Array<HistoryEntry<Diff> | undefined>(capacity)
  }

  /**
   * Record a diff. A `RESET_VALUE` diff means this change cannot be described,
   * so everything up to and including it becomes unanswerable.
   */
  pushEntry(fromEpoch: number, toEpoch: number, diff: Diff | ResetValue): void {
    if (diff === RESET_VALUE) {
      this.clear()
      this.oldestSafeEpoch = toEpoch
      return
    }
    const evicted = this.entries[this.index]
    this.entries[this.index] = { fromEpoch, toEpoch, diff }
    this.index = (this.index + 1) % this.capacity
    if (evicted && evicted.toEpoch > this.oldestSafeEpoch) this.oldestSafeEpoch = evicted.toEpoch
  }

  clear(): void {
    this.entries.fill(undefined)
    this.index = 0
    this.oldestSafeEpoch = -1
  }

  /**
   * Every diff recorded after `epoch`, oldest first, or {@link RESET_VALUE}
   * when the history does not reach back that far.
   */
  getChangesSince(epoch: number): Diff[] | ResetValue {
    if (epoch < this.oldestSafeEpoch) return RESET_VALUE
    const result: Diff[] = []
    // Walk oldest-to-newest through the ring: `index` is the next slot to
    // overwrite, so it is also the oldest entry.
    for (let i = 0; i < this.capacity; i++) {
      const entry = this.entries[(this.index + i) % this.capacity]
      if (!entry) continue
      if (entry.toEpoch <= epoch) continue
      result.push(entry.diff)
    }
    return result
  }
}
