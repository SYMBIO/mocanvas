import { atom, transact, type Atom } from "@mocanvas/state"
import {
  isRecordsDiffEmpty,
  reverseRecordsDiff,
  squashRecordDiffs,
  type RecordsDiff,
  type Store,
  type UnknownRecord,
} from "@mocanvas/store"

type Entry<R extends UnknownRecord> = { type: "diff"; diff: RecordsDiff<R> } | { type: "mark"; id: string }

/**
 * Undo/redo over store diffs. Every user-sourced document change is recorded;
 * marks delimit undo steps. Undo applies the reverse of every diff back to the
 * previous mark.
 */
export class HistoryManager<R extends UnknownRecord> {
  private undos: Entry<R>[] = []
  private redos: Entry<R>[] = []
  private ignoring = 0
  private pendingDiff: RecordsDiff<R> | null = null
  private readonly _version: Atom<number>
  private readonly dispose: () => void

  constructor(
    private readonly store: Store<R>,
    private readonly onBatchComplete?: () => void,
  ) {
    this._version = atom("history.version", 0)
    this.dispose = store.listen(
      (entry) => {
        if (this.ignoring > 0) return
        if (isRecordsDiffEmpty(entry.changes)) return
        this.pushDiff(entry.changes)
      },
      { source: "user", scope: "document" },
    )
  }

  private pushDiff(diff: RecordsDiff<R>): void {
    const last = this.undos.at(-1)
    if (last && last.type === "diff") {
      last.diff = squashRecordDiffs([last.diff, diff])
    } else {
      this.undos.push({ type: "diff", diff })
    }
    if (this.redos.length) this.redos = []
    this._version.update((v) => v + 1)
  }

  /** Reactive counter for UI. */
  getVersion(): number {
    return this._version.get()
  }

  getNumUndos(): number {
    return this.undos.filter((e) => e.type === "diff").length
  }

  getNumRedos(): number {
    return this.redos.filter((e) => e.type === "diff").length
  }

  /** Run `fn` without recording its changes. */
  ignore<T>(fn: () => T): T {
    this.ignoring++
    try {
      return fn()
    } finally {
      this.ignoring--
    }
  }

  /** Place a stopping point. Returns the mark id. */
  mark(id: string = `mark:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`): string {
    const last = this.undos.at(-1)
    if (last && last.type === "mark") {
      // collapse consecutive marks
      last.id = id
    } else {
      this.undos.push({ type: "mark", id })
    }
    this._version.update((v) => v + 1)
    return id
  }

  private apply(diff: RecordsDiff<R>): void {
    this.ignore(() => {
      transact(() => {
        this.store.applyDiff(diff, { runCallbacks: true })
      })
    })
  }

  undo(): this {
    this.step("undo", "toMark", undefined)
    return this
  }

  redo(): this {
    this.step("redo", "toMark", undefined)
    return this
  }

  /** Undo to the previous mark and drop the undone entries (no redo). */
  bail(): this {
    this.step("undo", "toMark", undefined, true)
    return this
  }

  /** Undo back to a specific mark and drop the entries. */
  bailToMark(id: string): this {
    this.step("undo", "toSpecificMark", id, true)
    return this
  }

  /** Merge every diff since `id` into one step (the mark stays). */
  squashToMark(id: string): this {
    const i = this.undos.findLastIndex((e) => e.type === "mark" && e.id === id)
    if (i < 0) return this
    const tail = this.undos.splice(i + 1)
    const diffs = tail.filter((e): e is { type: "diff"; diff: RecordsDiff<R> } => e.type === "diff").map((e) => e.diff)
    if (diffs.length) this.undos.push({ type: "diff", diff: squashRecordDiffs(diffs) })
    this._version.update((v) => v + 1)
    return this
  }

  clear(): void {
    this.undos = []
    this.redos = []
    this.pendingDiff = null
    this._version.update((v) => v + 1)
  }

  private step(dir: "undo" | "redo", mode: "toMark" | "toSpecificMark", markId: string | undefined, drop = false): void {
    const from = dir === "undo" ? this.undos : this.redos
    const to = dir === "undo" ? this.redos : this.undos
    if (from.length === 0) return

    // Skip leading marks.
    while (from.length && from.at(-1)!.type === "mark") {
      const m = from.pop()!
      if (!drop) to.push(m)
      if (mode === "toSpecificMark" && (m as { id: string }).id === markId) {
        this._version.update((v) => v + 1)
        return
      }
    }

    const diffs: RecordsDiff<R>[] = []
    while (from.length) {
      const e = from.at(-1)!
      if (e.type === "mark") {
        if (mode === "toMark") break
        // toSpecificMark: pass through marks until the requested one
        from.pop()
        if (!drop) to.push(e)
        if (e.id === markId) break
        continue
      }
      from.pop()
      diffs.push(e.diff)
      if (!drop) to.push(e)
      if (mode === "toMark") break
    }
    if (diffs.length) {
      const combined = squashRecordDiffs(diffs)
      this.apply(dir === "undo" ? reverseRecordsDiff(combined) : combined)
    }
    this._version.update((v) => v + 1)
    this.onBatchComplete?.()
  }

  destroy(): void {
    this.dispose()
  }
}
