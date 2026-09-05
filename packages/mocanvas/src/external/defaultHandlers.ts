/**
 * The default handlers for content that arrives from outside the editor.
 *
 * `registerDefaultExternalContentHandlers` wires these up; they are exported
 * individually so an app can *extend* one rather than replace it — filter the
 * files, then call the default with what is left:
 *
 * ```ts
 * editor.registerExternalContentHandler("files", async (content) => {
 *   const small = content.files.filter((file) => file.size < 1024 * 1024)
 *   await defaultHandleExternalFileContent(editor, { ...content, files: small }, { toasts, msg })
 * })
 * ```
 *
 * The ones that can refuse a file take a third argument carrying the toasts and
 * the translator, because refusing silently is worse than not handling the drop
 * at all.
 */

import { AssetRecordType, type Asset, type Editor, type ShapeId, type VecLike } from "@mocanvas/editor"
import { createShapesForAssets, notifyIfFileNotAllowed } from "../assets/media"
import { createImageAssetFromSvgText, createTextShapeAt } from "./defaultExternalContentHandlers"
import type { TLDefaultExternalContentHandlerOpts } from "./handler-options"
import { sanitizeSvg } from "./sanitizeSvg"
import { defaultHandleExternalUrlContent } from "./urlContent"

/** Where content should land, when it says. */
interface AtPoint {
  point?: VecLike
}

function pointOrCenter(editor: Editor, point: VecLike | undefined): VecLike {
  return point ?? editor.getViewportPageCenter()
}

/** Plain text: one text shape, centred where it was dropped. */
export async function defaultHandleExternalTextContent(editor: Editor, info: { text: string } & AtPoint): Promise<void> {
  const text = info.text.trim()
  if (!text) return
  editor.markHistoryStoppingPoint("insert text")
  createTextShapeAt(editor, text, info.point)
}

/**
 * SVG markup: one image shape backed by an inline SVG asset.
 *
 * The markup is sanitized first, and dropped entirely when nothing safe is left
 * — pasted SVG is the single most dangerous thing that can arrive on a canvas,
 * because it can carry script.
 */
export async function defaultHandleExternalSvgTextContent(editor: Editor, info: { text: string } & AtPoint): Promise<void> {
  const safe = sanitizeSvg(info.text)
  if (!safe) return
  editor.markHistoryStoppingPoint("insert svg")
  const asset = createImageAssetFromSvgText(safe)
  await createShapesForAssets(editor, [asset], pointOrCenter(editor, info.point))
}

/** A url the caller has already decided to embed, skipping the bookmark negotiation. */
export async function defaultHandleExternalEmbedContent(editor: Editor, info: { url: string } & AtPoint): Promise<void> {
  if (!editor.hasShapeUtil("embed")) {
    await defaultHandleExternalUrlContent(editor, { url: info.url, ...(info.point ? { point: info.point } : {}) })
    return
  }
  editor.markHistoryStoppingPoint("insert embed")
  const { createEmbedShape } = await import("./urlContent")
  createEmbedShape(editor, info.url, info.point)
}

/**
 * mocanvas's own clipboard content: shapes, bindings and assets, put back onto
 * the current page.
 *
 * Goes through `putContentOntoCurrentPage`, so ids are remapped, the content is
 * migrated from whatever schema it was written under, and a paste with a point
 * lands inside whatever frame is under it.
 */
export async function defaultHandleExternalTldrawContent(
  editor: Editor,
  info: { content: unknown } & AtPoint,
): Promise<void> {
  const content = info.content as { shapes?: unknown[] } | null
  if (!content || !Array.isArray(content.shapes)) return
  editor.markHistoryStoppingPoint("paste")
  editor.putContentOntoCurrentPage(content as never, info.point ? { point: info.point } : {})
}

/**
 * Files: turn each one into an asset through the util that claims its type,
 * then create the shapes those assets call for.
 *
 * Files that are refused (too large, or a type nothing claims) are dropped with
 * a toast and the rest still land — a drop of ten photos and one video should
 * not fail wholesale because the video was too big.
 */
export async function defaultHandleExternalFileContent(
  editor: Editor,
  info: { files: File[] } & AtPoint,
  opts: TLDefaultExternalContentHandlerOpts,
): Promise<void> {
  const assets: Asset[] = []
  for (const file of info.files) {
    if (!notifyIfFileNotAllowed(editor, file, opts)) continue
    const asset = await defaultHandleExternalFileAsset(editor, { type: "file", file }, opts)
    if (asset) assets.push(asset)
  }
  if (assets.length === 0) return
  editor.markHistoryStoppingPoint("insert files")
  await createShapesForAssets(editor, assets, pointOrCenter(editor, info.point))
}

/**
 * Replace the asset behind an existing shape with one built from `file`.
 *
 * The shape keeps its position, size and every other prop — which is the point:
 * "swap this photo for that one" should not move or resize anything.
 */
export async function defaultHandleExternalFileReplaceContent(
  editor: Editor,
  info: { files: File[]; shapeId: ShapeId },
  opts: TLDefaultExternalContentHandlerOpts,
): Promise<void> {
  const file = info.files[0]
  if (!file) return
  if (!notifyIfFileNotAllowed(editor, file, opts)) return
  const asset = await defaultHandleExternalFileAsset(editor, { type: "file", file }, opts)
  if (!asset) return
  const shape = editor.getShape(info.shapeId)
  if (!shape) return
  editor.markHistoryStoppingPoint("replace media")
  editor.run(() => {
    editor.createAssets([{ id: asset.id, type: asset.type, props: asset.props, meta: asset.meta }])
    editor.updateShape({ id: shape.id, type: shape.type, props: { ...(shape.props as object), assetId: asset.id } } as never)
  })
}

/**
 * Build an asset record for a file, without creating any shape.
 *
 * The seam an app overrides to upload somewhere: return an asset whose `src`
 * points at your own storage and every path that handles a file gets it.
 */
export async function defaultHandleExternalFileAsset(
  editor: Editor,
  info: { type: "file"; file: File },
  opts: TLDefaultExternalContentHandlerOpts,
): Promise<Asset | undefined> {
  if (!notifyIfFileNotAllowed(editor, info.file, opts)) return undefined
  const util = editor.getAssetUtilForMimeType(info.file.type)
  if (util?.upload) return await util.upload(info.file, editor)
  // No util claims the type — fall back to whatever asset handler the app
  // registered, which is how an app supports a type without writing a util.
  return await editor.getAssetForExternalContent(info)
}

/**
 * Build a bookmark asset for a url, without creating any shape.
 *
 * mocanvas performs no network request of its own here: unfurling a link needs
 * a server that can fetch it, which is the app's to provide. The asset that
 * comes back carries the url and empty metadata, and an app that has an unfurl
 * endpoint registers its own `url` asset handler to fill the rest in.
 */
export async function defaultHandleExternalUrlAsset(
  editor: Editor,
  info: { type: "url"; url: string },
  _opts?: TLDefaultExternalContentHandlerOpts,
): Promise<Asset | undefined> {
  const registered = await editor.getAssetForExternalContent(info)
  if (registered) return registered
  return {
    id: AssetRecordType.createId(),
    typeName: "asset",
    type: "bookmark",
    props: { title: "", description: "", image: "", favicon: "", src: info.url },
    meta: {},
  }
}
