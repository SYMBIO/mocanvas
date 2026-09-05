/**
 * Walking the shape tree.
 *
 * Grouping, framing and reparenting are all the same question asked in
 * different directions — who is above this shape, who is below it, and which
 * ancestor do two shapes have in common. The answers are pure functions of the
 * store, so they live here rather than on `Editor`, which only re-exports them
 * as methods.
 *
 * Every walk in this file is loop-safe: a corrupt snapshot whose parent chain
 * cycles stops at the repeat instead of hanging the tab.
 */
import { isPageId, type PageId, type ShapeId, type UnknownShape } from "../records/base"
import type { Editor } from "./Editor"

/** How a caller may name a shape: by record or by id. */
export type ShapeRef = UnknownShape | ShapeId

/** Resolve either spelling of a shape reference to a record. */
export function resolveShape(editor: Editor, ref: ShapeRef | undefined): UnknownShape | undefined {
  if (ref === undefined) return undefined
  return typeof ref === "string" ? editor.getShape<UnknownShape>(ref) : ref
}

/**
 * The nearest ancestor of `shape` that `predicate` accepts, or `undefined`.
 *
 * Searches upwards from the shape's parent, so a shape is never its own
 * ancestor. This is how a tool finds "the frame I am inside" or "the outermost
 * group holding me" without writing the walk again.
 */
export function findShapeAncestor(
  editor: Editor,
  shape: ShapeRef | undefined,
  predicate: (parent: UnknownShape) => boolean,
): UnknownShape | undefined {
  const start = resolveShape(editor, shape)
  if (!start) return undefined
  const seen = new Set<ShapeId>([start.id])
  let current: UnknownShape | undefined = start
  while (current && !isPageId(current.parentId)) {
    const parent: UnknownShape | undefined = editor.getShape<UnknownShape>(current.parentId)
    if (!parent || seen.has(parent.id)) return undefined
    if (predicate(parent)) return parent
    seen.add(parent.id)
    current = parent
  }
  return undefined
}

/**
 * The innermost shape that every one of `shapes` sits inside, or `undefined`
 * when they only share the page.
 *
 * This is what decides where a new group goes: a group made from two shapes in
 * the same frame belongs in that frame, not on the page. With `predicate`, only
 * ancestors that satisfy it are considered — pass `isGroup` to find the common
 * *group* rather than the common parent of any kind.
 *
 * A single shape's answer is its own nearest accepted ancestor; an empty list
 * has no answer at all.
 */
export function findCommonAncestor(
  editor: Editor,
  shapes: readonly ShapeRef[],
  predicate?: (shape: UnknownShape) => boolean,
): ShapeId | undefined {
  const records = shapes.map((s) => resolveShape(editor, s)).filter((s): s is UnknownShape => !!s)
  if (records.length === 0) return undefined

  // The first shape's ancestor chain, outermost first, is the only chain any
  // common ancestor can come from; intersecting it with each other chain leaves
  // exactly the shared prefix.
  const chainOf = (shape: UnknownShape): ShapeId[] => {
    const ids = editor.getShapeAncestors(shape).map((a) => a.id)
    return predicate ? ids.filter((id) => predicate(editor.getShape<UnknownShape>(id)!)) : ids
  }

  let common = chainOf(records[0]!)
  for (let i = 1; i < records.length && common.length > 0; i++) {
    const other = new Set(chainOf(records[i]!))
    let keep = 0
    while (keep < common.length && other.has(common[keep]!)) keep++
    common = common.slice(0, keep)
  }
  return common.at(-1)
}

/**
 * Whether `ancestorId` is somewhere above `shape` in the tree.
 *
 * False for a shape asked about itself: "is my own descendant" is the question
 * a reparent guard is really asking, and answering `true` there would let a
 * shape be dropped into itself.
 */
export function hasAncestor(editor: Editor, shape: ShapeRef | undefined, ancestorId: ShapeId): boolean {
  return findShapeAncestor(editor, shape, (parent) => parent.id === ancestorId) !== undefined
}

/**
 * Call `visitor` for every descendant of `parent`, depth first, in draw order.
 *
 * Returning `false` from the visitor prunes that branch — its children are not
 * visited — which is what makes this usable for "collect until you reach a
 * frame" walks rather than only for full traversals.
 */
export function visitDescendants(
  editor: Editor,
  parent: PageId | ShapeId,
  visitor: (id: ShapeId) => void | false,
): void {
  const seen = new Set<string>([parent])
  const walk = (parentId: PageId | ShapeId): void => {
    for (const childId of editor.getSortedChildIdsForParent(parentId)) {
      if (seen.has(childId)) continue
      seen.add(childId)
      if (visitor(childId) === false) continue
      walk(childId)
    }
  }
  walk(parent)
}

/**
 * Every id in `ids`, plus every descendant of each of them.
 *
 * The set a delete, a duplicate or a page move operates on: acting on a parent
 * without its children leaves orphans behind, which is the bug this function
 * exists to make unwritable.
 */
export function getShapeAndDescendantIds(editor: Editor, ids: readonly ShapeId[]): Set<ShapeId> {
  const out = new Set<ShapeId>()
  for (const id of ids) {
    if (out.has(id)) continue
    if (!editor.getShape<UnknownShape>(id)) continue
    out.add(id)
    visitDescendants(editor, id, (childId) => {
      out.add(childId)
    })
  }
  return out
}

/**
 * Whether any ancestor of `shape` is selected.
 *
 * A shape inside a selected group must not draw its own indicator or take its
 * own drag — the group is the thing being manipulated — and this is the test
 * for that.
 */
export function isAncestorSelected(editor: Editor, shape: ShapeRef | undefined): boolean {
  const selected = new Set(editor.getSelectedShapeIds())
  if (selected.size === 0) return false
  return findShapeAncestor(editor, shape, (parent) => selected.has(parent.id)) !== undefined
}

/**
 * Whether `shape` lives on `pageId` (the current page by default).
 *
 * Walks to the shape's page rather than reading `parentId`, so a shape nested
 * inside a frame on the page answers `true`.
 */
export function isShapeInPage(editor: Editor, shape: ShapeRef | undefined, pageId?: PageId): boolean {
  const record = resolveShape(editor, shape)
  if (!record) return false
  return editor.getAncestorPageId(record) === (pageId ?? editor.getCurrentPageId())
}
