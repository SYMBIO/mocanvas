import type { Asset, AssetId } from "../records/asset"
import type { JsonObject } from "../records/base"

/**
 * How an asset is about to be used, so a store can serve a resolution- or
 * bandwidth-appropriate variant instead of always handing back the original.
 *
 * Every field has a sensible value in {@link DEFAULT_ASSET_CONTEXT}, so a store
 * that only ever returns one URL can ignore the whole object.
 */
export interface AssetContext {
  /** How large one page unit is on screen right now: camera zoom times device pixel ratio. */
  screenScale: number
  /** `screenScale` snapped to a power of two, so a drag-resize does not re-request every frame. */
  steppedScreenScale: number
  /** `devicePixelRatio` of the surface the asset will be painted on. */
  dpr: number
  /** `navigator.connection.effectiveType` when the browser reports it, otherwise `null`. */
  networkEffectiveType: string | null
  /** True for copy, paste and export, where a downscaled variant would lose data. */
  shouldResolveToOriginal: boolean
}

/** The context used when nobody supplied one: original quality, no network hints. */
export const DEFAULT_ASSET_CONTEXT: AssetContext = {
  screenScale: 1,
  steppedScreenScale: 1,
  dpr: 1,
  networkEffectiveType: null,
  shouldResolveToOriginal: false,
}

/** Build an {@link AssetContext}, filling anything unspecified from {@link DEFAULT_ASSET_CONTEXT}. */
export function getDefaultAssetContext(overrides: Partial<AssetContext> = {}): AssetContext {
  return { ...DEFAULT_ASSET_CONTEXT, ...overrides }
}

/** What {@link AssetStore.upload} resolves to: where the bytes ended up, plus anything to remember. */
export interface AssetUploadResult {
  /** The URL to write into the asset record. Should be stable: it is synced to every peer. */
  src: string
  /** Extra data to merge into the asset's `meta`. */
  meta?: JsonObject
}

/**
 * The seam between the editor and wherever asset bytes actually live.
 *
 * An app implements this to put dropped and pasted files somewhere durable —
 * object storage, a CDN, its own upload endpoint — and to turn a stored asset
 * back into a URL the canvas can paint. The editor never assumes anything about
 * the transport; it only ever calls these three methods.
 *
 * Only {@link upload} is required. Without {@link resolve} the editor falls back
 * to the asset's own `props.src` (see {@link resolveAssetUrl}); without
 * {@link remove}, deleting an asset record leaves the bytes in place.
 */
export interface AssetStore {
  /**
   * Store the bytes for a freshly created asset and say where they landed.
   *
   * Called once per file, before the asset record is written, so the returned
   * `src` is what every collaborator will see. Throw to reject the file (wrong
   * type, too large, quota exhausted) — the editor will not create the shape.
   */
  upload(asset: Asset, file: File, abortSignal?: AbortSignal): Promise<AssetUploadResult>
  /**
   * Turn a stored asset into a URL to load right now, or `null` when it cannot
   * be shown. May return a different URL per {@link AssetContext} — a thumbnail
   * at low zoom, the original when `shouldResolveToOriginal` is set.
   */
  resolve?(asset: Asset, context: AssetContext): Promise<string | null> | string | null
  /** Forget the bytes behind these assets. Best-effort: the records are gone either way. */
  remove?(assetIds: AssetId[]): Promise<void>
}

/**
 * Resolve an asset through `store`, falling back to the asset's own `props.src`
 * when the store has no `resolve` (or when there is no store at all).
 */
export async function resolveAssetUrl(
  store: AssetStore | undefined,
  asset: Asset,
  context: AssetContext = DEFAULT_ASSET_CONTEXT,
): Promise<string | null> {
  if (store?.resolve) return await store.resolve(asset, context)
  return getAssetSrc(asset)
}

/** The `src` an asset carries in its own props, or `null` when it has none yet. */
export function getAssetSrc(asset: Asset): string | null {
  const src = (asset.props as { src?: string | null }).src
  return src ?? null
}

/** Base64-encode bytes without assuming Node's `Buffer` exists. */
function toBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

/** Read a file into a `data:` URL. Used by the in-memory store and by tests. */
export async function fileToDataUrl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return `data:${file.type || "application/octet-stream"};base64,${toBase64(bytes)}`
}

/**
 * The store used when an app supplies none: files become `data:` URLs held in
 * memory for the life of the page.
 *
 * Good enough for demos and tests, wrong for anything synced — a data URL is
 * carried inside the document, so a few images will bloat every snapshot sent
 * over the wire. Real apps implement {@link AssetStore} against their own storage.
 */
export function createInMemoryAssetStore(): AssetStore & { readonly size: number } {
  const bySrc = new Map<AssetId, string>()
  return {
    get size() {
      return bySrc.size
    },
    async upload(asset: Asset, file: File): Promise<AssetUploadResult> {
      const src = await fileToDataUrl(file)
      bySrc.set(asset.id, src)
      return { src }
    },
    resolve(asset: Asset): string | null {
      return bySrc.get(asset.id) ?? getAssetSrc(asset)
    },
    async remove(assetIds: AssetId[]): Promise<void> {
      for (const id of assetIds) bySrc.delete(id)
    },
  }
}
