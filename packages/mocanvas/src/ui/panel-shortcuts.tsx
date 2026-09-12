import { useActions, useTools } from "@mocanvas/editor"
import { useMemo, type ReactNode } from "react"
import { TldrawUiDialogBody, TldrawUiDialogCloseButton, TldrawUiDialogHeader, TldrawUiDialogTitle, type TLUiDialogProps } from "./ui-dialogs"
import { TldrawUiMenuContextProvider, TldrawUiMenuItem } from "./ui-menu"
import { useReadonly } from "./ui-actions"
import { KEYBOARD_SHORTCUTS, type TLKeyboardShortcut, type TLKeyboardShortcutGroup } from "./useKeyboardShortcuts"
import { toolKeyMap } from "./useToolShortcuts"
import { actionKeyMap } from "./useActionShortcuts"
import type { TLUiKeyboardShortcutsDialogProps } from "./ui-components"

/**
 * The keyboard shortcuts dialog.
 *
 * Built from the three things that actually install bindings — the
 * {@link KEYBOARD_SHORTCUTS} table that `useKeyboardShortcuts` dispatches
 * through, the UI tool list that `useToolShortcuts` binds, and the UI action
 * list that `useActionShortcuts` binds — rather than from a list written out
 * by hand beside them. A sheet assembled from
 * anything else can drift from the editor it describes, and a shortcut sheet
 * that is wrong is worse than none: the user tries the key, nothing happens,
 * and they stop trusting the rest of the page.
 *
 * It is also why the tool rows come from the *list* and not from the tool's
 * declared `kbd`: an app that rebinds a key through `overrides.tools` gets a
 * correct sheet, and one whose binding lost a fight for the same key does not
 * see a row claiming otherwise.
 */

/** One row: a label and the key that reaches it. */
interface ShortcutRow {
  id: string
  label: string
  kbd: string
}

/** The tools that really answer to a key right now, in tool-list order. */
export function useBoundToolShortcuts(): ShortcutRow[] {
  const tools = useTools()
  const readonly = useReadonly()
  return useMemo(() => {
    const bound = toolKeyMap(tools, readonly)
    const keysByTool = new Map<string, string[]>()
    for (const [key, toolId] of bound) {
      const keys = keysByTool.get(toolId)
      if (keys) keys.push(key)
      else keysByTool.set(toolId, [key])
    }
    const rows: ShortcutRow[] = []
    for (const tool of Object.values(tools)) {
      const keys = keysByTool.get(tool.id)
      if (!keys || keys.length === 0) continue
      rows.push({ id: tool.id, label: tool.label, kbd: keys.join(",") })
    }
    return rows
  }, [tools, readonly])
}

/**
 * The actions that really answer to a key right now, in action-list order.
 *
 * `actionKeyMap` drops anything {@link KEYBOARD_SHORTCUTS} already owns, so an
 * action that shares a binding with the table is listed once, by the table,
 * under the table's label — which is the one that runs.
 */
export function useBoundActionShortcuts(): ShortcutRow[] {
  const actions = useActions()
  const readonly = useReadonly()
  return useMemo(() => {
    const bound = actionKeyMap(actions, readonly)
    const keysByAction = new Map<string, string[]>()
    for (const [key, actionId] of bound) {
      const keys = keysByAction.get(actionId)
      if (keys) keys.push(key)
      else keysByAction.set(actionId, [key])
    }
    const rows: ShortcutRow[] = []
    for (const action of Object.values(actions)) {
      const keys = keysByAction.get(action.id)
      if (!keys || keys.length === 0) continue
      rows.push({ id: action.id, label: action.label, kbd: keys.join(",") })
    }
    return rows
  }, [actions, readonly])
}

const GROUP_ORDER: readonly TLKeyboardShortcutGroup[] = ["Edit", "View", "Arrange", "Canvas"]

/** The table's rows, in the order the sections are shown. */
export function groupKeyboardShortcuts(
  shortcuts: readonly TLKeyboardShortcut[] = KEYBOARD_SHORTCUTS,
): { group: TLKeyboardShortcutGroup; rows: ShortcutRow[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    rows: shortcuts.filter((s) => s.group === group).map((s) => ({ id: s.id, label: s.label, kbd: s.kbd })),
  })).filter((section) => section.rows.length > 0)
}

function Section({ title, rows }: { title: string; rows: readonly ShortcutRow[] }) {
  if (rows.length === 0) return null
  return (
    <section className="mocanvas-shortcut-section" data-section={title}>
      <h3>{title}</h3>
      {rows.map((row) => (
        <TldrawUiMenuItem key={row.id} id={row.id} label={row.label} kbd={row.kbd} />
      ))}
    </section>
  )
}

/** Every shortcut the editor is listening for, grouped. */
export function DefaultKeyboardShortcutsDialogContent() {
  const toolRows = useBoundToolShortcuts()
  const actionRows = useBoundActionShortcuts()
  const sections = groupKeyboardShortcuts()
  return (
    <TldrawUiMenuContextProvider type="keyboard-shortcuts">
      <Section title="Tools" rows={toolRows} />
      {sections.map((section) => (
        <Section key={section.group} title={section.group} rows={section.rows} />
      ))}
      <Section title="Actions" rows={actionRows} />
    </TldrawUiMenuContextProvider>
  )
}

/**
 * The dialog frame. Replace the contents by passing `children`; replace the
 * whole dialog through the `KeyboardShortcutsDialog` component slot.
 */
export function DefaultKeyboardShortcutsDialog({ children }: TLUiKeyboardShortcutsDialogProps) {
  return (
    <>
      <TldrawUiDialogHeader>
        <TldrawUiDialogTitle>Keyboard shortcuts</TldrawUiDialogTitle>
        <TldrawUiDialogCloseButton />
      </TldrawUiDialogHeader>
      <TldrawUiDialogBody className="mocanvas-shortcuts">{children ?? <DefaultKeyboardShortcutsDialogContent />}</TldrawUiDialogBody>
    </>
  )
}

/**
 * The form the dialog stack wants: a component taking `onClose`.
 *
 * `addDialog({ component: KeyboardShortcutsDialogContents })` is the whole
 * call, which is why this exists separately from the panel above.
 */
export function KeyboardShortcutsDialogContents(_props: TLUiDialogProps): ReactNode {
  return <DefaultKeyboardShortcutsDialog />
}
