import { createShapeId, type Asset, type Editor, type ShapeId, type VecLike } from "@mocanvas/editor"
import { EMBED_HEIGHT, EMBED_WIDTH, getEmbedDefinition, type EmbedShape } from "../shapes/EmbedShapeUtil"
import { BOOKMARK_HEIGHT, BOOKMARK_WIDTH, type BookmarkShape } from "../shapes/BookmarkShapeUtil"
import { createTextShapeAt } from "./defaultExternalContentHandlers"

/**
 * What a pasted or dropped URL turns into.
 *
 * The rule has two halves, and they fail differently on purpose: a url on the
 * embed permit list becomes a live `embed`; anything else becomes a
 * `bookmark` — a link card, unfurled through whatever `url` asset handler the
 * app registered. Refusing to embed an arbitrary page is a security position,
 * not a limitation: it is what keeps a pasted link from putting a third-party
 * iframe on the board.
 */

/** A toast surface, as much of one as this module needs. */
export interface ExternalUrlToasts {
  addToast(toast: { id?: string; title?: string; description?: string; severity?: string }): void
}

/** Options for {@link defaultHandleExternalUrlContent}. */
export interface ExternalUrlContentOptions {
  /** Where to report an unfurl that failed. Optional; without one the failure is silent. */
  toasts?: ExternalUrlToasts
  /** Resolve a UI string id for the toast. Defaults to the identity. */
  msg?: (id: string) => string
}

/** The toast id used when a link could not be unfurled. Stable, so it can be asserted on. */
export const BOOKMARK_UNFURL_FAILED = "bookmark.unfurl-failed"

function pointOrCenter(editor: Editor, point: VecLike | undefined): VecLike {
  return point ?? editor.getViewportPageCenter()
}

/**
 * Handle a url that arrived from outside the editor.
 *
 * Resolves once the shape exists. It does not reject on an unfurl failure: a
 * link card that says where it points is a better outcome than nothing, so a
 * failed unfurl still creates the bookmark (with no asset) and reports through
 * `opts.toasts`.
 *
 * SEMANTICS-ASSUMED: the third argument. The consumer casts it at every call
 * site (`as unknown as Parameters<typeof …>[2]`), so nothing pins its members;
 * `toasts` and `msg` are the two the consumer's own casts name, and both are
 * optional so the function is usable with no options at all.
 */
export async function defaultHandleExternalUrlContent(
  editor: Editor,
  info: { url: string; point?: VecLike },
  opts: ExternalUrlContentOptions = {},
): Promise<void> {
  const url = info.url.trim()
  if (url.length === 0) return

  const match = getEmbedDefinition(url)
  if (match && editor.hasShapeUtil("embed")) {
    createEmbedShape(editor, url, info.point)
    return
  }

  // No bookmark shape on a trimmed editor: a link is still worth keeping, and
  // a text shape is the one thing every editor can hold.
  if (!editor.hasShapeUtil("bookmark")) {
    editor.markHistoryStoppingPoint("insert url")
    createTextShapeAt(editor, url, info.point)
    return
  }

  let asset: Asset | undefined
  try {
    asset = await editor.getAssetForExternalContent({ type: "url", url })
  } catch (error) {
    const msg = opts.msg ?? ((id: string) => id)
    opts.toasts?.addToast({ id: BOOKMARK_UNFURL_FAILED, title: msg(BOOKMARK_UNFURL_FAILED), description: url, severity: "warning" })
    asset = undefined
    // Swallowed deliberately — see the doc comment. Kept visible for debugging.
    if (typeof console !== "undefined") console.warn("[mocanvas] could not unfurl", url, error)
  }

  createBookmarkShape(editor, url, asset, info.point)
}

/** Create the `embed` shape for an already-matched url, centered on `point`. */
export function createEmbedShape(editor: Editor, url: string, point?: VecLike): ShapeId {
  const p = pointOrCenter(editor, point)
  const id = createShapeId()
  editor.run(() => {
    editor.markHistoryStoppingPoint("insert embed")
    editor.createShape<EmbedShape>({
      id,
      type: "embed",
      x: p.x - EMBED_WIDTH / 2,
      y: p.y - EMBED_HEIGHT / 2,
      props: { w: EMBED_WIDTH, h: EMBED_HEIGHT, url },
    })
    editor.setSelectedShapes([id])
  })
  return id
}

/**
 * Create the `bookmark` card for a url, storing `asset` when the unfurl
 * produced one. A card with `assetId: null` is a valid card — it renders the
 * host and the url and nothing else.
 */
export function createBookmarkShape(editor: Editor, url: string, asset: Asset | undefined, point?: VecLike): ShapeId {
  const p = pointOrCenter(editor, point)
  const id = createShapeId()
  editor.run(() => {
    editor.markHistoryStoppingPoint("insert bookmark")
    if (asset) editor.createAssets([{ id: asset.id, type: asset.type, props: asset.props, meta: asset.meta }])
    editor.createShape<BookmarkShape>({
      id,
      type: "bookmark",
      x: p.x - BOOKMARK_WIDTH / 2,
      y: p.y - BOOKMARK_HEIGHT / 2,
      props: { w: BOOKMARK_WIDTH, h: BOOKMARK_HEIGHT, url, assetId: asset ? asset.id : null },
    })
    editor.setSelectedShapes([id])
  })
  return id
}
