import { atom, type Atom } from "@mocanvas/state"
import type { Editor } from "./Editor"
import type { EditorEvents } from "./events"

/**
 * The base class for anything that owns subscriptions on behalf of an editor.
 *
 * A manager is a piece of the editor that has to *listen* — to store changes,
 * to editor events, to the DOM — and therefore has to stop listening when the
 * editor goes away. Getting that wrong is the usual cause of "cannot read
 * properties of undefined" after a board is closed: a timer or a listener
 * outlives the store it was written against.
 *
 * Extending this class means the unsubscribe bookkeeping is written once.
 * Register anything that must be undone through {@link register} (or
 * {@link addEditorEvent} for the common case of an editor event), and
 * {@link dispose} unwinds all of it in reverse order, exactly once.
 *
 * Subclasses that need to do their own teardown override {@link dispose} and
 * call `super.dispose()`.
 */
export abstract class EditorManager {
  /**
   * The teardown functions collected so far, oldest first.
   *
   * Public because a host that owns a manager's lifetime (a test, a devtools
   * panel) can meaningfully ask how much is still attached; nothing inside the
   * editor reads it except {@link dispose}.
   */
  readonly disposables: (() => void)[] = []

  private disposed = false

  constructor(readonly editor: Editor) {}

  /**
   * Remember how to undo something, and hand the undo back.
   *
   * Calling the returned function early both runs the teardown and forgets it,
   * so a subscription that ends before the editor does is not run twice. After
   * {@link dispose} this runs `disposable` immediately — a subscription created
   * against a dead editor must not linger.
   */
  register(disposable: () => void): () => void {
    if (this.disposed) {
      disposable()
      return () => {}
    }
    this.disposables.push(disposable)
    return () => {
      const at = this.disposables.indexOf(disposable)
      if (at === -1) return
      this.disposables.splice(at, 1)
      disposable()
    }
  }

  /**
   * Listen to one of the editor's own events for as long as this manager
   * lives. The returned function removes the listener early.
   */
  addEditorEvent<K extends keyof EditorEvents>(name: K, handler: EditorEvents[K]): () => void {
    const off = this.editor.on(name, handler)
    return this.register(off)
  }

  /** Whether {@link dispose} has already run. */
  getIsDisposed(): boolean {
    return this.disposed
  }

  /** Unwind every registered teardown, newest first. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const pending = this.disposables.splice(0, this.disposables.length)
    for (let i = pending.length - 1; i >= 0; i--) pending[i]!()
  }
}

/**
 * A piece of reactive state that belongs to an editor rather than to a module.
 *
 * Library code often wants "one value per editor" — which overlay is hovered,
 * whether a tool has armed itself, a cached measurement. A module-level `atom`
 * is wrong (two editors on one page would share it) and an instance field is
 * wrong too when the code holding the value is not part of the `Editor` class.
 * `EditorAtom` is the middle: declare it once at module scope, and every editor
 * that touches it gets its own atom, created on first use and dropped with the
 * editor.
 *
 * ```ts
 * const hoveredId = new EditorAtom<string | null>("hoveredOverlay", () => null)
 * hoveredId.set(editor, "brush")
 * hoveredId.get(editor) // reactive read
 * ```
 *
 * SEMANTICS-ASSUMED: the per-editor atoms are held in a `WeakMap`, so nothing
 * here keeps a disposed editor alive. The initial value is produced lazily, per
 * editor, so a mutable default (an array, a `Set`) is not shared between them —
 * the trap a plain `initialValue` parameter would set.
 */
export class EditorAtom<T> {
  private readonly atoms = new WeakMap<Editor, Atom<T>>()

  /**
   * @param name - Debug label; the per-editor atoms are named after it.
   * @param getInitialValue - Produces the starting value for an editor that has
   * not touched this state yet. Called at most once per editor.
   */
  constructor(
    private readonly name: string,
    private readonly getInitialValue: (editor: Editor) => T,
  ) {}

  /** The underlying atom for `editor`, created on first use. */
  getAtom(editor: Editor): Atom<T> {
    let existing = this.atoms.get(editor)
    if (!existing) {
      existing = atom<T>(`EditorAtom(${this.name})`, this.getInitialValue(editor))
      this.atoms.set(editor, existing)
    }
    return existing
  }

  /** Read the value. Reactive: reading inside a signal subscribes to it. */
  get(editor: Editor): T {
    return this.getAtom(editor).get()
  }

  /** Replace the value. */
  set(editor: Editor, value: T): T {
    return this.getAtom(editor).set(value)
  }

  /** Derive the next value from the current one. */
  update(editor: Editor, updater: (value: T) => T): T {
    return this.getAtom(editor).update(updater)
  }
}
