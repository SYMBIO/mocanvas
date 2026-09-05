import {
  BaseBoxShapeUtil,
  Rectangle2d,
  type AssetId,
  type BaseShape,
  type Editor,
  type Geometry2d,
  getDefaultDisplayValues,
  type ShapeUtilOptions,
  type StyleWords,
  type TLColorMode,
  type TLDefaultDisplayValues,
  type TLStyledShape,
  type TLTheme,
  type VideoAsset,
} from "@mocanvas/editor"
import { videoShapeProps } from "./shape-props"
import { videoShapeMigrations } from "./shape-migrations"
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react"
import { propsOf, readBoolean, readNumber, readString } from "./prop-access"
import { rectPath } from "./indicator-paths"

export interface VideoShapeProps {
  w: number
  h: number
  /** The `video` asset holding the file; `null` while nothing is attached. */
  assetId: AssetId | null
  /** Playhead position, in seconds. */
  time: number
  playing: boolean
  /** A hyperlink attached to the shape (not the video source). */
  url: string
  altText: string
}

export type VideoShape = BaseShape<"video", VideoShapeProps>

export const VIDEO_WIDTH = 640
export const VIDEO_HEIGHT = 360

export const VIDEO_PLACEHOLDER_FILL = "#eceff3"
export const VIDEO_PLACEHOLDER_STROKE = "#9fa8b2"
/** The play triangle drawn on the placeholder (and in an SVG export). */
export const VIDEO_PLAY_COLOR = "#5f6670"
export const VIDEO_PLAY_SIZE = 48

/** Seeking to within this many seconds of the stored time is treated as already there. */
export const VIDEO_TIME_EPSILON = 0.1

/**
 * The editor members this module reads, none of which it requires to exist.
 *
 * `allowVideoAutoplay` is an editor *option*, so its declaration belongs on
 * `EditorConfig` in the editor package; it is read structurally here so that a
 * host which already sets it is honoured whether or not the field has been
 * declared yet.
 */
interface EditorWithVideoOptions {
  options?: { allowVideoAutoplay?: boolean }
}

/**
 * Whether a video may start itself.
 *
 * Defaults to `true` — the historical behaviour, where a shape carrying
 * `props.playing` starts as soon as it is on screen. An app that sets
 * `options.allowVideoAutoplay: false` gets the opposite: no video ever starts
 * on its own, and one only plays once someone presses play in its controls.
 * The shape's `playing` prop is left alone either way, so the setting is a
 * property of this editor rather than an edit to the document.
 */
export function isVideoAutoplayAllowed(editor: Editor | null | undefined): boolean {
  return (editor as EditorWithVideoOptions | null | undefined)?.options?.allowVideoAutoplay !== false
}

/**
 * The file the shape plays: the asset's `src`, or `null` when there is no
 * asset yet, the asset is still uploading, or it is not a video.
 */
export function getVideoSource(editor: Editor, shape: VideoShape): string | null {
  const assetId = readString(propsOf(shape), "assetId", "") as AssetId | ""
  if (!assetId) return null
  const asset = editor.getAsset<VideoAsset>(assetId)
  if (!asset || asset.type !== "video") return null
  return asset.props.src ?? null
}

function readVideoBox(shape: { props?: unknown }): { w: number; h: number } {
  const p = propsOf(shape)
  return { w: readNumber(p, "w", VIDEO_WIDTH), h: readNumber(p, "h", VIDEO_HEIGHT) }
}

/** The play triangle's points, centred in a `w`×`h` box. */
export function getVideoPlayTriangle(w: number, h: number, size = VIDEO_PLAY_SIZE): { x: number; y: number }[] {
  const s = Math.max(0, Math.min(size, w * 0.6, h * 0.6))
  const cx = w / 2
  const cy = h / 2
  // An equilateral-ish triangle pointing right, centred on its own area.
  const half = s / 2
  return [
    { x: cx - half * 0.6, y: cy - half },
    { x: cx - half * 0.6, y: cy + half },
    { x: cx + half * 0.9, y: cy },
  ]
}

interface VideoPlayerProps {
  src: string
  time: number
  playing: boolean
  controls: boolean
  altText: string
}

/**
 * The `<video>` element, kept in step with the shape's `time` and `playing`
 * props. The props are the source of truth: the element is seeked and
 * played/paused from them, never the other way round, so two views of the same
 * document stay together.
 */
function VideoPlayer({ src, time, playing, controls, altText }: VideoPlayerProps): ReactNode {
  const ref = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Seeking before metadata arrives is refused by some browsers, so it is
    // retried once the duration is known.
    const seek = (): void => {
      if (Math.abs(el.currentTime - time) <= VIDEO_TIME_EPSILON) return
      try {
        el.currentTime = time
      } catch {
        /* not seekable yet; `loadedmetadata` retries */
      }
    }
    seek()
    el.addEventListener("loadedmetadata", seek)
    return () => el.removeEventListener("loadedmetadata", seek)
  }, [time, src])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Autoplay may be refused (a policy, a decode error); the shape stays put.
    if (playing) void el.play().catch(() => {})
    else el.pause()
  }, [playing, src])

  return (
    <video
      ref={ref}
      src={src}
      controls={controls}
      playsInline
      muted
      loop
      preload="metadata"
      aria-label={altText || undefined}
      draggable={false}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        objectFit: "cover",
        // Controls are only reachable while editing; otherwise the canvas
        // keeps the pointer so a drag over a video still pans.
        pointerEvents: controls ? "auto" : "none",
        userSelect: "none",
      }}
    />
  )
}

/**
 * What a video shape paints with: the placeholder frame and the play glyph
 * drawn over it. Like an image, a video carries no styles of its own.
 */
export interface VideoShapeUtilDisplayValues extends TLDefaultDisplayValues {
  /** Fill of the frame drawn before the video can be shown. */
  placeholderFill: string
  /** Border of that placeholder. */
  placeholderStroke: string
  /** Ink of the play glyph. */
  playColor: string
  /** The play glyph's side, in page units. */
  playSize: number
}

/** `VideoShapeUtil`'s settings; see {@link ShapeUtil.configure}. */
export interface VideoShapeOptions extends ShapeUtilOptions<VideoShape, VideoShapeUtilDisplayValues> {
  /** The width a new video shape is created at, in page units. */
  defaultWidth?: number
  /** The height a new video shape is created at, in page units. */
  defaultHeight?: number
}

/** Resolve a video shape's display values; see {@link VideoShapeUtilDisplayValues}. */
export function getVideoDisplayValues(
  editor: unknown,
  shape: { props?: unknown },
  theme: TLTheme,
  colorMode: TLColorMode,
): VideoShapeUtilDisplayValues {
  return {
    ...getDefaultDisplayValues(editor, shape as TLStyledShape, theme, colorMode),
    placeholderFill: VIDEO_PLACEHOLDER_FILL,
    placeholderStroke: VIDEO_PLACEHOLDER_STROKE,
    playColor: VIDEO_PLAY_COLOR,
    playSize: VIDEO_PLAY_SIZE,
  }
}

export class VideoShapeUtil extends BaseBoxShapeUtil<VideoShape> {
  static override type = "video" as const
  static override props = videoShapeProps
  static override migrations = videoShapeMigrations
  static override options: VideoShapeOptions = { getDefaultDisplayValues: getVideoDisplayValues }
  declare readonly options: VideoShapeOptions

  getDefaultProps(): VideoShapeProps {
    return { w: VIDEO_WIDTH, h: VIDEO_HEIGHT, assetId: null, time: 0, playing: true, url: "", altText: "" }
  }

  getGeometry(shape: VideoShape): Geometry2d {
    const { w, h } = readVideoBox(shape)
    return new Rectangle2d({ width: Math.max(1, w), height: Math.max(1, h), isFilled: true })
  }

  /** A moving picture is not a texture the engine owns: video renders in the DOM overlay. */
  override getRenderStyle(_shape: VideoShape): StyleWords | null {
    return null
  }

  component(shape: VideoShape): ReactNode {
    const { w, h } = readVideoBox(shape)
    const p = propsOf(shape)
    const altText = readString(p, "altText", "")
    const src = getVideoSource(this.editor, shape)
    const box: CSSProperties = { position: "absolute", left: 0, top: 0, width: w, height: h, overflow: "hidden", boxSizing: "border-box" }
    if (!src) {
      const [a, b, c] = getVideoPlayTriangle(w, h)
      return (
        <div
          style={{ ...box, background: VIDEO_PLACEHOLDER_FILL, border: `1px dashed ${VIDEO_PLACEHOLDER_STROKE}`, pointerEvents: "none" }}
          aria-label={altText || "video"}
        >
          <svg width={w} height={h} viewBox={`0 0 ${Math.max(1, w)} ${Math.max(1, h)}`} style={{ display: "block" }} aria-hidden="true">
            <polygon points={`${a!.x},${a!.y} ${b!.x},${b!.y} ${c!.x},${c!.y}`} fill={VIDEO_PLAY_COLOR} />
          </svg>
        </div>
      )
    }
    return (
      <div style={box}>
        <VideoPlayer
          src={src}
          time={readNumber(p, "time", 0)}
          playing={readBoolean(p, "playing", true) && isVideoAutoplayAllowed(this.editor)}
          controls={this.editor.getEditingShapeId() === shape.id}
          altText={altText}
        />
      </div>
    )
  }

  override getIndicatorPath(shape: VideoShape): Path2D {
    const { w, h } = readVideoBox(shape)
    return rectPath(w, h)
  }

  /** Editing a video means taking its controls, not typing into it. */
  override canEdit(_shape: VideoShape): boolean {
    return true
  }

  override isAspectRatioLocked(_shape: VideoShape): boolean {
    return true
  }
}
