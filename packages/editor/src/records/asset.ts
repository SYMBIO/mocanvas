import type { RecordId } from "@mocanvas/store"
import { createRecordType } from "@mocanvas/store"
import type { JsonObject } from "./base"

/** Pixel dimensions and source of an image file. `src` is a URL or data URL; `null` while uploading. */
export interface ImageAssetProps {
  w: number
  h: number
  name: string
  isAnimated: boolean
  mimeType: string | null
  src: string | null
  fileSize?: number
}

export type VideoAssetProps = ImageAssetProps

export interface BookmarkAssetProps {
  title: string
  description: string
  image: string
  favicon: string
  src: string | null
}

/** A document-scoped record describing external media referenced by shapes (images, videos, bookmarks). */
export interface BaseAsset<Type extends string, Props extends object> {
  readonly id: AssetId
  readonly typeName: "asset"
  type: Type
  props: Props
  meta: JsonObject
}

export type ImageAsset = BaseAsset<"image", ImageAssetProps>
export type VideoAsset = BaseAsset<"video", VideoAssetProps>
export type BookmarkAsset = BaseAsset<"bookmark", BookmarkAssetProps>
export type Asset = ImageAsset | VideoAsset | BookmarkAsset
export type AssetType = Asset["type"]
export type AssetId = RecordId<Asset>

/**
 * Per-type validation lives in `../assets/assetValidators` — `imageAssetValidator`,
 * `videoAssetValidator` and `bookmarkAssetValidator`, plus the `assetValidator`
 * union over the three. It is deliberately not attached here yet: turning it on
 * would start rejecting asset records inside `parseTldrFile`, and documents
 * written by older editors have not been checked against it.
 */
export const AssetRecordType = createRecordType<Asset>("asset", { scope: "document" }).withDefaultProperties(() => ({
  meta: {},
}))

export function createAssetId(id?: string): AssetId {
  return AssetRecordType.createId(id) as AssetId
}
export function isAssetId(id: unknown): id is AssetId {
  return typeof id === "string" && id.startsWith("asset:")
}
export function isAsset(record: unknown): record is Asset {
  return typeof record === "object" && record !== null && (record as { typeName?: string }).typeName === "asset"
}

/** An asset to create: `id` and `meta` are optional, `props` must be complete. */
export type AssetCreate<A extends Asset = Asset> = {
  id?: AssetId
  type: A["type"]
  props: A["props"]
  meta?: Partial<A["meta"]>
}

export type AssetPartial<A extends Asset = Asset> = {
  id: AssetId
  type: A["type"]
  props?: Partial<A["props"]>
  meta?: Partial<A["meta"]>
}

// ---- external content ------------------------------------------------------

/** Content dropped or pasted onto the canvas. `point` is in page space; defaults to the viewport center. */
export type ExternalContent =
  | { type: "files"; files: File[]; point?: VecLikeJson }
  | { type: "text"; text: string; point?: VecLikeJson }
  | { type: "url"; url: string; point?: VecLikeJson }
  | { type: "svg-text"; text: string; point?: VecLikeJson }
  /**
   * A url an app has already decided to embed, rather than one to be sniffed.
   * `url` skips the bookmark/embed negotiation `type: "url"` performs.
   */
  | {
      type: "embed"
      url: string
      point?: VecLikeJson
      /** The definition the url was matched against, when the caller already has it. */
      embed?: unknown
    }
export type ExternalContentType = ExternalContent["type"]

/** Something an asset can be produced from. */
export type ExternalAssetContent = { type: "file"; file: File } | { type: "url"; url: string }
export type ExternalAssetType = ExternalAssetContent["type"]

export type ExternalContentHandler<T extends ExternalContentType = ExternalContentType> = (
  info: Extract<ExternalContent, { type: T }>,
) => void | Promise<void>

export type ExternalAssetHandler<T extends ExternalAssetType = ExternalAssetType> = (
  info: Extract<ExternalAssetContent, { type: T }>,
) => Asset | undefined | Promise<Asset | undefined>

/** Plain `{ x, y }`; kept structural so records stay JSON-serializable. */
interface VecLikeJson {
  x: number
  y: number
}
