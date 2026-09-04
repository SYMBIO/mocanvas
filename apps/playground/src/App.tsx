import { createShapeId, downloadBlob, exportToBlob, loadMocanvasFile, Mocanvas, serializeMocanvasFile, type Editor, type GeoShape, type GeoShapeKind, type ShapeCreate } from "@mocanvas/mocanvas"
import { CollaboratorCursors, createBroadcastChannelTransport, useSync } from "@mocanvas/sync"
import { useCallback, useRef, useState } from "react"

const COLORS = ["black", "grey", "light-violet", "violet", "blue", "light-blue", "yellow", "orange", "green", "light-green", "light-red", "red"] as const
const GEOS: GeoShapeKind[] = ["rectangle", "ellipse", "triangle", "diamond", "hexagon", "star"]

function stress(editor: Editor, n: number) {
  const cols = Math.ceil(Math.sqrt(n))
  const shapes: ShapeCreate<GeoShape>[] = []
  for (let i = 0; i < n; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    shapes.push({
      id: createShapeId(),
      type: "geo" as const,
      x: col * 140,
      y: row * 140,
      rotation: ((i * 37) % 360) * (Math.PI / 180) * (i % 3 === 0 ? 1 : 0),
      props: {
        geo: GEOS[i % GEOS.length]!,
        w: 60 + (i % 5) * 12,
        h: 60 + (i % 7) * 8,
        color: COLORS[i % COLORS.length]!,
        fill: i % 4 === 0 ? ("solid" as const) : i % 4 === 1 ? ("semi" as const) : ("none" as const),
      },
    })
  }
  const t0 = performance.now()
  editor.run(() => {
    editor.createShapes(shapes)
  })
  const t1 = performance.now()
  editor.zoomToFit()
  return t1 - t0
}

const ROOM_ID = new URLSearchParams(location.search).get("room") ?? "playground"

export function App() {
  const editorRef = useRef<Editor | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [msg, setMsg] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)
  // Same-origin tabs share a room over a BroadcastChannel; open a second tab to try it.
  const transport = useCallback(() => createBroadcastChannelTransport(ROOM_ID), [])
  const { status } = useSync(editor, { roomId: ROOM_ID, transport })

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Mocanvas
        onMount={(editor) => {
          editorRef.current = editor
          setEditor(editor)
          ;(window as unknown as { editor: Editor }).editor = editor
          if (editor.getCurrentPageShapeIds().size === 0) {
            editor.createShapes([
              { type: "geo", x: 100, y: 100, props: { geo: "rectangle", w: 200, h: 120, color: "blue", fill: "semi", text: "" } },
              { type: "geo", x: 380, y: 140, props: { geo: "ellipse", w: 160, h: 160, color: "red", fill: "solid" } },
              { type: "geo", x: 620, y: 100, props: { geo: "star", w: 140, h: 140, color: "yellow", fill: "semi" } },
              { type: "note", x: 120, y: 320, props: { text: "Hello mocanvas" } },
              { type: "arrow", x: 320, y: 300, props: { start: { x: 0, y: 0 }, end: { x: 260, y: 60 }, bend: 40, color: "green" } },
            ])
            editor.history.clear()
          }
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            display: "flex",
            gap: 6,
            zIndex: 10,
            fontFamily: "system-ui",
            fontSize: 12,
            alignItems: "center",
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <strong style={{ marginRight: 8 }}>mocanvas</strong>
          {[1000, 10000, 50000].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                const ed = editorRef.current
                if (!ed) return
                const ms = stress(ed, n)
                setMsg(`created ${n} shapes in ${ms.toFixed(0)} ms`)
              }}
            >
              +{n.toLocaleString()} shapes
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              const ed = editorRef.current
              if (!ed) return
              ed.selectAll()
              ed.deleteShapes(ed.getSelectedShapeIds())
            }}
          >
            clear
          </button>
          <button
            type="button"
            onClick={() => {
              const ed = editorRef.current
              if (!ed) return
              const text = serializeMocanvasFile(ed)
              const blob = new Blob([text], { type: "application/json" })
              const a = document.createElement("a")
              a.href = URL.createObjectURL(blob)
              a.download = "drawing.tldr"
              a.click()
              URL.revokeObjectURL(a.href)
            }}
          >
            save .tldr
          </button>
          <button type="button" onClick={() => fileRef.current?.click()}>
            open .tldr
          </button>
          {(["svg", "png"] as const).map((format) => (
            <button
              key={format}
              type="button"
              onClick={async () => {
                const ed = editorRef.current
                if (!ed) return
                try {
                  const blob = await exportToBlob(ed, { format, background: true })
                  downloadBlob(blob, `mocanvas.${format}`)
                  setMsg(`exported ${format} (${(blob.size / 1024).toFixed(0)} kB)`)
                } catch (err) {
                  setMsg(`export failed: ${String(err)}`)
                }
              }}
            >
              export {format}
            </button>
          ))}
          <button
            type="button"
            onClick={async () => {
              const ed = editorRef.current
              if (!ed) return
              const text = await (await fetch("/sample.tldr")).text()
              const res = loadMocanvasFile(ed, text)
              setMsg(res.ok ? `loaded sample (${res.records.length} records)` : `load failed: ${res.error}`)
            }}
          >
            load sample
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".tldr,application/json"
            style={{ display: "none" }}
            onChange={async (e) => {
              const ed = editorRef.current
              const file = e.target.files?.[0]
              if (!ed || !file) return
              const res = loadMocanvasFile(ed, await file.text())
              setMsg(res.ok ? `loaded ${res.records.length} records` : `load failed: ${res.error}`)
              e.target.value = ""
            }}
          />
          <span style={{ color: "#6b7280" }}>{msg}</span>
          <span
            title={`Collaboration room "${ROOM_ID}" — open this page in a second tab to see the other cursor`}
            style={{ color: status === "online" ? "#059669" : "#9ca3af" }}
          >
            ● {status}
          </span>
        </div>
        {editor ? <CollaboratorCursors editor={editor} /> : null}
      </Mocanvas>
    </div>
  )
}
