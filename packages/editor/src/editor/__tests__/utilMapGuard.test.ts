import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { loadEngineSync } from "@mocanvas/wasm"
import { Editor } from "../Editor"
import { createStore } from "../createStore"
import { Rectangle2d } from "../../geometry"
import type { BaseShape } from "../../records/base"
import { BaseBoxShapeUtil } from "../../shapes/ShapeUtil"

/**
 * A consumer reported `TypeError: Cannot read properties of undefined (reading
 * 'stickyAnchor')` from `createBindings`, reading it as a missing binding util.
 * It is not: `this.bindingUtils` itself was gone, which the constructor never
 * leaves it. The way that happens is a subclass redeclaring the field — at
 * ES2022 a field declaration without an initializer DEFINES the property as
 * undefined once the base constructor has finished.
 *
 * These pin the diagnosis, not the crash: the crash was never ours to prevent,
 * but the message was ours to make readable.
 */

const wasmPath = fileURLToPath(new URL("../../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))
type BoxShape = BaseShape<"box", { w: number; h: number }>
class BoxUtil extends BaseBoxShapeUtil<BoxShape> {
  static override type = "box" as const
  getDefaultProps() {
    return { w: 10, h: 10 }
  }
  override getGeometry(s: BoxShape) {
    return new Rectangle2d({ width: s.props.w, height: s.props.h, isFilled: true })
  }
  component() {
    return null
  }
  override indicator() {
    return null
  }
}

function opts() {
  return {
    store: createStore(),
    shapeUtils: [BoxUtil],
    tools: [],
    engine: loadEngineSync(readFileSync(wasmPath)),
    getContainer: () => ({}) as HTMLElement,
  }
}

describe("a util map that has been wiped out from under the editor", () => {
  it("says what actually happened instead of reading like a missing util", () => {
    const editor = new Editor(opts())
    try {
      // Exactly what a subclass field redeclaration does at ES2022.
      Object.defineProperty(editor, "bindingUtils", { value: undefined, configurable: true })
      expect(() => editor.getBindingUtil("stickyAnchor")).toThrow(/bindingUtils is undefined/)
      expect(() => editor.getBindingUtil("stickyAnchor")).toThrow(/subclass redeclaring/)
      expect(() => editor.getBindingUtil("stickyAnchor")).toThrow(/declare readonly bindingUtils/)
    } finally {
      editor.dispose()
    }
  })

  it("does the same for shapeUtils", () => {
    const editor = new Editor(opts())
    try {
      Object.defineProperty(editor, "shapeUtils", { value: undefined, configurable: true })
      expect(() => editor.getShapeUtil("box")).toThrow(/shapeUtils is undefined/)
    } finally {
      editor.dispose()
    }
  })

  it("still reports a genuinely unregistered type as such", () => {
    const editor = new Editor(opts())
    try {
      expect(() => editor.getBindingUtil("nope")).toThrow(/No BindingUtil registered for type "nope"/)
      expect(() => editor.getShapeUtil("nope")).toThrow(/No ShapeUtil registered for type "nope"/)
    } finally {
      editor.dispose()
    }
  })

  it("costs a well-formed editor nothing", () => {
    const editor = new Editor(opts())
    try {
      expect(editor.getShapeUtil("box")).toBeDefined()
      expect(editor.bindingUtils).toEqual({})
    } finally {
      editor.dispose()
    }
  })
})
