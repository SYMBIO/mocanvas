import type { StateNodeConstructor } from "@mocanvas/editor"
import { ArrowTool } from "./ArrowTool"
import { DrawTool } from "./DrawTool"
import { EraserTool } from "./EraserTool"
import { FrameTool } from "./FrameTool"
import { GeoTool } from "./GeoTool"
import { HighlightShapeTool } from "./HighlightShapeTool"
import { LaserTool } from "./LaserTool"
import { HandTool } from "./HandTool"
import { LineTool } from "./LineTool"
import { NoteTool } from "./NoteTool"
import { SelectTool } from "./SelectTool"
import { TextTool } from "./TextTool"

export { BaseBoxShapeTool } from "./BaseBoxShapeTool"
export { HighlightShapeTool, LaserTool }
export { ArrowTool, DrawTool, EraserTool, FrameTool, GeoTool, HandTool, LineTool, NoteTool, SelectTool, TextTool }

/**
 * The tools that *place a shape*: one entry per built-in shape type that has a
 * tool of its own.
 *
 * Split out from {@link defaultTools} so an app can register the canvas tools
 * and its own shape tools without inheriting ours:
 *
 * ```ts
 * tools: [...defaultTools, ...defaultShapeTools, SectionTool]
 * ```
 *
 * {@link defaultTools} still contains these as well, so that spread names each
 * tool twice. That is deliberate and safe — a tool is registered under its
 * `id`, so a repeated constructor replaces its own earlier entry rather than
 * adding a second one — and it keeps every existing `tools: defaultTools`
 * working unchanged.
 */
export const defaultShapeTools: StateNodeConstructor[] = [
  GeoTool,
  DrawTool,
  HighlightShapeTool,
  NoteTool,
  TextTool,
  ArrowTool,
  LineTool,
  FrameTool,
]

/**
 * Every built-in tool: the canvas tools plus {@link defaultShapeTools}.
 *
 * `SelectTool` is first because the editor starts in whichever tool leads this
 * list.
 */
export const defaultTools: StateNodeConstructor[] = [SelectTool, HandTool, EraserTool, LaserTool, ...defaultShapeTools]

/**
 * The `*ShapeTool` spellings.
 *
 * A tool that places a shape is documented as `<Shape>ShapeTool`; this library
 * named them `<Shape>Tool` from the start. Both names are the same class — a
 * tool registers by its `static id`, so aliasing changes nothing at runtime.
 */
export {
  ArrowTool as ArrowShapeTool,
  DrawTool as DrawShapeTool,
  FrameTool as FrameShapeTool,
  GeoTool as GeoShapeTool,
  LineTool as LineShapeTool,
  NoteTool as NoteShapeTool,
  TextTool as TextShapeTool,
}
