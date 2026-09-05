/**
 * The asset utils for the three built-in asset types.
 *
 * An asset util is to a dropped file what a shape util is to a shape: it says
 * which MIME types it can take, turns one into an asset record, and names the
 * shape type that record should become. Registering one is how an app teaches
 * the editor about a new kind of attachment without touching the drop handler.
 *
 * The editor drives these structurally (see `TLAssetUtilLike`), so the three
 * below are ordinary classes rather than a framework: what makes them *the
 * defaults* is only that {@link defaultAssetUtils} lists them.
 */

import { AssetRecordType, type Asset, type BookmarkAsset, type BookmarkAssetProps, type Editor, type ImageAsset, type ImageAssetProps, type VideoAsset, type VideoAssetProps } from "@mocanvas/editor"
import { readFileAsDataUrl } from "../external/defaultExternalContentHandlers"
import { downsizeDimensions, readImageSize } from "./media"

/**
 * The largest file the drop and paste paths will turn into an asset, in bytes.
 *
 * A ceiling rather than a preference: an asset is inlined as a data URL until an
 * app supplies an asset store, and a 50 MB data URL in a document is a document
 * nothing can open. Apps that upload to their own storage raise it.
 */
export const DEFAULT_MAX_ASSET_SIZE = 10 * 1024 * 1024

/** Image types every browser that runs the canvas can decode. */
export const DEFAULT_SUPPORTED_IMAGE_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/svg+xml",
  "image/webp",
  "image/apng",
  "image/avif",
]

/** Video types every browser that runs the canvas can play. */
export const DEFAULT_SUPPORTED_VIDEO_TYPES: readonly string[] = ["video/mp4", "video/quicktime", "video/webm"]

/** Longest side, in page units, an inserted image is scaled down to. */
const DEFAULT_MAX_IMAGE_DIMENSION = 1000

/** What every asset util can be configured with; a subclass adds its own. */
export interface AssetUtilOptions {
  /** MIME types this util claims. Replacing the list is how an app narrows it. */
  supportedMimeTypes?: readonly string[]
}

/** Constructor form, matching what `<Mocanvas assetUtils={…}>` accepts. */
export interface AssetUtilClass {
  // A mixin base has to accept a rest parameter; the one argument an asset util
  // actually takes is the editor.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...args: any[]): { readonly type: string }
  readonly type: string
  options?: object
}

/**
 * The shared half of the three utils below.
 *
 * Deliberately not exported: the documented base class is `AssetUtil` in the
 * editor package, and exporting a second class under a different name here
 * would give apps two bases to choose between. When the editor's `AssetUtil`
 * lands, these three change their `extends` clause and nothing else — they
 * already have its documented members.
 */
abstract class BuiltInAssetUtil<A extends Asset> {
  static type: string
  /** Prop validators for this asset type. Read by the store when it builds the schema. */
  static props?: object
  /** How this asset type's props have changed over time. */
  static migrations?: object
  /** The defaults every instance starts its `options` from. */
  static options?: object

  /**
   * This util with `options` merged over its defaults, as a new class.
   *
   * Nothing is mutated, so two editors on one page can register differently
   * configured copies of the same asset type.
   */
  static configure<C extends AssetUtilClass>(this: C, options: object): C {
    const Base = this
    const merged = { ...((Base as { options?: object }).options ?? {}), ...options }
    const Configured = class extends Base {}
    Object.defineProperty(Configured, "options", { value: merged, writable: true, configurable: true, enumerable: true })
    Object.defineProperty(Configured, "name", { value: `${(Base as { name?: string }).name ?? "AssetUtil"}(configured)`, configurable: true })
    return Configured as unknown as C
  }

  readonly options: AssetUtilOptions

  constructor(readonly editor: Editor) {
    this.options = ((this.constructor as { options?: AssetUtilOptions }).options ?? {}) as AssetUtilOptions
  }

  get type(): A["type"] {
    return (this.constructor as unknown as { type: A["type"] }).type
  }

  /** The MIME types this util can build an asset from. */
  abstract getSupportedMimeTypes(): readonly string[]

  /** The props a freshly created asset of this type starts with. */
  abstract getDefaultProps(): A["props"]

  /** Build an asset record from a file, or `null` when it cannot. */
  abstract getAssetFromFile(file: File, assetId: Asset["id"]): Promise<A | null>

  /** Whether this util claims `mimeType`. Case-insensitive. */
  acceptsMimeType(mimeType: string): boolean {
    const wanted = mimeType.toLowerCase()
    return this.getSupportedMimeTypes().some((type) => type.toLowerCase() === wanted)
  }

  // ---- the editor's structural contract -------------------------------------

  /** Alias of {@link getSupportedMimeTypes}, under the name the editor's registry calls. */
  getMimeTypes(): readonly string[] {
    return this.getSupportedMimeTypes()
  }

  /** The shape type an asset of this type is dropped as. */
  abstract getShapeType(): string

  /** Build an asset for `file`, for the editor's registry. */
  async upload(file: File, _editor: Editor): Promise<Asset> {
    const asset = await this.getAssetFromFile(file, AssetRecordType.createId())
    if (!asset) throw new Error(`mocanvas: ${this.type} asset util could not read "${file.name}".`)
    return asset
  }

  /** The URL the canvas should paint this asset from. */
  resolve(asset: Asset): string | null {
    return (asset.props as { src?: string | null }).src ?? null
  }
}

/** Image files: raster and SVG, downsized to the configured maximum. */
export class ImageAssetUtil extends BuiltInAssetUtil<ImageAsset> {
  static override type = "image" as const
  static override options: AssetUtilOptions & { maxDimension?: number } = {
    supportedMimeTypes: DEFAULT_SUPPORTED_IMAGE_TYPES,
    maxDimension: DEFAULT_MAX_IMAGE_DIMENSION,
  }

  override getSupportedMimeTypes(): readonly string[] {
    return this.options.supportedMimeTypes ?? DEFAULT_SUPPORTED_IMAGE_TYPES
  }

  override getShapeType(): string {
    return "image"
  }

  override getDefaultProps(): ImageAssetProps {
    return { w: 0, h: 0, name: "", isAnimated: false, mimeType: null, src: null }
  }

  override async getAssetFromFile(file: File, assetId: Asset["id"]): Promise<ImageAsset | null> {
    if (!this.acceptsMimeType(file.type) && !/\.svg$/i.test(file.name)) return null
    const src = await readFileAsDataUrl(file)
    const mimeType = file.type || (/\.svg$/i.test(file.name) ? "image/svg+xml" : null)
    const size = downsizeDimensions(await readImageSize(src, file), (this.options as { maxDimension?: number }).maxDimension ?? DEFAULT_MAX_IMAGE_DIMENSION)
    return {
      id: assetId,
      typeName: "asset",
      type: "image",
      props: {
        ...size,
        name: file.name,
        // An animated format has to be painted as a live element rather than a
        // texture, so this flag decides how the shape renders, not just how it
        // is described.
        isAnimated: mimeType === "image/gif" || mimeType === "image/apng" || mimeType === "image/webp",
        mimeType,
        src,
        fileSize: file.size,
      },
      meta: {},
    }
  }
}

/** Video files. */
export class VideoAssetUtil extends BuiltInAssetUtil<VideoAsset> {
  static override type = "video" as const
  static override options: AssetUtilOptions = { supportedMimeTypes: DEFAULT_SUPPORTED_VIDEO_TYPES }

  override getSupportedMimeTypes(): readonly string[] {
    return this.options.supportedMimeTypes ?? DEFAULT_SUPPORTED_VIDEO_TYPES
  }

  override getShapeType(): string {
    return "video"
  }

  override getDefaultProps(): VideoAssetProps {
    return { w: 0, h: 0, name: "", isAnimated: true, mimeType: null, src: null }
  }

  override async getAssetFromFile(file: File, assetId: Asset["id"]): Promise<VideoAsset | null> {
    if (!this.acceptsMimeType(file.type)) return null
    const src = await readFileAsDataUrl(file)
    return {
      id: assetId,
      typeName: "asset",
      type: "video",
      // Dimensions are left at zero: reading them needs a `<video>` element to
      // reach `loadedmetadata`, and the video shape sizes itself from the
      // element once it has one. A wrong guess here would make the shape jump.
      props: { w: 0, h: 0, name: file.name, isAnimated: true, mimeType: file.type || null, src, fileSize: file.size },
      meta: {},
    }
  }
}

/**
 * Bookmarks: a link with a title, description and preview image.
 *
 * It claims no MIME types, because a bookmark never comes from a file — it
 * comes from a URL. The util exists so a bookmark asset has the same
 * default-props and shape-type answers as any other asset type, and so
 * `editor.getShapeUtilForAssetType("bookmark")` resolves.
 */
export class BookmarkAssetUtil extends BuiltInAssetUtil<BookmarkAsset> {
  static override type = "bookmark" as const

  override getSupportedMimeTypes(): readonly string[] {
    return this.options.supportedMimeTypes ?? []
  }

  override getShapeType(): string {
    return "bookmark"
  }

  override getDefaultProps(): BookmarkAssetProps {
    return { title: "", description: "", image: "", favicon: "", src: null }
  }

  override async getAssetFromFile(): Promise<BookmarkAsset | null> {
    return null
  }
}

/**
 * The built-in asset utils, in registration order.
 *
 * Order matters for MIME-type lookup — the first util that claims a type wins —
 * which is why images come before videos: the two lists are disjoint today, but
 * a container format claimed by both should read as an image.
 */
export const defaultAssetUtils = [ImageAssetUtil, VideoAssetUtil, BookmarkAssetUtil]
