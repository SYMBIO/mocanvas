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
 * What to call a shape out loud.
 *
 * The record's `type` is the useful answer for most shapes, but not for `geo`:
 * every rectangle, ellipse and star is a "geo", which tells a listener
 * nothing. The kind lives in `props.geo`, so that is what gets said.
 */
function describeShape(shape: { type: string; props?: unknown }): string {
  if (shape.type !== "geo") return shape.type
  const geo = (shape.props as Record<string, unknown> | undefined)?.["geo"]
  return typeof geo === "string" && geo !== "" ? geo : shape.type
}

/**
 * Announce the selection whenever it changes.
 *
 * Says how many shapes are selected and, for a single shape, what kind it is —
 * which is the minimum a keyboard user needs to know that their last keystroke
 * did what they meant.
 *
 * Under {@link ToggleEnhancedA11yModeItem} it also reads back position and
 * size. That is deliberately not the default: it is what a person wants when
 * they are placing something by keyboard, and unbearable when they are only
 * tabbing through a board.
 */
export function useSelectedShapesAnnouncer(): void {
  const editor = useEditor()
  const { announce } = useA11y()
  const summary = useValue(
    "selection summary",
    () => {
      const shapes = editor.getSelectedShapes()
      if (shapes.length === 0) return ""
      const enhanced = editor.user.getIsEnhancedA11yMode()
      if (shapes.length === 1) {
        const shape = shapes[0]!
        const name = describeShape(shape)
        if (!enhanced) return `${name} selected`
        const bounds = editor.getShapePageBounds(shape)
        if (!bounds) return `${name} selected`
        // Rounded: a screen reader reading "271.83164" is worse than useless,
        // and nothing a person does by ear needs sub-pixel precision.
        return `${name} selected, at ${Math.round(bounds.x)}, ${Math.round(bounds.y)}, ${Math.round(bounds.w)} by ${Math.round(bounds.h)}`
      }
      if (!enhanced) return `${shapes.length} shapes selected`
      const bounds = editor.getSelectionPageBounds()
      if (!bounds) return `${shapes.length} shapes selected`
      return `${shapes.length} shapes selected, ${Math.round(bounds.w)} by ${Math.round(bounds.h)}`
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
 * Runs {@link useSelectedShapesAnnouncer}. Draws nothing.
 *
 * Separate from {@link DefaultA11yAnnouncer} — which is the live region, the
 * place announcements land — because the two are independently replaceable:
 * an app that swaps the `A11y` slot for its own region still wants the
 * editor's selection announcements delivered into it. Before this existed the
 * regions rendered and nothing ever announced into them, so a screen reader
 * heard nothing at all when the selection changed.
 */
export function SelectionAnnouncer() {
  useSelectedShapesAnnouncer()
  return null
}

/** Whether the *operating system* asks for reduced motion. */
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

/**
 * Whether motion is reduced right now: the user's `animationSpeed`
 * preference, or — while they have expressed none — the operating system's.
 *
 * The distinction matters for a checkbox. Reading only the combined value
 * leaves a box that is already ticked because of the OS setting and does not
 * untick when pressed, which is a control that appears broken. Reading the
 * raw preference (`undefined` for "not set") lets the box start in the state
 * the OS asked for and still respond to every press.
 */
export function useReduceMotion(): boolean {
  const editor = useEditor()
  const os = usePrefersReducedMotion()
  const preference = useValue("animationSpeed", () => editor.user.getUserPreferences().animationSpeed, [editor])
  return preference === undefined ? os : preference === 0
}

/**
 * Puts `data-reduce-motion` on the editor's container while motion is
 * reduced, so `ui.css` can switch off the chrome's transitions.
 *
 * An attribute rather than a class because the container belongs to the host:
 * adding to `className` would fight whatever the app set there.
 */
export function ReduceMotionAttribute() {
  const editor = useEditor()
  const reduced = useReduceMotion()
  useEffect(() => {
    const container = editor.getContainer()
    if (!container) return
    if (reduced) container.setAttribute("data-reduce-motion", "true")
    else container.removeAttribute("data-reduce-motion")
    return () => container.removeAttribute("data-reduce-motion")
  }, [editor, reduced])
  return null
}
