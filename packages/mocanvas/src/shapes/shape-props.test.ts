import { describe, expect, it } from "vitest"
import { DefaultColorStyle, DefaultSizeStyle, StyleProp, getStylePropsOf } from "@mocanvas/editor"
import { defaultShapeUtils } from "./index"
import {
  arrowBindingProps,
  arrowShapeProps,
  drawShapeProps,
  frameShapeProps,
  geoShapeProps,
  groupShapeProps,
  highlightShapeProps,
  imageShapeProps,
  lineShapeProps,
  noteShapeProps,
  richTextValidator,
  textShapeProps,
} from "./shape-props"

describe("built-in props maps", () => {
  it("gives every built-in shape a validator for every prop it defaults", () => {
    for (const Util of defaultShapeUtils) {
      const props = Util.props
      expect(props, Util.type).toBeDefined()
      // Every *required* prop the map names must have a default, or a shape
      // created from `getDefaultProps` would not validate. An optional one may
      // legitimately have none — a note's `textFirstEditedBy` is round-tripped
      // but never written by this library.
      const defaults = Object.keys(new (Util as unknown as new () => { getDefaultProps(): object })().getDefaultProps())
      for (const [key, validator] of Object.entries(props!)) {
        if (validator.isValid(undefined)) continue
        expect(defaults, `${Util.type}.${key}`).toContain(key)
      }
    }
  })

  it("keeps the style set exactly as each shape declared it", () => {
    // Styles are shared, remembered and multi-select-editable; adding one to a
    // shape changes the style panel, so the maps are pinned against that.
    const styles = (props: object): string[] => [...getStylePropsOf(props).keys()].sort()
    expect(styles(geoShapeProps)).toEqual(["align", "color", "dash", "fill", "font", "geo", "labelColor", "size", "verticalAlign"])
    expect(styles(arrowShapeProps)).toEqual(["color", "dash", "fill", "font", "labelColor", "size"])
    expect(styles(drawShapeProps)).toEqual(["color", "dash", "fill", "size"])
    expect(styles(highlightShapeProps)).toEqual(["color", "size"])
    expect(styles(lineShapeProps)).toEqual(["color", "dash", "size"])
    expect(styles(textShapeProps)).toEqual(["color", "font", "size", "textAlign"])
    expect(styles(noteShapeProps)).toEqual(["align", "color", "font", "labelColor", "size", "verticalAlign"])
    // Media and container shapes carry no styles at all.
    expect(styles(imageShapeProps)).toEqual([])
    expect(styles(groupShapeProps)).toEqual([])
  })

  it("keeps an arrow's routing and terminals off the style panel", () => {
    // They belong to the one arrow: a mixed selection has nothing to share them
    // with, and a remembered "last arrowhead" is not what the style set is for.
    expect(arrowShapeProps.kind).not.toBeInstanceOf(StyleProp)
    expect(arrowShapeProps.arrowheadStart).not.toBeInstanceOf(StyleProp)
    expect(arrowShapeProps.kind.isValid("elbow")).toBe(true)
    expect(arrowShapeProps.kind.isValid("wiggly")).toBe(false)
    expect(arrowShapeProps.arrowheadEnd.isValid("triangle")).toBe(true)
  })

  it("validates a frame's colour without making it a style", () => {
    expect(frameShapeProps.color).not.toBeInstanceOf(StyleProp)
    expect(frameShapeProps.color!.isValid("blue")).toBe(true)
    expect(frameShapeProps.color!.isValid("puce")).toBe(false)
    expect(frameShapeProps.color!.isValid(undefined)).toBe(true)
  })

  it("uses the shared style objects, not copies of them", () => {
    // Two shapes only share a style when they name the same object; a copy with
    // the same values would silently split every multi-shape edit in two.
    expect(geoShapeProps.color).toBe(DefaultColorStyle)
    expect(drawShapeProps.color).toBe(DefaultColorStyle)
    expect(highlightShapeProps.size).toBe(DefaultSizeStyle)
  })

  it("accepts a rich-text document and refuses anything else", () => {
    expect(richTextValidator.isValid({ type: "doc", content: [] })).toBe(true)
    expect(richTextValidator.isValid({ type: "paragraph" })).toBe(false)
    expect(richTextValidator.isValid("plain")).toBe(false)
    // An unknown node type passes: an app may register its own, and a newer
    // editor's document must not be rejected outright.
    expect(richTextValidator.isValid({ type: "doc", content: [{ type: "mermaid", attrs: { src: "x" } }] })).toBe(true)
  })

  it("fills in an absent `content`, so every accepted document has one", () => {
    expect(richTextValidator.validate({ type: "doc" })).toEqual({ type: "doc", content: [] })
  })

  it("rejects a zero-width shape and a crop outside the source", () => {
    expect(geoShapeProps.w.isValid(0)).toBe(false)
    expect(imageShapeProps.crop.isValid({ topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 } })).toBe(true)
    expect(imageShapeProps.crop.isValid({ topLeft: { x: -0.5, y: 0 }, bottomRight: { x: 1, y: 1 } })).toBe(false)
    expect(imageShapeProps.crop.isValid(null)).toBe(true)
  })

  it("drops `isCircle` rather than storing it as undefined", () => {
    // The two spellings differ under `exactOptionalPropertyTypes`, and only the
    // absent one matches `TLShapeCrop`.
    const crop = imageShapeProps.crop.validate({ topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 } })
    expect(crop && "isCircle" in crop).toBe(false)
  })

  it("describes the arrow binding's four props", () => {
    expect(Object.keys(arrowBindingProps).sort()).toEqual(["isExact", "isPrecise", "normalizedAnchor", "terminal"])
    expect(arrowBindingProps.terminal.isValid("start")).toBe(true)
    expect(arrowBindingProps.terminal.isValid("middle")).toBe(false)
  })
})
