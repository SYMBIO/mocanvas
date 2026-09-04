import { GEO_SHAPE_KINDS, type GeoShapeKind } from "@mocanvas/editor"
import type { IconName } from "./icons"

/**
 * The default toolbar's contents, as data.
 *
 * Kept apart from the components that render it so the tool *list* — which is
 * also what `TLUiOverrides.tools` starts from and what `useTools()` hands to a
 * custom toolbar — has no React in it.
 */

export interface ToolbarItem {
  /** Unique key; also the geo kind for geo entries. */
  id: string
  /** Tool id that must be registered for this entry to appear. */
  tool: string
  icon: IconName
  label: string
  /**
   * Keyboard shortcut(s), comma-separated. Lower case: these are compared
   * against `KeyboardEvent.key`.
   */
  kbd?: string
  /** Displayed in the tooltip, next to the label. */
  shortcut?: string
  /** Geo kind the entry selects, for entries driving the `geo` tool. */
  geo?: GeoShapeKind
  /** Tools outside the default set: shown only when the app registers them. */
  optional?: boolean
  /** Keep the shortcut live on a read-only editor. */
  readonlyOk?: boolean
}

/** Toolbar entries, grouped; groups are separated by a divider. */
export const TOOLBAR_GROUPS: readonly (readonly ToolbarItem[])[] = [
  [
    { id: "select", tool: "select", icon: "select", label: "Select", shortcut: "V", kbd: "v", readonlyOk: true },
    { id: "hand", tool: "hand", icon: "hand", label: "Hand", shortcut: "H", kbd: "h", readonlyOk: true },
  ],
  [
    { id: "draw", tool: "draw", icon: "draw", label: "Draw", shortcut: "D", kbd: "d,p,b" },
    { id: "eraser", tool: "eraser", icon: "eraser", label: "Eraser", shortcut: "E", kbd: "e" },
  ],
  [
    { id: "rectangle", tool: "geo", icon: "geo-rectangle", label: "Rectangle", shortcut: "R", kbd: "r", geo: "rectangle" },
    { id: "ellipse", tool: "geo", icon: "geo-ellipse", label: "Ellipse", shortcut: "O", kbd: "o", geo: "ellipse" },
    { id: "triangle", tool: "geo", icon: "geo-triangle", label: "Triangle", geo: "triangle" },
    { id: "diamond", tool: "geo", icon: "geo-diamond", label: "Diamond", geo: "diamond" },
    { id: "star", tool: "geo", icon: "geo-star", label: "Star", geo: "star" },
  ],
  [
    { id: "text", tool: "text", icon: "text", label: "Text", shortcut: "T", kbd: "t" },
    { id: "note", tool: "note", icon: "note", label: "Note", shortcut: "N", kbd: "n" },
    { id: "arrow", tool: "arrow", icon: "arrow", label: "Arrow", shortcut: "A", kbd: "a", optional: true },
    { id: "line", tool: "line", icon: "line", label: "Line", shortcut: "L", kbd: "l", optional: true },
    { id: "frame", tool: "frame", icon: "frame", label: "Frame", shortcut: "F", kbd: "f", optional: true },
  ],
]

/** Geo kinds with a toolbar button of their own. */
export const PRIMARY_GEO_KINDS: readonly GeoShapeKind[] = TOOLBAR_GROUPS.flat()
  .map((t) => t.geo)
  .filter((g): g is GeoShapeKind => g !== undefined)

/** Geo kinds that live behind the "more shapes" popover. */
export const MORE_GEO_KINDS: readonly GeoShapeKind[] = GEO_SHAPE_KINDS.filter((k) => !PRIMARY_GEO_KINDS.includes(k))
