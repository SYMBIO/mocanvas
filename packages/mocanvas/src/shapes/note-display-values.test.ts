import { describe, expect, it } from "vitest"
import { DEFAULT_THEME, getColorValue, getDisplayValues, type Editor } from "@mocanvas/editor"
import { toRichText } from "../text/rich-text"
import {
  NOTE_PADDING,
  NOTE_SIZE,
  NoteShapeUtil,
  getNoteDisplayValues,
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
    expect(values.labelFontSize).toBeCloseTo(DEFAULT_THEME.fontSize.m * 1.6, 6)
  })

  it("lets a stored fontSizeAdjustment win over the size style", () => {
    expect(displayOf(note({ size: "xl", fontSizeAdjustment: 11 })).labelFontSize).toBe(11)
    // Anything too small to be a font size reads as "unset" instead.
    expect(displayOf(note({ size: "m", fontSizeAdjustment: 1 })).labelFontSize).toBe(DEFAULT_THEME.fontSize.m)
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
    expect(values.labelFontSize).toBe(DEFAULT_THEME.fontSize.m)
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
