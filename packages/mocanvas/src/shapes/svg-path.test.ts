import { describe, expect, it } from "vitest"
import { Mat, PATH_OP, Rectangle2d } from "@mocanvas/editor"
import { pathWordsToSvgD, transformPathWords } from "./svg-path"

describe("transformPathWords", () => {
  it("returns a copy, leaving the input alone", () => {
    const words = [PATH_OP.MOVE, 1, 2, PATH_OP.LINE, 3, 4, PATH_OP.CLOSE]
    const before = [...words]
    const out = transformPathWords(words, Mat.Translate(10, 20))
    expect(words).toEqual(before)
    expect(out).not.toBe(words)
  })

  it("is the identity for the identity matrix", () => {
    const words = new Rectangle2d({ width: 10, height: 5, isFilled: true }).toPathWords()
    expect(transformPathWords(words, Mat.Identity())).toEqual(words)
  })

  it("moves every point, and keeps the op words where they were", () => {
    const words = [PATH_OP.MOVE, 0, 0, PATH_OP.LINE, 10, 0, PATH_OP.CLOSE]
    expect(transformPathWords(words, Mat.Translate(3, 7))).toEqual([PATH_OP.MOVE, 3, 7, PATH_OP.LINE, 13, 7, PATH_OP.CLOSE])
  })

  it("transforms a cubic's control points as well as its anchors", () => {
    const words = [PATH_OP.MOVE, 0, 0, PATH_OP.CUBIC, 1, 2, 3, 4, 5, 6]
    expect(transformPathWords(words, Mat.Identity().scale(2, 3))).toEqual([PATH_OP.MOVE, 0, 0, PATH_OP.CUBIC, 2, 6, 6, 12, 10, 18])
  })

  it("transforms a quadratic's control point", () => {
    const words = [PATH_OP.MOVE, 0, 0, PATH_OP.QUAD, 1, 1, 2, 2]
    expect(transformPathWords(words, Mat.Translate(1, 0))).toEqual([PATH_OP.MOVE, 1, 0, PATH_OP.QUAD, 2, 1, 3, 2])
  })

  it("mirrors a path in place, which is what a flip is", () => {
    const words = [PATH_OP.MOVE, 0, 0, PATH_OP.LINE, 10, 0, PATH_OP.LINE, 10, 4, PATH_OP.CLOSE]
    // Translate then scale: the box's own left-right mirror.
    const flipped = transformPathWords(words, Mat.Identity().translate(10, 0).scale(-1, 1))
    expect(flipped).toEqual([PATH_OP.MOVE, 10, 0, PATH_OP.LINE, 0, 0, PATH_OP.LINE, 0, 4, PATH_OP.CLOSE])
  })

  it("composes, so two transforms are one", () => {
    const words = [PATH_OP.MOVE, 1, 1]
    const a = Mat.Translate(2, 0)
    const b = Mat.Identity().scale(3, 3)
    expect(transformPathWords(transformPathWords(words, b), a)).toEqual(transformPathWords(words, Mat.Multiply(a, b)))
  })

  it("accepts a plain {a…f} as well as a Mat", () => {
    expect(transformPathWords([PATH_OP.MOVE, 1, 1], { a: 1, b: 0, c: 0, d: 1, e: 5, f: 5 })).toEqual([PATH_OP.MOVE, 6, 6])
  })

  it("truncates at a malformed word rather than emitting garbage, as the serializer does", () => {
    const words = [PATH_OP.MOVE, 0, 0, 999, 1, 2]
    expect(transformPathWords(words, Mat.Identity())).toEqual([PATH_OP.MOVE, 0, 0])
    // A truncated op at the end of the stream is dropped too.
    expect(transformPathWords([PATH_OP.MOVE, 0, 0, PATH_OP.LINE, 5], Mat.Identity())).toEqual([PATH_OP.MOVE, 0, 0])
    expect(transformPathWords([], Mat.Identity())).toEqual([])
  })

  it("serializes through the same encoder the indicators use", () => {
    const words = new Rectangle2d({ width: 10, height: 10, isFilled: true }).toPathWords()
    expect(pathWordsToSvgD(transformPathWords(words, Mat.Translate(5, 5)))).toBe("M5 5 L15 5 L15 15 L5 15 Z")
  })
})
