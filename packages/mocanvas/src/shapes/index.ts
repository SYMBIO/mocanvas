// Registers the built-in shapes in the editor's global prop map (types only).
import "./register"
import type { ShapeUtilConstructor } from "@mocanvas/editor"
import { ArrowShapeUtil } from "./ArrowShapeUtil"
import { BookmarkShapeUtil } from "./BookmarkShapeUtil"
import { DrawShapeUtil } from "./DrawShapeUtil"
import { EmbedShapeUtil } from "./EmbedShapeUtil"
import { FrameShapeUtil } from "./FrameShapeUtil"
import { GeoShapeUtil } from "./GeoShapeUtil"
import { HighlightShapeUtil } from "./HighlightShapeUtil"
import { ImageShapeUtil } from "./ImageShapeUtil"
import { LineShapeUtil } from "./LineShapeUtil"
import { NoteShapeUtil } from "./NoteShapeUtil"
import { TextShapeUtil } from "./TextShapeUtil"
import { VideoShapeUtil } from "./VideoShapeUtil"

export * from "./GeoShapeUtil"
export * from "./HighlightShapeUtil"
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
export * from "./geo-types"
export * from "./arrow-helpers"
export * from "./spline-helpers"
export * from "./draw-helpers"
export * from "./text-helpers"
export * from "./prop-access"
export { pathWordsToSvgD, transformPathWords } from "./svg-path"
export * from "./indicator-paths"

/** The built-in shape utils, in the order they are registered. */
export * from "./GroupShapeUtil"
import { GroupShapeUtil } from "./GroupShapeUtil"

export const defaultShapeUtils: ShapeUtilConstructor[] = [
  GroupShapeUtil,
  GeoShapeUtil,
  DrawShapeUtil,
  HighlightShapeUtil,
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
export * from "./elbow-arrow-types"
export * from "./shape-props"
export * from "./shape-migrations"
export * from "./crop-box"
