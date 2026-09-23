import { describe, expect, it } from "vitest"
import { DEFAULT_THEME, getColorValue, getDisplayValues, type Editor } from "@mocanvas/editor"
import { LABEL_FONT_SIZES } from "@mocanvas/editor"
import { toRichText } from "../text/rich-text"
import {
  NOTE_PADDING,
  NOTE_SIZE,
  NoteShapeUtil,
  getNoteDisplayValues,
  getNoteGrowY,
  type NoteShape,
  type NoteShapeUtilDisplayValues,
} from "./NoteShapeUtil"

function stubEditor(colorMode: "light" | "dark" = "light"): Editor {
  return {
    getEditingShapeId: () => null,
    getCurrentTheme: () => DEFAULT_THEME,
    getColorMode: () => colorMode,
  } as unknown as Editor
}

function note(props: Partial<NoteShape["props"]> = {}): NoteShape {
  const util = new NoteShapeUtil(stubEditor())
  return { id: "shape:n", type: "note", props: { ...util.getDefaultProps(), ...props } } as NoteShape
}

/** What the consumer actually calls: a util looked up by string, plus the shape. */
function displayOf(shape: NoteShape, editor = stubEditor()): NoteShapeUtilDisplayValues {
  return getDisplayValues<NoteShape, NoteShapeUtilDisplayValues>(new NoteShapeUtil(editor), shape)
}

describe("note display values", () => {
  it("reports the note's LOGICAL square, before growY", () => {
    // The square is the note's identity: a caller fitting text into it wants the
    // box the text has to fit, not the box the text already grew.
    const values = displayOf(note({ growY: 220 }))
    expect(values.noteWidth).toBe(NOTE_SIZE)
    expect(values.noteHeight).toBe(NOTE_SIZE)
  })

  it("scales the square, its padding and its font together", () => {
    const values = displayOf(note({ scale: 1.6 }))
    expect(values.noteWidth).toBeCloseTo(NOTE_SIZE * 1.6, 6)
    expect(values.noteHeight).toBeCloseTo(NOTE_SIZE * 1.6, 6)
    expect(values.labelPadding).toBeCloseTo(NOTE_PADDING * 1.6, 6)
    expect(values.labelFontSize).toBeCloseTo(LABEL_FONT_SIZES.m * 1.6, 6)
  })

  it("shrinks the label by a stored fontSizeAdjustment", () => {
    // A fraction of the styled size, not a size of its own: a quarter is a
    // quarter of whatever the size style says, at whatever scale.
    expect(displayOf(note({ size: "xl", fontSizeAdjustment: 0.25 })).labelFontSize).toBeCloseTo(LABEL_FONT_SIZES.xl * 0.25, 6)
    expect(displayOf(note({ size: "m", fontSizeAdjustment: 1 })).labelFontSize).toBe(LABEL_FONT_SIZES.m)
    expect(displayOf(note({ size: "m", fontSizeAdjustment: 0 })).labelFontSize).toBe(LABEL_FONT_SIZES.m)
  })

  it("publishes the size the adjustment is a fraction of", () => {
    // What a host fitting text to the square divides by to record how far it
    // had to shrink. Reading `labelFontSize` for that compounds the shrink on
    // every pass.
    const shrunk = displayOf(note({ size: "m", fontSizeAdjustment: 0.25, scale: 1.6 }))
    expect(shrunk.labelBaseFontSize).toBeCloseTo(LABEL_FONT_SIZES.m * 1.6, 6)
    expect(shrunk.labelFontSize).toBeCloseTo(shrunk.labelBaseFontSize * 0.25, 6)
  })

  it("paints the body and the ink from the palette's NOTE tokens, not the fill styles", () => {
    const values = displayOf(note({ color: "blue" }))
    expect(values.fill).toBe(getColorValue(DEFAULT_THEME.colors.light, "blue", "noteFill"))
    expect(values.labelColor).toBe(getColorValue(DEFAULT_THEME.colors.light, "blue", "noteText"))
  })

  it("uses an explicit label colour when the note carries one", () => {
    const values = displayOf(note({ color: "blue", labelColor: "red" }))
    expect(values.labelColor).toBe(getColorValue(DEFAULT_THEME.colors.light, "red", "solid"))
  })

  it("follows the colour mode, so the same note is legible on a dark board", () => {
    const light = displayOf(note({ color: "blue" }), stubEditor("light"))
    const dark = displayOf(note({ color: "blue" }), stubEditor("dark"))
    expect(dark.fill).toBe(getColorValue(DEFAULT_THEME.colors.dark, "blue", "noteFill"))
    expect(dark.fill).not.toBe(light.fill)
  })

  it("reports the label line height as a unitless multiple, the way CSS takes it", () => {
    const values = displayOf(note())
    expect(values.labelLineHeight).toBe(DEFAULT_THEME.lineHeight)
    // `lineHeight` from the shared set stays absolute; the two are not the same number.
    expect(values.lineHeight).toBeCloseTo(values.labelFontSize * DEFAULT_THEME.lineHeight, 6)
  })

  it("resolves from a bare props bag, which is all a placement ghost has", () => {
    const util = new NoteShapeUtil(stubEditor())
    const values = getNoteDisplayValues({}, { props: util.getDefaultProps() }, DEFAULT_THEME, "light")
    expect(values.noteWidth).toBe(NOTE_SIZE)
    expect(values.noteHeight).toBe(NOTE_SIZE)
  })

  it("honours a configured note size and padding", () => {
    const Configured = NoteShapeUtil.configure({ noteSize: 320, labelPadding: 24 })
    const values = getDisplayValues<NoteShape, NoteShapeUtilDisplayValues>(new Configured(stubEditor()), note())
    expect(values.noteWidth).toBe(320)
    expect(values.labelPadding).toBe(24)
  })

  it("survives a note whose props never arrived", () => {
    const values = displayOf({ id: "shape:n", type: "note", props: {} } as unknown as NoteShape)
    expect(values.noteWidth).toBe(NOTE_SIZE)
    expect(values.labelFontSize).toBe(LABEL_FONT_SIZES.m)
  })
})

describe("a note's font faces", () => {
  it("asks for all four faces of its family, because rich text can bold or italicise any run", () => {
    const faces = new NoteShapeUtil(stubEditor()).getFontFaces(note({ font: "serif", richText: toRichText("hi") }))
    expect(faces).toHaveLength(4)
    expect(new Set(faces.map((f) => f.family))).toEqual(new Set(["tldraw_serif"]))
    expect(new Set(faces.map((f) => `${f.style}/${f.weight}`))).toEqual(
      new Set(["normal/normal", "normal/bold", "italic/normal", "italic/bold"]),
    )
  })
})

/**
 * How tall a note is, and in what units `growY` says so.
 *
 * `growY` is how much taller than its square a note had to become for its text
 * to fit. It used to be stored already multiplied by `scale` and added to a
 * scaled box; it is stored unscaled now and multiplied with the box:
 *
 *     was:  200 * scale + growY
 *     now:  (200 + growY) * scale
 *
 * The two agree whenever `scale` is 1 or `growY` is 0, which is why nothing
 * here caught it: every note this codebase grew itself was internally
 * consistent. They disagree about every note that arrives from outside — a
 * `.tldr` file, or an app writing records directly — where the prop has always
 * been unscaled. The numbers below are the measured tldraw values.
 */
describe("a note's height", () => {
  const heightOf = (scale: number, growY: number): number =>
    new NoteShapeUtil(stubEditor()).getGeometry(note({ scale, growY })).bounds.h

  it.each([
    [1, 100, 300],
    [1.6, 0, 320],
    [1.6, 100, 480],
    [1.6, 250, 720],
    [2, 100, 600],
    [2, 250, 900],
  ])("is (200 + growY) * scale — scale %s, growY %s", (scale, growY, expected) => {
    expect(heightOf(scale, growY)).toBeCloseTo(expected, 6)
  })

  it("scales the overflow with the note, not just the square", () => {
    // The half that made this a real bug rather than a number: at scale 1.6 a
    // note kept 100 units of overflow while its text grew to 160, so the last
    // lines ran past the paper.
    const overflowAtOne = heightOf(1, 100) - heightOf(1, 0)
    const overflowAtTwo = heightOf(2, 100) - heightOf(2, 0)
    expect(overflowAtTwo).toBeCloseTo(overflowAtOne * 2, 6)
  })

  it("still grows a scaled note far enough for its own text", () => {
    // The other direction: whatever the unit, a note this codebase grew must
    // still be at least as tall as the label it grew for.
    const util = new NoteShapeUtil(stubEditor())
    for (const scale of [1, 1.6, 2]) {
      const shape = note({ scale, richText: toRichText("a line\nand another\nand a third\nand a fourth") })
      const grown = { ...shape, props: { ...shape.props, growY: getNoteGrowY(shape, stubEditor()) } } as NoteShape
      const height = util.getGeometry(grown).bounds.h
      expect(height, `scale ${scale} left the note shorter than its square`).toBeGreaterThanOrEqual(NOTE_SIZE * scale)
    }
  })
})
