import type { ShapeUtilConstructor } from "@mocanvas/editor"
import { ArrowShapeUtil } from "./ArrowShapeUtil"
import { BookmarkShapeUtil } from "./BookmarkShapeUtil"
import { DrawShapeUtil } from "./DrawShapeUtil"
import { EmbedShapeUtil } from "./EmbedShapeUtil"
import { FrameShapeUtil } from "./FrameShapeUtil"
import { GeoShapeUtil } from "./GeoShapeUtil"
import { ImageShapeUtil } from "./ImageShapeUtil"
import { LineShapeUtil } from "./LineShapeUtil"
import { NoteShapeUtil } from "./NoteShapeUtil"
import { TextShapeUtil } from "./TextShapeUtil"
import { VideoShapeUtil } from "./VideoShapeUtil"

export * from "./GeoShapeUtil"
export * from "./DrawShapeUtil"
export * from "./LineShapeUtil"
export * from "./ArrowShapeUtil"
export * from "./TextShapeUtil"
export * from "./NoteShapeUtil"
export * from "./FrameShapeUtil"
export * from "./ImageShapeUtil"
export * from "./BookmarkShapeUtil"
export * from "./EmbedShapeUtil"
export * from "./VideoShapeUtil"
export * from "./shape-theme"
export * from "./geo-helpers"
export * from "./arrow-helpers"
export * from "./spline-helpers"
export * from "./draw-helpers"
export * from "./text-helpers"
export * from "./prop-access"
export { pathWordsToSvgD } from "./svg-path"
export * from "./indicator-paths"

/** The built-in shape utils, in the order they are registered. */
export { GroupShapeUtil, type GroupShape } from "./GroupShapeUtil"
import { GroupShapeUtil } from "./GroupShapeUtil"

export const defaultShapeUtils: ShapeUtilConstructor[] = [
  GroupShapeUtil,
  GeoShapeUtil,
  DrawShapeUtil,
  LineShapeUtil,
  ArrowShapeUtil,
  TextShapeUtil,
  NoteShapeUtil,
  FrameShapeUtil,
  ImageShapeUtil,
  BookmarkShapeUtil,
  EmbedShapeUtil,
  VideoShapeUtil,
]
export * from "./elbow-helpers"
