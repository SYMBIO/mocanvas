import type { ArrowShapeProps } from "./ArrowShapeUtil"
import type { BookmarkShapeProps } from "./BookmarkShapeUtil"
import type { DrawShapeProps } from "./DrawShapeUtil"
import type { EmbedShapeProps } from "./EmbedShapeUtil"
import type { FrameShapeProps } from "./FrameShapeUtil"
import type { GeoShapeProps } from "./GeoShapeUtil"
import type { HighlightShapeProps } from "./HighlightShapeUtil"
import type { ImageShapeProps } from "./ImageShapeUtil"
import type { LineShapeProps } from "./LineShapeUtil"
import type { NoteShapeProps } from "./NoteShapeUtil"
import type { TextShapeProps } from "./TextShapeUtil"
import type { VideoShapeProps } from "./VideoShapeUtil"

/**
 * Register this package's shapes in the editor's global prop map.
 *
 * `@mocanvas/editor` is shape-agnostic: it ships no shapes, so it cannot
 * declare their props. This is the same module augmentation an app writes for
 * a custom shape, done here for the built-ins — which is what makes `Shape` a
 * discriminated union, so `shape.type === "note"` narrows `shape.props`.
 *
 * Type-only: nothing here exists at runtime.
 */
declare module "@mocanvas/editor" {
  interface TLGlobalShapePropsMap {
    arrow: ArrowShapeProps
    bookmark: BookmarkShapeProps
    draw: DrawShapeProps
    embed: EmbedShapeProps
    frame: FrameShapeProps
    geo: GeoShapeProps
    group: Record<string, never>
    highlight: HighlightShapeProps
    image: ImageShapeProps
    line: LineShapeProps
    note: NoteShapeProps
    text: TextShapeProps
    video: VideoShapeProps
  }
}

export {}
