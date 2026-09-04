import { BaseBoxShapeUtil, Rectangle2d, type BaseShape, type Geometry2d, type StyleWords } from "@mocanvas/editor"
import type { CSSProperties, ReactNode } from "react"
import { propsOf, readNumber, readString } from "./prop-access"

export interface EmbedShapeProps {
  w: number
  h: number
  /** The page being embedded, as the document stored it (not the iframe's src). */
  url: string
}

export type EmbedShape = BaseShape<"embed", EmbedShapeProps>

export const EMBED_WIDTH = 720
export const EMBED_HEIGHT = 500

export const EMBED_PLACEHOLDER_FILL = "#f5f6f8"
export const EMBED_PLACEHOLDER_STROKE = "#9fa8b2"
export const EMBED_PLACEHOLDER_TEXT = "#5f6670"
export const EMBED_PLACEHOLDER_FONT_SIZE = 13
export const EMBED_PLACEHOLDER_PADDING = 16
export const EMBED_RADIUS = 6

/**
 * The sandbox an embedded page runs in. Scripts and same-origin are what makes
 * a player work at all; popups let a "watch on the site" button escape. Nothing
 * else is granted — no forms, no top-level navigation, no pointer lock.
 */
export const EMBED_SANDBOX = "allow-scripts allow-same-origin allow-popups"

// ---- the permit list ------------------------------------------------------

/**
 * One embeddable service: the exact hosts it is recognised by, and how one of
 * its page urls becomes an embeddable one.
 *
 * `hostnames` are matched exactly (case-insensitively, with a leading `www.`
 * ignored), never as a suffix — `youtube.com.evil.test` is a different host and
 * is not on the list. `toEmbedUrl` receives the parsed url and returns an
 * absolute `https:` url, or `null` when this particular page of the service is
 * not embeddable (a channel page rather than a video, say).
 */
export interface EmbedDefinition {
  /** Stable id for the service, e.g. `"youtube"`. */
  type: string
  /** Human-readable name, shown on the placeholder card. */
  title: string
  hostnames: readonly string[]
  toEmbedUrl(url: URL): string | null
}

/** A url that matched the permit list. */
export interface EmbedMatch {
  definition: EmbedDefinition
  /** Absolute `https:` url for the iframe's `src`. */
  embedUrl: string
}

/** `https://` + host + path + query + hash of an already-permitted url, forcing the scheme. */
function httpsUrl(host: string, url: URL, opts: { hash?: boolean } = {}): string {
  return `https://${host}${url.pathname}${url.search}${opts.hash ? url.hash : ""}`
}

/** A youtube video id: the opaque token youtube itself uses, nothing path-like. */
function youTubeId(candidate: string | undefined | null): string | null {
  return candidate && /^[A-Za-z0-9_-]{6,20}$/.test(candidate) ? candidate : null
}

const youtube: EmbedDefinition = {
  type: "youtube",
  title: "YouTube",
  hostnames: ["youtube.com", "m.youtube.com", "youtube-nocookie.com", "youtu.be"],
  toEmbedUrl(url) {
    const segments = url.pathname.split("/").filter(Boolean)
    const host = url.hostname.toLowerCase().replace(/^www\./, "")
    const id =
      host === "youtu.be"
        ? youTubeId(segments[0])
        : youTubeId(url.searchParams.get("v")) ??
          (segments[0] === "embed" || segments[0] === "shorts" || segments[0] === "live" ? youTubeId(segments[1]) : null)
    // The no-cookie host is the same player without the tracking cookie.
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : null
  },
}

const vimeo: EmbedDefinition = {
  type: "vimeo",
  title: "Vimeo",
  hostnames: ["vimeo.com", "player.vimeo.com"],
  toEmbedUrl(url) {
    const id = url.pathname.split("/").filter(Boolean).find((s) => /^\d{6,12}$/.test(s))
    return id ? `https://player.vimeo.com/video/${id}` : null
  },
}

const codesandbox: EmbedDefinition = {
  type: "codesandbox",
  title: "CodeSandbox",
  hostnames: ["codesandbox.io"],
  toEmbedUrl(url) {
    const segments = url.pathname.split("/").filter(Boolean)
    // `/s/<id>`, `/embed/<id>` and `/p/sandbox/<id>` all name the same sandbox.
    const id = segments[0] === "p" && segments[1] === "sandbox" ? segments[2] : segments[0] === "s" || segments[0] === "embed" ? segments[1] : null
    return id && /^[A-Za-z0-9_-]{3,64}$/.test(id) ? `https://codesandbox.io/embed/${id}` : null
  },
}

const figma: EmbedDefinition = {
  type: "figma",
  title: "Figma",
  hostnames: ["figma.com"],
  toEmbedUrl(url) {
    // Figma's viewer takes the file url as a parameter rather than a path.
    const target = `https://www.figma.com${url.pathname}${url.search}`
    return `https://www.figma.com/embed?embed_host=mocanvas&url=${encodeURIComponent(target)}`
  },
}

const googleMaps: EmbedDefinition = {
  type: "google-maps",
  title: "Google Maps",
  hostnames: ["google.com", "maps.google.com"],
  toEmbedUrl(url) {
    if (!url.pathname.startsWith("/maps")) return null
    if (url.pathname.startsWith("/maps/embed")) return httpsUrl("www.google.com", url)
    const params = new URLSearchParams(url.search)
    params.set("output", "embed")
    return `https://www.google.com/maps?${params.toString()}`
  },
}

const excalidraw: EmbedDefinition = {
  type: "excalidraw",
  title: "Excalidraw",
  hostnames: ["excalidraw.com"],
  // The scene lives in the fragment (`#json=`, `#room=`), so it has to survive.
  toEmbedUrl: (url) => httpsUrl("excalidraw.com", url, { hash: true }),
}

/** The services recognised out of the box. */
export const DEFAULT_EMBED_DEFINITIONS: readonly EmbedDefinition[] = [youtube, vimeo, codesandbox, figma, googleMaps, excalidraw]

/**
 * The permit list `getEmbedDefinition` consults. It starts as the defaults and
 * is meant to be extended by the app:
 *
 * ```ts
 * embedDefinitions.push({
 *   type: "intranet",
 *   title: "Intranet",
 *   hostnames: ["wiki.example.com"],
 *   toEmbedUrl: (url) => `https://wiki.example.com${url.pathname}?embed=1`,
 * })
 * ```
 *
 * Nothing outside the list is ever put in an iframe.
 */
export const embedDefinitions: EmbedDefinition[] = [...DEFAULT_EMBED_DEFINITIONS]

/** Hosts are compared case-insensitively, and a leading `www.` never distinguishes one. */
function normalizeHost(hostname: string): string {
  const host = hostname.toLowerCase()
  return host.startsWith("www.") ? host.slice(4) : host
}

/**
 * The permit-list entry for `url`, with the url to actually put in the iframe,
 * or `null` when the url is not one we embed.
 *
 * Rejects anything that is not `http(s)` (a `javascript:` or `data:` url never
 * reaches an iframe), and matches hosts exactly, so a lookalike host that
 * merely *contains* a permitted one is not embedded.
 */
export function getEmbedDefinition(url: string, definitions: readonly EmbedDefinition[] = embedDefinitions): EmbedMatch | null {
  if (typeof url !== "string" || url.length === 0) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null
  const host = normalizeHost(parsed.hostname)
  for (const definition of definitions) {
    if (!definition.hostnames.some((h) => normalizeHost(h) === host)) continue
    const embedUrl = definition.toEmbedUrl(parsed)
    // A permitted host with an unembeddable page falls through to the placeholder.
    if (embedUrl && embedUrl.startsWith("https://")) return { definition, embedUrl }
    return null
  }
  return null
}

function readEmbedBox(shape: { props?: unknown }): { w: number; h: number } {
  const p = propsOf(shape)
  return { w: readNumber(p, "w", EMBED_WIDTH), h: readNumber(p, "h", EMBED_HEIGHT) }
}

export class EmbedShapeUtil extends BaseBoxShapeUtil<EmbedShape> {
  static override type = "embed" as const

  getDefaultProps(): EmbedShapeProps {
    return { w: EMBED_WIDTH, h: EMBED_HEIGHT, url: "" }
  }

  getGeometry(shape: EmbedShape): Geometry2d {
    const { w, h } = readEmbedBox(shape)
    return new Rectangle2d({ width: Math.max(1, w), height: Math.max(1, h), isFilled: true })
  }

  /** An iframe is not a quad: embeds always render through the DOM overlay. */
  override getRenderStyle(_shape: EmbedShape): StyleWords | null {
    return null
  }

  component(shape: EmbedShape): ReactNode {
    const { w, h } = readEmbedBox(shape)
    const url = readString(propsOf(shape), "url", "")
    const match = getEmbedDefinition(url)
    const box: CSSProperties = {
      position: "absolute",
      left: 0,
      top: 0,
      width: w,
      height: h,
      boxSizing: "border-box",
      overflow: "hidden",
      borderRadius: EMBED_RADIUS,
    }
    if (!match) {
      return (
        <div
          style={{
            ...box,
            background: EMBED_PLACEHOLDER_FILL,
            border: `1px dashed ${EMBED_PLACEHOLDER_STROKE}`,
            padding: EMBED_PLACEHOLDER_PADDING,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
            fontSize: EMBED_PLACEHOLDER_FONT_SIZE,
            color: EMBED_PLACEHOLDER_TEXT,
            wordBreak: "break-all",
            pointerEvents: "none",
            userSelect: "none",
          }}
          aria-label={url ? `embed: ${url}` : "embed"}
        >
          {url || "No embed url"}
        </div>
      )
    }
    /*
     * An iframe that takes the pointer swallows the gesture that was meant to
     * pan or select the canvas — the wheel and the drag never reach us. So the
     * frame is inert until the shape is being edited, and the canvas keeps its
     * own gestures the rest of the time.
     */
    const isEditing = this.editor.getEditingShapeId() === shape.id
    return (
      <div style={box}>
        <iframe
          src={match.embedUrl}
          title={`${match.definition.title} embed`}
          width={w}
          height={h}
          sandbox={EMBED_SANDBOX}
          referrerPolicy="no-referrer"
          loading="lazy"
          allowFullScreen
          style={{ display: "block", width: "100%", height: "100%", border: 0, pointerEvents: isEditing ? "auto" : "none" }}
        />
      </div>
    )
  }

  indicator(shape: EmbedShape): ReactNode {
    const { w, h } = readEmbedBox(shape)
    return <rect width={w} height={h} rx={EMBED_RADIUS} />
  }

  /** There is nothing to type into an embed; the shape has no text of its own. */
  override canEdit(_shape: EmbedShape): boolean {
    return false
  }
}
