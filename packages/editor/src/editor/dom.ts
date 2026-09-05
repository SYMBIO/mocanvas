/**
 * The DOM operations the canvas needs that the platform does not give it
 * directly: reading a pointer event into the editor's own vocabulary, holding
 * on to a pointer for the duration of a drag, moving an element between parents
 * without destroying it, and turning a cursor record into a CSS value.
 *
 * Everything here takes the element or event it works on, so none of it reaches
 * for an ambient `document` — an editor in an iframe or a popped-out window
 * would otherwise be measuring the wrong realm.
 */
import { getOwnerWindow } from "./container"
import type { VecModel } from "./events"
import { TL_CURSOR_TYPES, type TLCursor, type TLCursorType } from "../records/cursor"

/** What {@link getPointerInfo} reads off a pointer event. */
export interface TLPointerInfo {
  /** Position relative to the element the event was read against. */
  point: VecModel
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  /** `metaKey` on Apple platforms, `ctrlKey` elsewhere. */
  accelKey: boolean
  pointerId: number
  button: number
  /** Whether the event came from a pen rather than a mouse or a finger. */
  isPen: boolean
}

/**
 * Read a browser pointer event into the fields the editor's dispatch loop
 * wants, in the coordinate space of `container`.
 *
 * The container is explicit rather than inferred from `event.currentTarget`
 * because the listener is usually on an outer element while coordinates have to
 * be relative to the canvas itself, and because a synthetic React event's
 * `currentTarget` is null by the time an async handler looks at it.
 */
export function getPointerInfo(event: PointerEvent | MouseEvent, container?: Element | null): TLPointerInfo {
  const rect = container?.getBoundingClientRect()
  const pointer = event as Partial<PointerEvent>
  const isApple = isApplePlatform(container)
  return {
    point: {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    },
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    accelKey: isApple ? event.metaKey : event.ctrlKey,
    pointerId: pointer.pointerId ?? 0,
    button: event.button,
    isPen: pointer.pointerType === "pen",
  }
}

function isApplePlatform(el?: Element | null): boolean {
  const nav = getOwnerWindow(el)?.navigator
  if (!nav) return false
  return /Mac|iPod|iPhone|iPad/.test(nav.platform ?? "") || /Mac|iPhone|iPad/.test(nav.userAgent)
}

/**
 * Keep sending this pointer's events to `element` until it is released, even
 * once the pointer leaves the element's box.
 *
 * Without it, dragging a resize handle past the edge of the canvas silently
 * stops updating: the events start going to whatever is under the cursor. Every
 * drag the editor starts takes capture and releases it on pointer up.
 *
 * Never throws. Capture legitimately fails when the pointer has already been
 * lifted — a fast drag out of the window — and there is nothing useful to do
 * about that but carry on.
 */
export function setPointerCapture(element: Element, event: { pointerId: number }): void {
  const target = element as Element & { setPointerCapture?(pointerId: number): void }
  try {
    target.setPointerCapture?.(event.pointerId)
  } catch {
    // The pointer is already gone; the drag will end on the next event anyway.
  }
}

/** Undo a {@link setPointerCapture}. Also never throws, for the same reason. */
export function releasePointerCapture(element: Element, event: { pointerId: number }): void {
  const target = element as Element & {
    releasePointerCapture?(pointerId: number): void
    hasPointerCapture?(pointerId: number): boolean
  }
  try {
    if (target.hasPointerCapture?.(event.pointerId) === false) return
    target.releasePointerCapture?.(event.pointerId)
  } catch {
    // Releasing a capture nobody holds is not an error worth propagating.
  }
}

/**
 * Walk up from `node` to the first `HTMLElement`, or `null`.
 *
 * Event targets are not always elements: a click inside a text shape lands on a
 * `Text` node, and a click on an SVG lands on an `SVGElement` whose
 * `parentElement` chain leads back to HTML. Anything that wants to ask "which
 * shape was this?" has to normalise first.
 */
export function loopToHtmlElement(node: Node | EventTarget | null | undefined): HTMLElement | null {
  let current: Node | null = node && "nodeType" in (node as Node) ? (node as Node) : null
  while (current) {
    // `instanceof HTMLElement` is checked against the *node's own* realm, not
    // the ambient one: an editor inside an iframe has a different constructor.
    const view = (current.ownerDocument ?? (current as Document)).defaultView
    if (view && current instanceof view.HTMLElement) return current
    current = current.parentNode
  }
  return null
}

/**
 * Move `element` to be the last child of `parent`, preserving its state.
 *
 * The reason this is not `parent.appendChild(element)`: removing and re-adding
 * a node resets it. An `<iframe>` reloads, a `<video>` stops, a canvas loses its
 * context, focus is lost. `Node.moveBefore` is the platform's answer and moves a
 * node without disconnecting it; where it is unavailable this falls back to
 * `appendChild`, which does reload — the same trade every browser without the
 * new method forces.
 *
 * Returns `true` when the move preserved state.
 */
export function moveElementInto(parent: Element, element: Element): boolean {
  if (element.parentNode === parent && element.nextSibling === null) return true
  const host = parent as Element & { moveBefore?(node: Node, child: Node | null): void }
  if (typeof host.moveBefore === "function") {
    try {
      host.moveBefore(element, null)
      return true
    } catch {
      // `moveBefore` throws when either node is disconnected from the document,
      // which is exactly the case the caller's "parking lot" pattern exists to
      // avoid — fall through rather than losing the element entirely.
    }
  }
  parent.appendChild(element)
  return false
}

/**
 * The CSS `cursor` value for a cursor record.
 *
 * Directional cursors are stored as a name plus a rotation, because a rotated
 * shape's handles need cursors at arbitrary angles and CSS has only eight
 * names. This renders the rotated ones as an inline SVG data URL and passes the
 * rest through as the plain CSS keyword, which keeps the common case free.
 *
 * SEMANTICS-ASSUMED: the artwork. The docs pin the *names* (`TL_CURSOR_TYPES`)
 * but not the images; these are drawn to the same conventions the platform
 * cursors use — a white-outlined black glyph, 32×32, hot spot at the centre —
 * so a custom cursor sits alongside the native ones without looking foreign.
 */
export function getCursor(cursor: TLCursor | TLCursorType, rotation = 0, color = "black"): string {
  const type = typeof cursor === "string" ? cursor : cursor.type
  const angle = typeof cursor === "string" ? rotation : cursor.rotation

  const direct = DIRECT_CSS_CURSORS[type]
  if (direct && !angle) return direct

  const svg = ROTATABLE_CURSORS[type]
  if (!svg) return direct ?? "default"

  const degrees = (angle * 180) / Math.PI
  const markup = cursorSvg(svg, degrees, color)
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(markup)}") 16 16, ${direct ?? "default"}`
}

/** Cursor names that are already CSS keywords, so no image is needed. */
const DIRECT_CSS_CURSORS: Partial<Record<TLCursorType, string>> = {
  none: "none",
  default: "default",
  pointer: "pointer",
  cross: "crosshair",
  move: "move",
  grab: "grab",
  grabbing: "grabbing",
  text: "text",
  "zoom-in": "zoom-in",
  "zoom-out": "zoom-out",
  "resize-edge": "ew-resize",
  "resize-corner": "nwse-resize",
  rotate: "grab",
  "nwse-resize": "nwse-resize",
  "nesw-resize": "nesw-resize",
  "ns-resize": "ns-resize",
  "ew-resize": "ew-resize",
  "nw-resize": "nw-resize",
  "ne-resize": "ne-resize",
  "se-resize": "se-resize",
  "sw-resize": "sw-resize",
  "n-resize": "n-resize",
  "e-resize": "e-resize",
  "s-resize": "s-resize",
  "w-resize": "w-resize",
}

/** The glyphs that are worth drawing at an arbitrary angle. */
const ROTATABLE_CURSORS: Partial<Record<TLCursorType, string>> = {
  "resize-edge": '<path d="M9 12 5 16l4 4M23 12l4 4-4 4M6 16h20"/>',
  "resize-corner": '<path d="M10 6v6H4M22 26v-6h6M10 12l12 14"/>',
  rotate: '<path d="M22 12a8 8 0 1 0 2 6"/><path d="M22 6v6h-6"/>',
  "ew-resize": '<path d="M9 12 5 16l4 4M23 12l4 4-4 4M6 16h20"/>',
  "ns-resize": '<path d="M12 9 16 5l4 4M12 23l4 4 4-4M16 6v20"/>',
  "nwse-resize": '<path d="M8 14V8h6M24 18v6h-6M9 9l14 14"/>',
  "nesw-resize": '<path d="M24 14V8h-6M8 18v6h6M23 9 9 23"/>',
}

function cursorSvg(path: string, degrees: number, color: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
    `<g transform="rotate(${degrees.toFixed(2)} 16 16)" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<g stroke="white" stroke-width="5">${path}</g>` +
    `<g stroke="${color}" stroke-width="2">${path}</g>` +
    `</g></svg>`
  )
}

/** Every cursor name, re-exported so a picker can enumerate them without a second import. */
export const CURSOR_TYPES: readonly TLCursorType[] = TL_CURSOR_TYPES

/** What {@link isCursorInViewport} needs of an editor. Structural, so this file stays DOM-only. */
export interface TLCursorViewportSource {
  getViewportScreenBounds(): { x: number; y: number; w: number; h: number }
  readonly inputs: { readonly currentScreenPoint: { x: number; y: number } }
}

/**
 * Whether the pointer is currently over the canvas.
 *
 * Used to decide where a paste lands and whether an edge-scroll should start:
 * both should follow the pointer when it is on the canvas, and fall back to the
 * centre of the viewport when it is not — the pointer's last known position is
 * stale and possibly far off screen once it has left.
 */
export function isCursorInViewport(source: TLCursorViewportSource): boolean {
  const bounds = source.getViewportScreenBounds()
  const { x, y } = source.inputs.currentScreenPoint
  // The screen point is container-relative, so the viewport starts at 0,0 in
  // that space regardless of where the container sits on the page.
  return x >= 0 && y >= 0 && x <= bounds.w && y <= bounds.h
}
