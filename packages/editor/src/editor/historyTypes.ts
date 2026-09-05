/**
 * The documented shapes of the history system's inputs and entries.
 *
 * The undo stack is not a list of commands — it is a list of *diffs* against
 * the store, separated by *marks*. That choice is what makes undo work when
 * several people are editing at once: a diff can be reversed and rebased,
 * whereas "the resize command" cannot be replayed against a document that has
 * moved underneath it.
 */
import type { RecordsDiff } from "@mocanvas/store"
import type { EditorRecord } from "./createStore"

/**
 * How a batch of changes should be recorded.
 *
 * - `record` — the default: the changes become one undoable step, and the redo
 *   stack is discarded because the future just diverged.
 * - `ignore` — the changes happen but are not undoable. For anything derived
 *   rather than authored: culling flags, presence, layout the editor recomputed.
 * - `record-preserveRedoStack` — recorded, but the redo stack survives. For a
 *   change that is *part of* a redo, so redoing twice still works.
 */
export type TLHistoryRecordingMode = "record" | "ignore" | "record-preserveRedoStack"

/** Options for a batch of history-affecting work. */
export interface TLHistoryBatchOptions {
  history?: TLHistoryRecordingMode | undefined
}

/**
 * Options for `Editor.run`.
 *
 * The same bag as {@link TLHistoryBatchOptions}, plus the ability to run work
 * that would otherwise be refused. `ignoreShapeLock` exists because the lock is
 * a guard against the *person*, not against the program: an app performing a
 * bulk fixup or a migration legitimately needs to write to locked shapes.
 */
export interface TLEditorRunOptions extends TLHistoryBatchOptions {
  /** Allow writes to locked shapes for the duration of the callback. */
  ignoreShapeLock?: boolean | undefined
}

/**
 * One recorded change on the undo stack.
 *
 * `diff` is reversible on its own: undo applies the inverse, redo applies it
 * again. Nothing else about the change is retained, deliberately — a diff that
 * remembered which command produced it would tempt callers into replaying the
 * command instead of the diff.
 */
export interface TLHistoryDiff {
  type: "diff"
  diff: RecordsDiff<EditorRecord>
}

/**
 * A boundary between undo steps.
 *
 * Marks are what make an undo step mean something to a person: without them,
 * every store write would undo separately and a single drag would take fifty
 * presses to reverse. `id` is what `bailToMark` and `squashToMark` address.
 */
export interface TLHistoryMark {
  type: "mark"
  id: string
}

/** An entry on the undo or redo stack: either a change or a boundary. */
export type TLHistoryEntry = TLHistoryDiff | TLHistoryMark
