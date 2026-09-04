/**
 * Container awareness.
 *
 * The editor may be mounted inside an iframe, an Electron `<webview>`, or a
 * popped-out window. In any of those the ambient `document` / `window` globals
 * belong to the HOST page, not to the one the canvas is actually painted in:
 * measuring text, listening for pointer events or loading a font against the
 * wrong realm silently produces the wrong answer.
 *
 * Everything that would otherwise reach for a bare global goes through these
 * helpers, resolved from the editor's container element.
 *
 * Both return `undefined` rather than throwing when there is no DOM at all
 * (server rendering, plain-node tests, an element that was never attached), so
 * callers decide what a missing realm means for them.
 */

/**
 * The DOM `Document` / `Window` types under names that cannot be shadowed.
 * `Document` is also the name of a mocanvas record type, so any file that
 * touches both needs these aliases to say which one it means.
 */
export type ContainerDocument = Document
export type ContainerWindow = Window

/** The document `el` belongs to, falling back to the ambient one. */
export function getOwnerDocument(el?: Element | null): ContainerDocument | undefined {
  const owner = el?.ownerDocument
  if (owner) return owner
  return typeof globalThis.document === "undefined" ? undefined : globalThis.document
}

/** The window `el` is painted in, falling back to the ambient one. */
export function getOwnerWindow(el?: Element | null): ContainerWindow | undefined {
  const owner = getOwnerDocument(el)?.defaultView
  if (owner) return owner
  return typeof globalThis.window === "undefined" ? undefined : globalThis.window
}
