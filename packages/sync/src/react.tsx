import { track, useValue } from "@mocanvas/state/react"
import { useEditorComponents, type Editor, type EditorRecord, type InstancePresence, type UnknownShape } from "@mocanvas/editor"
import { useEffect, useRef, useState, type CSSProperties } from "react"
import { createSyncClient, type SyncClient, type SyncClientOptions, type SyncStatus } from "./SyncClient"
import type { Transport } from "./transport"

const layerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  pointerEvents: "none",
  overflow: "visible",
}

export interface CollaboratorCursorsProps {
  editor: Editor
  /** Draw what each collaborator has selected. Default `true`. */
  showSelection?: boolean
  /** Draw a name chip next to each cursor. Default `true`. */
  showNames?: boolean
}

/**
 * Other people's cursors and selections, drawn in screen space above the
 * canvas. Drop it inside `<Mocanvas>` or `<Canvas>`; it positions itself.
 *
 * The arrow below is the default. An app that supplies a
 * {@link TLEditorComponents.CollaboratorCursor} component gets that instead —
 * the slot was declared on two component maps and consulted by nothing, so an
 * app that replaced the cursor silently kept seeing ours.
 */
export const CollaboratorCursors = track(function CollaboratorCursors({
  editor,
  showSelection = true,
  showNames = true,
}: CollaboratorCursorsProps) {
  const components = useEditorComponents()
  const collaborators = editor.getCollaboratorsOnCurrentPage()
  if (collaborators.length === 0) return null
  // `null` is an app switching the cursors off, which is different from not
  // supplying one; `undefined` means "use ours".
  const Slot = components.CollaboratorCursor
  return (
    <>
      <svg className="mocanvas-collaborators" style={layerStyle}>
        {collaborators.map((presence) => (
          <g key={presence.id}>
            {showSelection ? <CollaboratorSelection editor={editor} presence={presence} /> : null}
            {Slot === undefined ? <CollaboratorCursor editor={editor} presence={presence} showName={showNames} /> : null}
          </g>
        ))}
      </svg>
      {/* A supplied slot is HTML, not SVG — `DefaultCursor` is a div — so it
          gets its own layer rather than being nested inside the <svg> above,
          where it would not render at all. */}
      {Slot ? (
        <div className="mocanvas-collaborator-cursors" style={layerStyle}>
          {collaborators.map((presence) =>
            presence.cursor === null ? null : (
              <Slot
                key={presence.id}
                type="default"
                rotation={presence.cursor.rotation}
                color={presence.color}
                name={showNames ? presence.userName || "Anonymous" : null}
                point={editor.pageToViewport(presence.cursor)}
              />
            ),
          )}
        </div>
      ) : null}
    </>
  )
})

const CollaboratorCursor = track(function CollaboratorCursor({
  editor,
  presence,
  showName,
}: {
  editor: Editor
  presence: InstancePresence
  showName: boolean
}) {
  // A collaborator with no pointer — an agent, or someone whose pointer has left
  // the canvas — draws no cursor at all.
  if (presence.cursor === null) return null
  // Viewport space: the overlay is positioned inside the canvas container, not
  // the window.
  const point = editor.pageToViewport(presence.cursor)
  const name = presence.userName || "Anonymous"
  // A 16x22 arrow drawn from the hotspot, then the name chip below it.
  return (
    <g transform={`translate(${point.x}, ${point.y}) rotate(${presence.cursor.rotation})`}>
      <path
        d="M0 0 L0 17.3 L4.3 13.4 L7 19.4 L9.9 18 L7.2 12.2 L12.8 12 Z"
        fill={presence.color}
        stroke="#fff"
        strokeWidth={1}
        strokeLinejoin="round"
      />
      {showName ? (
        <g transform="translate(11, 18)">
          <rect rx={4} ry={4} width={Math.max(24, name.length * 7 + 12)} height={18} fill={presence.color} />
          <text x={6} y={13} fontSize={11} fontFamily="system-ui, sans-serif" fill="#fff">
            {name}
          </text>
        </g>
      ) : null}
    </g>
  )
})

const CollaboratorSelection = track(function CollaboratorSelection({
  editor,
  presence,
}: {
  editor: Editor
  presence: InstancePresence
}) {
  const outlines: string[] = []
  for (const id of presence.selectedShapeIds) {
    const shape: UnknownShape | undefined = editor.getShape(id)
    if (!shape) continue
    const bounds = editor.getShapeGeometryBounds(shape)
    if (!bounds) continue
    const m = editor.getShapePageTransform(shape)
    // Transform the local corners to page space, then to screen space, so the
    // outline follows rotation without a nested SVG transform.
    const corners: [number, number][] = [
      [bounds.x, bounds.y],
      [bounds.maxX, bounds.y],
      [bounds.maxX, bounds.maxY],
      [bounds.x, bounds.maxY],
    ]
    const points = corners.map(([x, y]) => {
      // Viewport space, like the cursor above: this overlay lives in the canvas
      // container, so window offsets must not be added.
      const p = editor.pageToViewport({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f })
      return `${p.x},${p.y}`
    })
    outlines.push(points.join(" "))
  }
  if (outlines.length === 0) return null
  return (
    <>
      {outlines.map((points, i) => (
        <polygon key={i} points={points} fill="none" stroke={presence.color} strokeWidth={1.5} opacity={0.8} />
      ))}
    </>
  )
})

export interface UseSyncOptions {
  roomId: string
  /**
   * The channel to the room. Pass a factory when the transport should be
   * recreated with the room (the usual case); it is read once per connection.
   */
  transport: Transport | (() => Transport)
  /** Share this editor's cursor and selection. Default `true`. */
  presence?: boolean
  /** Set `false` to stay offline (a read-only view, say). Default `true`. */
  enabled?: boolean
  clientId?: string
  presenceTimeoutMs?: number
  presenceThrottleMs?: number
  onError?: (error: Error) => void
}

export interface UseSyncResult {
  status: SyncStatus
  client: SyncClient | null
}

/**
 * Connect an editor's store to a room for as long as the component is mounted.
 * Everything is torn down (including the transport) on unmount.
 */
export function useSync(editor: Editor | null, options: UseSyncOptions): UseSyncResult {
  const { roomId, enabled = true, presence = true } = options
  // Kept in a ref so that inline factories and callbacks do not reconnect.
  const latest = useRef(options)
  latest.current = options

  const [client, setClient] = useState<SyncClient | null>(null)

  useEffect(() => {
    if (!editor || !enabled) {
      setClient(null)
      return
    }
    const current = latest.current
    const transport = typeof current.transport === "function" ? current.transport() : current.transport
    const clientOptions: SyncClientOptions<EditorRecord> = {
      store: editor.store,
      roomId,
      transport: transport as Transport<EditorRecord>,
      ...(presence ? { presence: { editor } } : {}),
      ...(current.clientId !== undefined ? { clientId: current.clientId } : {}),
      ...(current.presenceTimeoutMs !== undefined ? { presenceTimeoutMs: current.presenceTimeoutMs } : {}),
      ...(current.presenceThrottleMs !== undefined ? { presenceThrottleMs: current.presenceThrottleMs } : {}),
      onError: (error: Error) => latest.current.onError?.(error),
    }
    const next = createSyncClient<EditorRecord>(clientOptions)
    setClient(next)
    next.connect()
    return () => {
      setClient(null)
      next.dispose()
    }
  }, [editor, roomId, enabled, presence])

  const status = useValue("sync.status", () => client?.getStatus().get() ?? "offline", [client])
  return { status, client }
}
