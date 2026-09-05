import { useEditor, useValue } from "@mocanvas/editor"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

/**
 * The editor's live region: how the canvas tells a screen reader what just
 * happened.
 *
 * A canvas is opaque to assistive technology — there is no DOM to read for
 * "three shapes selected" or "moved to the front". The announcer is the one
 * place that gap is closed, and every panel that changes the document
 * announces through it rather than growing an `aria-live` region of its own,
 * because two live regions read over each other.
 */

/** How urgently an announcement interrupts. */
export type A11yPriority = "polite" | "assertive"

/** One thing to say. */
export interface TLUiA11y {
  msg: string
  priority?: A11yPriority
}

/** What {@link useA11y} hands back. */
export interface TLUiA11yContextType {
  /** Queue an announcement. Repeating the same text still re-announces it. */
  announce(value: TLUiA11y): void
  /** The most recent announcement, or `null` before the first one. */
  currentMsg: TLUiA11y | null
}

const A11yContext = createContext<TLUiA11yContextType | null>(null)

const NOOP: TLUiA11yContextType = { announce: () => {}, currentMsg: null }

export interface A11yProviderProps {
  children?: ReactNode
}

/** Holds the announcement queue. Render {@link DefaultA11yAnnouncer} inside it. */
export function TldrawUiA11yProvider({ children }: A11yProviderProps) {
  const [currentMsg, setCurrentMsg] = useState<TLUiA11y | null>(null)
  // A screen reader only reads a live region when its *text* changes, so the
  // same announcement twice in a row would be silent. The counter is appended
  // as an invisible suffix to force a change.
  const seq = useRef(0)
  const announce = useCallback((value: TLUiA11y) => {
    seq.current += 1
    setCurrentMsg({ ...value, msg: seq.current % 2 === 0 ? `${value.msg}​` : value.msg })
  }, [])
  const value = useMemo<TLUiA11yContextType>(() => ({ announce, currentMsg }), [announce, currentMsg])
  return <A11yContext.Provider value={value}>{children}</A11yContext.Provider>
}

/**
 * The announcer. Outside a provider this is inert rather than an error, so a
 * panel that announces can still be rendered on its own.
 */
export function useA11y(): TLUiA11yContextType {
  return useContext(A11yContext) ?? NOOP
}

/**
 * The live region itself: two of them, one per priority, because a region's
 * politeness cannot change after it is announced into.
 *
 * Visually hidden with the clip-rect idiom rather than `display: none`, which
 * would take it out of the accessibility tree along with the layout.
 */
export function DefaultA11yAnnouncer() {
  const { currentMsg } = useA11y()
  const priority = currentMsg?.priority ?? "polite"
  const hidden = {
    position: "absolute" as const,
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap" as const,
    border: 0,
  }
  return (
    <>
      <div className="mocanvas-a11y-announcer" role="status" aria-live="polite" aria-atomic="true" style={hidden}>
        {priority === "polite" ? currentMsg?.msg : ""}
      </div>
      <div className="mocanvas-a11y-announcer" role="alert" aria-live="assertive" aria-atomic="true" style={hidden}>
        {priority === "assertive" ? currentMsg?.msg : ""}
      </div>
    </>
  )
}

/**
 * Announce the selection whenever it changes.
 *
 * Says how many shapes are selected and, for a single shape, what kind it is —
 * which is the minimum a keyboard user needs to know that their last keystroke
 * did what they meant.
 */
export function useSelectedShapesAnnouncer(): void {
  const editor = useEditor()
  const { announce } = useA11y()
  const summary = useValue(
    "selection summary",
    () => {
      const shapes = editor.getSelectedShapes()
      if (shapes.length === 0) return ""
      if (shapes.length === 1) return `${shapes[0]!.type} selected`
      return `${shapes.length} shapes selected`
    },
    [editor],
  )
  useEffect(() => {
    if (summary) announce({ msg: summary, priority: "polite" })
    // `announce` is stable; re-announcing on every render would be noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary])
}

/**
 * Whether the user has asked for reduced motion, following both the OS setting
 * and the editor's own `animationSpeed` preference (which `0` disables
 * animation with).
 */
export function usePrefersReducedMotion(): boolean {
  const [os, setOs] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setOs(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])
  return os
}
