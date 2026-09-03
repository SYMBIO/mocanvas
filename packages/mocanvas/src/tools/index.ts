import type { StateNodeConstructor } from "@mocanvas/editor"
import { DrawTool } from "./DrawTool"
import { EraserTool } from "./EraserTool"
import { GeoTool } from "./GeoTool"
import { HandTool } from "./HandTool"
import { NoteTool } from "./NoteTool"
import { SelectTool } from "./SelectTool"

export { DrawTool, EraserTool, GeoTool, HandTool, NoteTool, SelectTool }

export const defaultTools: StateNodeConstructor[] = [SelectTool, HandTool, GeoTool, DrawTool, EraserTool, NoteTool]
