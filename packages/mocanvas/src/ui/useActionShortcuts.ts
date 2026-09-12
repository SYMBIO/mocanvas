import { useActions, useEditor, type TLUiActionsContextType } from "@mocanvas/editor"
import { useEffect, useRef } from "react"
import { buildShortcutIndex, normalizeKbd, pressedBindings } from "./useKeyboardShortcuts"

/**
 * Bind the keyboard shortcuts declared by the UI *action* list.
 *
 * The counterpart to `useToolShortcuts`, and it exists for the same reason:
 * an action's `kbd` is what the Arrange and Actions menus print beside it, so
 * whatever prints there had better be what fires. Before this, thirteen of
 * them printed a shortcut nothing listened for — ⇧L on Toggle lock, ⌥A/H/D/W/V/S
 * on the align items, ⌥⇧H/V on distribute, ⇧H/V on flip, and bare ] and [ on
 * bring-to-front and send-to-back. A menu that advertises a key and ignores it
 * is worse than one that advertises nothing.
 *
 * Binding the list rather than a second hard-coded table is what keeps the two
 * from drifting again, and it is what makes `TLUiOverrides.actions` mean
 * something: an app that rebinds an action, or adds one with a `kbd`, gets the
 * binding with it.
 */
function isEditable(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
}

/**
 * `{ normalized binding: actionId }` for every action that declares one.
 *
 * Bindings already owned by {@link KEYBOARD_SHORTCUTS} are skipped rather than
 * overridden: those carry behaviour an action item does not (undo coalescing,
 * clipboard fallbacks), and firing both would run the same operation twice.
 */
export function actionKeyMap(actions: TLUiActionsContextType, isReadonly: boolean): Map<string, string> {
  const owned = buildShortcutIndex()
  const map = new Map<string, string>()
  for (const action of Object.values(actions)) {
    if (action.disabled) continue
    if (isReadonly && !action.readonlyOk) continue
    if (!action.kbd) continue
    for (const raw of action.kbd.split(",")) {
      const binding = raw.trim()
      if (binding === "") continue
      const normalized = normalizeKbd(binding)
      if (owned.has(normalized)) continue
      // First declaration wins, so a later item cannot silently steal a
      // binding an earlier one already answers to.
      if (!map.has(normalized)) map.set(normalized, action.id)
    }
  }
  return map
}

/** Binds the action list's shortcuts for as long as the calling component is mounted. */
export function useActionShortcuts(): void {
  const editor = useEditor()
  const actions = useActions()
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return
      if (editor.getEditingShapeId()) return
      const map = actionKeyMap(actionsRef.current, editor.getInstanceState().isReadonly)
      for (const binding of pressedBindings(e)) {
        const id = map.get(binding)
        if (id === undefined) continue
        const action = actionsRef.current[id]
        if (!action) continue
        e.preventDefault()
        action.onSelect("kbd")
        return
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [editor])
}

/** Component form, so the hook can be mounted from inside the UI provider. */
export function ActionShortcuts() {
  useActionShortcuts()
  return null
}
