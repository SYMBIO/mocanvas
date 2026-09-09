import {
  BaseBoxShapeUtil,
  Rectangle2d,
  getDefaultDisplayValues,
  type BaseShape,
  type Geometry2d,
  type ShapeUtilOptions,
  type StyleWords,
  type TLColorMode,
  type TLDefaultDisplayValues,
  type TLStyledShape,
  type TLTheme,
} from "@mocanvas/editor"
import { embedShapeProps } from "./shape-props"
import { embedShapeMigrations } from "./shape-migrations"
import type { CSSProperties, ReactNode } from "react"
import { propsOf, readNumber, readString } from "./prop-access"
import { rectPath } from "./indicator-paths"

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
 * Settings for one embeddable service, as the app supplies them: an api key, a
 * player option, a locale. Opaque to mocanvas — only the definition that
 * declared the service looks inside.
 */
export type EmbedSettings = Readonly<Record<string, unknown>>

/**
 * Per-service settings, keyed by {@link EmbedDefinition.type}.
 *
 * ```ts
 * EmbedShapeUtil.configure({ embedConfig: { maps: { apiKey: MAPS_KEY } } })
 * ```
 *
 * This is the *only* route a secret takes into an embed url. See
 * {@link EmbedDefinition.toEmbedUrl}.
 */
export type EmbedConfig = Readonly<Record<string, EmbedSettings>>

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
  /**
   * `settings` is this service's entry in the editor's {@link EmbedConfig} —
   * an api key, a player flag, a locale. It is passed in rather than read from
   * the environment on purpose: a definition that reached for `process.env`
   * would only work in one bundler, would leak a secret into every client
   * bundle that imported it, and could not differ between two editors on one
   * page. It is `undefined` when the app configured nothing.
   */
  toEmbedUrl(url: URL, settings?: EmbedSettings): string | null
  /**
   * The width ÷ height this service's content actually is, when it has a fixed
   * one — `16 / 9` for a video player. Optional, and unset on every built-in:
   * a service whose pages vary has no such number, and guessing one would
   * resize somebody's embed for no reason.
   *
   * Where it is set, {@link EmbedShapeUtil.resolveAspectRatio} reports it, a
   * new shape is created at it, and resizing preserves it.
   */
  sizeToContentAspectRatio?: number
  /**
   * The inverse: given an already-embeddable url, the *page* url a person
   * would share. Optional — implement it only where the two forms differ
   * enough that `toEmbedUrl` cannot simply be handed its own output.
   *
   * {@link getEmbedInfo} uses it as its second pass, so that pasting an embed
   * url stores the shareable url on the shape rather than the embed one.
   * Return `null` when the url is not one of this service's embed urls.
   */
  fromEmbedUrl?(url: URL): string | null
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
    // An embed url is not a page url: wrapping one would nest it inside a
    // second viewer. `fromEmbedUrl` below is the branch that handles it.
    if (url.pathname === "/embed") return null
    // Figma's viewer takes the file url as a parameter rather than a path.
    const target = `https://www.figma.com${url.pathname}${url.search}`
    return `https://www.figma.com/embed?embed_host=mocanvas&url=${encodeURIComponent(target)}`
  },
  // The one built-in whose embed form is not also a valid input to its own
  // `toEmbedUrl`: wrapping an already-wrapped url would nest it twice.
  fromEmbedUrl(url) {
    if (url.pathname !== "/embed") return null
    const target = url.searchParams.get("url")
    if (!target) return null
    try {
      const parsed = new URL(target)
      return parsed.protocol === "https:" && normalizeHost(parsed.hostname) === "figma.com" ? parsed.href : null
    } catch {
      return null
    }
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

/** One identity for "no embed settings configured", so a default argument is stable. */
const EMPTY_EMBED_CONFIG: EmbedConfig = Object.freeze({})

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
export function getEmbedDefinition(
  url: string,
  definitions: readonly EmbedDefinition[] = embedDefinitions,
  config: EmbedConfig = EMPTY_EMBED_CONFIG,
): EmbedMatch | null {
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
    const embedUrl = definition.toEmbedUrl(parsed, config[definition.type])
    // A permitted host with an unembeddable page falls through to the placeholder.
    if (embedUrl && embedUrl.startsWith("https://")) return { definition, embedUrl }
    return null
  }
  return null
}

/** What {@link getEmbedInfo} resolved a url to. */
export interface EmbedInfo {
  /** The definition that recognised it. */
  definition: EmbedDefinition
  /**
   * The *page* url — what a person would share, and what belongs in
   * `shape.props.url`. For an input that was already a page url this is the
   * input verbatim; for an input that was an embed url it is the recovered
   * page url.
   */
  url: string
  /** The url to actually put in the iframe. */
  embedUrl: string
}

/**
 * Resolve a url against a permit list, in both directions.
 *
 * Two passes, in this order: `toEmbedUrl` (the url is a page url), then
 * `fromEmbedUrl` (the url is already an embed url and the page url has to be
 * recovered). That is what makes a shared link and an already-embeddable link
 * both work from one entry point.
 *
 * Every url-parsing throw is swallowed: garbage input comes back as `undefined`
 * rather than as an exception inside somebody's onChange handler.
 *
 * Unlike {@link getEmbedDefinition} the permit list is the first argument and
 * is required, because the caller is usually a picker deciding what it will
 * accept rather than the shape util deciding what it will render.
 */
export function getEmbedInfo(
  definitions: readonly EmbedDefinition[],
  url: string,
  config: EmbedConfig = EMPTY_EMBED_CONFIG,
): EmbedInfo | undefined {
  const match = getEmbedDefinition(url, definitions, config)
  if (match !== null) return { definition: match.definition, url, embedUrl: match.embedUrl }

  if (typeof url !== "string" || url.length === 0) return undefined
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined
  const host = normalizeHost(parsed.hostname)
  for (const definition of definitions) {
    if (definition.fromEmbedUrl === undefined) continue
    if (!definition.hostnames.some((h) => normalizeHost(h) === host)) continue
    let pageUrl: string | null
    try {
      pageUrl = definition.fromEmbedUrl(parsed)
    } catch {
      pageUrl = null
    }
    if (!pageUrl) continue
    // The embed url is the input itself: it is already the form the iframe wants.
    return { definition, url: pageUrl, embedUrl: parsed.href }
  }
  return undefined
}

function readEmbedBox(shape: { props?: unknown }): { w: number; h: number } {
  const p = propsOf(shape)
  return { w: readNumber(p, "w", EMBED_WIDTH), h: readNumber(p, "h", EMBED_HEIGHT) }
}

/**
 * `EmbedShapeUtil`'s settings.
 *
 * ```ts
 * const utils = [
 *   EmbedShapeUtil.configure({
 *     embedDefinitions: [...DEFAULT_EMBED_DEFINITIONS, intranet],
 *     embedConfig: { intranet: { apiKey: process.env.INTRANET_KEY } },
 *   }),
 * ]
 * ```
 */
/**
 * What an embed shape paints with.
 *
 * An embed is an iframe: the page inside it paints itself, and the only thing
 * this shape draws is the placeholder card shown before — or instead of — that
 * page. So those are the values it adds to the shared set.
 */
export interface EmbedShapeUtilDisplayValues extends TLDefaultDisplayValues {
  /** Fill of the placeholder card. */
  placeholderFill: string
  /** Border of the placeholder card. */
  placeholderStroke: string
  /** Ink of the text on the placeholder card. */
  placeholderTextColor: string
  /** Corner radius of the card and of the iframe, in page units. */
  cornerRadius: number
}

/** Resolve an embed's display values; see {@link EmbedShapeUtilDisplayValues}. */
export function getEmbedDisplayValues(
  editor: unknown,
  shape: { props?: unknown },
  theme: TLTheme,
  colorMode: TLColorMode,
): EmbedShapeUtilDisplayValues {
  return {
    ...getDefaultDisplayValues(editor, shape as TLStyledShape, theme, colorMode),
    placeholderFill: EMBED_PLACEHOLDER_FILL,
    placeholderStroke: EMBED_PLACEHOLDER_STROKE,
    placeholderTextColor: EMBED_PLACEHOLDER_TEXT,
    cornerRadius: EMBED_RADIUS,
  }
}

/* ---- iframe permissions --------------------------------------------------- */

/**
 * The powerful features an embedded page may be granted, as the iframe `allow`
 * attribute names them.
 *
 * Deliberately a *permit* vocabulary and not a copy of the browser's whole
 * feature-policy list: everything absent from here can never be granted by a
 * definition, which is what keeps "add an embed provider" from turning into
 * "hand a third-party page the microphone by accident".
 */
export const EMBED_SHAPE_PERMISSION_NAMES = [
  "accelerometer",
  "autoplay",
  "camera",
  "clipboard-write",
  "encrypted-media",
  "fullscreen",
  "geolocation",
  "gyroscope",
  "microphone",
  "picture-in-picture",
] as const

/** One of {@link EMBED_SHAPE_PERMISSION_NAMES}. */
export type EmbedShapePermissionName = (typeof EMBED_SHAPE_PERMISSION_NAMES)[number]

/**
 * Which features an embedded page is granted: present and `true` grants,
 * absent or `false` withholds.
 *
 * A partial map rather than a total one so that a definition states only what
 * it needs; anything it does not mention stays off.
 */
export type TLEmbedShapePermissions = { readonly [K in EmbedShapePermissionName]?: boolean }

/**
 * The permissions applied to an embed whose url matched no definition.
 *
 * Empty, and that is the whole point: an unrecognised page gets nothing. The
 * value exists as a named constant rather than as an inline `{}` so that an app
 * that deliberately wants a more permissive fallback has something to override,
 * and so the default is visible rather than implied.
 */
export const unknownEmbedShapePermissionOverrides: TLEmbedShapePermissions = {}

/** The `allow` attribute for `permissions`, or `undefined` when nothing is granted. */
export function embedShapePermissionsToAllow(permissions: TLEmbedShapePermissions): string | undefined {
  const granted = EMBED_SHAPE_PERMISSION_NAMES.filter((name) => permissions[name] === true)
  return granted.length === 0 ? undefined : granted.join("; ")
}

export interface EmbedShapeOptions extends ShapeUtilOptions<EmbedShape, EmbedShapeUtilDisplayValues> {
  /**
   * The permit list this util embeds from. Defaults to the mutable module-level
   * {@link embedDefinitions}; naming one here is how two editors on a page get
   * different permit lists, and how an app avoids mutating a global.
   */
  embedDefinitions?: readonly EmbedDefinition[]
  /**
   * Per-service settings, keyed by {@link EmbedDefinition.type} — see
   * {@link EmbedConfig}. Read back as {@link EmbedShapeUtil.embedConfig}.
   */
  embedConfig?: EmbedConfig
}

export class EmbedShapeUtil extends BaseBoxShapeUtil<EmbedShape> {
  static override type = "embed" as const
  static override props = embedShapeProps
  static override migrations = embedShapeMigrations
  static override options: EmbedShapeOptions = { getDefaultDisplayValues: getEmbedDisplayValues }
  declare readonly options: EmbedShapeOptions

  getDefaultProps(): EmbedShapeProps {
    return { w: EMBED_WIDTH, h: EMBED_HEIGHT, url: "" }
  }

  /**
   * The per-service settings this util was configured with, keyed by
   * {@link EmbedDefinition.type}.
   *
   * Always an object, so a definition can index it without a guard. This is
   * where an api key belongs: a definition is handed its own entry and never
   * reaches for `process.env` itself, which would put the secret in every
   * bundle that imported the definition and make it the same for every editor
   * on the page.
   */
  get embedConfig(): EmbedConfig {
    return this.options.embedConfig ?? EMPTY_EMBED_CONFIG
  }

  /** The permit list in force for this util; see {@link EmbedShapeOptions.embedDefinitions}. */
  getEmbedDefinitions(): readonly EmbedDefinition[] {
    return this.options.embedDefinitions ?? embedDefinitions
  }

  /** This shape's permit-list entry and iframe url, or `null` when it has none. */
  getEmbedMatch(shape: EmbedShape): EmbedMatch | null {
    return getEmbedDefinition(readString(propsOf(shape), "url", ""), this.getEmbedDefinitions(), this.embedConfig)
  }

  /**
   * The width ÷ height this embed's content wants, or `undefined` when nothing
   * has an opinion about it.
   *
   * Public because the app needs the same answer the util uses: a "fit to
   * content" command, a paste handler placing a new embed, a layout engine
   * reserving a slot. It comes from the matching definition's
   * {@link EmbedDefinition.sizeToContentAspectRatio}; a url off the permit
   * list, or a service with no fixed shape, answers `undefined`.
   */
  resolveAspectRatio(shape: EmbedShape): number | undefined {
    const ratio = this.getEmbedMatch(shape)?.definition.sizeToContentAspectRatio
    return typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0 ? ratio : undefined
  }

  override getGeometry(shape: EmbedShape): Geometry2d {
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
    const match = this.getEmbedMatch(shape)
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
          // The origin, and nothing more. `no-referrer` is the stricter setting and
          // was the obvious one to reach for, but a player that has to check which
          // domain is embedding it cannot: YouTube answers a refererless embed with
          // "error 153" and refuses to play. This sends the scheme and host — what
          // the check needs — and never the path or query of the page the canvas is
          // on, and sends nothing at all when a secure page is embedded by an
          // insecure one.
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
          allowFullScreen
          style={{ display: "block", width: "100%", height: "100%", border: 0, pointerEvents: isEditing ? "auto" : "none" }}
        />
      </div>
    )
  }

  override getIndicatorPath(shape: EmbedShape): Path2D {
    const { w, h } = readEmbedBox(shape)
    return rectPath(w, h, EMBED_RADIUS)
  }

  /**
   * "Editing" an embed is not typing into it — the shape has no text of its own.
   * It is the state in which the embedded page takes the pointer, and it is the
   * state the iframe above waits for.
   *
   * Saying no here left that state unreachable, so the frame stayed inert for
   * good and the embed was a picture of a page rather than a page: a video that
   * would not play, a map that would not pan. Saying yes gives an embed the same
   * two-step every canvas uses for something that wants the pointer for itself —
   * one click selects the shape and its handles, a double click hands the
   * pointer over, and clicking away takes it back.
   */
  override canEdit(_shape: EmbedShape): boolean {
    return true
  }

  /**
   * An embed whose service declared a fixed content shape resizes
   * proportionally; anything else is a free box.
   */
  // SEMANTICS-ASSUMED: tying the lock to `sizeToContentAspectRatio` is the
  // reading that makes the two features one feature — the ratio is declared
  // once and both sizing paths honour it — and it is a no-op for every
  // built-in, none of which declares one.
  override isAspectRatioLocked(shape: EmbedShape): boolean {
    return this.resolveAspectRatio(shape) !== undefined
  }

  /**
   * A new embed is created at its service's content ratio, keeping the width
   * it was asked for. Nothing happens for a service with no declared ratio.
   */
  override onBeforeCreate(next: EmbedShape): EmbedShape | void {
    const ratio = this.resolveAspectRatio(next)
    if (ratio === undefined) return
    const { w } = readEmbedBox(next)
    const h = Math.max(1, w / ratio)
    if (h === readEmbedBox(next).h) return
    return { ...next, props: { ...next.props, h } }
  }
}
