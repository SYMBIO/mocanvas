import {
  getLoadedEngine,
  registerEngineProvider,
  registerExportImplementation,
  registerTextMeasureImplementation,
  type Editor,
  type ShapeId,
} from "@mocanvas/editor"
import { exportToBlob, getSvgString } from "./export"
import { getTextMeasure } from "./text"

/**
 * `@mocanvas/editor` declares `Editor.getSvgString`, `Editor.toImage` and
 * `Editor.textMeasure` but cannot implement them: exporting needs the default
 * shapes' SVG renderers and measuring text needs the DOM, both of which live
 * here, and this package depends on the editor rather than the other way round.
 *
 * Importing `mocanvas` runs this module and fills those three in. An app that
 * builds on `@mocanvas/editor` alone either imports this package or registers
 * its own through the same seam.
 */
registerExportImplementation({
  getSvgString,
  async toImage(editor: Editor, ids?: readonly ShapeId[], opts = {}) {
    const { format = "png", ...rest } = opts
    // Measure from the SVG so the caller learns the size without decoding the blob.
    const measured = getSvgString(editor, ids, rest)
    if (!measured) throw new Error("Nothing to export: the page has no shapes, and none were named.")
    const blob = await exportToBlob(editor, { ...rest, ...(ids === undefined ? {} : { ids }), format })
    return { blob, width: measured.width, height: measured.height }
  },
})

registerTextMeasureImplementation(getTextMeasure)

/**
 * Let `new Editor({ ... })` be constructed without threading the engine
 * through: it picks up whatever `loadEngine()` last produced. `<Mocanvas />`
 * loads it before mounting, so an app that uses the component never sees this.
 */
registerEngineProvider(getLoadedEngine)
