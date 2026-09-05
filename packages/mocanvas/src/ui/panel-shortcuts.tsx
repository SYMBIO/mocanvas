import { useActions, useTools } from "@mocanvas/editor"
import type { ReactNode } from "react"
import { TldrawUiDialogBody, TldrawUiDialogCloseButton, TldrawUiDialogHeader, TldrawUiDialogTitle, type TLUiDialogProps } from "./ui-dialogs"
import { TldrawUiMenuContextProvider, TldrawUiMenuItem } from "./ui-menu"
import type { TLUiKeyboardShortcutsDialogProps } from "./ui-components"

/**
 * The keyboard shortcuts dialog.
 *
 * Built from the same tool and action lists everything else renders from, so
 * an app that rebinds a key through `overrides` gets a correct shortcuts sheet
 * for free — and, more usefully, cannot end up with one that lies.
 */

/** Every registered tool and action that has a shortcut, grouped. */
export function DefaultKeyboardShortcutsDialogContent() {
  const tools = useTools()
  const actions = useActions()
  const toolItems = Object.values(tools).filter((tool) => tool.kbd)
  const actionItems = Object.values(actions).filter((action) => action.kbd)
  return (
    <TldrawUiMenuContextProvider type="keyboard-shortcuts">
      <section className="mocanvas-shortcut-section">
        <h3>Tools</h3>
        {toolItems.map((tool) => (
          <TldrawUiMenuItem key={tool.id} id={tool.id} label={tool.label} kbd={tool.kbd as string} />
        ))}
      </section>
      <section className="mocanvas-shortcut-section">
        <h3>Actions</h3>
        {actionItems.map((action) => (
          <TldrawUiMenuItem key={action.id} id={action.id} label={action.label} kbd={action.kbd as string} />
        ))}
      </section>
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
