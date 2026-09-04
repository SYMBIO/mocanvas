import { react as reactSignal } from "@mocanvas/state"
import { track, useValue } from "@mocanvas/state/react"
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import type { ClipRect } from "@mocanvas/wasm"
import type { Editor } from "../editor/Editor"
import type { RenderBackend } from "../render/backend"
import { createBackend } from "../render/webgl2"
import type { UnknownShape } from "../records/base"
import { Vec } from "../geometry"
import { EditorProvider } from "./EditorContext"
import { useCanvasEvents } from "./useCanvasEvents"
import { getSelectionHandlePositions } from "../editor/selectionHandles"

export interface CanvasProps {
  editor: Editor
  className?: string
  style?: CSSProperties
  /** Extra layers rendered above the canvas (UI, menus). */
  children?: ReactNode
  /** Override the default selection/brush indicators. */
  components?: Partial<CanvasComponents>
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

/**
 * The canvas: a WebGL2 surface driven by the engine, a DOM overlay for shapes
 * that render through `ShapeUtil.component`, and an SVG layer for indicators.
 */
export function Canvas({ editor, className, style, children, components }: CanvasProps) {
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
      editor.renderFrame(backend)
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
  const Indicators = components?.Indicators ?? DefaultIndicators
  const Brush = components?.Brush ?? DefaultBrush
  const Background = components?.Background

  return (
    <EditorProvider value={editor}>
      <div
        ref={containerRef}
        className={className ? `mocanvas ${className}` : "mocanvas"}
        style={{ ...containerStyle, ...style, cursor }}
        tabIndex={0}
        onPointerDown={events.onPointerDown}
        onPointerMove={events.onPointerMove}
        onPointerUp={events.onPointerUp}
        onPointerCancel={events.onPointerCancel}
        onContextMenu={events.onContextMenu}
        data-testid="mocanvas-container"
      >
        {Background ? <Background editor={editor} /> : null}
        <canvas ref={canvasRef} style={{ ...layerStyle, display: "block" }} />
        <OverlayLayer editor={editor} />
        <svg style={{ ...layerStyle, pointerEvents: "none", overflow: "visible" }}>
          <Indicators editor={editor} />
          <SnapLines editor={editor} />
          <Brush editor={editor} />
        </svg>
        {children}
      </div>
    </EditorProvider>
  )
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

  const indicatorFor = (shape: UnknownShape, key: string, stroke: string) => {
    const b = editor.getShapeGeometryBounds(shape)
    if (!b) return null
    const m = editor.getShapePageTransform(shape)
    return (
      <g key={key} transform={`matrix(${z} 0 0 ${z} ${cam.x * z} ${cam.y * z}) matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`}>
        <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke={stroke} strokeWidth={1.5 / z} />
      </g>
    )
  }

  if (hovered && tool === "select" && !selected.some((s) => s.id === hovered.id)) {
    const ind = indicatorFor(hovered, "hover", "var(--mocanvas-selection, #3b82f6)")
    if (ind) items.push(ind)
  }
  if (selected.length > 1) {
    for (const s of selected) {
      const ind = indicatorFor(s, `sel-${s.id}`, "var(--mocanvas-selection, #3b82f6)")
      if (ind) items.push(ind)
    }
  }
  if (bounds && tool === "select") {
    const info = getSelectionHandlePositions(editor)
    const stroke = "var(--mocanvas-selection, #3b82f6)"
    if (selected.length === 1) {
      const shape = selected[0]!
      const util = editor.getShapeUtil(shape)
      const b = editor.getShapeGeometryBounds(shape)!
      const m = editor.getShapePageTransform(shape)
      if (!util.hideSelectionBoundsFg(shape)) {
        items.push(
          <g key="bounds" transform={`matrix(${z} 0 0 ${z} ${cam.x * z} ${cam.y * z}) matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke={stroke} strokeWidth={1.5 / z} />
          </g>,
        )
      }
      const handles = util.getHandles?.(shape) ?? []
      for (const hd of handles) {
        const p = new Vec(m.a * hd.x + m.c * hd.y + m.e, m.b * hd.x + m.d * hd.y + m.f)
        const sp = editor.pageToScreen(p)
        items.push(
          <circle key={`h-${hd.id}`} cx={sp.x} cy={sp.y} r={hd.type === "virtual" ? 4 : 6} fill={hd.type === "virtual" ? stroke : "#fff"} stroke={stroke} strokeWidth={1.5} opacity={hd.type === "virtual" ? 0.6 : 1} />,
        )
      }
    } else {
      const [x0, y0] = toScreen(bounds.x, bounds.y)
      const [x1, y1] = toScreen(bounds.maxX, bounds.maxY)
      items.push(<rect key="bounds" x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke={stroke} strokeWidth={1.5} />)
    }
    if (info) {
      for (const h of info.handles) {
        if (h.handle === "rotate") {
          items.push(<circle key="rotate" cx={h.point.x} cy={h.point.y} r={5} fill="#fff" stroke={stroke} strokeWidth={1.5} />)
        } else if (h.handle.includes("_")) {
          items.push(<rect key={h.handle} x={h.point.x - 4} y={h.point.y - 4} width={8} height={8} fill="#fff" stroke={stroke} strokeWidth={1.5} />)
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
        const pts = l.points.map((p) => editor.pageToScreen(p))
        return (
          <g key={l.id}>
            <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--mocanvas-snap, #e879f9)" strokeWidth={1} />
            {pts.map((p, i) => (
              <line key={i} x1={p.x - 4} y1={p.y - 4} x2={p.x + 4} y2={p.y + 4} stroke="var(--mocanvas-snap, #e879f9)" strokeWidth={1} />
            ))}
            {pts.map((p, i) => (
              <line key={`b${i}`} x1={p.x - 4} y1={p.y + 4} x2={p.x + 4} y2={p.y - 4} stroke="var(--mocanvas-snap, #e879f9)" strokeWidth={1} />
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
      fill="var(--mocanvas-brush-fill, rgba(59,130,246,0.1))"
      stroke="var(--mocanvas-selection, #3b82f6)"
      strokeWidth={1}
    />
  )
})

/** Re-render on a signal value; convenience re-export for shape components. */
export { useValue }
