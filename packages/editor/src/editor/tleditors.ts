/**
 * The process-wide registry of mounted editors.
 *
 * Getting hold of an editor normally means being inside the React tree that
 * mounted it — `useEditor()`, or the `onMount` handler. Plenty of code is not:
 * a keyboard shortcut installed on `document`, a devtools panel, an automation
 * driving the board from a test, a service worker message handler. That code
 * has no context to read, so it reads this instead.
 *
 * ```ts
 * const editors = useValue("mounted editors", () => tleditors.getMounted(), [])
 * // …or, outside React entirely:
 * const [editor] = tleditors.getMounted()
 * ```
 *
 * The list is reactive: it is backed by an atom, so a `useValue` or `react()`
 * that reads it is re-run when an editor mounts or unmounts.
 */

import { atom, type Signal } from "@mocanvas/state"
import type { Editor } from "./Editor"

/**
 * The registry behind {@link tleditors}. Exported for its type; the one
 * instance every editor registers with is `tleditors`.
 */
export class TLEditorsRegistry {
  private readonly _mounted = atom<readonly Editor[]>("tleditors:mounted", [])

  /**
   * Every editor currently mounted, in the order they mounted.
   *
   * // SEMANTICS-ASSUMED: mount order, and a fresh frozen array on every
   * change. Mount order is the only ordering available without asking the DOM,
   * and it makes `getMounted()[0]` mean "the first editor on the page", which
   * is what a single-editor app wants. A new array identity per change is what
   * lets `useValue` and `computed` compare by reference.
   */
  getMounted(): readonly Editor[] {
    return this._mounted.get()
  }

  /**
   * The list as a signal, for code that wants to subscribe with `react()`
   * rather than read once. Reading `.get()` on it is the same as
   * {@link TLEditorsRegistry.getMounted}.
   */
  get mounted(): Signal<readonly Editor[]> {
    return this._mounted
  }

  /**
   * Add `editor` to the registry, returning the function that removes it
   * again. Registering an editor that is already registered changes nothing
   * and hands back a remover all the same, so a double-invoked effect (React
   * strict mode) cannot leave a duplicate behind.
   */
  register(editor: Editor): () => void {
    this._mounted.update((current) => (current.includes(editor) ? current : Object.freeze([...current, editor])))
    return () => this.unregister(editor)
  }

  /** Remove `editor`. Removing one that is not registered is a no-op. */
  unregister(editor: Editor): void {
    this._mounted.update((current) => (current.includes(editor) ? Object.freeze(current.filter((e) => e !== editor)) : current))
  }
}

/**
 * The registry every mounted `Mocanvas` adds itself to. See
 * {@link TLEditorsRegistry}.
 */
export const tleditors = new TLEditorsRegistry()
