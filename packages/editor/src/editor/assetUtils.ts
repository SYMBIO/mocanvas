/**
 * The editor's side of the asset-util contract.
 *
 * An *asset util* is to a file what a shape util is to a shape: it knows which
 * MIME types it can take, how to turn one into an asset record, how to turn an
 * asset record back into a URL the canvas can paint, and which shape type
 * should be created for it. Registering one is how an app teaches the editor
 * about a new kind of attachment — a PDF, a CAD file, a 3D model — without
 * touching the drop handler.
 *
 * Only the *shape* of that contract lives here, as a structural interface. The
 * base class an app extends belongs with the rest of the asset code; declaring
 * it structurally means the editor can drive any util that fits, including one
 * from a package this file has never heard of, and that neither side owns the
 * other's file.
 */
import type { Asset, AssetId } from "../records/asset"
import type { Editor } from "./Editor"

/** A preview shown while an upload is still in flight. */
export interface TLTemporaryAssetPreview {
  /** Object URL (or data URL) to paint until the real asset arrives. */
  url: string
  /** When it was created, for expiry against `temporaryAssetPreviewLifetimeMs`. */
  createdAt: number
}

/**
 * What the editor requires of an asset util.
 *
 * Everything but `type` is optional, so a util that only resolves URLs — the
 * common case for an app pointing at its own CDN — is three lines long.
 */
export interface TLAssetUtilLike {
  /** The `Asset["type"]` this util handles. */
  readonly type: string
  /** MIME types it can build an asset from. */
  getMimeTypes?(): readonly string[]
  /** The shape type to create when one of these assets is dropped. */
  getShapeType?(): string | undefined
  /** Turn a file into an asset record. */
  upload?(file: File, editor: Editor): Promise<Asset>
  /** Turn an asset record into a URL the canvas can paint. */
  resolve?(asset: Asset, editor: Editor): string | null | Promise<string | null>
}

/** Constructor form, as an app registers it. */
export interface TLAssetUtilConstructorLike {
  new (editor: Editor): TLAssetUtilLike
  readonly type: string
}

/**
 * The per-editor registry behind `editor.assetUtils` and the `getAssetUtil*`
 * family.
 *
 * Also holds temporary previews, because they are the same subject seen from
 * the other end: a preview exists exactly for the window between "a file was
 * dropped" and "its util finished uploading it".
 */
export class AssetUtilRegistry {
  private readonly utils = new Map<string, TLAssetUtilLike>()
  private readonly previews = new Map<AssetId, TLTemporaryAssetPreview>()

  constructor(
    private readonly editor: Editor,
    constructors: readonly TLAssetUtilConstructorLike[] = [],
  ) {
    for (const Util of constructors) this.utils.set(Util.type, new Util(editor))
  }

  /** Every registered util, keyed by asset type. */
  get all(): ReadonlyMap<string, TLAssetUtilLike> {
    return this.utils
  }

  /** The util for an asset type, or `undefined`. */
  get(type: string): TLAssetUtilLike | undefined {
    return this.utils.get(type)
  }

  /** Whether a type has a util. */
  has(type: string): boolean {
    return this.utils.has(type)
  }

  /**
   * The util that claims a MIME type, or `undefined`.
   *
   * First match in registration order, so an app registering its own util for
   * `image/png` after the built-in one does not shadow it — registration order
   * is under the app's control and shadowing should be explicit (replace the
   * util for that `type` instead).
   */
  getForMimeType(mimeType: string): TLAssetUtilLike | undefined {
    const wanted = mimeType.toLowerCase()
    for (const util of this.utils.values()) {
      if (util.getMimeTypes?.().some((type) => type.toLowerCase() === wanted)) return util
    }
    return undefined
  }

  /** The shape type an asset of this type should be turned into. */
  getShapeTypeFor(assetType: string): string | undefined {
    return this.utils.get(assetType)?.getShapeType?.()
  }

  /** Upload a file through the util that claims its type. */
  async upload(file: File): Promise<Asset | undefined> {
    const util = this.getForMimeType(file.type)
    if (!util?.upload) return undefined
    return await util.upload(file, this.editor)
  }

  /** Resolve an asset record to a paintable URL. */
  resolveUrl(asset: Asset): string | null | Promise<string | null> {
    const util = this.utils.get(asset.type)
    if (!util?.resolve) return (asset.props as { src?: string | null }).src ?? null
    return util.resolve(asset, this.editor)
  }

  /** Remember a preview to paint while an upload is in flight. */
  setPreview(assetId: AssetId, url: string): void {
    this.previews.set(assetId, { url, createdAt: Date.now() })
  }

  /**
   * The preview for an asset, if one is still current.
   *
   * Expired previews are dropped on read rather than on a timer: the object
   * URL behind one is cheap to hold and expensive to sweep, and nothing can
   * observe a stale preview without asking for it.
   */
  getPreview(assetId: AssetId): TLTemporaryAssetPreview | undefined {
    const preview = this.previews.get(assetId)
    if (!preview) return undefined
    if (Date.now() - preview.createdAt > this.editor.options.temporaryAssetPreviewLifetimeMs) {
      this.previews.delete(assetId)
      return undefined
    }
    return preview
  }

  /** Forget every preview. Called when the editor goes away. */
  clearPreviews(): void {
    this.previews.clear()
  }
}
