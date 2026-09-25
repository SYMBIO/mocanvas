import { describe, expect, it } from "vitest"
import { createShapeId, LABEL_FONT_SIZES, type Editor, type PageId, type ShapeId, type UnknownShape } from "@mocanvas/editor"
import type { IndexKey } from "@mocanvas/store"
import { toRichText } from "../text/rich-text"
import { LINE_HEIGHT } from "./text-helpers"
import { GeoShapeUtil, getGeoGrowY, type GeoShape } from "./GeoShapeUtil"
import { NoteShapeUtil, NOTE_SIZE, type NoteShape } from "./NoteShapeUtil"
import { TEXT_SHAPE_MIN_WIDTH } from "../text/text-layout"
import { TextShapeUtil, type TextShape } from "./TextShapeUtil"
import { ArrowShapeUtil, type ArrowShape } from "./ArrowShapeUtil"
import { FrameShapeUtil, type FrameShape } from "./FrameShapeUtil"

/** Minimal editor double recording writes; `editingId` toggles the editing state. */
function fakeEditor(editingId: ShapeId | null = null) {
  const updates: unknown[] = []
  const deleted: ShapeId[] = []
  const editor = {
    getEditingShapeId: () => editingId,
    getBindingsFromShape: () => [],
    updateShape: (p: unknown) => {
      updates.push(p)
      return editor
    },
    deleteShapes: (ids: readonly ShapeId[]) => {
      deleted.push(...ids)
      return editor
    },
  }
  return { editor: editor as unknown as Editor, updates, deleted }
}

function makeShape<T extends UnknownShape>(type: T["type"], props: T["props"]): T {
  return {
    id: createShapeId("test"),
    typeName: "shape",
    type,
    x: 0,
    y: 0,
    rotation: 0,
    index: "a1" as IndexKey,
    parentId: "page:page" as PageId,
    isLocked: false,
    opacity: 1,
    props,
    meta: {},
  } as T
}

describe("TextShapeUtil auto-size", () => {
  const { editor, deleted } = fakeEditor()
  const util = new TextShapeUtil(editor)
  const base = () => makeShape<TextShape>("text", util.getDefaultProps())

  it("fits w to the text on create and on text change", () => {
    // An empty text already measures to the minimum width, which is what the
    // default props carry, so there is nothing for the create hook to change.
    expect(util.onBeforeCreate(base())).toBeUndefined()
    const created = base()
    expect(created.props.w).toBe(TEXT_SHAPE_MIN_WIDTH)

    const prev = created
    const next = { ...prev, props: { ...prev.props, text: "hello world" } }
    const adjusted = util.onBeforeUpdate(prev, next)!
    expect(adjusted.props.w).toBeGreaterThan(prev.props.w)
    expect(adjusted.props.w).toBeCloseTo("hello world".length * 24 * 0.6)

    const longer = util.onBeforeUpdate(adjusted, { ...adjusted, props: { ...adjusted.props, text: "hello world, again" } })!
    expect(longer.props.w).toBeGreaterThan(adjusted.props.w)
  })

  it("height follows the line count", () => {
    const one = makeShape<TextShape>("text", { ...util.getDefaultProps(), text: "one" })
    const three = makeShape<TextShape>("text", { ...util.getDefaultProps(), text: "one\ntwo\nthree" })
    expect(util.getGeometry(one).bounds.h).toBeCloseTo(24 * LINE_HEIGHT)
    expect(util.getGeometry(three).bounds.h).toBeCloseTo(3 * 24 * LINE_HEIGHT)
    // multi-line auto-size width is the widest line
    const size = util.onBeforeCreate(three)!
    expect(size.props.w).toBeCloseTo("three".length * 24 * 0.6)
  })

  it("does not touch w when auto-size is off, but height still wraps", () => {
    const fixed = makeShape<TextShape>("text", { ...util.getDefaultProps(), autoSize: false, w: 100, text: "a".repeat(30) })
    expect(util.onBeforeCreate(fixed)).toBeUndefined()
    expect(util.onBeforeUpdate(fixed, { ...fixed, props: { ...fixed.props, text: "b".repeat(40) } })).toBeUndefined()
    expect(util.getGeometry(fixed).bounds.w).toBe(100)
    expect(util.getGeometry(fixed).bounds.h).toBeCloseTo(5 * 24 * LINE_HEIGHT)
  })

  it("scale changes the measured width", () => {
    const s1 = util.onBeforeCreate(makeShape<TextShape>("text", { ...util.getDefaultProps(), text: "abc" }))!
    const s2 = util.onBeforeCreate(makeShape<TextShape>("text", { ...util.getDefaultProps(), text: "abc", scale: 2 }))!
    expect(s2.props.w).toBeCloseTo(s1.props.w * 2)
  })

  it("deletes itself when editing ends with empty text", () => {
    const empty = makeShape<TextShape>("text", { ...util.getDefaultProps(), text: "  \n" })
    util.onEditEnd(empty)
    expect(deleted).toEqual([empty.id])
    const kept = makeShape<TextShape>("text", { ...util.getDefaultProps(), text: "keep" })
    util.onEditEnd(kept)
    expect(deleted).toHaveLength(1)
  })
})

describe("GeoShapeUtil growY", () => {
  const { editor, updates } = fakeEditor()
  const util = new GeoShapeUtil(editor)

  it("computes growY from the label height", () => {
    const props = { ...util.getDefaultProps(), w: 100, h: 40 }
    expect(getGeoGrowY(props)).toBe(0)
    // 100px wide with 16px padding either side leaves 68px of line, which at
    // the label scale's `m` takes 40 x's onto eight lines. The line count
    // follows the font size, so both come from the same constant.
    const tall = { ...props, text: "x".repeat(40) }
    const growY = getGeoGrowY(tall)
    expect(growY).toBeCloseTo(8 * LABEL_FONT_SIZES.m * LINE_HEIGHT + 32 - 40)
    // a taller box absorbs the label
    expect(getGeoGrowY({ ...tall, h: 1000 })).toBe(0)
  })

  it("applies growY on create and update, and geometry height includes it", () => {
    const shape = makeShape<GeoShape>("geo", { ...util.getDefaultProps(), w: 100, h: 40, text: "x".repeat(40) })
    const created = util.onBeforeCreate(shape)!
    expect(created.props.growY).toBeGreaterThan(0)
    expect(util.getGeometry(created).bounds.h).toBeCloseTo(40 + created.props.growY)

    const shrunk = util.onBeforeUpdate(created, { ...created, props: { ...created.props, text: "x" } })!
    expect(shrunk.props.growY).toBeCloseTo(LABEL_FONT_SIZES.m * LINE_HEIGHT + 32 - 40)
    const cleared = util.onBeforeUpdate(shrunk, { ...shrunk, props: { ...shrunk.props, text: "" } })!
    expect(cleared.props.growY).toBe(0)

    // unrelated prop changes do not recompute
    expect(util.onBeforeUpdate(created, { ...created, props: { ...created.props, color: "blue" } })).toBeUndefined()
  })

  it("trims trailing whitespace on edit end", () => {
    const shape = makeShape<GeoShape>("geo", { ...util.getDefaultProps(), text: "label \n" })
    util.onEditEnd(shape)
    // Both spellings are written together: a util that trimmed only `text`
    // would leave the document — the canonical spelling — untrimmed.
    expect(updates).toEqual([
      { id: shape.id, type: "geo", props: { text: "label", richText: toRichText("label") } },
    ])
  })

  it("stays on the GPU while editing and shows the label overlay when editing an empty label", () => {
    const shape = makeShape<GeoShape>("geo", util.getDefaultProps())
    const editing = new GeoShapeUtil(fakeEditor(shape.id).editor)
    expect(editing.needsOverlay(shape)).toBe(false)
    expect(editing.hasOverlayLabel(shape)).toBe(true)
    expect(editing.component(shape)).not.toBeNull()
    expect(util.hasOverlayLabel(shape)).toBe(false)
    expect(util.component(shape)).toBeNull()
  })
})

describe("NoteShapeUtil growY", () => {
  const util = new NoteShapeUtil(fakeEditor().editor)

  it("grows the note when the text overflows", () => {
    const short = util.onBeforeCreate(makeShape<NoteShape>("note", { ...util.getDefaultProps(), text: "hi" }))
    expect(short).toBeUndefined()
    const long = util.onBeforeCreate(makeShape<NoteShape>("note", { ...util.getDefaultProps(), text: "x".repeat(300) }))!
    expect(long.props.growY).toBeGreaterThan(0)
    expect(util.getGeometry(long).bounds.h).toBeCloseTo(NOTE_SIZE + long.props.growY)
    expect(util.needsOverlay(long)).toBe(false)
  })
})

describe("ArrowShapeUtil and FrameShapeUtil editing", () => {
  it("arrow label overlay appears while editing an empty label", () => {
    const shape = makeShape<ArrowShape>("arrow", new ArrowShapeUtil(fakeEditor().editor).getDefaultProps())
    const idle = new ArrowShapeUtil(fakeEditor().editor)
    const editing = new ArrowShapeUtil(fakeEditor(shape.id).editor)
    expect(idle.component(shape)).toBeNull()
    expect(idle.hasOverlayLabel(shape)).toBe(false)
    expect(editing.component(shape)).not.toBeNull()
    expect(editing.hasOverlayLabel(shape)).toBe(true)
    expect(editing.needsOverlay(shape)).toBe(false)
  })

  it("frame name is trimmed on edit end", () => {
    const { editor, updates } = fakeEditor()
    const util = new FrameShapeUtil(editor)
    const shape = makeShape<FrameShape>("frame", { ...util.getDefaultProps(), name: "  Title " })
    util.onEditEnd(shape)
    expect(updates).toEqual([{ id: shape.id, type: "frame", props: { name: "Title" } }])
    expect(util.needsOverlay(shape)).toBe(false)
  })
})
