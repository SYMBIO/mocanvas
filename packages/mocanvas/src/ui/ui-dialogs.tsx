import { EditorPortal } from "@mocanvas/editor"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react"

/**
 * Modal dialogs, and the stack that owns them.
 *
 * Opening a dialog is a *data* operation — `addDialog({ component })` — rather
 * than rendering one in place, because the code that opens a dialog is almost
 * always a menu item that unmounts on the same click.
 */

/** What a dialog component is rendered with. */
export interface TLUiDialogProps {
  /** Close this dialog. Also called when the backdrop or Escape closes it. */
  onClose(): void
}

/** One entry on the dialog stack. */
export interface TLUiDialog {
  id: string
  /** Rendered inside the modal frame. */
  component: ComponentType<TLUiDialogProps>
  /** Called after the dialog is removed, however it was closed. */
  onClose?(): void
  /** Let a click on the backdrop close it. Defaults to `true`. */
  preventBackdropClose?: boolean
}

export interface TLUiDialogsContextType {
  addDialog(dialog: Omit<TLUiDialog, "id"> & { id?: string }): string
  removeDialog(id: string): void
  clearDialogs(): void
  dialogs: TLUiDialog[]
}

const DialogsContext = createContext<TLUiDialogsContextType | null>(null)

const NOOP: TLUiDialogsContextType = { addDialog: () => "", removeDialog: () => {}, clearDialogs: () => {}, dialogs: [] }

export interface TLUiDialogsProviderProps {
  children?: ReactNode
}

let nextDialogId = 0

/** Holds the dialog stack. Render {@link DefaultDialogs} inside it. */
export function TldrawUiDialogsProvider({ children }: TLUiDialogsProviderProps) {
  const [dialogs, setDialogs] = useState<TLUiDialog[]>([])

  const removeDialog = useCallback((id: string) => {
    setDialogs((current) => {
      current.find((dialog) => dialog.id === id)?.onClose?.()
      return current.filter((dialog) => dialog.id !== id)
    })
  }, [])

  const addDialog = useCallback((dialog: Omit<TLUiDialog, "id"> & { id?: string }) => {
    const id = dialog.id ?? `dialog:${nextDialogId++}`
    setDialogs((current) => [...current.filter((d) => d.id !== id), { ...dialog, id }])
    return id
  }, [])

  const clearDialogs = useCallback(() => {
    setDialogs((current) => {
      for (const dialog of current) dialog.onClose?.()
      return []
    })
  }, [])

  const value = useMemo<TLUiDialogsContextType>(
    () => ({ addDialog, removeDialog, clearDialogs, dialogs }),
    [addDialog, removeDialog, clearDialogs, dialogs],
  )
  return <DialogsContext.Provider value={value}>{children}</DialogsContext.Provider>
}

/** The dialog stack. Inert outside a provider. */
export function useDialogs(): TLUiDialogsContextType {
  return useContext(DialogsContext) ?? NOOP
}

/** Everything inside a dialog that the keyboard can reach. */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * The modal frame: backdrop, focus trap, Escape.
 *
 * The trap is the part a dialog cannot do without. Without it, Tab walks out
 * of the dialog and onto the canvas behind it, which is both wrong and
 * invisible — the focus ring is under the backdrop.
 */
function DialogFrame({ dialog, onClose }: { dialog: TLUiDialog; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const returnFocusTo = useRef<Element | null>(null)

  useEffect(() => {
    returnFocusTo.current = ref.current?.ownerDocument.activeElement ?? null
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? ref.current)?.focus()
    return () => {
      const previous = returnFocusTo.current
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== "Tab") return
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (items.length === 0) return
    const first = items[0]!
    const last = items[items.length - 1]!
    const active = ref.current?.ownerDocument.activeElement
    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const Component = dialog.component
  return (
    <div
      className="mocanvas-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !dialog.preventBackdropClose) onClose()
      }}
    >
      <div ref={ref} className="mocanvas-dialog mocanvas-panel" role="dialog" aria-modal="true" tabIndex={-1} onKeyDown={onKeyDown}>
        <Component onClose={onClose} />
      </div>
    </div>
  )
}

/** Renders the dialog stack into the editor's container. */
export function DefaultDialogs() {
  const { dialogs, removeDialog } = useDialogs()
  if (dialogs.length === 0) return null
  return (
    <EditorPortal>
      {dialogs.map((dialog) => (
        <DialogFrame key={dialog.id} dialog={dialog} onClose={() => removeDialog(dialog.id)} />
      ))}
    </EditorPortal>
  )
}

// ---------------------------------------------------------------------------
// The pieces a dialog is built from
// ---------------------------------------------------------------------------

export interface TLUiDialogHeaderProps {
  className?: string
  children?: ReactNode
}

/** A dialog's title bar. */
export function TldrawUiDialogHeader({ className, children }: TLUiDialogHeaderProps) {
  return <div className={className ? `mocanvas-dialog-header ${className}` : "mocanvas-dialog-header"}>{children}</div>
}

export interface TLUiDialogTitleProps {
  className?: string
  children?: ReactNode
}

/**
 * A dialog's title. Rendered as an `<h2>` so the dialog has a heading in the
 * document outline, not just a bold line.
 */
export function TldrawUiDialogTitle({ className, children }: TLUiDialogTitleProps) {
  return <h2 className={className ? `mocanvas-dialog-title ${className}` : "mocanvas-dialog-title"}>{children}</h2>
}

/** The dialog's close affordance. Reads `onClose` from the enclosing dialog. */
export function TldrawUiDialogCloseButton() {
  const { dialogs, removeDialog } = useDialogs()
  const top = dialogs[dialogs.length - 1]
  return (
    <button
      type="button"
      className="mocanvas-btn mocanvas-dialog-close"
      aria-label="Close"
      onClick={() => {
        if (top) removeDialog(top.id)
      }}
    >
      ×
    </button>
  )
}

export interface TLUiDialogBodyProps {
  className?: string
  style?: React.CSSProperties
  children?: ReactNode
}

/** A dialog's scrollable middle. */
export function TldrawUiDialogBody({ className, style, children }: TLUiDialogBodyProps) {
  return (
    <div className={className ? `mocanvas-dialog-body ${className}` : "mocanvas-dialog-body"} style={style}>
      {children}
    </div>
  )
}

export interface TLUiDialogFooterProps {
  className?: string
  children?: ReactNode
}

/** A dialog's button row. */
export function TldrawUiDialogFooter({ className, children }: TLUiDialogFooterProps) {
  return <div className={className ? `mocanvas-dialog-footer ${className}` : "mocanvas-dialog-footer"}>{children}</div>
}

export interface ExampleDialogProps extends TLUiDialogProps {
  title?: string
  body?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  displayDontShowAgain?: boolean
  onCancel?(): void
  onContinue?(): void
}

/**
 * A confirm/cancel dialog, complete.
 *
 * Exists so an app that only needs "are you sure?" does not have to assemble
 * one out of the five pieces above — and so the pieces have a worked example
 * to copy when it needs something else.
 */
export function ExampleDialog({
  title = "Title",
  body = "Description",
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  displayDontShowAgain = false,
  onCancel,
  onContinue,
  onClose,
}: ExampleDialogProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false)
  return (
    <>
      <TldrawUiDialogHeader>
        <TldrawUiDialogTitle>{title}</TldrawUiDialogTitle>
        <TldrawUiDialogCloseButton />
      </TldrawUiDialogHeader>
      <TldrawUiDialogBody>{body}</TldrawUiDialogBody>
      <TldrawUiDialogFooter>
        {displayDontShowAgain ? (
          <label className="mocanvas-dialog-checkbox">
            <input type="checkbox" checked={dontShowAgain} onChange={(event) => setDontShowAgain(event.target.checked)} />
            Don&rsquo;t show again
          </label>
        ) : null}
        <button
          type="button"
          className="mocanvas-btn mocanvas-btn--wide"
          onClick={() => {
            onCancel?.()
            onClose()
          }}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className="mocanvas-btn mocanvas-btn--wide"
          onClick={() => {
            onContinue?.()
            onClose()
          }}
        >
          {confirmLabel}
        </button>
      </TldrawUiDialogFooter>
    </>
  )
}
