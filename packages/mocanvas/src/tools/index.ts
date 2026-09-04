import type { StateNodeConstructor } from "@mocanvas/editor"
import { ArrowTool } from "./ArrowTool"
import { DrawTool } from "./DrawTool"
import { EraserTool } from "./EraserTool"
import { FrameTool } from "./FrameTool"
import { GeoTool } from "./GeoTool"
import { HandTool } from "./HandTool"
import { LineTool } from "./LineTool"
import { NoteTool } from "./NoteTool"
import { SelectTool } from "./SelectTool"
import { TextTool } from "./TextTool"

export { ArrowTool, DrawTool, EraserTool, FrameTool, GeoTool, HandTool, LineTool, NoteTool, SelectTool, TextTool }

export const defaultTools: StateNodeConstructor[] = [
  SelectTool,
  HandTool,
  GeoTool,
  DrawTool,
  EraserTool,
  NoteTool,
  TextTool,
  ArrowTool,
  LineTool,
  FrameTool,
]
