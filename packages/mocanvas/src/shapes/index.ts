import type { ShapeUtilConstructor } from "@mocanvas/editor"
import { ArrowShapeUtil } from "./ArrowShapeUtil"
import { DrawShapeUtil } from "./DrawShapeUtil"
import { FrameShapeUtil } from "./FrameShapeUtil"
import { GeoShapeUtil } from "./GeoShapeUtil"
import { LineShapeUtil } from "./LineShapeUtil"
import { NoteShapeUtil } from "./NoteShapeUtil"
import { TextShapeUtil } from "./TextShapeUtil"

export * from "./GeoShapeUtil"
export * from "./DrawShapeUtil"
export * from "./LineShapeUtil"
export * from "./ArrowShapeUtil"
export * from "./TextShapeUtil"
export * from "./NoteShapeUtil"
export * from "./FrameShapeUtil"
export * from "./shape-theme"
export * from "./geo-helpers"
export * from "./arrow-helpers"
export * from "./spline-helpers"
export * from "./draw-helpers"
export * from "./text-helpers"
export { pathWordsToSvgD } from "./svg-path"

/** The built-in shape utils, in the order they are registered. */
export const defaultShapeUtils: ShapeUtilConstructor[] = [
  GeoShapeUtil,
  DrawShapeUtil,
  LineShapeUtil,
  ArrowShapeUtil,
  TextShapeUtil,
  NoteShapeUtil,
  FrameShapeUtil,
]
