import { useEditor, useTools, type TLUiToolsContextType } from "@mocanvas/editor"
import { useEffect, useRef } from "react"

/**
 * Bind the keyboard shortcuts declared by the UI tool list.
 *
 * This is what makes `TLUiOverrides.tools` mean something: a tool's `kbd`
 * lives on its UI item, so an app that rebinds `s` to the note tool, or that
 * registers a tool of its own with a `c`, does it by rewriting that list —
 * not by patching a switch statement inside mocanvas.
 *
 * Only plain single-key bindings are handled here. Anything with a modifier
 * (`mod+z`) belongs to the action shortcuts, which `useKeyboardShortcuts`
 * owns; binding it in both places would fire it twice.
 */
function isEditable(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
}

/** `{ key: toolId }` for every plain single-key binding in the list. */
export function toolKeyMap(tools: TLUiToolsContextType, isReadonly: boolean): Map<string, string> {
  const map = new Map<string, string>()
  for (const tool of Object.values(tools)) {
    if (tool.disabled) continue
    if (isReadonly && !tool.readonlyOk) continue
    if (!tool.kbd) continue
    for (const raw of tool.kbd.split(",")) {
      const key = raw.trim().toLowerCase()
      if (key === "" || key.includes("+")) continue
      // First declaration wins, so a later item cannot silently steal a key
      // an earlier one already answers to.
      if (!map.has(key)) map.set(key, tool.id)
    }
  }
  return map
}

/** Binds the tool list's shortcuts for as long as the calling component is mounted. */
export function useToolShortcuts(): void {
  const editor = useEditor()
  const tools = useTools()
  const toolsRef = useRef(tools)
  toolsRef.current = tools

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isEditable(e.target)) return
      if (editor.getEditingShapeId()) return
      const map = toolKeyMap(toolsRef.current, editor.getInstanceState().isReadonly)
      const id = map.get(e.key.toLowerCase())
      if (id === undefined) return
      const tool = toolsRef.current[id]
      if (!tool) return
      e.preventDefault()
      tool.onSelect("kbd")
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [editor])
}

/** Component form, so the hook can be mounted from inside the UI provider. */
export function ToolShortcuts() {
  useToolShortcuts()
  return null
}
