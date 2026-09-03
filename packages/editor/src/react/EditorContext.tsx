import { createContext, useContext } from "react"
import type { Editor } from "../editor/Editor"

export const EditorContext = createContext<Editor | null>(null)

/** The editor of the nearest `<EditorProvider>` / `<Canvas>`. */
export function useEditor(): Editor {
  const editor = useContext(EditorContext)
  if (!editor) throw new Error("useEditor must be used inside a mocanvas <Canvas> or <EditorProvider>")
  return editor
}

export function useMaybeEditor(): Editor | null {
  return useContext(EditorContext)
}

export const EditorProvider = EditorContext.Provider
