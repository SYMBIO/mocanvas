import { createContext, useContext, type ReactNode } from "react"
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

/** Props of {@link EditorProvider}. */
export interface EditorProviderProps {
  /** The editor every `useEditor()` below this point resolves to. */
  editor: Editor
  children?: ReactNode
}

/**
 * Publishes an editor to the React tree.
 *
 * Takes the editor as `editor` rather than a context provider's `value`, so a
 * test — or an app rendering chrome outside `<Canvas>` — writes
 * `<EditorProvider editor={editor}>` and never has to know that a context is
 * what is underneath. {@link EditorContext} is still exported for the rare
 * caller that wants the raw provider (to publish `null`, say).
 */
export function EditorProvider({ editor, children }: EditorProviderProps) {
  return <EditorContext.Provider value={editor}>{children}</EditorContext.Provider>
}
