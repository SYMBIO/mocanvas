import {
  BaseBoxShapeUtil,
  Rectangle2d,
  type AssetId,
  type BaseShape,
  type BookmarkAsset,
  type Editor,
  type Geometry2d,
  type StyleWords,
} from "@mocanvas/editor"
import type { CSSProperties, ReactNode } from "react"
import { propsOf, readNumber, readString } from "./prop-access"
import { rectPath } from "./indicator-paths"

export interface BookmarkShapeProps {
  w: number
  h: number
  /** The `bookmark` asset holding the scraped preview; `null` when nothing was scraped. */
  assetId: AssetId | null
  /** The page the card points at. Kept on the shape so a card survives a missing asset. */
  url: string
}

export type BookmarkShape = BaseShape<"bookmark", BookmarkShapeProps>

export const BOOKMARK_WIDTH = 300
export const BOOKMARK_HEIGHT = 320

// ---- card chrome ----------------------------------------------------------

export const BOOKMARK_FILL = "#ffffff"
export const BOOKMARK_STROKE = "#e8e9ea"
export const BOOKMARK_STROKE_WIDTH = 1
export const BOOKMARK_RADIUS = 8
/** The banner strip behind the asset's preview image (and its colour when there is none). */
export const BOOKMARK_BANNER_HEIGHT = 160
export const BOOKMARK_BANNER_FILL = "#eceff3"
export const BOOKMARK_PADDING = 12
export const BOOKMARK_GAP = 6
export const BOOKMARK_TITLE_HEIGHT = 38
export const BOOKMARK_META_HEIGHT = 16
export const BOOKMARK_FAVICON_SIZE = 14
export const BOOKMARK_TITLE_FONT_SIZE = 14
export const BOOKMARK_TEXT_FONT_SIZE = 12
export const BOOKMARK_META_FONT_SIZE = 11
export const BOOKMARK_TITLE_COLOR = "#1d1d1d"
export const BOOKMARK_TEXT_COLOR = "#666666"
export const BOOKMARK_META_COLOR = "#8f8f8f"
/** Body left under the banner even on a short card, so the text never disappears. */
export const BOOKMARK_MIN_BODY_HEIGHT = 80

/** A rectangle in shape-local space. */
export interface BookmarkRect {
  x: number
  y: number
  w: number
  h: number
}

/** Where each part of the card sits, in shape-local space. Shared by the overlay and the SVG export. */
export interface BookmarkLayout {
  banner: BookmarkRect
  title: BookmarkRect
  description: BookmarkRect
  favicon: BookmarkRect
  hostname: BookmarkRect
}

export function getBookmarkLayout(w: number, h: number): BookmarkLayout {
  const pad = BOOKMARK_PADDING
  const innerW = Math.max(0, w - pad * 2)
  const bannerH = Math.max(0, Math.min(BOOKMARK_BANNER_HEIGHT, h - BOOKMARK_MIN_BODY_HEIGHT))
  // The host line is placed from the bottom up and the title is what gives way
  // when the card is short, so a resized card loses its description first and
  // still reads as a link to somewhere.
  const metaY = Math.max(bannerH, h - pad - BOOKMARK_META_HEIGHT)
  const titleY = bannerH + pad
  const titleH = Math.max(0, Math.min(BOOKMARK_TITLE_HEIGHT, metaY - BOOKMARK_GAP - titleY))
  const descY = titleY + titleH + BOOKMARK_GAP
  const clamp = (r: BookmarkRect): BookmarkRect => {
    const x = Math.max(0, Math.min(r.x, w))
    const y = Math.max(0, Math.min(r.y, h))
    return { x, y, w: Math.max(0, Math.min(r.w, w - x)), h: Math.max(0, Math.min(r.h, h - y)) }
  }
  return {
    banner: clamp({ x: 0, y: 0, w, h: bannerH }),
    title: clamp({ x: pad, y: titleY, w: innerW, h: titleH }),
    description: clamp({ x: pad, y: descY, w: innerW, h: metaY - BOOKMARK_GAP - descY }),
    favicon: clamp({
      x: pad,
      y: metaY + (BOOKMARK_META_HEIGHT - BOOKMARK_FAVICON_SIZE) / 2,
      w: BOOKMARK_FAVICON_SIZE,
      h: BOOKMARK_FAVICON_SIZE,
    }),
    hostname: clamp({
      x: pad + BOOKMARK_FAVICON_SIZE + BOOKMARK_GAP,
      y: metaY,
      w: innerW - BOOKMARK_FAVICON_SIZE - BOOKMARK_GAP,
      h: BOOKMARK_META_HEIGHT,
    }),
  }
}

/**
 * The host a bookmark points at, without a `www.` prefix — the one line of a
 * link card that is always available, since it comes from the shape's own url
 * rather than from a scrape. An unparseable url reads as `""`.
 */
export function getBookmarkHostname(url: string): string {
  if (!url) return ""
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.startsWith("www.") ? host.slice(4) : host
  } catch {
    return ""
  }
}

/** The shape's `bookmark` asset, or `null` when it has none (or one of another type). */
export function getBookmarkAsset(editor: Editor, shape: BookmarkShape): BookmarkAsset | null {
  const assetId = readString(propsOf(shape), "assetId", "") as AssetId | ""
  if (!assetId) return null
  const asset = editor.getAsset<BookmarkAsset>(assetId)
  return asset && asset.type === "bookmark" ? asset : null
}

/** Everything the card draws, with each field falling back to something renderable. */
export interface BookmarkCard {
  title: string
  description: string
  image: string
  favicon: string
  hostname: string
  url: string
  /** Whether the card has a scraped asset behind it; `false` renders the placeholder. */
  hasAsset: boolean
}

export function getBookmarkCard(editor: Editor, shape: BookmarkShape): BookmarkCard {
  const url = readString(propsOf(shape), "url", "")
  const asset = getBookmarkAsset(editor, shape)
  const props = asset ? (asset.props as Partial<BookmarkAsset["props"]>) : undefined
  return {
    title: readString(props, "title", ""),
    description: readString(props, "description", ""),
    image: readString(props, "image", ""),
    favicon: readString(props, "favicon", ""),
    hostname: getBookmarkHostname(url) || getBookmarkHostname(readString(props, "src", "") ?? ""),
    url,
    hasAsset: asset !== null,
  }
}

function readBookmarkBox(shape: { props?: unknown }): { w: number; h: number } {
  const p = propsOf(shape)
  return { w: readNumber(p, "w", BOOKMARK_WIDTH), h: readNumber(p, "h", BOOKMARK_HEIGHT) }
}

const ELLIPSIS: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis" }

export class BookmarkShapeUtil extends BaseBoxShapeUtil<BookmarkShape> {
  static override type = "bookmark" as const

  getDefaultProps(): BookmarkShapeProps {
    return { w: BOOKMARK_WIDTH, h: BOOKMARK_HEIGHT, assetId: null, url: "" }
  }

  getGeometry(shape: BookmarkShape): Geometry2d {
    const { w, h } = readBookmarkBox(shape)
    return new Rectangle2d({ width: Math.max(1, w), height: Math.max(1, h), isFilled: true })
  }

  /**
   * The card is html — a banner image over wrapped, ellipsised text — which no
   * single textured quad can stand in for, so the shape always renders through
   * the DOM overlay.
   */
  override getRenderStyle(_shape: BookmarkShape): StyleWords | null {
    return null
  }

  component(shape: BookmarkShape): ReactNode {
    const { w, h } = readBookmarkBox(shape)
    const card = getBookmarkCard(this.editor, shape)
    const layout = getBookmarkLayout(w, h)
    const isEditing = this.editor.getEditingShapeId() === shape.id
    const frame: CSSProperties = {
      position: "absolute",
      left: 0,
      top: 0,
      width: w,
      height: h,
      boxSizing: "border-box",
      overflow: "hidden",
      borderRadius: BOOKMARK_RADIUS,
      background: BOOKMARK_FILL,
      border: `${BOOKMARK_STROKE_WIDTH}px solid ${BOOKMARK_STROKE}`,
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      /*
       * The canvas owns the pointer: a card is a shape you drag and select,
       * not a link you click. The url is still in the DOM as an `<a>` so
       * assistive tech can read and follow it, but it only takes the pointer
       * while the shape is being edited.
       */
      pointerEvents: isEditing ? "auto" : "none",
      userSelect: "none",
    }
    return (
      <a
        href={card.url || undefined}
        target="_blank"
        rel="noreferrer noopener"
        draggable={false}
        aria-label={card.title || card.hostname || card.url || "bookmark"}
        tabIndex={isEditing ? 0 : -1}
        style={{ ...frame, display: "block", color: "inherit", textDecoration: "none" }}
      >
        {card.hasAsset ? this.renderCard(card, layout) : this.renderPlaceholder(card, layout)}
      </a>
    )
  }

  /** The scraped card: banner, title, description, favicon and host. */
  private renderCard(card: BookmarkCard, layout: BookmarkLayout): ReactNode {
    return (
      <>
        <div style={{ position: "absolute", ...layout.banner, background: BOOKMARK_BANNER_FILL, overflow: "hidden" }}>
          {card.image ? (
            <img
              src={card.image}
              alt=""
              draggable={false}
              style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
            />
          ) : null}
        </div>
        <div
          style={{
            position: "absolute",
            ...layout.title,
            ...ELLIPSIS,
            fontSize: BOOKMARK_TITLE_FONT_SIZE,
            fontWeight: 600,
            lineHeight: 1.3,
            color: BOOKMARK_TITLE_COLOR,
          }}
        >
          {card.title}
        </div>
        <div
          style={{
            position: "absolute",
            ...layout.description,
            ...ELLIPSIS,
            fontSize: BOOKMARK_TEXT_FONT_SIZE,
            lineHeight: 1.4,
            color: BOOKMARK_TEXT_COLOR,
          }}
        >
          {card.description}
        </div>
        {card.favicon ? (
          <img
            src={card.favicon}
            alt=""
            draggable={false}
            style={{ position: "absolute", ...layout.favicon, objectFit: "contain", pointerEvents: "none" }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            ...layout.hostname,
            ...ELLIPSIS,
            whiteSpace: "nowrap",
            fontSize: BOOKMARK_META_FONT_SIZE,
            lineHeight: `${BOOKMARK_META_HEIGHT}px`,
            color: BOOKMARK_META_COLOR,
          }}
        >
          {card.hostname}
        </div>
      </>
    )
  }

  /** No asset: an empty banner and the host, so the shape still reads as a link to somewhere. */
  private renderPlaceholder(card: BookmarkCard, layout: BookmarkLayout): ReactNode {
    return (
      <>
        <div style={{ position: "absolute", ...layout.banner, background: BOOKMARK_BANNER_FILL }} />
        <div
          style={{
            position: "absolute",
            ...layout.title,
            ...ELLIPSIS,
            fontSize: BOOKMARK_TITLE_FONT_SIZE,
            lineHeight: 1.3,
            color: BOOKMARK_META_COLOR,
          }}
        >
          {card.hostname || card.url}
        </div>
      </>
    )
  }

  override getIndicatorPath(shape: BookmarkShape): Path2D {
    const { w, h } = readBookmarkBox(shape)
    return rectPath(w, h, BOOKMARK_RADIUS)
  }
}
