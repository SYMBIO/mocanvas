/**
 * Turning a url into a bookmark card.
 *
 * The card's title, description and preview image come from *unfurling* the
 * url, and unfurling means fetching somebody else's page — which a browser
 * cannot do cross-origin and mocanvas will not pretend to. So this function
 * performs no network request of its own: it asks the editor for a `url` asset,
 * which reaches whatever asset handler the app registered, and creates the card
 * from whatever comes back.
 *
 * An app with an unfurl endpoint of its own wires it up once:
 *
 * ```ts
 * editor.registerExternalAssetHandler("url", async ({ url }) => {
 *   const meta = await fetch(`/api/unfurl?url=${encodeURIComponent(url)}`).then((r) => r.json())
 *   return { id: AssetRecordType.createId(), typeName: "asset", type: "bookmark", props: { ...meta, src: url }, meta: {} }
 * })
 * ```
 *
 * With no handler registered the card still appears, showing the host and the
 * link — which is a better outcome than a paste that does nothing.
 */

import type { Asset, Editor, VecLike } from "@mocanvas/editor"
import type { BookmarkShape } from "../shapes/BookmarkShapeUtil"
import { createBookmarkShape } from "./urlContent"

/**
 * Either the shape that was created, or why it was not.
 *
 * A result rather than a throw because failing to unfurl a link is an ordinary
 * outcome — an offline machine, a page that blocks scrapers — and the caller
 * usually wants to show a toast, not unwind.
 *
 * SEMANTICS-ASSUMED: the documented return type is `Result<TLBookmarkShape,
 * string>` from tldraw's utils package, which is outside the six packages
 * mocanvas reimplements. This is the same two-case shape under a local name.
 */
export type CreateBookmarkResult = { ok: true; value: BookmarkShape } | { ok: false; error: string }

/**
 * Create a bookmark shape for `url`, centred on `center`.
 *
 * Fails — rather than creating an empty card — when the url is unparseable or
 * the editor has no bookmark shape registered, because in both cases there is
 * nothing meaningful to put on the canvas.
 */
export async function createBookmarkFromUrl(editor: Editor, { url, center }: { url: string; center?: VecLike }): Promise<CreateBookmarkResult> {
  const trimmed = url.trim()
  if (!trimmed) return { ok: false, error: "No url given." }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: `Cannot bookmark a "${parsed.protocol}" url.` }
    }
  } catch {
    return { ok: false, error: `Could not parse "${trimmed}" as a url.` }
  }

  if (!editor.hasShapeUtil("bookmark")) {
    return { ok: false, error: "This editor has no bookmark shape registered." }
  }

  let asset: Asset | undefined
  try {
    asset = await editor.getAssetForExternalContent({ type: "url", url: trimmed })
  } catch {
    // An unfurl that failed is not a bookmark that failed: the card is still
    // worth creating, it just shows the link rather than a preview.
    asset = undefined
  }

  const id = createBookmarkShape(editor, trimmed, asset, center)
  const shape = editor.getShape<BookmarkShape>(id)
  if (!shape) return { ok: false, error: "The bookmark shape could not be created." }
  return { ok: true, value: shape }
}
