/**
 * Validators for the branded ids records refer to each other by.
 *
 * These are separate from the record validators because ids cross boundaries on
 * their own: a page id arrives in a URL, a shape id in a sync message, a parent
 * id inside another record's props. Each of those is a place where a string has
 * to be proven to be an id of the right type before it is trusted.
 */

import { T } from "../validation/T"
import type { Validator } from "../validation/validator"
import type { BindingId } from "./binding"
import type { PageId, ParentId, ShapeId } from "./base"

/**
 * A validator for ids of the record type named by `typeName`.
 *
 * ```ts
 * const widgetIdValidator = idValidator<WidgetId>("widget")
 * ```
 *
 * It checks the `typeName:` prefix and that something follows it — the two
 * things that make an id well-formed. Whether the record actually exists is a
 * question for the store, not for a validator.
 */
export function idValidator<Id extends string>(typeName: string): Validator<Id> {
  return T.idOfType<Id>(typeName)
}

/** A shape id: `shape:…`. */
export const shapeIdValidator = idValidator<ShapeId>("shape")

/** A page id: `page:…`. */
export const pageIdValidator = idValidator<PageId>("page")

/** A binding id: `binding:…`. */
export const bindingIdValidator = idValidator<BindingId>("binding")

/**
 * A shape's parent: either the page it sits on or the shape (a frame, a group)
 * that contains it. The union is why this cannot be one `idOfType` call.
 */
export const parentIdValidator: Validator<ParentId> = T.string.refine((value) => {
  if (value.startsWith("page:") && value.length > 5) return value as ParentId
  if (value.startsWith("shape:") && value.length > 6) return value as ParentId
  throw new Error(`Expected a page or shape id, got ${JSON.stringify(value)}`)
})
