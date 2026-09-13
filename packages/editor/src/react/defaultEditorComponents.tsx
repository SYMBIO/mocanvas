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

/** Clamp `v` into `[min, max]`. */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/**
 * The rendered spacing at which the lattice is fully drawn, and the one below
 * which it is gone, in screen pixels.
 *
 * The eye judges a grid in pixels, not in document units, so both thresholds
 * are pixel numbers: a cell under ~12px is dissolving and one under 6px is a
 * grey sheen rather than information. An app that wants the grid to survive
 * further out enlarges the cell — `documentSettings.gridSize`, which is the
 * snap step, so the dots stay magnets at every zoom.
 */
const GRID_SOLID_PX = 12
const GRID_GONE_PX = 6

/** How much of the cell one dot is, and the range that stays legible. */
const GRID_DOT_RATIO = 16
const GRID_DOT_MIN = 0.75
const GRID_DOT_MAX = 5

/**
 * The grid: one lattice of dots on the document's own grid step, drawn with an
 * SVG pattern in page space.
 *
 * **The dot scales with the world, and the lattice fades as a whole.** Those
 * are the two rules, and each fixes a direction the old grid got backwards. A
 * fixed 1px dot vanishes as you zoom in — the cell grows to 80 screen pixels
 * and what is left is a speck every 80px, which reads as no grid at all — so
 * the radius is a fraction of the cell, floored and capped so it never
 * disappears and never becomes a blob. And a second, heavier lattice every
 * fifth cell at a fixed opacity is exactly the dense sheen a zoomed-out canvas
 * must not have: one lattice, one opacity, gone below {@link GRID_GONE_PX}.
 *
 * **No re-levelling**, deliberately: the spacing is always the document's step
 * rather than a power of it chosen per zoom. Dots are then magnets — a corner
 * on a multiple of the step sits on a dot at *every* zoom — and re-levelling
 * breaks that on the intermediate steps, which is worse than a grid that
 * bows out when it gets too dense to mean anything.
 */
export function DefaultGrid({ x, y, z, size }: TLGridProps) {
  const id = useSharedSafeId("grid")
  // The cell as the screen sees it. Everything below is a function of this.
  const cell = size * z
  const opacity = clamp((cell - GRID_GONE_PX) / (GRID_SOLID_PX - GRID_GONE_PX), 0, 1)
  // Nothing at all rather than a transparent layer: at this density the grid
  // is not faint, it is wrong, and a host reading the DOM should see it gone.
  if (opacity <= 0) return null
  const r = clamp(cell / GRID_DOT_RATIO, GRID_DOT_MIN, GRID_DOT_MAX)
  // The dot sits at the centre of the tile and the pattern is shifted back by
  // half a cell, so the dot lands on the world lattice AND is never clipped.
  // Drawn at the tile's corner — where it was — a pattern clips three quarters
  // of it away, which at r = 5 is a quarter-disc rather than a dot.
  const half = cell / 2
  return (
    <svg className="mocanvas-grid" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} aria-hidden="true">
      <defs>
        <pattern id={id} width={cell} height={cell} patternUnits="userSpaceOnUse" patternTransform={`translate(${x * z - half} ${y * z - half})`}>
          <circle cx={half} cy={half} r={r} fill="var(--mocanvas-grid, currentColor)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} opacity={opacity} />
    </svg>
  )
}

/**
 * Drawn in place of one shape whose body threw.
 *
 * At the shape's own position and size, because that is where the user is
 * looking — and quiet, because a page of thirty broken shapes should not be
 * thirty alarms. The point is that the other twenty-nine still work.
 */
export function DefaultShapeErrorFallback({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div
      className="mocanvas-shape-error"
      role="img"
      aria-label={`This shape could not be drawn: ${message}`}
      title={message}
      style={{ position: "absolute", inset: 0, border: "1px dashed var(--mocanvas-selection, #e03131)", borderRadius: 2, opacity: 0.6, pointerEvents: "none" }}
    />
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
