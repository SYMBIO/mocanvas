import {
  GeoShapeGeoStyle,
  type Editor,
  type TLUiActionsContextType,
  type TLUiToolItem,
  type TLUiToolsContextType,
} from "@mocanvas/editor"
import { MORE_GEO_KINDS, TOOLBAR_GROUPS, type ToolbarItem } from "./toolbar-config"

/**
 * The default tool and action lists — the lists a `TLUiOverrides` callback is
 * handed and gets to rewrite.
 *
 * Only tools the editor actually has are listed. An app can register a smaller
 * tool set than the default one, and a UI item for a state-chart node that is
 * not there would render a button that throws when pressed.
 */

function titleCase(s: string): string {
  return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Tool ids the editor currently has registered. */
export function registeredToolIds(editor: Editor): Set<string> {
  return new Set(Object.keys(editor.root.children ?? {}))
}

function toolItem(editor: Editor, item: ToolbarItem): TLUiToolItem {
  return {
    id: item.id,
    label: item.label,
    icon: item.icon,
    ...(item.kbd === undefined ? {} : { kbd: item.kbd }),
    ...(item.readonlyOk === undefined ? {} : { readonlyOk: item.readonlyOk }),
    ...(item.geo === undefined ? {} : { meta: { geo: item.geo } }),
    onSelect: () => {
      if (item.geo === undefined) {
        editor.setCurrentTool(item.tool)
        return
      }
      // A geo item selects a *kind* as well as the tool, and re-selecting the
      // same kind must still re-enter the tool — hence `force`.
      editor.setStyleForNextShapes(GeoShapeGeoStyle, item.geo)
      editor.setCurrentTool("geo", { geo: item.geo, force: true })
    },
  }
}

/**
 * Build the default tool list for an editor. The geo kinds without a toolbar
 * button of their own are included too: they are real, selectable tools that
 * live behind the "more shapes" popover, and an app rebuilding the toolbar
 * should be able to surface them.
 */
export function buildDefaultToolItems(editor: Editor): TLUiToolsContextType {
  const available = registeredToolIds(editor)
  const tools: TLUiToolsContextType = {}
  for (const item of TOOLBAR_GROUPS.flat()) {
    if (!available.has(item.tool)) continue
    tools[item.id] = toolItem(editor, item)
  }
  if (available.has("geo")) {
    for (const kind of MORE_GEO_KINDS) {
      tools[kind] = toolItem(editor, { id: kind, tool: "geo", icon: `geo-${kind}`, label: titleCase(kind), geo: kind })
    }
  }
  return tools
}

/**
 * Build the default action list for an editor.
 *
 * Deliberately small: it covers the actions the default chrome renders as
 * buttons (the zoom bar's), which is what an override needs to be able to
 * relabel or rebind. Everything else the editor can do is reachable through
 * `editor` directly, and listing it here would claim a keyboard binding the
 * chrome does not own.
 */
export function buildDefaultActionItems(editor: Editor): TLUiActionsContextType {
  return {
    undo: { id: "undo", label: "Undo", icon: "undo", kbd: "mod+z", onSelect: () => void editor.undo() },
    redo: { id: "redo", label: "Redo", icon: "redo", kbd: "mod+shift+z", onSelect: () => void editor.redo() },
    "zoom-in": { id: "zoom-in", label: "Zoom in", icon: "zoom-in", kbd: "mod+=", onSelect: () => void editor.zoomIn() },
    "zoom-out": { id: "zoom-out", label: "Zoom out", icon: "zoom-out", kbd: "mod+-", onSelect: () => void editor.zoomOut() },
    "reset-zoom": { id: "reset-zoom", label: "Reset zoom", icon: "zoom-fit", kbd: "mod+0", readonlyOk: true, onSelect: () => void editor.resetZoom() },
    "zoom-to-fit": { id: "zoom-to-fit", label: "Zoom to fit", icon: "zoom-fit", kbd: "mod+1", readonlyOk: true, onSelect: () => void editor.zoomToFit() },
  }
}
