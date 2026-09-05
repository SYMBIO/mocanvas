/**
 * Page operations beyond create / delete / rename.
 *
 * A page is cheap — a record and an index — but the things attached to one are
 * not: its shapes, the bindings between them, and its session state (what is
 * selected on it, what is hovered, what group is focused). Anything that copies
 * or inspects a page has to account for all three, which is why these are
 * functions rather than one-liners at the call site.
 */
import {
  InstancePageStateRecordType,
  PageRecordType,
  ShapeRecordType,
  isPageId,
  type InstancePageState,
  type Page,
  type PageId,
  type ShapeId,
  type UnknownShape,
} from "../records/base"
import { BindingRecordType, type UnknownBinding } from "../records/binding"
import type { Editor } from "./Editor"

/**
 * Change a page's own fields — its name, its `meta`, its index among the other
 * pages.
 *
 * `renamePage` is the special case of this that people reach for most; this is
 * the general form, and the only way to write a page's `meta`.
 */
export function updatePage(editor: Editor, partial: Partial<Omit<Page, "typeName">> & { id: PageId }): void {
  const page = editor.getPage(partial.id)
  if (!page) return
  const next: Page = {
    ...page,
    ...(partial.name !== undefined ? { name: partial.name } : {}),
    ...(partial.index !== undefined ? { index: partial.index } : {}),
    ...(partial.meta !== undefined ? { meta: { ...page.meta, ...partial.meta } } : {}),
  }
  editor.run(() => {
    editor.store.put([next])
  })
}

/**
 * Copy a page — its shapes, the bindings among them, and its name — and return
 * the new page's id.
 *
 * The copy is NOT switched to: duplicating a page is usually a step in a longer
 * piece of work ("give me a variant to try things on"), and taking the user
 * away from where they were is the wrong default. `setCurrentPage` is one call.
 *
 * Session state is deliberately not copied. Selection and hover belong to a
 * person looking at a page, not to the page.
 */
export function duplicatePage(editor: Editor, id?: PageId, createId?: PageId): PageId | undefined {
  const sourceId = id ?? editor.getCurrentPageId()
  const source = editor.getPage(sourceId)
  if (!source) return undefined
  const newPageId = createId ?? (PageRecordType.createId() as PageId)

  // Parents before children, so a child's new parent id is already known by the
  // time the child is rewritten.
  const sourceShapes = sortedShapesOfPage(editor, sourceId)
  const idMap = new Map<ShapeId, ShapeId>()
  for (const shape of sourceShapes) idMap.set(shape.id, ShapeRecordType.createId() as ShapeId)

  const copies: UnknownShape[] = sourceShapes.map((shape) => ({
    ...shape,
    id: idMap.get(shape.id)!,
    parentId: isPageId(shape.parentId) ? newPageId : (idMap.get(shape.parentId) ?? newPageId),
    props: { ...shape.props },
    meta: { ...shape.meta },
  }))

  const sourceIds = new Set(sourceShapes.map((s) => s.id))
  const bindingCopies: UnknownBinding[] = []
  for (const shape of sourceShapes) {
    for (const binding of editor.getBindingsFromShape(shape.id)) {
      if (!sourceIds.has(binding.toId)) continue
      bindingCopies.push({
        ...binding,
        id: BindingRecordType.createId(),
        fromId: idMap.get(binding.fromId)!,
        toId: idMap.get(binding.toId)!,
        props: { ...binding.props },
        meta: { ...binding.meta },
      })
    }
  }

  editor.run(() => {
    editor.createPage({ id: newPageId, name: `${source.name} copy` })
    if (copies.length > 0) editor.store.put(copies)
    if (bindingCopies.length > 0) editor.store.put(bindingCopies)
  })
  return newPageId
}

/**
 * The session state of every page: what is selected, hovered, being edited or
 * cropped on each one.
 *
 * The list a page menu needs in order to show which pages have work in progress
 * on them, and the list a "close without saving" prompt needs in order to know
 * whether anything is mid-edit anywhere.
 */
export function getPageStates(editor: Editor): InstancePageState[] {
  const out: InstancePageState[] = []
  for (const page of editor.getPages()) {
    const state = editor.store.get(InstancePageStateRecordType.createId(page.id.slice("page:".length)))
    if (state) out.push(state as InstancePageState)
  }
  return out
}

/** Shapes on a page, parents before children. */
function sortedShapesOfPage(editor: Editor, pageId: PageId): UnknownShape[] {
  const out: UnknownShape[] = []
  const walk = (parentId: PageId | ShapeId): void => {
    for (const childId of editor.getSortedChildIdsForParent(parentId)) {
      const shape = editor.getShape<UnknownShape>(childId)
      if (!shape) continue
      out.push(shape)
      walk(shape.id)
    }
  }
  walk(pageId)
  return out
}

