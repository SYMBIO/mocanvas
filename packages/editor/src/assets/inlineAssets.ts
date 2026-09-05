/**
 * The asset store you get when you have not configured one, and the file/data-URL
 * conversions that go with it.
 *
 * Inlining an asset as a data URL is the only storage that needs no
 * infrastructure at all: the bytes travel inside the document, so a board
 * saved to a file or synced to a peer carries its images with it. That is
 * exactly right for a prototype, a test, or an export, and exactly wrong for
 * anything real — a few photographs will produce a document too large to sync.
 */
import type { Asset, AssetId } from "../records/asset"
import type { AssetStore, AssetUploadResult } from "./AssetStore"

/**
 * Turn a data URL back into a `File`.
 *
 * The inverse of the store below, and what a paste handler needs: a data URL on
 * the clipboard has to become a `File` before it can go through the same upload
 * path as a dropped one, so that an app's real storage sees both kinds
 * identically.
 *
 * Throws on anything that is not a `data:` URL, because silently producing an
 * empty file would surface much later as a broken image.
 */
export async function dataUrlToFile(dataUrl: string, filename: string, mimeType?: string): Promise<File> {
  const match = /^data:([^;,]*)?(;base64)?,/.exec(dataUrl)
  if (!match) throw new Error(`Not a data URL: ${dataUrl.slice(0, 32)}…`)

  const declaredType = match[1] || "application/octet-stream"
  const type = mimeType ?? declaredType
  const payload = dataUrl.slice(match[0].length)

  if (match[2]) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new File([bytes], filename, { type })
  }
  // A non-base64 data URL is percent-encoded text — SVG markup, most often.
  return new File([decodeURIComponent(payload)], filename, { type })
}

/**
 * An {@link AssetStore} that keeps every uploaded file inside the document, as
 * a base64 data URL.
 *
 * The default when no store is configured. Nothing is uploaded anywhere and
 * nothing needs cleaning up, so `remove` is deliberately absent: deleting the
 * asset record deletes the bytes with it.
 */
export const inlineBase64AssetStore: AssetStore = {
  async upload(_asset: Asset, file: File): Promise<AssetUploadResult> {
    return { src: await fileToBase64DataUrl(file) }
  },
  // No `resolve`: the src *is* the data, so the default fallback to
  // `props.src` is already the right answer and an override would only add a
  // promise to every paint.
}

/** Read a file as a base64 `data:` URL. */
export async function fileToBase64DataUrl(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ""
  // Chunked rather than one spread: `String.fromCharCode(...bytes)` overflows
  // the argument limit somewhere around a megabyte, which is a small image.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return `data:${file.type || "application/octet-stream"};base64,${btoa(binary)}`
}

/**
 * The base URL that default asset URLs (icons, fonts, translations) are built
 * from.
 *
 * mocanvas ships no hosted CDN and deliberately points at nothing: the
 * *mechanism* — an app supplying its own URLs through `AssetUrlsProvider` — is
 * the part worth having, and a built-in default pointing at somebody else's
 * infrastructure is a dependency nobody asked for. The empty string makes every
 * derived URL document-relative, so an app that serves the assets alongside its
 * own bundle needs no configuration at all.
 *
 * Set it once at startup with {@link setDefaultCdnBaseUrl} if your assets live
 * somewhere else.
 */
export function getDefaultCdnBaseUrl(): string {
  return cdnBaseUrl
}

let cdnBaseUrl = ""

/** Point {@link getDefaultCdnBaseUrl} somewhere. A trailing slash is trimmed. */
export function setDefaultCdnBaseUrl(url: string): void {
  cdnBaseUrl = url.replace(/\/+$/, "")
}

/** Forget every asset id in `ids`. Exported for stores that batch their deletes. */
export type AssetIdList = readonly AssetId[]
