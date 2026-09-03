import type { Editor } from "./Editor"
import type { SelectionHandle } from "./events"
import { Box, Vec, type VecLike } from "../geometry"

export const HANDLE_HIT_RADIUS = 8
export const ROTATE_HANDLE_OFFSET = 20

export interface SelectionHandleHit {
  handle: SelectionHandle
  /** Screen-space position of the handle. */
  point: Vec
}

/**
 * Screen-space positions of the selection handles for the current selection,
 * or null if nothing is selected / handles are hidden.
 */
export function getSelectionHandlePositions(editor: Editor): { bounds: Box; rotation: number; handles: SelectionHandleHit[] } | null {
  const selected = editor.getSelectedShapes()
  if (selected.length === 0) return null
  if (selected.length === 1) {
    const util = editor.getShapeUtil(selected[0]!)
    if (util.hideResizeHandles(selected[0]!) && util.hideRotateHandle(selected[0]!)) return null
  }
  const single = selected.length === 1 ? selected[0]! : undefined
  const rotation = single ? editor.getSelectionRotation() : 0
  // Local bounds of a single shape (rotated with it), or the page bounds of many.
  let bounds: Box
  let toScreen: (p: VecLike) => Vec
  if (single) {
    const b = editor.getShapeGeometryBounds(single)!
    const m = editor.getShapePageTransform(single)
    bounds = b
    toScreen = (p) => editor.pageToScreen({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f })
  } else {
    bounds = editor.getSelectionPageBounds()!
    toScreen = (p) => editor.pageToScreen(p)
  }
  const { x, y, w, h } = bounds
  const cx = x + w / 2
  const cy = y + h / 2
  const handles: SelectionHandleHit[] = []
  const hideResize = single ? editor.getShapeUtil(single).hideResizeHandles(single) : false
  const hideRotate = single ? editor.getShapeUtil(single).hideRotateHandle(single) : false
  if (!hideResize) {
    handles.push(
      { handle: "top_left", point: toScreen({ x, y }) },
      { handle: "top_right", point: toScreen({ x: x + w, y }) },
      { handle: "bottom_right", point: toScreen({ x: x + w, y: y + h }) },
      { handle: "bottom_left", point: toScreen({ x, y: y + h }) },
      { handle: "top", point: toScreen({ x: cx, y }) },
      { handle: "right", point: toScreen({ x: x + w, y: cy }) },
      { handle: "bottom", point: toScreen({ x: cx, y: y + h }) },
      { handle: "left", point: toScreen({ x, y: cy }) },
    )
  }
  if (!hideRotate) {
    // rotate handle above the top edge, in screen pixels
    const top = toScreen({ x: cx, y })
    const center = toScreen({ x: cx, y: cy })
    const dir = Vec.Uni(Vec.Sub(top, center))
    const off = Vec.Len(Vec.Sub(top, center)) === 0 ? new Vec(0, -1) : dir
    handles.push({ handle: "rotate", point: Vec.Add(top, Vec.Mul(off, ROTATE_HANDLE_OFFSET)) })
  }
  return { bounds, rotation, handles }
}

/** The selection handle under a screen point, if any. */
export function hitTestSelectionHandles(editor: Editor, screenPoint: VecLike, radius = HANDLE_HIT_RADIUS): SelectionHandle | undefined {
  const info = getSelectionHandlePositions(editor)
  if (!info) return undefined
  let best: SelectionHandle | undefined
  let bestD = radius * radius
  for (const h of info.handles) {
    const d = Vec.Dist2(h.point, screenPoint)
    if (d <= bestD) {
      bestD = d
      best = h.handle
    }
  }
  // Prefer corners over edges when they overlap (small shapes)
  return best
}

/** Is the screen point inside the selection bounds (for dragging the selection as a whole)? */
export function hitTestSelectionBounds(editor: Editor, pagePoint: VecLike): boolean {
  const selected = editor.getSelectedShapes()
  if (selected.length === 0) return false
  if (selected.length === 1) {
    const s = selected[0]!
    const util = editor.getShapeUtil(s)
    if (util.hideSelectionBoundsBg(s)) return false
    const b = editor.getShapeGeometryBounds(s)!
    const local = editor.getPointInShapeSpace(s, pagePoint)
    return Box.ContainsPoint(b, local)
  }
  const b = editor.getSelectionPageBounds()!
  return Box.ContainsPoint(b, pagePoint)
}
