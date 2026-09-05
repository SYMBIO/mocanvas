/**
 * The pointer record: where the local pointer last was, in page space.
 *
 * There is exactly one, under a fixed id, in the `session` scope. It is a
 * record rather than a plain field so that anything reactive — a custom cursor,
 * a snap indicator, a tool's own overlay — can subscribe to pointer movement
 * through the same mechanism it subscribes to everything else, without the
 * editor having to expose a bespoke signal for it.
 *
 * Session-scoped, so it is never written to a `.tldr` file and never shared.
 * What collaborators see is `instance_presence.cursor`, which is a separate
 * decision about what to broadcast.
 */

import type { RecordId } from "@mocanvas/store"
import { createRecordType } from "@mocanvas/store"
import { T } from "../validation/T"
import type { Validator } from "../validation/validator"
import type { JsonObject } from "./base"

/** Where the pointer is, in page space, plus the moment it was last there. */
export interface TLPointer {
  readonly id: TLPointerId
  readonly typeName: "pointer"
  x: number
  y: number
  /** `Date.now()` at the last move. Used to decide whether a pointer is stale. */
  lastActivityTimestamp: number
  meta: JsonObject
}

export type TLPointerId = RecordId<TLPointer>

// `T.object` infers a structurally equal but distinct type; restate it.
export const pointerValidator = T.object({
  id: T.idOfType<TLPointerId>("pointer"),
  typeName: T.literal("pointer"),
  x: T.number,
  y: T.number,
  lastActivityTimestamp: T.number,
  meta: T.jsonObject,
}) as unknown as Validator<TLPointer>

export const PointerRecordType = createRecordType<TLPointer>("pointer", {
  scope: "session",
  validator: pointerValidator,
}).withDefaultProperties(() => ({ x: 0, y: 0, lastActivityTimestamp: 0, meta: {} }))

/** The id of the one pointer record. There is only ever one per editor. */
export const TLPOINTER_ID = PointerRecordType.createId("pointer")
