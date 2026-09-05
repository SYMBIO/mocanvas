import { createContext, useContext, type ReactNode } from "react"
import { createPortal } from "react-dom"

/**
 * The editor's container element, published to everything rendered inside it.
 *
 * Chrome needs the container for three things it cannot get any other way:
 * the element to portal a floating layer into (so a menu is clipped by the
 * editor, not by the page), the element to measure when deciding a breakpoint,
 * and the `ownerDocument` to attach listeners to — which is not
 * `globalThis.document` when the editor has been mounted into an iframe or a
 * popped-out window.
 *
 * `<Canvas>` publishes its own container automatically. A piece of chrome that
 * is mounted *outside* the canvas — a dialog layer, a context menu wrapping it
 * — is rendered inside this provider by whoever owns the layout.
 */
const ContainerContext = createContext<HTMLElement | null>(null)

export interface ContainerProviderProps {
  container: HTMLElement
  children?: ReactNode
}

/** Publishes `container` to {@link useContainer} and {@link EditorPortal}. */
export function ContainerProvider({ container, children }: ContainerProviderProps) {
  return <ContainerContext.Provider value={container}>{children}</ContainerContext.Provider>
}

/**
 * The editor's container element.
 *
 * Throws outside a provider, because every use of it is a DOM operation that
 * would otherwise silently target the wrong document. Reach for
 * {@link useContainerIfExists} in a component that must also render on its own.
 */
export function useContainer(): HTMLElement {
  const container = useContext(ContainerContext)
  if (!container) {
    throw new Error("useContainer: no editor container. Render inside <ContainerProvider> (or inside <Canvas>).")
  }
  return container
}

/**
 * The editor's container element, or `null` when there is none.
 *
 * The tolerant reading: for a component that is useful both inside the editor
 * and standing alone — a shape body rendered into an export, a panel under
 * test — and that has a sensible fallback for "no container".
 */
export function useContainerIfExists(): HTMLElement | null {
  return useContext(ContainerContext)
}

/**
 * Where floating layers are portalled to.
 *
 * SEMANTICS-ASSUMED: the host is the container itself rather than a dedicated
 * child node. Portalling into the container keeps a menu inside the editor's
 * stacking and theming context (the CSS custom properties are set on the
 * container), which is the property that makes portalling worth doing at all;
 * a separate host node would have to be created and torn down in lockstep with
 * the container for no additional benefit.
 */
export function useEditorPortalHost(): HTMLElement | null {
  return useContext(ContainerContext)
}

export interface EditorPortalProps {
  /**
   * Portal somewhere other than the editor's container. Useful for a layer
   * that deliberately escapes the editor, e.g. a modal owned by the host app.
   */
  container?: HTMLElement | null
  children?: ReactNode
}

/**
 * Renders `children` into the editor's container rather than in place.
 *
 * Chrome that has to escape an ancestor's `overflow: hidden` or transform —
 * every popover, tooltip and menu — goes through here. With no container
 * available the children are rendered in place instead of thrown away, so a
 * component using it still renders in a test or a server render.
 */
export function EditorPortal({ container, children }: EditorPortalProps) {
  const host = useContainerIfExists()
  const target = container ?? host
  if (!target) return <>{children}</>
  return createPortal(children, target)
}
