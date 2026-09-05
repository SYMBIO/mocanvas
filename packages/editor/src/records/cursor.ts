/**
 * The cursor the canvas shows, as a record field rather than a CSS string.
 *
 * It is stored on `instance` (and mirrored onto `instance_presence`, so
 * collaborators see the same pointer a person sees) because the cursor is
 * derived state: which tool is active, what is under the pointer, whether a
 * resize handle is being dragged. A string would be fine for one editor; a
 * closed set of names plus a rotation is what lets a collaborator's cursor be
 * drawn by a renderer that never ran the interaction that produced it.
 */

import { T } from "../validation/T"

/**
 * Every cursor the canvas can show.
 *
 * The resize cursors (`ew-resize`, `nwse-resize`, …) are stored as a *name plus
 * a rotation* rather than as eight separate images: a rotated shape's handles
 * need cursors at arbitrary angles, and there are only so many CSS names.
 */
export const TL_CURSOR_TYPES = [
  "none",
  "default",
  "pointer",
  "cross",
  "move",
  "grab",
  "grabbing",
  "text",
  "zoom-in",
  "zoom-out",
  "resize-edge",
  "resize-corner",
  "rotate",
  "nwse-resize",
  "nesw-resize",
  "ns-resize",
  "ew-resize",
  "nw-resize",
  "ne-resize",
  "se-resize",
  "sw-resize",
  "n-resize",
  "e-resize",
  "s-resize",
  "w-resize",
] as const

/** One of {@link TL_CURSOR_TYPES}. */
export type TLCursorType = (typeof TL_CURSOR_TYPES)[number]

/**
 * The cursor to show, and how far to rotate it.
 *
 * `rotation` is in radians and only means anything for the directional cursors;
 * it is what keeps a resize cursor pointing along the edge of a rotated shape.
 */
export interface TLCursor {
  type: TLCursorType
  rotation: number
}

export const cursorTypeValidator = T.literalEnum(...TL_CURSOR_TYPES)

export const cursorValidator = T.object({
  type: cursorTypeValidator,
  rotation: T.number,
})
