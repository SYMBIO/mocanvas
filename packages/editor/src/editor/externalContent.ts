/**
 * The documented shapes of what arrives on the canvas from outside it — a
 * paste, a drop, a file picker — and of what the editor puts on the clipboard.
 *
 * `records/asset.ts` holds the union the editor's handler registry is keyed on
 * (`ExternalContent`). This module names each variant of it, adds the variants
 * that only reach the editor through a specific entry point (replacing one
 * shape's file, restoring a copied selection), and describes the *sources* a
 * paste can be reconstructed from.
 *
 * The split between "content" and "source" matters. A single paste carries the
 * same selection several times over — as HTML, as plain text, as this library's
 * own JSON — and which one to believe is a decision, not a lookup. A handler
 * receives all of them and picks.
 */
import type { SerializedSchema } from "@mocanvas/store"
import type { Asset } from "../records/asset"
import type { UnknownBinding } from "../records/binding"
import type { ShapeId, UnknownShape } from "../records/base"
import type { VecModel } from "./events"

/**
 * A copied selection, whole enough to be pasted into a different document.
 *
 * `schema` travels with it because a selection copied from an older build has
 * to be migrated before it can be inserted — without it, pasting between two
 * versions of an app silently produces shapes with missing props.
 */
export interface TLContent {
  /** The shapes, in reading order, including descendants of the selection. */
  shapes: UnknownShape[]
  /** Bindings whose two ends are both inside `shapes`. */
  bindings?: UnknownBinding[] | undefined
  /** Which of `shapes` were top level in the selection, for re-parenting on paste. */
  rootShapeIds?: ShapeId[] | undefined
  /** Assets the shapes reference, so an image survives a paste into an empty document. */
  assets?: Asset[] | undefined
  /** The schema the shapes were serialized against. */
  schema?: SerializedSchema | undefined
}

/**
 * What every kind of external content carries.
 *
 * `point` is in page space and defaults to the centre of the viewport (or the
 * pointer, when the person has the paste-at-cursor preference on).
 */
export interface TLBaseExternalContent {
  /** Where the content should land, in page space. */
  point?: VecModel | undefined
  /**
   * The other readings of the same paste, for a handler that would rather use
   * one of them. Present for a clipboard paste; absent for a drop.
   */
  sources?: TLExternalContentSource[] | undefined
}

/** Plain or rich text, pasted or dropped. */
export interface TLTextExternalContent extends TLBaseExternalContent {
  type: "text"
  text: string
  /** The HTML form, when the source had one. */
  html?: string | undefined
}

/** One or more files, from a drop, a paste or a file picker. */
export interface TLFilesExternalContent extends TLBaseExternalContent {
  type: "files"
  files: File[]
  /**
   * Create the shapes on the current page rather than inside whatever frame
   * the drop landed on.
   */
  ignoreParent?: boolean | undefined
}

/**
 * A file dropped onto an existing shape, to replace what that shape shows.
 *
 * Distinct from {@link TLFilesExternalContent} because the answer is different:
 * this must not create a shape, and it must keep the target's position, size
 * and bindings.
 */
export interface TLFileReplaceExternalContent extends TLBaseExternalContent {
  type: "file-replace"
  file: File
  /** The shape whose asset is being replaced. */
  shapeId: ShapeId
}

/** A URL, before anything has decided whether it becomes a bookmark or an embed. */
export interface TLUrlExternalContent extends TLBaseExternalContent {
  type: "url"
  url: string
}

/**
 * A URL the caller has already decided to embed.
 *
 * Skips the bookmark/embed negotiation that {@link TLUrlExternalContent}
 * triggers — which is the whole difference between the two.
 */
export interface TLEmbedExternalContent extends TLBaseExternalContent {
  type: "embed"
  url: string
  /** The definition the URL was matched against, when the caller already has it. */
  embed?: unknown
}

/** SVG markup, as text. Pasting an SVG gives shapes, not an image asset. */
export interface TLSvgTextExternalContent extends TLBaseExternalContent {
  type: "svg-text"
  text: string
}

/** A selection copied out of another canvas, in this library's own format. */
export interface TLTldrawExternalContent extends TLBaseExternalContent {
  type: "tldraw"
  content: TLContent
}

/**
 * A drawing exported from Excalidraw.
 *
 * Only the *data shape* is declared here. Reading it — mapping Excalidraw's
 * element model onto canvas shapes — is deliberately not implemented: it is an
 * import path for another vendor's format, and it is listed as out of scope.
 * The type exists so a host that wants that import can register a handler for
 * it against the same registry as everything else, and so
 * {@link TLExternalContentSource} can name the case where a paste turns out to
 * be an Excalidraw clipboard.
 */
export interface TLExcalidrawExternalContent extends TLBaseExternalContent {
  type: "excalidraw"
  content: unknown
}

/** A URL something should be made *from*, rather than content to place. */
export interface TLUrlExternalAsset {
  type: "url"
  url: string
}

/** A file something should be made from. */
export interface TLFileExternalAsset {
  type: "file"
  file: File
}

/**
 * What an asset can be produced from.
 *
 * Distinct from external *content*: content ends up as shapes on the page,
 * an external asset ends up as an `asset` record that a shape then points at.
 */
export type TLExternalAsset = TLUrlExternalAsset | TLFileExternalAsset

/** Plain or rich text found on the clipboard. */
export interface TLTextExternalContentSource {
  type: "text"
  /** The MIME type this reading came from, e.g. `text/plain`, `text/html`. */
  subtype: "html" | "plain" | "url"
  data: string
}

/** This library's own format, found on the clipboard and already parsed. */
export interface TLTldrawExternalContentSource {
  type: "tldraw"
  data: TLContent
}

/** An Excalidraw clipboard payload, recognised but not interpreted. See {@link TLExcalidrawExternalContent}. */
export interface TLExcalidrawExternalContentSource {
  type: "excalidraw"
  data: unknown
}

/**
 * A reading that failed.
 *
 * Kept in the list rather than dropped so a handler can tell "there was no
 * HTML on the clipboard" from "the HTML was there and would not parse" — the
 * second is worth telling the person about, the first is not.
 */
export interface TLErrorExternalContentSource {
  type: "error"
  /** What the reading would have been. */
  subtype?: string | undefined
  /** Why it failed. */
  reason: string
}

/**
 * One reading of a paste. A single paste usually produces several.
 *
 * Ordered most-specific first by whoever assembles the list, so a handler that
 * just wants the best available answer can take the first entry it understands.
 */
export type TLExternalContentSource =
  | TLTextExternalContentSource
  | TLTldrawExternalContentSource
  | TLExcalidrawExternalContentSource
  | TLErrorExternalContentSource
