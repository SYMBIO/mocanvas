import { createStore, Editor, type CurrentUser, type EditorStoreSnapshot, type ShapeUtilConstructor, type BindingUtilConstructor } from "@mocanvas/editor"
import { useEffect, useState, type CSSProperties } from "react"
import { defaultBindingUtils } from "../bindings"
import { defaultShapeUtils } from "../shapes"

/**
 * A snapshot, rendered as a static picture.
 *
 * The point is that it is *not* an editor: no engine, no event handlers, no
 * store subscription. A document listing, a thumbnail grid or a printed report
 * needs the drawing and none of the machinery, and mounting a real editor per
 * thumbnail is what makes those pages unusable.
 *
 * The snapshot is rendered through the same SVG exporter the file export uses,
 * so a thumbnail and a downloaded file agree.
 */
export interface TldrawImageProps {
  /** The document to draw. */
  snapshot: EditorStoreSnapshot
  /** Which page to draw. Defaults to the snapshot's current page. */
  pageId?: string
  /** Draw only these shapes. */
  shapeIds?: readonly string[]
  /** Page units of padding around the shapes. */
  padding?: number
  /** Paint the theme's background behind the shapes. */
  background?: boolean
  /** Render with the dark theme. */
  darkMode?: boolean
  /** Extra shape utils beyond the defaults, for a document with custom shapes. */
  shapeUtils?: readonly ShapeUtilConstructor[]
  /** Extra binding utils beyond the defaults. */
  bindingUtils?: readonly BindingUtilConstructor[]
  /** Owns the preferences the render reads. */
  user?: CurrentUser
  /** Accessible description of the drawing. Empty marks it decorative. */
  alt?: string
  className?: string
  style?: CSSProperties
}

/**
 * A snapshot as an inline SVG.
 *
 * Rendered in an effect rather than during render: building the editor and
 * walking the document is work, and doing it synchronously would block the
 * first paint of whatever page is showing the thumbnail.
 */
export function TldrawImage({
  snapshot,
  pageId,
  shapeIds,
  padding,
  background,
  darkMode,
  shapeUtils,
  bindingUtils,
  user,
  alt,
  className,
  style,
}: TldrawImageProps) {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let disposed = false
    let editor: Editor | null = null
    const container = typeof document === "undefined" ? (null as unknown as HTMLElement) : document.createElement("div")
    try {
      const store = createStore({
        shapeUtils: [...defaultShapeUtils, ...(shapeUtils ?? [])],
        bindingUtils: [...defaultBindingUtils, ...(bindingUtils ?? [])],
      })
      editor = new Editor({
        store,
        shapeUtils: [...defaultShapeUtils, ...(shapeUtils ?? [])],
        bindingUtils: [...defaultBindingUtils, ...(bindingUtils ?? [])],
        // No tools and a detached container: this editor exists to be read,
        // never pointed at. The container is a bare element rather than the
        // page's, so nothing here can style or measure against the host.
        tools: [],
        getContainer: () => container,
        ...(user ? { user } : {}),
      })
      editor.loadSnapshot(snapshot)
      if (pageId) editor.setCurrentPage(pageId as never)
      const ids = shapeIds ? (shapeIds as never[]) : undefined
      const result = editor.getSvgString(ids, {
        ...(padding === undefined ? {} : { padding }),
        ...(background === undefined ? {} : { background }),
        ...(darkMode === undefined ? {} : { darkMode }),
      })
      if (!disposed) setSvg(result?.svg ?? null)
    } catch (thrown) {
      if (!disposed) setError(thrown)
    } finally {
      editor?.dispose()
    }
    return () => {
      disposed = true
    }
  }, [snapshot, pageId, shapeIds, padding, background, darkMode, shapeUtils, bindingUtils, user])

  if (error) {
    return (
      <div className={["mocanvas-image", "mocanvas-image--error", className].filter(Boolean).join(" ")} style={style} role="img" aria-label={alt ?? "Could not render drawing"} />
    )
  }
  return (
    <div
      className={["mocanvas-image", className].filter(Boolean).join(" ")}
      style={style}
      {...(alt ? { role: "img", "aria-label": alt } : { "aria-hidden": true })}
      // The markup comes from mocanvas's own exporter, which escapes every
      // value it writes; nothing the document carries reaches the DOM as
      // markup.
      dangerouslySetInnerHTML={{ __html: svg ?? "" }}
    />
  )
}
