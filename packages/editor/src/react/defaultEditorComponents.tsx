import { track } from "@mocanvas/state/react"
import { useEffect, type CSSProperties, type ReactNode } from "react"
import type { Editor } from "../editor/Editor"
import type { ShapeId } from "../records/base"
import { Canvas } from "./Canvas"
import { useEditor, useMaybeEditor } from "./EditorContext"
import { useSharedSafeId } from "./safeIds"
import type { TLGridProps } from "./ui-types"

/**
 * The components the editor renders when an app overrides nothing.
 *
 * Every one of them is a slot: they exist as exported components so that an
 * app replacing one has something to start from — wrap it, or render it
 * alongside its own — rather than having to reconstruct the default from the
 * docs. None of them takes the editor as a prop; they read it from context.
 */

/**
 * The canvas surface.
 *
 * A thin default: the real work is in {@link Canvas}, which needs the editor
 * instance. This is the form that fits a component slot, which is rendered
 * with no props.
 */
export function DefaultCanvas() {
  const editor = useEditor()
  return <Canvas editor={editor} />
}

/**
 * The plate behind the page: a flat fill in the theme's canvas colour.
 *
 * Painted as a DOM layer rather than into the GL surface so a host can
 * restyle it — an image, a gradient, a printed grain — with CSS alone.
 */
export function DefaultBackground() {
  return <div className="mocanvas-background" style={{ position: "absolute", inset: 0, background: "var(--mocanvas-canvas, transparent)" }} />
}

/**
 * The grid, drawn in page space with an SVG pattern.
 *
 * Two patterns rather than one: a fine cell at the document's grid step and a
 * heavier one every fifth cell, so the eye can count without the fine grid
 * having to be dark enough to read on its own. Both fade out as the camera
 * zooms away, because a grid finer than a few screen pixels is noise.
 */
export function DefaultGrid({ x, y, z, size }: TLGridProps) {
  const id = useSharedSafeId("grid")
  const step = size * z
  // Below a few pixels per cell the fine grid is aliasing, not information.
  const fineOpacity = Math.min(1, Math.max(0, (step - 4) / 12))
  return (
    <svg className="mocanvas-grid" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} aria-hidden="true">
      <defs>
        <pattern id={id} width={step} height={step} patternUnits="userSpaceOnUse" patternTransform={`translate(${x * z} ${y * z})`}>
          <circle cx={0} cy={0} r={1} fill="var(--mocanvas-grid, currentColor)" opacity={fineOpacity * 0.5} />
        </pattern>
        <pattern id={`${id}_major`} width={step * 5} height={step * 5} patternUnits="userSpaceOnUse" patternTransform={`translate(${x * z} ${y * z})`}>
          <circle cx={0} cy={0} r={1.5} fill="var(--mocanvas-grid, currentColor)" opacity={0.8} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
      <rect width="100%" height="100%" fill={`url(#${id}_major)`} />
    </svg>
  )
}

/**
 * The document-level `<defs>`: the one place a shape can put a gradient,
 * filter or marker that every instance of it shares.
 *
 * Rendered once per editor, above the canvas but with no size of its own, so
 * a shape body can reference `url(#…)` by a {@link useSharedSafeId} name.
 */
export function DefaultSvgDefs({ children }: { children?: ReactNode }) {
  return (
    <svg className="mocanvas-svg-defs" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} aria-hidden="true">
      <defs>{children}</defs>
    </svg>
  )
}

export interface TLCursorProps {
  /** The cursor kind, as `editor.getCursor()` reports it. */
  type: string
  /** Rotation in radians — a resize cursor follows the shape it will resize. */
  rotation: number
  /** The collaborator's colour, when this is somebody else's cursor. */
  color?: string
  /** The collaborator's name, drawn beside the arrow. */
  name?: string | null
  /** Screen-space position, for a collaborator's cursor. */
  point?: { x: number; y: number } | null
}

/**
 * A pointer arrow drawn in the editor, with an optional name tag.
 *
 * Used for collaborators: the local pointer is the browser's own cursor,
 * driven by the CSS `cursor` property, and does not go through here.
 */
export function DefaultCursor({ rotation, color, name, point }: TLCursorProps) {
  if (!point) return null
  return (
    <div
      className="mocanvas-cursor"
      style={{ position: "absolute", top: 0, left: 0, transform: `translate(${point.x}px, ${point.y}px) rotate(${rotation}rad)`, pointerEvents: "none" }}
    >
      <svg width="20" height="24" viewBox="0 0 20 24" aria-hidden="true">
        <path d="M2 2l14 10-6 1.5L7 21z" fill={color ?? "currentColor"} stroke="var(--mocanvas-selection-fg, #fff)" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      {name ? (
        <div className="mocanvas-cursor-name" style={{ position: "absolute", left: 14, top: 18, background: color ?? "currentColor", color: "#fff", borderRadius: 4, padding: "1px 5px", font: "11px/1.4 system-ui, sans-serif", whiteSpace: "nowrap" }}>
          {name}
        </div>
      ) : null}
    </div>
  )
}

export interface TLShapeWrapperProps {
  shape: { id: ShapeId; type: string }
  children?: ReactNode
}

/**
 * The element a shape's DOM body is rendered into.
 *
 * The seam exists so an app can put an attribute, a data hook or a wrapper of
 * its own around every shape at once — an automated-test id, a drag-and-drop
 * target — without touching the shape utils. The default adds nothing: the
 * positioning and pointer-event policy already live on the wrapper `<Canvas>`
 * builds, and duplicating them here would give every shape a second box.
 */
export function DefaultShapeWrapper({ children }: TLShapeWrapperProps) {
  return <>{children}</>
}

/**
 * A transparent sheet that swallows the click which closes an open menu.
 *
 * Without it, the click that dismisses a dropdown also lands on the canvas and
 * starts a selection or, worse, creates a shape. Mounted only while a menu is
 * open, so it costs nothing the rest of the time.
 */
export const MenuClickCapture = track(function MenuClickCapture({ onClose }: { onClose?: () => void }) {
  const editor = useMaybeEditor()
  const isOpen = (editor?.menus.getOpenMenus().length ?? 0) > 0
  useEffect(() => {
    if (!isOpen || !editor) return
    // A menu left open when its owner unmounts would otherwise pin this sheet
    // over the canvas forever.
    return () => void editor.menus.clearOpenMenus()
  }, [isOpen, editor])
  if (!isOpen) return null
  const style: CSSProperties = { position: "absolute", inset: 0, zIndex: 1 }
  return <div className="mocanvas-menu-click-capture" style={style} onPointerDown={() => onClose?.()} aria-hidden="true" />
})

/**
 * Whether a shape is being cropped — its crop handles are live, so the
 * ordinary resize handles must not be.
 *
 * SEMANTICS-ASSUMED: mocanvas has no crop tool yet, so "cropping" is read off
 * the state chart by path (`select.crop…`), which is where a crop tool would
 * live. Until one exists this is always `false`, which is the correct answer
 * rather than a stub — a caller can already branch on it and will not have to
 * change when cropping lands.
 */
export function useIsCropping(shapeId?: ShapeId): boolean {
  const editor = useMaybeEditor()
  if (!editor) return false
  if (!editor.isInAny("select.crop", "select.crop.idle", "select.crop.pointing_crop_handle", "select.crop.cropping")) return false
  if (shapeId === undefined) return true
  return editor.getOnlySelectedShape()?.id === shapeId
}

/** The editor-level component map: the twelve slots `<Canvas>` itself renders. */
export interface TLEditorComponents {
  Background?: (() => ReactNode) | null
  Canvas?: (() => ReactNode) | null
  CollaboratorCursor?: ((props: TLCursorProps) => ReactNode) | null
  ErrorFallback?: ((props: { error: unknown; resetError?(): void }) => ReactNode) | null
  Grid?: ((props: TLGridProps) => ReactNode) | null
  InFrontOfTheCanvas?: (() => ReactNode) | null
  LoadingScreen?: (() => ReactNode) | null
  OnTheCanvas?: (() => ReactNode) | null
  ShapeErrorFallback?: ((props: { error: unknown; resetError?(): void }) => ReactNode) | null
  ShapeWrapper?: ((props: TLShapeWrapperProps) => ReactNode) | null
  Spinner?: (() => ReactNode) | null
  SvgDefs?: (() => ReactNode) | null
}

/** Read for its side effect on the type checker only; keeps `Editor` imported. */
export type TLEditorComponentsEditor = Editor
