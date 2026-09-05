/**
 * Comment records: threads, comments and reactions, as document data.
 *
 * Three record types rather than one nested object, because each is edited
 * independently and by different people: two collaborators replying to the same
 * thread at once must not overwrite each other, and a reaction must not
 * conflict with an edit to the comment it is attached to. Splitting them is
 * what makes concurrent commenting merge cleanly through the ordinary record
 * pipeline instead of needing a bespoke one.
 *
 * These are the *records* only. The commenting UI is a separate concern.
 */

import type { IndexKey, RecordId } from "@mocanvas/store"
import { createRecordType } from "@mocanvas/store"
import { T } from "../validation/T"
import type { Validator } from "../validation/validator"
import type { UserId } from "../user/userRecord"
import type { JsonObject, PageId, ShapeId } from "./base"

/* ---- ids ---------------------------------------------------------------- */

export type TLCommentThreadId = RecordId<TLCommentThread>
export type TLCommentId = RecordId<TLComment>
export type TLCommentReactionId = RecordId<TLCommentReaction>

/* ---- anchors ------------------------------------------------------------ */

/**
 * Where a thread is pinned.
 *
 * A thread on a *shape* moves with the shape and disappears with it; a thread
 * on a *page* sits at a fixed point on the canvas; a thread with no anchor
 * belongs to the document as a whole. The three are genuinely different
 * lifetimes, which is why this is a union rather than an optional shape id.
 */
export type TLCommentAnchor =
  | { type: "shape"; shapeId: ShapeId; pageId: PageId; x: number; y: number }
  | { type: "page"; pageId: PageId; x: number; y: number }
  | { type: "document" }

export const commentAnchorValidator = T.union("type", {
  shape: T.object({
    type: T.literal("shape"),
    shapeId: T.idOfType<ShapeId>("shape"),
    pageId: T.idOfType<PageId>("page"),
    x: T.number,
    y: T.number,
  }),
  page: T.object({
    type: T.literal("page"),
    pageId: T.idOfType<PageId>("page"),
    x: T.number,
    y: T.number,
  }),
  document: T.object({ type: T.literal("document") }),
})

/* ---- thread ------------------------------------------------------------- */

/** A conversation pinned somewhere in the document. */
export interface TLCommentThread {
  readonly id: TLCommentThreadId
  readonly typeName: "comment_thread"
  anchor: TLCommentAnchor
  /** Who opened it. */
  authorId: UserId
  createdAt: number
  updatedAt: number
  /** Resolved threads stay in the document; they are hidden, not deleted. */
  isResolved: boolean
  /** Who resolved it, or `null` while it is open. */
  resolvedBy: UserId | null
  meta: JsonObject
}

// `T.object` infers a structurally equal but distinct type (mutable `id`, a
// `Record<string, unknown>` meta) and `Validator` is invariant, so the type we
// actually built is restated on the way out.
export const commentThreadValidator = T.object({
  id: T.idOfType<TLCommentThreadId>("comment_thread"),
  typeName: T.literal("comment_thread"),
  anchor: commentAnchorValidator,
  authorId: T.idOfType<UserId>("user"),
  createdAt: T.number,
  updatedAt: T.number,
  isResolved: T.boolean,
  resolvedBy: T.idOfType<UserId>("user").nullable(),
  meta: T.jsonObject,
}) as unknown as Validator<TLCommentThread>

export const CommentThreadRecordType = createRecordType<TLCommentThread>("comment_thread", {
  scope: "document",
  validator: commentThreadValidator,
}).withDefaultProperties(() => ({
  createdAt: Date.now(),
  updatedAt: Date.now(),
  isResolved: false,
  resolvedBy: null,
  meta: {},
}))

/* ---- comment ------------------------------------------------------------ */

/** One message in a thread. */
export interface TLComment {
  readonly id: TLCommentId
  readonly typeName: "comment"
  threadId: TLCommentThreadId
  authorId: UserId
  /** The body, as a rich-text document. Plain text is a rich-text document too. */
  richText: { type: "doc"; content: unknown[] }
  /**
   * Ordering within the thread. A fractional index rather than a timestamp so
   * that two people posting at once cannot collide, and so a comment can be
   * moved without renumbering the rest.
   */
  index: IndexKey
  createdAt: number
  updatedAt: number
  /** Whether the body has been edited since it was posted. */
  isEdited: boolean
  meta: JsonObject
}

// `T.object` infers a structurally equal but distinct type (mutable `id`, a
// `Record<string, unknown>` meta) and `Validator` is invariant, so the type we
// actually built is restated on the way out.
export const commentValidator = T.object({
  id: T.idOfType<TLCommentId>("comment"),
  typeName: T.literal("comment"),
  threadId: T.idOfType<TLCommentThreadId>("comment_thread"),
  authorId: T.idOfType<UserId>("user"),
  richText: T.object({ type: T.literal("doc"), content: T.arrayOf(T.unknown) }),
  index: T.indexKey,
  createdAt: T.number,
  updatedAt: T.number,
  isEdited: T.boolean,
  meta: T.jsonObject,
}) as unknown as Validator<TLComment>

export const CommentRecordType = createRecordType<TLComment>("comment", {
  scope: "document",
  validator: commentValidator,
}).withDefaultProperties(() => ({
  createdAt: Date.now(),
  updatedAt: Date.now(),
  isEdited: false,
  meta: {},
}))

/* ---- reaction ----------------------------------------------------------- */

/**
 * One person's reaction to one comment.
 *
 * A record per (person, emoji) pair rather than a count on the comment: a count
 * cannot be merged when two people react at the same time, and it cannot answer
 * "did I already react?" without a second field.
 */
export interface TLCommentReaction {
  readonly id: TLCommentReactionId
  readonly typeName: "comment_reaction"
  commentId: TLCommentId
  userId: UserId
  /** The emoji, as a string. Not restricted: any emoji a host allows. */
  emoji: string
  createdAt: number
  meta: JsonObject
}

// `T.object` infers a structurally equal but distinct type (mutable `id`, a
// `Record<string, unknown>` meta) and `Validator` is invariant, so the type we
// actually built is restated on the way out.
export const commentReactionValidator = T.object({
  id: T.idOfType<TLCommentReactionId>("comment_reaction"),
  typeName: T.literal("comment_reaction"),
  commentId: T.idOfType<TLCommentId>("comment"),
  userId: T.idOfType<UserId>("user"),
  emoji: T.string,
  createdAt: T.number,
  meta: T.jsonObject,
}) as unknown as Validator<TLCommentReaction>

export const CommentReactionRecordType = createRecordType<TLCommentReaction>("comment_reaction", {
  scope: "document",
  validator: commentReactionValidator,
}).withDefaultProperties(() => ({ createdAt: Date.now(), meta: {} }))

/* ---- constructors and guards -------------------------------------------- */

export function createCommentThreadId(id?: string): TLCommentThreadId {
  return CommentThreadRecordType.createId(id)
}
export function createCommentId(id?: string): TLCommentId {
  return CommentRecordType.createId(id)
}
export function createCommentReactionId(id?: string): TLCommentReactionId {
  return CommentReactionRecordType.createId(id)
}

export function isCommentThreadId(id: unknown): id is TLCommentThreadId {
  return typeof id === "string" && CommentThreadRecordType.isId(id)
}
export function isCommentId(id: unknown): id is TLCommentId {
  return typeof id === "string" && CommentRecordType.isId(id)
}
export function isCommentReactionId(id: unknown): id is TLCommentReactionId {
  return typeof id === "string" && CommentReactionRecordType.isId(id)
}

/** Build a thread record. `createdAt`/`updatedAt` default to now. */
export function createCommentThread(
  properties: Parameters<typeof CommentThreadRecordType.create>[0],
): TLCommentThread {
  return CommentThreadRecordType.create(properties)
}

/** Build a comment record. */
export function createComment(properties: Parameters<typeof CommentRecordType.create>[0]): TLComment {
  return CommentRecordType.create(properties)
}

/** Build a reaction record. */
export function createCommentReaction(
  properties: Parameters<typeof CommentReactionRecordType.create>[0],
): TLCommentReaction {
  return CommentReactionRecordType.create(properties)
}

/* ---- schema wiring ------------------------------------------------------ */

/**
 * The commenting record types, in the shape `createTLSchema({ records })`
 * expects.
 *
 * Commenting is opt-in: a document that never comments should not carry three
 * unused record types in its schema, and — more importantly — should not record
 * migration versions for them, because that would make the file unreadable by a
 * build that does not know them.
 *
 * ```ts
 * createTLSchema({ records: { ...commentSchemaRecords } })
 * ```
 */
export const commentThreadRecordConfig = { type: "comment_thread", recordType: CommentThreadRecordType } as const
export const commentRecordConfig = { type: "comment", recordType: CommentRecordType } as const
export const commentReactionRecordConfig = { type: "comment_reaction", recordType: CommentReactionRecordType } as const

export const commentSchemaRecords = {
  comment_thread: commentThreadRecordConfig,
  comment: commentRecordConfig,
  comment_reaction: commentReactionRecordConfig,
} as const
