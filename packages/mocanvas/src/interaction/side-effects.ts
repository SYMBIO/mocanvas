/**
 * The store side effects the flagship installs that the bare editor does not.
 *
 * A side effect here is bookkeeping that has to happen however the store was
 * changed — by a tool, by an undo, by a remote peer, or by an app calling
 * `createShapes` directly. Anything that only needs to happen when *this* user
 * did something belongs in a tool instead; putting it here would make it fire
 * on a collaborator's edit too.
 *
 * `<Mocanvas>` calls this on mount. An app assembling the editor from
 * `MocanvasEditor` and the defaults calls it itself, and disposes it when the
 * editor goes away.
 */

import type { Editor, UnknownShape } from "@mocanvas/editor"

/**
 * Install the default side effects and return a function that removes them.
 *
 * Safe to call more than once on one editor — each call installs its own
 * handlers and its own disposer — though there is rarely a reason to.
 */
export function registerDefaultSideEffects(editor: Editor): () => void {
  const disposers: (() => void)[] = []

  // An embed's aspect ratio is a property of the *service*, not of the shape,
  // so it can only be known once the shape has a url. Applying it after the
  // fact rather than at creation means a shape pasted from another document —
  // where no tool ran — is sized correctly too.
  disposers.push(
    editor.sideEffects.registerAfterCreateHandler("shape", (shape: UnknownShape) => {
      if (shape.type !== "embed") return
      const util = editor.getShapeUtil(shape) as { resolveAspectRatio?: (shape: UnknownShape) => number | undefined }
      const ratio = util.resolveAspectRatio?.(shape)
      if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return
      const props = shape.props as { w?: number; h?: number }
      if (typeof props.w !== "number" || typeof props.h !== "number") return
      const nextHeight = Math.round(props.w / ratio)
      if (nextHeight === props.h) return
      editor.updateShape({ id: shape.id, type: shape.type, props: { h: nextHeight } } as never)
    }),
  )

  // A shape whose asset nothing else references leaves that asset orphaned in
  // the document, where it costs whatever the file weighs on every save. The
  // check is on delete rather than on a sweep because a sweep would have to
  // walk every shape on every page.
  disposers.push(
    editor.sideEffects.registerAfterDeleteHandler("shape", (shape: UnknownShape) => {
      const assetId = (shape.props as { assetId?: string | null }).assetId
      if (!assetId) return
      const stillUsed = editor.getCurrentPageShapes().some((other) => (other.props as { assetId?: string | null }).assetId === assetId)
      if (stillUsed) return
      // Deleting the asset is deliberately *not* done here: an undo of the
      // shape deletion would have nothing to point at, and an asset is small
      // compared to the surprise of losing an image on redo. What is released
      // is the in-flight upload preview, which nothing can undo into.
      const releasePreview = (editor as { clearTemporaryAssetPreview?: (id: string) => void }).clearTemporaryAssetPreview
      releasePreview?.call(editor, assetId)
    }),
  )

  return () => {
    for (const dispose of disposers) dispose()
  }
}
