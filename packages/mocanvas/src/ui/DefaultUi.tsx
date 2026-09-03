import { track, useEditor, type Editor, type GeoShapeKind } from "@mocanvas/editor"
import type { CSSProperties } from "react"

const panel: CSSProperties = {
  position: "absolute",
  display: "flex",
  gap: 4,
  padding: 6,
  background: "var(--mocanvas-panel, #fff)",
  border: "1px solid var(--mocanvas-panel-border, #e5e7eb)",
  borderRadius: 10,
  boxShadow: "0 4px 16px rgba(0,0,0,.08)",
  fontFamily: "system-ui, sans-serif",
  fontSize: 13,
  pointerEvents: "auto",
  zIndex: 10,
}

const btn = (active: boolean): CSSProperties => ({
  minWidth: 34,
  height: 34,
  padding: "0 8px",
  borderRadius: 8,
  border: "none",
  cursor: "pointer",
  background: active ? "var(--mocanvas-selection, #3b82f6)" : "transparent",
  color: active ? "#fff" : "#111",
  fontWeight: 600,
})

interface ToolButton {
  id: string
  label: string
  title: string
  geo?: GeoShapeKind
}

const TOOLS: ToolButton[] = [
  { id: "select", label: "↖", title: "Select (V)" },
  { id: "hand", label: "✋", title: "Hand (H)" },
  { id: "draw", label: "✎", title: "Draw (D)" },
  { id: "eraser", label: "◫", title: "Eraser (E)" },
  { id: "geo", label: "▭", title: "Rectangle (R)", geo: "rectangle" },
  { id: "geo", label: "◯", title: "Ellipse (O)", geo: "ellipse" },
  { id: "geo", label: "△", title: "Triangle", geo: "triangle" },
  { id: "geo", label: "◇", title: "Diamond", geo: "diamond" },
  { id: "geo", label: "☆", title: "Star", geo: "star" },
  { id: "note", label: "▤", title: "Note (N)" },
]

/** Bottom toolbar. */
export const Toolbar = track(function Toolbar() {
  const editor = useEditor()
  const toolId = editor.getCurrentToolId()
  const geo = toolId === "geo" ? ((editor.getStateDescendant("geo") as { geo?: GeoShapeKind } | undefined)?.geo ?? "rectangle") : null
  return (
    <div style={{ ...panel, left: "50%", bottom: 12, transform: "translateX(-50%)" }} onPointerDown={(e) => e.stopPropagation()}>
      {TOOLS.map((t) => {
        const active = t.id === toolId && (t.geo === undefined || t.geo === geo)
        return (
          <button
            key={t.title}
            type="button"
            title={t.title}
            style={btn(active)}
            onClick={() => {
              if (t.geo) {
                editor.updateInstanceState({ stylesForNextShape: { ...editor.getInstanceState().stylesForNextShape, geo: t.geo } })
                editor.setCurrentTool("geo", { geo: t.geo, force: true })
              } else editor.setCurrentTool(t.id)
            }}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
})

/** Zoom controls and undo/redo. */
export const ZoomBar = track(function ZoomBar() {
  const editor = useEditor()
  const z = editor.getZoomLevel()
  return (
    <div style={{ ...panel, left: 12, bottom: 12 }} onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" style={btn(false)} title="Zoom out (⌘-)" onClick={() => editor.zoomOut()}>
        −
      </button>
      <button type="button" style={{ ...btn(false), minWidth: 56 }} title="Reset zoom (⌘0)" onClick={() => editor.resetZoom()}>
        {Math.round(z * 100)}%
      </button>
      <button type="button" style={btn(false)} title="Zoom in (⌘+)" onClick={() => editor.zoomIn()}>
        +
      </button>
      <button type="button" style={btn(false)} title="Zoom to fit (⌘1)" onClick={() => editor.zoomToFit()}>
        ⤢
      </button>
      <span style={{ width: 1, background: "#e5e7eb", margin: "4px 2px" }} />
      <button type="button" style={btn(false)} title="Undo (⌘Z)" disabled={!editor.getCanUndo()} onClick={() => editor.undo()}>
        ↶
      </button>
      <button type="button" style={btn(false)} title="Redo (⌘⇧Z)" disabled={!editor.getCanRedo()} onClick={() => editor.redo()}>
        ↷
      </button>
    </div>
  )
})

/** Frame statistics. */
export const DebugStats = track(function DebugStats({ editor }: { editor: Editor }) {
  const stats = editor.getLastFrameStats()
  const count = editor.getCurrentPageShapeIds().size
  return (
    <div style={{ ...panel, right: 12, top: 12, fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#374151", flexDirection: "column", gap: 2, padding: "6px 10px" }}>
      <span>shapes {count}</span>
      <span>drawn {stats.drawn} · culled {stats.culled}</span>
      <span>frame {stats.ms.toFixed(2)} ms</span>
      <span>engine {editor.engine.shapeCount}</span>
    </div>
  )
})

export function DefaultUi({ editor, showStats = true }: { editor: Editor; showStats?: boolean }) {
  return (
    <>
      <Toolbar />
      <ZoomBar />
      {showStats ? <DebugStats editor={editor} /> : null}
    </>
  )
}
