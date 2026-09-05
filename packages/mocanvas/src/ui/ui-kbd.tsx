import type { ReactNode } from "react"

/**
 * A keyboard shortcut, rendered.
 *
 * Takes the shortcut in the same `"mod+shift+z"` notation the tool and action
 * items carry, so a menu row can pass an item's `kbd` straight through instead
 * of every call site formatting it.
 */
export interface TLUiKbdProps {
  /** `"mod+z"`, `"shift+r"`, `"?"`. Comma-separated alternatives: only the first is shown. */
  children?: ReactNode
  /** Force Apple-style glyphs. Detected from the platform when omitted. */
  isApple?: boolean
  className?: string
}

const APPLE = {
  mod: "⌘",
  cmd: "⌘",
  alt: "⌥",
  opt: "⌥",
  shift: "⇧",
  ctrl: "⌃",
  enter: "↵",
  backspace: "⌫",
  del: "⌦",
  esc: "⎋",
  tab: "⇥",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
} as const

const OTHER = {
  mod: "Ctrl",
  cmd: "Ctrl",
  alt: "Alt",
  opt: "Alt",
  shift: "Shift",
  ctrl: "Ctrl",
  enter: "Enter",
  backspace: "Backspace",
  del: "Delete",
  esc: "Esc",
  tab: "Tab",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
} as const

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "")
}

/**
 * Split a shortcut into the keys to draw.
 *
 * Only the first comma-separated alternative is shown: a tool bound to
 * `"d,p,b"` has one shortcut as far as the user is concerned, and printing
 * three would suggest a chord.
 */
export function kbdToKeys(kbd: string, isApple = isApplePlatform()): string[] {
  const table: Record<string, string> = isApple ? APPLE : OTHER
  const first = (kbd.split(",")[0] ?? "").trim()
  if (first === "") return []
  return first
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => table[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part))
}

/**
 * A shortcut as a row of `<kbd>` elements.
 *
 * `aria-hidden`: the shortcut is already on the control it belongs to, via
 * `aria-keyshortcuts`, and reading the glyphs out as text ("command shift Z"
 * rendered as three separate symbols) is noise.
 */
export function TldrawUiKbd({ children, isApple, className }: TLUiKbdProps) {
  const raw = typeof children === "string" ? children : String(children ?? "")
  const keys = kbdToKeys(raw, isApple ?? isApplePlatform())
  if (keys.length === 0) return null
  return (
    <span className={["mocanvas-kbd", className].filter(Boolean).join(" ")} aria-hidden="true">
      {keys.map((key, i) => (
        <kbd key={`${key}-${i}`}>{key}</kbd>
      ))}
    </span>
  )
}
