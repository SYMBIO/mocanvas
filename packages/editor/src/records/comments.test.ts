import { describe, expect, it } from "vitest"
import { ZERO_INDEX_KEY } from "@mocanvas/store"
import {
  commentReactionValidator,
  commentSchemaRecords,
  commentThreadValidator,
  commentValidator,
  createComment,
  createCommentId,
  createCommentReaction,
  createCommentReactionId,
  createCommentThread,
  createCommentThreadId,
  isCommentId,
  isCommentReactionId,
  isCommentThreadId,
} from "./comments"

describe("comment ids", () => {
  it("mint and recognise their own kind only", () => {
    const thread = createCommentThreadId()
    const comment = createCommentId()
    const reaction = createCommentReactionId()

    expect(isCommentThreadId(thread)).toBe(true)
    expect(isCommentId(comment)).toBe(true)
    expect(isCommentReactionId(reaction)).toBe(true)

    // `comment_thread:` starts with `comment` — the guards must not confuse them.
    expect(isCommentId(thread)).toBe(false)
    expect(isCommentThreadId(comment)).toBe(false)
    expect(isCommentReactionId(comment)).toBe(false)
    expect(isCommentId(42)).toBe(false)
  })
})

describe("comment records", () => {
  const threadId = createCommentThreadId("t1")
  const commentId = createCommentId("c1")

  it("builds a thread that validates", () => {
    const thread = createCommentThread({
      id: threadId,
      anchor: { type: "shape", shapeId: "shape:a" as never, pageId: "page:home" as never, x: 1, y: 2 },
      authorId: "user:amy" as never,
    })
    expect(thread.isResolved).toBe(false)
    expect(thread.resolvedBy).toBeNull()
    expect(() => commentThreadValidator.validate(thread)).not.toThrow()
  })

  it("accepts each anchor kind and refuses an invented one", () => {
    const base = { id: threadId, authorId: "user:amy" as never }
    for (const anchor of [
      { type: "page", pageId: "page:home", x: 0, y: 0 },
      { type: "document" },
    ] as const) {
      expect(() => commentThreadValidator.validate(createCommentThread({ ...base, anchor: anchor as never }))).not.toThrow()
    }
    expect(() =>
      commentThreadValidator.validate(createCommentThread({ ...base, anchor: { type: "galaxy" } as never })),
    ).toThrow()
  })

  it("builds a comment that validates and orders by index", () => {
    const comment = createComment({
      id: commentId,
      threadId,
      authorId: "user:amy" as never,
      richText: { type: "doc", content: [] },
      index: ZERO_INDEX_KEY,
    })
    expect(comment.isEdited).toBe(false)
    expect(() => commentValidator.validate(comment)).not.toThrow()
    expect(() => commentValidator.validate({ ...comment, index: "not-an-index" })).toThrow(/index/)
  })

  it("refuses a comment pointing at something that is not a thread", () => {
    const comment = createComment({
      id: commentId,
      threadId,
      authorId: "user:amy" as never,
      richText: { type: "doc", content: [] },
      index: ZERO_INDEX_KEY,
    })
    expect(() => commentValidator.validate({ ...comment, threadId: "comment:c1" })).toThrow(/threadId/)
  })

  it("builds a reaction that validates", () => {
    const reaction = createCommentReaction({
      id: createCommentReactionId("r1"),
      commentId,
      userId: "user:amy" as never,
      emoji: "👍",
    })
    expect(() => commentReactionValidator.validate(reaction)).not.toThrow()
  })
})

describe("commentSchemaRecords", () => {
  it("names all three record types, so commenting is one opt-in", () => {
    expect(Object.keys(commentSchemaRecords).sort()).toEqual(["comment", "comment_reaction", "comment_thread"])
    expect(commentSchemaRecords.comment.recordType.scope).toBe("document")
  })
})
