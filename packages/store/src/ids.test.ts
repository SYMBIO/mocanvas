import { describe, expect, it } from "vitest"
import {
  createRecordType,
  isRecordLike,
  parseRecordId,
  uniqueId,
  type BaseRecord,
  type RecordId,
} from "./ids"

interface Book extends BaseRecord<"book", RecordId<Book>> {
  title: string
  pages: number
  inStock: boolean
}

const Book = createRecordType<Book>("book", { scope: "document" })
const BookWithDefaults = Book.withDefaultProperties(() => ({ inStock: true, pages: 0 }))

describe("uniqueId", () => {
  it("returns 21 url-safe characters by default", () => {
    const id = uniqueId()
    expect(id).toHaveLength(21)
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it("is unique across many calls", () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => uniqueId()))
    expect(ids.size).toBe(10_000)
  })
})

describe("createRecordType", () => {
  it("creates ids of the form typeName:unique", () => {
    const id = Book.createId()
    expect(id.startsWith("book:")).toBe(true)
    expect(id.slice("book:".length)).toHaveLength(21)
    expect(Book.createId("custom")).toBe("book:custom")
  })

  it("recognises and parses its own ids", () => {
    const id = Book.createId("abc")
    expect(Book.isId(id)).toBe(true)
    expect(Book.isId("bookmark:abc")).toBe(false)
    expect(Book.isId("book:")).toBe(false)
    expect(Book.isId(undefined)).toBe(false)
    expect(Book.parseId(id)).toBe("abc")
    expect(() => Book.parseId("shape:abc" as never)).toThrow()
  })

  it("creates records with a generated id and the type name", () => {
    const book = Book.create({ title: "Dune", pages: 412, inStock: false })
    expect(book.typeName).toBe("book")
    expect(Book.isId(book.id)).toBe(true)
    expect(book.title).toBe("Dune")
  })

  it("keeps an explicit id", () => {
    const id = Book.createId("x")
    const book = Book.create({ id, title: "Dune", pages: 1, inStock: true })
    expect(book.id).toBe(id)
  })

  it("applies default properties and lets explicit values win", () => {
    const a = BookWithDefaults.create({ title: "A" })
    expect(a.inStock).toBe(true)
    expect(a.pages).toBe(0)
    const b = BookWithDefaults.create({ title: "B", pages: 9, inStock: false })
    expect(b.pages).toBe(9)
    expect(b.inStock).toBe(false)
    expect(BookWithDefaults.scope).toBe("document")
    expect(BookWithDefaults.typeName).toBe("book")
  })

  it("isInstance checks the typeName", () => {
    expect(Book.isInstance(Book.create({ title: "", pages: 0, inStock: true }))).toBe(true)
    expect(Book.isInstance({ id: "book:x", typeName: "author" })).toBe(false)
    expect(Book.isInstance(null)).toBe(false)
  })

  it("runs the validator when present", () => {
    const Strict = createRecordType<Book>("book", {
      scope: "document",
      validator: {
        validate(record) {
          const r = record as Book
          if (typeof r.title !== "string") throw new Error("title must be a string")
          return r
        },
      },
    })
    expect(() => Strict.validate({ id: "book:a", typeName: "book", title: 1 })).toThrow(/title/)
    const ok = { id: "book:a", typeName: "book", title: "x", pages: 0, inStock: true }
    expect(Strict.validate(ok)).toBe(ok)
  })

  it("exposes ephemeral keys as a set", () => {
    const T = createRecordType<Book>("book", {
      scope: "session",
      ephemeralKeys: { title: false, pages: true, inStock: true },
    })
    expect([...T.ephemeralKeySet].sort()).toEqual(["inStock", "pages"])
    expect(T.withDefaultProperties(() => ({ pages: 1 })).ephemeralKeySet.has("pages")).toBe(true)
  })
})

describe("parseRecordId / isRecordLike", () => {
  it("splits ids", () => {
    expect(parseRecordId("shape:abc:def")).toEqual({ typeName: "shape", uniquePart: "abc:def" })
    expect(() => parseRecordId("nocolon")).toThrow()
    expect(() => parseRecordId(":x")).toThrow()
    expect(() => parseRecordId("x:")).toThrow()
  })

  it("detects record-like values", () => {
    expect(isRecordLike({ id: "a:b", typeName: "a" })).toBe(true)
    expect(isRecordLike({ id: "a:b" })).toBe(false)
    expect(isRecordLike("a:b")).toBe(false)
  })
})
