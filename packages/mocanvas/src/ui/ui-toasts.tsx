import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

/**
 * Transient messages: "copied", "could not import that file".
 *
 * Owned by a provider rather than by whichever panel raised one, because a
 * toast has to outlive the menu the user raised it from — the menu closes on
 * the same click.
 */

/** A button on a toast. */
export interface TLUiToastAction {
  type: "primary" | "secondary" | "warn" | "danger"
  label: string
  onClick(): void
}

/** One message. `id` is assigned by {@link TLUiToastsContextType.addToast}. */
export interface TLUiToast {
  id: string
  icon?: string
  severity?: "success" | "info" | "warning" | "error"
  title?: string
  description?: string
  actions?: TLUiToastAction[]
  /** Milliseconds before it removes itself. `0` keeps it until dismissed. */
  keepOpen?: boolean
  closeLabel?: string
}

export interface TLUiToastsContextType {
  addToast(toast: Omit<TLUiToast, "id"> & { id?: string }): string
  removeToast(id: string): void
  clearToasts(): void
  toasts: TLUiToast[]
}

const ToastsContext = createContext<TLUiToastsContextType | null>(null)

const NOOP: TLUiToastsContextType = { addToast: () => "", removeToast: () => {}, clearToasts: () => {}, toasts: [] }

export interface TLUiToastsProviderProps {
  children?: ReactNode
}

let nextToastId = 0

/** Holds the toast list. Render {@link DefaultToasts} inside it. */
export function TldrawUiToastsProvider({ children }: TLUiToastsProviderProps) {
  const [toasts, setToasts] = useState<TLUiToast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const addToast = useCallback((toast: Omit<TLUiToast, "id"> & { id?: string }) => {
    const id = toast.id ?? `toast:${nextToastId++}`
    setToasts((current) => [...current.filter((t) => t.id !== id), { ...toast, id }])
    return id
  }, [])

  const clearToasts = useCallback(() => setToasts([]), [])

  const value = useMemo<TLUiToastsContextType>(
    () => ({ addToast, removeToast, clearToasts, toasts }),
    [addToast, removeToast, clearToasts, toasts],
  )
  return <ToastsContext.Provider value={value}>{children}</ToastsContext.Provider>
}

/** The toast list. Inert outside a provider. */
export function useToasts(): TLUiToastsContextType {
  return useContext(ToastsContext) ?? NOOP
}

/** How long a toast that did not ask to stay open lives for. */
const TOAST_LIFETIME_MS = 5000

function Toast({ toast, onClose }: { toast: TLUiToast; onClose: () => void }) {
  useEffect(() => {
    if (toast.keepOpen) return
    const timer = setTimeout(onClose, TOAST_LIFETIME_MS)
    return () => clearTimeout(timer)
  }, [toast.keepOpen, onClose])

  return (
    <div className="mocanvas-toast mocanvas-panel" role="alert" data-severity={toast.severity ?? "info"}>
      <div className="mocanvas-toast-body">
        {toast.title ? <strong className="mocanvas-toast-title">{toast.title}</strong> : null}
        {toast.description ? <span className="mocanvas-toast-desc">{toast.description}</span> : null}
      </div>
      {toast.actions?.length ? (
        <div className="mocanvas-toast-actions">
          {toast.actions.map((action) => (
            <button key={action.label} type="button" className="mocanvas-btn mocanvas-btn--wide" data-type={action.type} onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
      <button type="button" className="mocanvas-btn" aria-label={toast.closeLabel ?? "Dismiss"} onClick={onClose}>
        ×
      </button>
    </div>
  )
}

/**
 * The toast stack.
 *
 * A `role="log"` region rather than a live region: each toast is itself an
 * alert, and nesting a live region inside another makes screen readers read
 * the whole stack every time one arrives.
 */
export function DefaultToasts() {
  const { toasts, removeToast } = useToasts()
  if (toasts.length === 0) return null
  return (
    <div className="mocanvas-toasts" role="log" aria-label="Notifications">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  )
}

/**
 * How loud a message is.
 *
 * Shared by toasts and by any inline alert an app builds on the same
 * vocabulary, which is why it is named for the severity rather than for the
 * toast: the four levels are a UI concept, not a property of one component.
 */
export type AlertSeverity = NonNullable<TLUiToast["severity"]>
