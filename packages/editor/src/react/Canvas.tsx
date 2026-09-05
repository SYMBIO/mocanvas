import { react as reactSignal } from "@mocanvas/state"
import { track, useValue } from "@mocanvas/state/react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import type { ClipRect } from "@mocanvas/wasm"
import type { Editor } from "../editor/Editor"
import type { RenderBackend } from "../render/backend"
import { createBackend } from "../render/webgl2"
import type { UnknownShape } from "../records/base"
import { Vec } from "../geometry"
import { EditorProvider } from "./EditorContext"
import { useEditorComponents } from "./ui-context"
import { useThemeCssVars } from "./themeVars"
import { useCanvasEvents } from "./useCanvasEvents"
import { getSelectionHandlePositions } from "../editor/selectionHandles"
import { ShapeIndicatorCompositor, type TLIndicatorHost } from "../indicators/ShapeIndicatorCompositor"
import { getIndicatorSource } from "../indicators/resolve"

/**
 * What the `Canvas` component slot is handed.
 *
 * A host replacing the canvas gets only presentation: a class name and
 * children. It deliberately does *not* receive the editor as a prop — the
 * replacement is rendered inside the editor's provider and reads it with
 * `useEditor()`, so a slot cannot be rendered against a different editor than
 * the one it is inside of.
 */
export interface TLCanvasComponentProps {
  className?: string
  children?: ReactNode
}

export interface CanvasProps {
  editor: Editor
  className?: string
  style?: CSSProperties
  /** Extra layers rendered above the canvas (UI, menus). */
  children?: ReactNode
  /** Override the default selection/brush indicators. */
  components?: Partial<CanvasComponents>
  /**
   * The overlay util that paints shape indicators onto the canvas layer.
   *
   * A *class*, not an instance — one is constructed per editor. Pass
   * `ShapeIndicatorCompositor.configure({ lineWidth })` to restyle, or a
   * subclass to control which shapes get an outline.
   */
  indicatorOverlayUtil?: typeof ShapeIndicatorCompositor
}

export interface CanvasComponents {
  Indicators: (props: { editor: Editor }) => ReactNode
  Brush: (props: { editor: Editor }) => ReactNode
  Background: (props: { editor: Editor }) => ReactNode
}

const containerStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  overflow: "hidden",
  touchAction: "none",
  userSelect: "none",
  WebkitUserSelect: "none",
  outline: "none",
  cursor: "default",
}

const layerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
}

/*
 * Canvas chrome. Every colour comes from a custom property so an app can retheme
 * the indicators along with the rest of the UI; the literals here are only the
 * fallback for an editor mounted without `ui.css`, and are picked to clear 3:1
 * against both a light and a dark canvas.
 */
const SELECTION = "var(--mocanvas-selection, #2f6fe4)"
/** Fill of a solid handle: the surface the selection stroke is drawn against. */
const HANDLE_FILL = "var(--mocanvas-selection-fg, #ffffff)"
const BRUSH_FILL = "var(--mocanvas-brush-fill, rgba(47, 111, 228, 0.12))"
const SNAP = "var(--mocanvas-snap, #cf3fe0)"
/** Screen-space stroke width for indicator outlines. */
const INDICATOR_STROKE = 1.5
/** Screen-space radii/sides of the selection handles, in CSS px. */
const HANDLE = { corner: 9, rotate: 5.5, shape: 6, virtual: 4 } as const

/**
 * The canvas: a WebGL2 surface driven by the engine, a DOM overlay for shapes
 * that render through `ShapeUtil.component`, a 2D canvas overlay for shape
 * indicators, and an SVG layer for the selection handles, snap lines, the brush
 * — and for any util still on the deprecated `indicator()` hook.
 */
export function Canvas({ editor, className, style, children, components, indicatorOverlayUtil }: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [backend, setBackend] = useState<RenderBackend | null>(null)
  const events = useCanvasEvents(editor)

  // Backend lifecycle
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const b = createBackend(canvas)
    setBackend(b)
    return () => {
      b.dispose()
      setBackend(null)
    }
  }, [])

  // Viewport size tracking
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || !backend) return
    const update = () => {
      const rect = el.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      backend.resize(rect.width, rect.height, dpr)
      editor.updateViewportScreenBounds({ x: rect.left, y: rect.top, w: rect.width, h: rect.height })
      editor.updateInstanceState({ devicePixelRatio: dpr })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener("resize", update)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [editor, backend])

  // Frame loop: redraw when the frame epoch, camera, or viewport change.
  useEffect(() => {
    if (!backend) return
    let raf = 0
    let dirty = true
    const draw = () => {
      raf = 0
      if (!dirty) return
      dirty = false
      // Shapes that entered the viewport may still be waiting on the engine's
      // per-frame tessellation budget, drawn as flat quads until their turn comes.
      // Keep the loop alive until that backlog clears.
      if (editor.renderFrame(backend).pending) {
        dirty = true
        raf = requestAnimationFrame(draw)
      }
    }
    const stop = reactSignal(
      "canvas.frame",
      () => {
        editor.getFrameEpoch()
        editor.getCamera()
        editor.getViewportScreenBounds()
        editor.getEditingShapeId()
        dirty = true
        if (!raf) raf = requestAnimationFrame(draw)
      },
    )
    return () => {
      stop()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [editor, backend])

  // Non-passive wheel + keyboard listeners
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => events.onWheel(e)
    el.addEventListener("wheel", onWheel, { passive: false })
    window.addEventListener("keydown", events.onKeyDown)
    window.addEventListener("keyup", events.onKeyUp)
    return () => {
      el.removeEventListener("wheel", onWheel)
      window.removeEventListener("keydown", events.onKeyDown)
      window.removeEventListener("keyup", events.onKeyUp)
    }
  }, [events])

  const cursor = useValue("cursor", () => cssCursor(editor.getInstanceState().cursor.type), [editor])
  /*
   * Suppressing the browser's own menu is the canvas's job only while nothing
   * else wants the gesture. An app that filled the `ContextMenu` chrome slot
   * WRAPS this element with its own trigger, and a `preventDefault` here would
   * reach that trigger as an already-handled event and silently stop it from
   * opening — the canvas would eat the menu it exists to make room for.
   */
  const hasChromeContextMenu = useEditorComponents().ContextMenu != null
  // The theme's surface colours, stamped as custom properties so the SVG
  // overlays, the chrome and an app's own CSS all read one source. `style`
  // comes after, so a caller can still override an individual variable.
  const themeVars = useThemeCssVars(editor)
  const Indicators = components?.Indicators ?? DefaultIndicators
  const Brush = components?.Brush ?? (hasOverlay(editor, "brush") ? null : DefaultBrush)
  const Background = components?.Background

  return (
    <EditorProvider editor={editor}>
      <div
        ref={containerRef}
        className={className ? `mocanvas ${className}` : "mocanvas"}
        style={{ ...containerStyle, ...themeVars, ...style, cursor }}
        tabIndex={0}
        onPointerDown={events.onPointerDown}
        onPointerMove={events.onPointerMove}
        onPointerUp={events.onPointerUp}
        onPointerCancel={events.onPointerCancel}
        {...(hasChromeContextMenu ? {} : { onContextMenu: events.onContextMenu })}
        data-testid="mocanvas-container"
      >
        {Background ? <Background editor={editor} /> : null}
        <canvas ref={canvasRef} style={{ ...layerStyle, display: "block" }} />
        <OverlayLayer editor={editor} />
        <IndicatorCanvas editor={editor} util={indicatorOverlayUtil ?? ShapeIndicatorCompositor} />
        <svg style={{ ...layerStyle, pointerEvents: "none", overflow: "visible" }}>
          <Indicators editor={editor} />
          {hasOverlay(editor, "snapIndicator") ? null : <SnapLines editor={editor} />}
          {Brush ? <Brush editor={editor} /> : null}
        </svg>
        {children}
      </div>
    </EditorProvider>
  )
}

/**
 * The canvas indicator overlay: every selection, hover and drop-target outline,
 * stroked into one 2D context above the scene.
 *
 * A canvas rather than SVG because the count is unbounded — a marquee over a
 * thousand shapes is a thousand outlines, and a thousand DOM nodes created and
 * destroyed per pointer move is the thing that makes a big board feel slow.
 *
 * The layer is sized in device pixels and drawn under a `dpr` transform, so
 * everything below it (and inside {@link ShapeIndicatorCompositor.render}) can
 * be expressed in CSS pixels and page units without a factor in sight.
 */
/**
 * Whether an overlay painter is registered for `type`.
 *
 * The SVG layer below predates the canvas painters and still knows how to draw
 * the brush, the snap lines and the selection handles. Where a painter is
 * registered it owns that job, and the SVG version stands down rather than
 * stroking the same thing twice. Where one is not — an app that passed its own
 * `overlayUtils` and left something out — the SVG version still draws it, so
 * nothing silently disappears.
 */
function hasOverlay(editor: Editor, type: string): boolean {
  return editor.overlays.getOverlayUtil(type) !== undefined
}

function IndicatorCanvas({ editor, util }: { editor: Editor; util: typeof ShapeIndicatorCompositor }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlay = useMemo(() => new util(editor as unknown as TLIndicatorHost), [editor, util])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let raf = 0
    let dirty = true
    const draw = () => {
      raf = 0
      if (!dirty) return
      dirty = false
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      const viewport = editor.getViewportScreenBounds()
      const dpr = editor.getInstanceState().devicePixelRatio || 1
      const w = Math.max(0, Math.round(viewport.w * dpr))
      const h = Math.max(0, Math.round(viewport.h * dpr))
      // Assigning either dimension resets the whole context, so the transform
      // below has to be re-established every frame regardless.
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // The registered overlay utils paint here — brush, scribble, snap lines,
      // handles, collaborators. When one of them is the shape-indicator util,
      // it draws the indicators too, so the standalone compositor stands down
      // rather than stroking every outline twice.
      const registered = editor.overlays.getOverlayUtil("shapeIndicator")
      if (!registered) overlay.render(ctx)
      editor.overlays.render(ctx)
    }
    const stop = reactSignal("canvas.indicators", () => {
      editor.getCamera()
      editor.getViewportScreenBounds()
      editor.getSelectedShapeIds()
      editor.getHoveredShapeId()
      editor.getHintingShapeIds()
      editor.getCurrentToolId()
      // Shape edits move the outline with the shape.
      editor.getFrameEpoch()
      // What the overlay painters draw from. Without these the overlays paint
      // once and then freeze: the brush, the scribbles and the collaborators
      // all change without touching the camera or the selection.
      editor.getInstanceState()
      editor.snaps.getLines()
      editor.getCollaborators()
      dirty = true
      if (!raf) raf = requestAnimationFrame(draw)
    })
    return () => {
      stop()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [editor, overlay])

  return <canvas ref={canvasRef} style={{ ...layerStyle, pointerEvents: "none", display: "block" }} />
}

/** Shapes rendered by their ShapeUtil.component, positioned in page space via a camera transform. */
const OverlayLayer = track(function OverlayLayer({ editor }: { editor: Editor }) {
  const ids = editor.getOverlayShapeIds()
  const clips = editor.getOverlayClips()
  const cam = editor.getCamera()
  const editingId = editor.getEditingShapeId()
  return (
    <div
      className="mocanvas-overlay"
      style={{
        ...layerStyle,
        pointerEvents: "none",
        transformOrigin: "0 0",
        transform: `scale(${cam.z}) translate(${cam.x}px, ${cam.y}px)`,
      }}
    >
      {ids.map((id, i) => {
        const shape = editor.getShape(id)
        if (!shape) return null
        return <OverlayShape key={id} editor={editor} shape={shape} isEditing={editingId === id} clip={clips[i]} />
      })}
    </div>
  )
})

const OverlayShape = track(function OverlayShape({
  editor,
  shape,
  isEditing,
  clip,
}: {
  editor: Editor
  shape: UnknownShape
  isEditing: boolean
  /** Page-space clip rect inherited from a clipping ancestor (a frame). */
  clip: ClipRect | undefined
}) {
  const util = editor.getShapeUtil(shape)
  const m = editor.getShapePageTransform(shape)
  const bounds = editor.getShapeGeometryBounds(shape)
  // The clip rect is page-space and the shape may be rotated, so it is applied
  // by an unrotated wrapper placed at the rect; the shape is offset back into it.
  const offset = clip ? `translate(${-clip[0]}px, ${-clip[1]}px) ` : ""
  const el = (
    <div
      className="mocanvas-shape"
      data-shape-id={shape.id}
      data-shape-type={shape.type}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: bounds?.w ?? 0,
        height: bounds?.h ?? 0,
        transformOrigin: "0 0",
        transform: `${offset}matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.e}, ${m.f})`,
        opacity: shape.opacity,
        pointerEvents: isEditing ? "auto" : "none",
      }}
    >
      {util.component(shape)}
      {util.getContentElement ? <ContentElementSlot editor={editor} shape={shape} /> : null}
    </div>
  )
  if (!clip) return el
  return (
    <div
      className="mocanvas-shape-clip"
      style={{
        position: "absolute",
        left: clip[0],
        top: clip[1],
        width: Math.max(0, clip[2] - clip[0]),
        height: Math.max(0, clip[3] - clip[1]),
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {el}
    </div>
  )
})

/**
 * Where a shape's {@link ShapeUtil.getContentElement} element is parked while
 * the shape is on screen.
 *
 * The element belongs to the editor, not to this component: mounting appends
 * it, unmounting only takes it out of the DOM. That asymmetry is the whole
 * feature — a cross-origin iframe that were removed *and destroyed* here would
 * reload, and re-authenticate, every time its shape scrolled out of view or
 * React re-rendered the layer.
 */
function ContentElementSlot({ editor, shape }: { editor: Editor; shape: UnknownShape }) {
  const slotRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const slot = slotRef.current
    if (!slot) return
    const element = editor.contentElements.get(shape)
    if (!element) return
    slot.appendChild(element)
    return () => {
      // Detach, do not release: the editor still owns it.
      if (element.parentNode === slot) slot.removeChild(element)
    }
    // Only the identity of the shape matters; the element is stable across edits.
  }, [editor, shape.id])

  return <div ref={slotRef} style={{ position: "absolute", inset: 0 }} />
}

const CURSORS: Record<string, string> = {
  default: "default",
  cross: "crosshair",
  grab: "grab",
  grabbing: "grabbing",
  move: "move",
  pointer: "pointer",
  text: "text",
}
function cssCursor(type: string): string {
  return CURSORS[type] ?? type
}

/**
 * The outline to draw over one shape: whatever its util's `indicator()`
 * returns, or a rectangle around the shape's geometry bounds when the util has
 * no indicator (or returns nothing). Both are expressed in *shape-local*
 * coordinates; the caller wraps them in the shape's page transform.
 *
 * Pure and exported so a custom `Indicators` component can reuse the same rule
 * instead of guessing at it.
 *
 * @deprecated The SVG indicator layer only draws utils still on the deprecated
 * `indicator()` hook. A util that implements `getIndicatorPath` is stroked on
 * the canvas overlay by `ShapeIndicatorCompositor` instead.
 */
export function getShapeIndicatorNode<T extends UnknownShape>(
  util: { indicator?(shape: T): ReactNode },
  shape: T,
  bounds: { x: number; y: number; w: number; h: number } | undefined,
): ReactNode {
  const own = util.indicator?.(shape)
  // `null`/`undefined`/`false` are the ways React spells "nothing here"; every
  // other node — including an empty fragment — is the util's own answer.
  if (own !== null && own !== undefined && own !== false) return own
  if (!bounds) return null
  return <rect x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h} />
}

/** Selection bounds and hover indicator. */
const DefaultIndicators = track(function DefaultIndicators({ editor }: { editor: Editor }) {
  const bounds = editor.getSelectionPageBounds()
  const hovered = editor.getHoveredShape()
  const selected = editor.getSelectedShapes()
  const cam = editor.getCamera()
  const z = cam.z
  const tool = editor.getCurrentToolId()
  const toScreen = (x: number, y: number) => [(x + cam.x) * z, (y + cam.y) * z] as const
  const items: ReactNode[] = []

  /*
   * One shape's outline, inside the camera transform and then the shape's own
   * page transform, so the util's shape-local indicator lands on the shape at
   * any pan, zoom or rotation.
   *
   * Paint is set on the group and inherited: an indicator is normally a bare
   * `<path>`/`<rect>`, and one that wants its own fill or dash just says so.
   * The stroke width is divided by the zoom because the group scales by it —
   * the quotient renders as a constant INDICATOR_STROKE CSS px, the same
   * hairline at 10% and at 800%, which is what makes an indicator readable at
   * all zooms. (`vector-effect="non-scaling-stroke"` would do the same for the
   * inherited width, but it would also silently reinterpret any width an
   * indicator sets for itself as screen px, breaking the promise that
   * everything inside the group is in shape-local units.)
   */
  const indicatorFor = (shape: UnknownShape, key: string, stroke: string) => {
    const util = editor.getShapeUtil(shape)
    // Ported utils are stroked on the canvas overlay; drawing them here as well
    // would double the stroke and undo the point of the move.
    if (getIndicatorSource(util) !== "react") return null
    const b = editor.getShapeGeometryBounds(shape)
    const node = getShapeIndicatorNode(util, shape, b)
    if (node === null) return null
    const m = editor.getShapePageTransform(shape)
    return (
      <g
        key={key}
        transform={`matrix(${z} 0 0 ${z} ${cam.x * z} ${cam.y * z}) matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`}
        fill="none"
        stroke={stroke}
        strokeWidth={INDICATOR_STROKE / z}
      >
        {node}
      </g>
    )
  }

  if (hovered && tool === "select" && !selected.some((s) => s.id === hovered.id)) {
    const ind = indicatorFor(hovered, "hover", SELECTION)
    if (ind) items.push(ind)
  }
  if (selected.length > 1) {
    for (const s of selected) {
      const ind = indicatorFor(s, `sel-${s.id}`, SELECTION)
      if (ind) items.push(ind)
    }
  }
  if (bounds && tool === "select") {
    const info = getSelectionHandlePositions(editor)
    const stroke = SELECTION
    if (selected.length === 1) {
      const shape = selected[0]!
      const util = editor.getShapeUtil(shape)
      const m = editor.getShapePageTransform(shape)
      if (!util.hideSelectionBoundsFg(shape)) {
        const ind = indicatorFor(shape, "bounds", stroke)
        if (ind) items.push(ind)
      }
      const handles = hasOverlay(editor, "shapeHandle") ? [] : (util.getHandles?.(shape) ?? [])
      for (const hd of handles) {
        const p = new Vec(m.a * hd.x + m.c * hd.y + m.e, m.b * hd.x + m.d * hd.y + m.f)
        // Viewport, not screen: the SVG layer is `inset: 0` inside the canvas
        // container, so its origin IS the container's. `pageToScreen` would add
        // the container's own position in the window on top.
        const sp = editor.pageToViewport(p)
        items.push(
          <circle
            key={`h-${hd.id}`}
            cx={sp.x}
            cy={sp.y}
            r={hd.type === "virtual" ? HANDLE.virtual : HANDLE.shape}
            fill={hd.type === "virtual" ? stroke : HANDLE_FILL}
            stroke={stroke}
            strokeWidth={INDICATOR_STROKE}
            opacity={hd.type === "virtual" ? 0.6 : 1}
          />,
        )
      }
    } else {
      const [x0, y0] = toScreen(bounds.x, bounds.y)
      const [x1, y1] = toScreen(bounds.maxX, bounds.maxY)
      items.push(<rect key="bounds" x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke={stroke} strokeWidth={INDICATOR_STROKE} />)
    }
    if (info && !hasOverlay(editor, "selectionForeground")) {
      for (const h of info.handles) {
        if (h.handle === "rotate") {
          items.push(<circle key="rotate" cx={h.point.x} cy={h.point.y} r={HANDLE.rotate} fill={HANDLE_FILL} stroke={stroke} strokeWidth={INDICATOR_STROKE} />)
        } else if (h.handle.includes("_")) {
          items.push(
            <rect
              key={h.handle}
              x={h.point.x - HANDLE.corner / 2}
              y={h.point.y - HANDLE.corner / 2}
              width={HANDLE.corner}
              height={HANDLE.corner}
              rx={2}
              fill={HANDLE_FILL}
              stroke={stroke}
              strokeWidth={INDICATOR_STROKE}
            />,
          )
        }
      }
    }
  }
  return <>{items}</>
})

const SnapLines = track(function SnapLines({ editor }: { editor: Editor }) {
  const lines = editor.snaps.getLines()
  if (lines.length === 0) return null
  return (
    <>
      {lines.map((l) => {
        // Container-relative, like every other coordinate on this SVG layer.
        const pts = l.points.map((p) => editor.pageToViewport(p))
        return (
          <g key={l.id}>
            <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={SNAP} strokeWidth={INDICATOR_STROKE} />
            {pts.map((p, i) => (
              <line key={i} x1={p.x - 4} y1={p.y - 4} x2={p.x + 4} y2={p.y + 4} stroke={SNAP} strokeWidth={INDICATOR_STROKE} />
            ))}
            {pts.map((p, i) => (
              <line key={`b${i}`} x1={p.x - 4} y1={p.y + 4} x2={p.x + 4} y2={p.y - 4} stroke={SNAP} strokeWidth={INDICATOR_STROKE} />
            ))}
          </g>
        )
      })}
    </>
  )
})

const DefaultBrush = track(function DefaultBrush({ editor }: { editor: Editor }) {
  const brush = editor.getInstanceState().brush
  if (!brush) return null
  const cam = editor.getCamera()
  const x = (brush.x + cam.x) * cam.z
  const y = (brush.y + cam.y) * cam.z
  return (
    <rect
      x={x}
      y={y}
      width={brush.w * cam.z}
      height={brush.h * cam.z}
      fill={BRUSH_FILL}
      stroke={SELECTION}
      strokeWidth={INDICATOR_STROKE}
    />
  )
})

/** Re-render on a signal value; convenience re-export for shape components. */
export { useValue }
