/**
 * "May I?" — the questions a tool asks before it commits to a gesture.
 *
 * Every one of these is also enforced by the operation itself, so a caller that
 * skips the check cannot corrupt the document. They exist so the UI can be
 * honest *before* the fact: a crop handle that appears and then refuses to drag
 * is worse than one that never appeared.
 *
 * Three things gate almost all of them, in this order: the editor being
 * readonly, the shape being locked, and the shape's own util. The util is asked
 * last because it is the most specific answer.
 */
import type { UnknownShape, ShapeCreate } from "../records/base"
import type { TLEditStartInfo } from "../shapes/ShapeUtil"
import type { Editor } from "./Editor"
import { resolveShape, type ShapeRef } from "./ancestry"

/** The parts of a util that gate editing, asked for by shape rather than name. */
interface PermissionHooks {
  canEdit?(shape: UnknownShape, info?: TLEditStartInfo): boolean
  canCrop?(shape: UnknownShape): boolean
  canEditInReadonly?(shape: UnknownShape): boolean
  canEditWhileLocked?(shape: UnknownShape): boolean
  canBind?(opts: { fromShape: UnknownShape; toShape: UnknownShape; bindingType: string }): boolean
}

function hooksFor(editor: Editor, shape: UnknownShape): PermissionHooks {
  // Duck-typed: the readonly / locked escape hatches are optional hooks, and a
  // util that does not implement one simply does not get the exemption.
  return editor.getShapeUtil<UnknownShape>(shape) as unknown as PermissionHooks
}

/**
 * Whether one more shape can be added to the current page.
 *
 * `false` for an unregistered type — a shape whose util is missing cannot be
 * measured, drawn or migrated, so creating it would only fail later and less
 * clearly — and `false` once the page is at `maxShapesPerPage`.
 */
export function canCreateShape(editor: Editor, partial: ShapeCreate<UnknownShape>): boolean {
  return canCreateShapes(editor, [partial])
}

/**
 * Whether a whole batch can be added. Checked as a batch because the page limit
 * is about the total: adding 400 shapes to a page with room for 10 must fail as
 * one decision, not 390 times.
 */
export function canCreateShapes(editor: Editor, partials: readonly ShapeCreate<UnknownShape>[]): boolean {
  if (editor.getIsReadonly()) return false
  for (const partial of partials) {
    if (!partial.type || !editor.hasShapeUtil(partial.type)) return false
  }
  return editor.getCurrentPageShapeIds().size + partials.length <= editor.options.maxShapesPerPage
}

/**
 * Whether a shape can be put into its editing state right now.
 *
 * `info` says what is trying to start the edit — a double click, the enter key,
 * a click on a header — so a util can allow some routes and not others; a shape
 * whose label is only editable from its header is the usual case.
 */
export function canEditShape(editor: Editor, shape: ShapeRef, info?: TLEditStartInfo): boolean {
  const record = resolveShape(editor, shape)
  if (!record) return false
  const hooks = hooksFor(editor, record)
  if (editor.getIsReadonly() && !hooks.canEditInReadonly?.(record)) return false
  if (record.isLocked && !hooks.canEditWhileLocked?.(record)) return false
  return hooks.canEdit?.(record, info) ?? false
}

/**
 * Whether a shape can enter cropping.
 *
 * Cropping always writes to the document, so unlike editing it has no readonly
 * or locked exemption — a util cannot opt back in.
 */
export function canCropShape(editor: Editor, shape: ShapeRef): boolean {
  const record = resolveShape(editor, shape)
  if (!record) return false
  if (editor.getIsReadonly() || record.isLocked) return false
  return hooksFor(editor, record).canCrop?.(record) ?? false
}

/**
 * Whether a binding of `bindingType` may be created between two shapes.
 *
 * BOTH utils have to agree. An arrow util that is happy to bind to anything
 * still must not bind to a shape whose own util refuses — that is how a shape
 * declares itself un-bindable — so this is an `and`, never an `or`.
 */
export function canBindShapes(
  editor: Editor,
  opts: { fromShape: ShapeRef; toShape: ShapeRef; binding: string | { type: string } },
): boolean {
  const fromShape = resolveShape(editor, opts.fromShape)
  const toShape = resolveShape(editor, opts.toShape)
  if (!fromShape || !toShape) return false
  const bindingType = typeof opts.binding === "string" ? opts.binding : opts.binding.type
  if (!editor.hasBindingUtil(bindingType)) return false

  const args = { fromShape, toShape, bindingType }
  return (hooksFor(editor, fromShape).canBind?.(args) ?? true) && (hooksFor(editor, toShape).canBind?.(args) ?? true)
}
