import { useEffect } from "react"
import { atom } from "@mocanvas/state"
import type { Editor } from "@mocanvas/editor"

/** Whether the frame-statistics chip is visible. Toggled with ⌥D. */
export const debugStatsOpen = atom("debugStatsOpen", false)

function isEditable(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
}

let clipboardFallback = ""

/** The sections the shortcuts dialog groups its rows under. */
export type TLKeyboardShortcutGroup = "Edit" | "View" | "Arrange" | "Canvas"

/** One binding this hook installs. */
export interface TLKeyboardShortcut {
  /** Stable id; also what the dialog keys its rows on. */
  id: string
  /** Display text for the dialog. */
  label: string
  /** The binding, in the `"mod+shift+z"` notation {@link TldrawUiKbd} renders. */
  kbd: string
  /** Further bindings that do the same thing; not shown. */
  also?: readonly string[]
  group: TLKeyboardShortcutGroup
  /**
   * Do the thing. Returning `false` means "not handled after all" — the event
   * keeps its default, which is what lets ⌘C fall through to the browser's own
   * copy when there is no selection to take.
   */
  run(editor: Editor, event: KeyboardEvent): void | false
}

/**
 * Every shortcut the editor binds, as data.
 *
 * This list *is* the binding: the handler below dispatches through it and the
 * keyboard-shortcuts dialog renders from it, so the sheet cannot describe a
 * key the editor does not answer to, and a key added here appears in the sheet
 * without anyone remembering to write it down. The previous arrangement — a
 * switch statement here and a separate list in the dialog — is exactly the
 * shape that drifts.
 *
 * Tool switches are *not* here. They come from the UI tool list, because that
 * is the list an app's `TLUiOverrides.tools` can rewrite; `useToolShortcuts`
 * binds them and the dialog reads the same list.
 */
export const KEYBOARD_SHORTCUTS: readonly TLKeyboardShortcut[] = [
  // ---- edit ---------------------------------------------------------------
  { id: "undo", label: "Undo", kbd: "mod+z", group: "Edit", run: (editor) => void editor.undo() },
  { id: "redo", label: "Redo", kbd: "mod+shift+z", also: ["mod+y"], group: "Edit", run: (editor) => void editor.redo() },
  { id: "select-all", label: "Select all", kbd: "mod+a", group: "Edit", run: (editor) => void editor.selectAll() },
  {
    id: "duplicate",
    label: "Duplicate",
    kbd: "mod+d",
    group: "Edit",
    run: (editor) => {
      const ids = editor.getSelectedShapeIds()
      if (ids.length === 0) return
      editor.markHistoryStoppingPoint("duplicate")
      editor.setSelectedShapes(editor.duplicateShapes(ids))
    },
  },
  {
    id: "copy",
    label: "Copy",
    kbd: "mod+c",
    group: "Edit",
    run: (editor) => (writeSelectionToClipboard(editor) ? undefined : false),
  },
  {
    id: "cut",
    label: "Cut",
    kbd: "mod+x",
    group: "Edit",
    run: (editor) => {
      if (!writeSelectionToClipboard(editor)) return false
      editor.markHistoryStoppingPoint("cut")
      editor.deleteShapes(editor.getSelectedShapeIds())
      return undefined
    },
  },
  {
    id: "paste",
    label: "Paste",
    kbd: "mod+v",
    group: "Edit",
    run: (editor) => {
      const paste = (text: string) => {
        try {
          const data = JSON.parse(text) as { type?: string; shapes?: unknown[]; bindings?: unknown[] }
          if (data.type !== "application/mocanvas" || !Array.isArray(data.shapes)) return
          editor.markHistoryStoppingPoint("paste")
          editor.putContentOntoCurrentPage(data as never, { point: editor.getViewportPageCenter() })
        } catch {
          // not our content
        }
      }
      if (navigator.clipboard?.readText) navigator.clipboard.readText().then(paste, () => clipboardFallback && paste(clipboardFallback))
      else if (clipboardFallback) paste(clipboardFallback)
    },
  },

  // ---- arrange ------------------------------------------------------------
  {
    id: "group",
    label: "Group",
    kbd: "mod+g",
    group: "Arrange",
    run: (editor) => {
      const ids = editor.getSelectedShapeIds()
      if (ids.length === 0) return
      editor.markHistoryStoppingPoint("group")
      editor.groupShapes(ids)
    },
  },
  {
    id: "ungroup",
    label: "Ungroup",
    kbd: "mod+shift+g",
    group: "Arrange",
    run: (editor) => {
      const ids = editor.getSelectedShapeIds()
      if (ids.length === 0) return
      editor.markHistoryStoppingPoint("ungroup")
      editor.ungroupShapes(ids)
    },
  },
  {
    id: "toggle-lock",
    label: "Lock or unlock",
    kbd: "mod+shift+l",
    group: "Arrange",
    run: (editor) => {
      editor.markHistoryStoppingPoint("lock")
      editor.toggleLock()
    },
  },
  { id: "bring-forward", label: "Bring forward", kbd: "mod+]", group: "Arrange", run: (editor) => void editor.bringForward() },
  { id: "bring-to-front", label: "Bring to front", kbd: "mod+alt+]", group: "Arrange", run: (editor) => void editor.bringToFront() },
  { id: "send-backward", label: "Send backward", kbd: "mod+[", group: "Arrange", run: (editor) => void editor.sendBackward() },
  { id: "send-to-back", label: "Send to back", kbd: "mod+alt+[", group: "Arrange", run: (editor) => void editor.sendToBack() },

  // ---- view ---------------------------------------------------------------
  { id: "zoom-in", label: "Zoom in", kbd: "mod+=", also: ["mod++", "mod+shift+="], group: "View", run: (editor) => void editor.zoomIn() },
  { id: "zoom-out", label: "Zoom out", kbd: "mod+-", group: "View", run: (editor) => void editor.zoomOut() },
  { id: "reset-zoom", label: "Reset zoom", kbd: "mod+0", group: "View", run: (editor) => void editor.resetZoom() },
  { id: "zoom-to-fit", label: "Zoom to fit", kbd: "mod+1", group: "View", run: (editor) => void editor.zoomToFit() },
  { id: "zoom-to-selection", label: "Zoom to selection", kbd: "mod+2", group: "View", run: (editor) => void editor.zoomToSelection() },
  {
    id: "toggle-grid",
    label: "Show grid",
    kbd: "mod+'",
    group: "View",
    run: (editor) => void editor.updateInstanceState({ isGridMode: !editor.getInstanceState().isGridMode }),
  },
  {
    id: "toggle-focus-mode",
    label: "Focus mode",
    kbd: "mod+.",
    group: "View",
    run: (editor) => void editor.updateInstanceState({ isFocusMode: !editor.getInstanceState().isFocusMode }),
  },
  {
    id: "toggle-debug-stats",
    label: "Frame statistics",
    // Not ⌥D: that belongs to Align right, which the Arrange menu advertises
    // and which is one of a coherent ⌥A/H/D/W/V/S set — breaking the set so
    // one of its members opens a developer overlay is the wrong trade. The
    // overlay takes the accelerator-plus-⌥ spelling instead.
    kbd: "mod+alt+d",
    group: "View",
    run: () => void debugStatsOpen.set(!debugStatsOpen.get()),
  },

  // ---- canvas -------------------------------------------------------------
  {
    id: "toggle-tool-lock",
    label: "Tool lock",
    kbd: "q",
    group: "Canvas",
    run: (editor) => void editor.updateInstanceState({ isToolLocked: !editor.getInstanceState().isToolLocked }),
  },
]

/** Put the selection on the clipboard. `false` when there was nothing to put. */
function writeSelectionToClipboard(editor: Editor): boolean {
  const ids = editor.getSelectedShapeIds()
  if (ids.length === 0) return false
  const content = editor.getContentFromCurrentPage(ids)
  if (!content) return false
  const text = JSON.stringify({ type: "application/mocanvas", ...content })
  navigator.clipboard?.writeText(text).catch(() => {})
  clipboardFallback = text
  return true
}

/**
 * The names a key press can be looked up under.
 *
 * Both `key` and the physical `code` are offered, because on macOS a key held
 * with Alt reports the character it *produces* — ⌥D is `"∂"` — and a binding
 * written as `alt+d` would never match it.
 */
function pressedKeyNames(event: KeyboardEvent): string[] {
  const names: string[] = []
  const key = event.key.toLowerCase()
  if (key) names.push(key)
  const code = event.code
  const fromCode = /^Key[A-Z]$/.test(code)
    ? code.slice(3).toLowerCase()
    : /^Digit[0-9]$/.test(code)
      ? code.slice(5)
      : PUNCTUATION_CODES[code]
  if (fromCode && !names.includes(fromCode)) names.push(fromCode)
  return names
}

const PUNCTUATION_CODES: Record<string, string> = {
  Equal: "=",
  Minus: "-",
  BracketLeft: "[",
  BracketRight: "]",
  Quote: "'",
  Period: ".",
  Comma: ",",
  Slash: "/",
  Semicolon: ";",
  Backslash: "\\",
}

/** `"mod+alt+shift+key"`, with the modifiers in a fixed order. */
function bindingString(mod: boolean, alt: boolean, shift: boolean, key: string): string {
  return `${mod ? "mod+" : ""}${alt ? "alt+" : ""}${shift ? "shift+" : ""}${key}`
}

/** Normalize an authored binding into the same shape {@link bindingString} makes. */
export function normalizeKbd(kbd: string): string {
  const parts = kbd
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
  // A trailing "+" is the key itself (`mod++`), which the split above ate.
  const key = kbd.trim().endsWith("+") ? "+" : (parts.pop() ?? "")
  const set = new Set(parts)
  return bindingString(set.has("mod") || set.has("cmd") || set.has("ctrl"), set.has("alt") || set.has("opt"), set.has("shift"), key)
}

/**
 * Every binding a press could mean, in the same normalized shape
 * {@link normalizeKbd} produces.
 *
 * Exported so the action list's bindings are matched by exactly the same rules
 * as this table's — the mac accelerator split and the `key`/`code` pair are
 * both easy to get subtly wrong a second time.
 */
export function pressedBindings(e: KeyboardEvent): string[] {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform ?? "")
  // A press carrying the *other* accelerator is not ours: ⌃C on a Mac belongs
  // to the terminal-ish bindings, not to copy.
  if (isMac ? e.ctrlKey : e.metaKey) return []
  const mod = isMac ? e.metaKey : e.ctrlKey
  return pressedKeyNames(e).map((name) => bindingString(mod, e.altKey, e.shiftKey, name))
}

/** Every binding in the table, indexed by its normalized form. */
export function buildShortcutIndex(shortcuts: readonly TLKeyboardShortcut[] = KEYBOARD_SHORTCUTS): Map<string, TLKeyboardShortcut> {
  const index = new Map<string, TLKeyboardShortcut>()
  for (const shortcut of shortcuts) {
    for (const binding of [shortcut.kbd, ...(shortcut.also ?? [])]) {
      const normalized = normalizeKbd(binding)
      if (!index.has(normalized)) index.set(normalized, shortcut)
    }
  }
  return index
}

export interface KeyboardShortcutOptions {
  /**
   * Bind the plain-key tool switches (`v`, `h`, `n`, …). Leave it on for an
   * editor with no chrome; turn it OFF whenever the chrome is mounted, because
   * the UI tool list binds those keys itself — and it is the list an app's
   * `TLUiOverrides.tools` can rewrite, so a binding hard-coded here would
   * survive an override that meant to remove it. Defaults to `true`.
   */
  tools?: boolean
}

/** The tool switches bound only when the chrome is not doing it. */
const TOOL_KEYS: Record<string, { tool: string; geo?: string; optional?: boolean }> = {
  v: { tool: "select" },
  h: { tool: "hand" },
  r: { tool: "geo", geo: "rectangle" },
  o: { tool: "geo", geo: "ellipse" },
  d: { tool: "draw" },
  p: { tool: "draw" },
  b: { tool: "draw" },
  e: { tool: "eraser" },
  n: { tool: "note" },
  t: { tool: "text" },
  a: { tool: "arrow", optional: true },
  l: { tool: "line", optional: true },
  f: { tool: "frame", optional: true },
}

/** Default keyboard shortcuts: {@link KEYBOARD_SHORTCUTS}, plus tool switching. */
export function useKeyboardShortcuts(editor: Editor | null, options: KeyboardShortcutOptions = {}): void {
  const bindTools = options.tools ?? true
  useEffect(() => {
    if (!editor) return
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform ?? "")
    const index = buildShortcutIndex()

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return
      if (editor.getEditingShapeId()) return
      const mod = isMac ? e.metaKey : e.ctrlKey
      // A press that carries the *other* accelerator is not ours: ⌃C on a Mac
      // belongs to the terminal-ish bindings, not to copy.
      if (isMac ? e.ctrlKey : e.metaKey) return

      for (const name of pressedKeyNames(e)) {
        const shortcut = index.get(bindingString(mod, e.altKey, e.shiftKey, name))
        if (!shortcut) continue
        if (shortcut.run(editor, e) !== false) e.preventDefault()
        return
      }

      if (mod || e.altKey || !bindTools) return
      const tool = TOOL_KEYS[e.key.toLowerCase()]
      if (!tool) return
      if (tool.optional && !editor.root.children?.[tool.tool]) return
      editor.setCurrentTool(tool.tool, tool.geo ? { geo: tool.geo } : undefined)
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [editor, bindTools])
}
