import {
  Canvas,
  createStore,
  Editor,
  loadEngine,
  type CanvasProps,
  type EditorStore,
  type ShapeUtilConstructor,
  type StateNodeConstructor,
} from "@mocanvas/editor"
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { defaultShapeUtils } from "./shapes"
import { defaultTools } from "./tools"
import { DefaultUi } from "./ui/DefaultUi"
import { useKeyboardShortcuts } from "./ui/useKeyboardShortcuts"

export interface MocanvasProps {
  /** Reuse a store (e.g. for persistence or collaboration). */
  store?: EditorStore
  /** Extra shape utils beyond the defaults. */
  shapeUtils?: readonly ShapeUtilConstructor[]
  /** Extra tools beyond the defaults. */
  tools?: readonly StateNodeConstructor[]
  initialState?: string
  onMount?: (editor: Editor) => void | (() => void)
  /** Hide the default toolbar and zoom bar. */
  hideUi?: boolean
  showStats?: boolean
  className?: string
  style?: CSSProperties
  children?: ReactNode
  components?: CanvasProps["components"]
  /** Editor config overrides. */
  options?: ConstructorParameters<typeof Editor>[0]["options"]
}

/** Batteries-included canvas: default shapes, tools, shortcuts and UI. */
export function Mocanvas(props: MocanvasProps) {
  const { store, shapeUtils, tools, initialState, onMount, hideUi, showStats, className, style, children, components, options } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const [editor, setEditor] = useState<Editor | null>(null)

  useEffect(() => {
    let disposed = false
    let ed: Editor | null = null
    let cleanup: void | (() => void)
    loadEngine().then((engine) => {
      if (disposed) {
        engine.dispose()
        return
      }
      ed = new Editor({
        store: store ?? createStore(),
        shapeUtils: [...defaultShapeUtils, ...(shapeUtils ?? [])],
        tools: [...defaultTools, ...(tools ?? [])],
        engine,
        ...(initialState ? { initialState } : {}),
        getContainer: () => containerRef.current!,
        ...(options ? { options } : {}),
      })
      setEditor(ed)
      cleanup = onMount?.(ed)
      ed.emit("mount")
    })
    return () => {
      disposed = true
      cleanup?.()
      ed?.dispose()
      setEditor(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  useKeyboardShortcuts(editor)

  return (
    <div ref={containerRef} className={className} style={{ position: "relative", width: "100%", height: "100%", ...style }}>
      {editor ? (
        <Canvas editor={editor} {...(components ? { components } : {})}>
          {hideUi ? null : <DefaultUi editor={editor} showStats={showStats ?? true} />}
          {children}
        </Canvas>
      ) : (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#9ca3af", fontFamily: "system-ui" }}>loading engine…</div>
      )}
    </div>
  )
}
