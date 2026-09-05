import { useEditor, useValue } from "@mocanvas/editor"
import { useCallback, useEffect, useState } from "react"

/**
 * The small hooks the chrome reaches for that do not belong to any one panel.
 */

/**
 * A value kept in `localStorage`, as React state.
 *
 * Every access is guarded: `localStorage` throws outright in a sandboxed
 * iframe and in a browser configured to block site data, and a panel that
 * remembers whether a section was collapsed must not be the thing that takes
 * the editor down.
 */
export function useLocalStorageState<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = globalThis.localStorage?.getItem(key)
      return stored === null || stored === undefined ? defaultValue : (JSON.parse(stored) as T)
    } catch {
      return defaultValue
    }
  })

  const set = useCallback(
    (next: T) => {
      setValue(next)
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(next))
      } catch {
        // Storage unavailable. The value still lives for this session.
      }
    },
    [key],
  )

  return [value, set]
}

/**
 * Whether a menu is open, tracked on the editor's instance state.
 *
 * Menu open-ness lives on the editor rather than in component state because
 * the *canvas* needs to know: a canvas that keeps interpreting pointer moves
 * while a menu is over it fights the menu.
 */
export function useMenuIsOpen(id: string): [boolean, (open: boolean) => void] {
  const editor = useEditor()
  const isOpen = useValue("menuIsOpen", () => editor.menus.isMenuOpen(id), [editor, id])
  const setIsOpen = useCallback(
    (open: boolean) => {
      if (open) editor.menus.addOpenMenu(id)
      else editor.menus.removeOpenMenu(id)
    },
    [editor, id],
  )
  // A menu torn down while open would otherwise leave the canvas suppressed.
  useEffect(() => () => void editor.menus.removeOpenMenu(id), [editor, id])
  return [isOpen, setIsOpen]
}

/** Whether any menu at all is open. */
export function useAnyMenuIsOpen(): boolean {
  const editor = useEditor()
  return useValue("anyMenuIsOpen", () => editor.menus.getOpenMenus().length > 0, [editor])
}

/**
 * Shorten a string with an ellipsis, on a grapheme boundary.
 *
 * Cutting on a code unit splits surrogate pairs and combining marks, which
 * turns a page name into a replacement character.
 */
export function truncateStringWithEllipsis(value: string, max: number): string {
  if (value.length <= max) return value
  const graphemes = Array.from(value)
  if (graphemes.length <= max) return value
  return `${graphemes.slice(0, Math.max(0, max - 1)).join("")}…`
}

/**
 * The plain text of a label that may carry markup.
 *
 * Menus show a shape's label as a row title; a shape whose label is a
 * rich-text document would otherwise render as `[object Object]`.
 */
export function unwrapLabel(label: unknown, max?: number): string {
  const text = typeof label === "string" ? label : typeof label === "object" && label !== null && "text" in label ? String((label as { text: unknown }).text) : String(label ?? "")
  return max === undefined ? text : truncateStringWithEllipsis(text, max)
}
