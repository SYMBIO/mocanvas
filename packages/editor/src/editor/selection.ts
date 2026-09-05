/**
 * Selection beyond "which ids are selected".
 *
 * Three related jobs live here. **Focus groups** are the drill-in model: double
 * clicking into a group narrows every subsequent gesture to that group's
 * children until you back out again. **Rotated bounds** are what a selection
 * box has to be drawn in when a single rotated shape is selected — the axis
 * aligned box is visibly wrong there. **Adjacent movement** is keyboard
 * navigation: the shape a person means when they press the right arrow.
 */
import { Box, Vec, type VecLike } from "../geometry"
import { isPageId, type PageId, type ShapeId, type UnknownShape } from "../records/base"
import type { Editor } from "./Editor"
import { resolveShape, type ShapeRef } from "./ancestry"

/** A direction for keyboard shape-to-shape movement. */
export type TLAdjacentDirection = "left" | "right" | "up" | "down"

/** The id of the only selected shape, or `null` when zero or many are. */
export function getOnlySelectedShapeId(editor: Editor): ShapeId | null {
  const ids = editor.getSelectedShapeIds()
  return ids.length === 1 ? ids[0]! : null
}

/**
 * Remove shapes from the selection, leaving the rest of it alone.
 *
 * The counterpart to `select()`, and not the same as `setSelectedShapes()` with
 * a shorter list: a caller that only wants to drop one shape should not have to
 * know what else is selected.
 */
export function deselect(editor: Editor, ids: readonly (ShapeId | UnknownShape)[]): void {
  if (ids.length === 0) return
  const drop = new Set(ids.map((id) => (typeof id === "string" ? id : id.id)))
  const next = editor.getSelectedShapeIds().filter((id) => !drop.has(id))
  editor.setSelectedShapes(next)
}

// ---- focus groups ---------------------------------------------------------

/**
 * The container gestures are currently scoped to: a group that has been drilled
 * into, or the current page when none has.
 *
 * Returning the page id rather than `null` for the unfocused case is what lets
 * callers use the result directly as a parent id — the overwhelmingly common
 * thing to do with it.
 */
export function getFocusedGroupId(editor: Editor): ShapeId | PageId {
  return editor.getCurrentPageState().focusedGroupId ?? editor.getCurrentPageId()
}

/** The focused group's record, or `undefined` when the page is focused. */
export function getFocusedGroup(editor: Editor): UnknownShape | undefined {
  const id = editor.getCurrentPageState().focusedGroupId
  return id ? editor.getShape<UnknownShape>(id) : undefined
}

/**
 * Drill into a group, or back out to the page with `null`.
 *
 * Focusing a group while a *different* group is focused is allowed and does not
 * stack: the focus is a position in the tree, not a history. Backing out one
 * level is {@link popFocusedGroupId}.
 */
export function setFocusedGroup(editor: Editor, id: ShapeId | UnknownShape | null): void {
  const next = id === null ? null : typeof id === "string" ? id : id.id
  if (next !== null && !editor.getShape<UnknownShape>(next)) return
  if (getFocusedGroupIdRaw(editor) === next) return
  editor.updateCurrentPageState({ focusedGroupId: next })
}

/**
 * Back out one level of drill-in: focus the focused group's own parent group,
 * or the page when there is none.
 *
 * The escape-key behaviour. Also selects the group being left, so pressing
 * escape twice from inside a group leaves you with the group selected and then
 * with nothing selected — the progression people expect.
 */
export function popFocusedGroupId(editor: Editor): void {
  const current = getFocusedGroup(editor)
  if (!current) {
    editor.selectNone()
    return
  }
  const parentId = isPageId(current.parentId) ? null : current.parentId
  setFocusedGroup(editor, parentId)
  editor.setSelectedShapes([current.id])
}

function getFocusedGroupIdRaw(editor: Editor): ShapeId | null {
  return editor.getCurrentPageState().focusedGroupId
}

// ---- moving the selection around the tree ---------------------------------

/**
 * Select the parents of the selected shapes.
 *
 * A shape already sitting on the page (or directly in the focused group) has no
 * parent to move to and stays selected, so the selection never empties itself
 * on a stray keystroke.
 */
export function selectParentShape(editor: Editor): void {
  const focused = getFocusedGroupId(editor)
  const next = new Set<ShapeId>()
  for (const id of editor.getSelectedShapeIds()) {
    const shape = editor.getShape<UnknownShape>(id)
    if (!shape) continue
    next.add(shape.parentId === focused || isPageId(shape.parentId) ? id : shape.parentId)
  }
  if (next.size > 0) editor.setSelectedShapes([...next])
}

/**
 * Select the first child of the only selected shape — the inverse of
 * {@link selectParentShape}, and what "enter" does on a selected group.
 *
 * A no-op unless exactly one shape is selected and it has children: with
 * several selected there is no single "the" child to descend to.
 */
export function selectFirstChildShape(editor: Editor): void {
  const id = getOnlySelectedShapeId(editor)
  if (!id) return
  const first = editor.getSortedChildIdsForParent(id)[0]
  if (!first) return
  editor.setSelectedShapes([first])
}

/**
 * The shape a person means when they press an arrow key from `shape`.
 *
 * Candidates are the shapes on the current page that lie in `direction` — their
 * centre must be past this shape's edge — and that overlap it on the other
 * axis, so pressing right from a card in a row of cards moves along the row
 * rather than diagonally to something far away.
 *
 * SEMANTICS-ASSUMED: the parameter order is `(shape, direction)`, and the
 * overlap test uses the `adjacentShapeMargin` option as a tolerance so shapes
 * laid out a pixel or two out of line still count as being in the same row.
 * Ties are broken by distance between centres, so the *nearest* aligned shape
 * wins rather than the one that happens to sort first.
 */
export function getNearestAdjacentShape(
  editor: Editor,
  shape: ShapeRef,
  direction: TLAdjacentDirection,
): UnknownShape | undefined {
  const from = resolveShape(editor, shape)
  if (!from) return undefined
  const fromBounds = editor.getShapeMaskedPageBounds(from)
  if (!fromBounds) return undefined

  const margin = editor.options.adjacentShapeMargin
  const horizontal = direction === "left" || direction === "right"
  const sign = direction === "right" || direction === "down" ? 1 : -1

  let best: { shape: UnknownShape; distance: number } | undefined
  for (const candidate of editor.getCurrentPageShapes()) {
    if (candidate.id === from.id) continue
    const bounds = editor.getShapeMaskedPageBounds(candidate)
    if (!bounds) continue

    const along = horizontal ? bounds.center.x - fromBounds.center.x : bounds.center.y - fromBounds.center.y
    if (along * sign <= 0) continue

    // Overlap on the perpendicular axis, with the configured slack.
    const overlaps = horizontal
      ? bounds.maxY >= fromBounds.minY - margin && bounds.minY <= fromBounds.maxY + margin
      : bounds.maxX >= fromBounds.minX - margin && bounds.minX <= fromBounds.maxX + margin
    if (!overlaps) continue

    const distance = Vec.Dist(bounds.center, fromBounds.center)
    if (!best || distance < best.distance) best = { shape: candidate, distance }
  }
  return best?.shape
}

/**
 * Move the selection one shape in `direction`, keeping it a single selection.
 *
 * With nothing selected the first shape in reading order is selected instead,
 * which is what makes arrow keys usable as a way *into* a board and not only as
 * a way around one.
 */
export function selectAdjacentShape(editor: Editor, direction: TLAdjacentDirection): void {
  const currentId = getOnlySelectedShapeId(editor) ?? editor.getSelectedShapeIds().at(-1)
  if (!currentId) {
    const first = editor.getCurrentPageShapesInReadingOrder()[0]
    if (first) editor.setSelectedShapes([first.id])
    return
  }
  const next = getNearestAdjacentShape(editor, currentId, direction)
  if (next) editor.setSelectedShapes([next.id])
}

// ---- selection bounds -----------------------------------------------------

/**
 * The selection's bounds in the selection's OWN rotated frame.
 *
 * With one rotated shape selected the axis-aligned box is visibly too big — it
 * is the bounding box of a tilted rectangle — so the selection UI draws this
 * box and then rotates it by `getSelectionRotation()`. With several shapes
 * selected the rotation is zero and this is the ordinary page bounds.
 *
 * `null` when nothing is selected.
 */
export function getSelectionRotatedPageBounds(editor: Editor): Box | null {
  const shapes = editor.getSelectedShapes()
  if (shapes.length === 0) return null
  const rotation = editor.getSelectionRotation()
  if (rotation === 0) return editor.getSelectionPageBounds()

  // Un-rotate every corner about the origin, take the box there, and the result
  // is the box that — rotated back by the same angle — hugs the selection.
  const points: Vec[] = []
  for (const shape of shapes) {
    const transform = editor.getShapePageTransform(shape)
    const bounds = editor.getShapeGeometryBounds(shape)
    if (!bounds) continue
    for (const corner of bounds.corners) {
      const page = new Vec(
        transform.a * corner.x + transform.c * corner.y + transform.e,
        transform.b * corner.x + transform.d * corner.y + transform.f,
      )
      points.push(Vec.Rot(page, -rotation))
    }
  }
  return points.length === 0 ? null : Box.FromPoints(points)
}

/**
 * The selection's bounds in SCREEN space (window-relative pixels) — where a
 * `position: fixed` toolbar has to be put to sit against the selection.
 */
export function getSelectionScreenBounds(editor: Editor): Box | undefined {
  const bounds = editor.getSelectionPageBounds()
  if (!bounds) return undefined
  const topLeft = editor.pageToScreen({ x: bounds.minX, y: bounds.minY })
  const bottomRight = editor.pageToScreen({ x: bounds.maxX, y: bounds.maxY })
  return Box.FromMinMax(topLeft.x, topLeft.y, bottomRight.x, bottomRight.y)
}

/**
 * {@link getSelectionRotatedPageBounds} in screen space: the rotated box scaled
 * and offset by the camera, still expressed in its own rotated frame.
 *
 * The caller applies `getSelectionRotation()` to it, exactly as with the page
 * space version.
 */
export function getSelectionRotatedScreenBounds(editor: Editor): Box | undefined {
  const bounds = getSelectionRotatedPageBounds(editor)
  if (!bounds) return undefined
  const { z } = editor.getCamera()
  const rotation = editor.getSelectionRotation()
  // The box lives in the un-rotated frame, so its origin has to be taken back
  // to page space before the camera can be applied to it.
  const origin = editor.pageToScreen(Vec.Rot(new Vec(bounds.minX, bounds.minY), rotation))
  return new Box(origin.x, origin.y, bounds.width * z, bounds.height * z)
}

// ---- pointer-relative selection queries -----------------------------------

/**
 * The topmost SELECTED shape under a page point, or `undefined`.
 *
 * The test a pointer-down does before starting a drag: pressing inside the
 * existing selection continues it, pressing outside starts a new one. Asking
 * `getShapeAtPoint` instead would pick up an unselected shape drawn above the
 * selection and get that decision backwards.
 */
export function getSelectedShapeAtPoint(editor: Editor, point: VecLike): UnknownShape | undefined {
  const selected = new Set(editor.getSelectedShapeIds())
  if (selected.size === 0) return undefined
  for (const shape of editor.getShapesAtPoint(point, { hitInside: true })) {
    if (selected.has(shape.id)) return shape
  }
  return undefined
}
