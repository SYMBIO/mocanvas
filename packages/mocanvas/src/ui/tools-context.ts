import {
  GeoShapeGeoStyle,
  type Editor,
  type TLUiActionItem,
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
 * Every menu, toolbar and shortcut in the default chrome renders from this
 * list rather than calling the editor directly, which is what makes
 * `TLUiOverrides.actions` a real override point: relabel an entry, rebind its
 * key or delete it and it changes — or disappears — everywhere at once.
 *
 * ## Why nothing here reads the editor
 * The list is built once per editor, not once per frame, so anything read
 * while building it would be frozen at that moment — an item marked
 * `disabled` because nothing was selected when the chrome mounted would stay
 * disabled forever. Availability is therefore *not* baked in: it is resolved
 * where it is rendered, by `useActionState`, which reads the editor
 * reactively. Everything below is either a constant or a closure.
 */
export function buildDefaultActionItems(editor: Editor): TLUiActionsContextType {
  const selected = () => editor.getSelectedShapeIds()

  const item = (
    id: string,
    label: string,
    onSelect: () => void,
    extra: Partial<Omit<TLUiActionItem, "id" | "label" | "onSelect">> = {},
  ): TLUiActionItem => ({ id, label, onSelect, ...extra })

  const items: TLUiActionItem[] = [
    // ---- history ----------------------------------------------------------
    item("undo", "Undo", () => void editor.undo(), { icon: "undo", kbd: "mod+z" }),
    item("redo", "Redo", () => void editor.redo(), { icon: "redo", kbd: "mod+shift+z" }),

    // ---- camera -----------------------------------------------------------
    item("zoom-in", "Zoom in", () => void editor.zoomIn(), { icon: "zoom-in", kbd: "mod+=", readonlyOk: true }),
    item("zoom-out", "Zoom out", () => void editor.zoomOut(), { icon: "zoom-out", kbd: "mod+-", readonlyOk: true }),
    item("reset-zoom", "Reset zoom", () => void editor.resetZoom(), { icon: "zoom-fit", kbd: "mod+0", readonlyOk: true }),
    item("zoom-to-fit", "Zoom to fit", () => void editor.zoomToFit(), { icon: "zoom-fit", kbd: "mod+1", readonlyOk: true }),
    item("zoom-to-selection", "Zoom to selection", () => void editor.zoomToSelection(), { icon: "zoom-fit", kbd: "mod+2", readonlyOk: true }),

    // ---- selection --------------------------------------------------------
    item("select-all", "Select all", () => void editor.selectAll(), { kbd: "mod+a", readonlyOk: true }),
    item("select-none", "Select none", () => void editor.selectNone(), { readonlyOk: true }),
    item("delete", "Delete", () => void editor.deleteShapes(selected()), { icon: "trash", kbd: "backspace,delete" }),
    item("duplicate", "Duplicate", () => void editor.duplicateShapes(selected()), { icon: "duplicate", kbd: "mod+d" }),
    item("group", "Group", () => void editor.groupShapes(selected()), { icon: "group", kbd: "mod+g" }),
    item("ungroup", "Ungroup", () => void editor.ungroupShapes(selected()), { icon: "ungroup", kbd: "mod+shift+g" }),
    item("toggle-lock", "Toggle lock", () => void editor.toggleLock(selected()), { icon: "lock", kbd: "shift+l" }),
    item("unlock-all", "Unlock all", () => {
      const locked = editor.getCurrentPageShapes().filter((shape) => shape.isLocked)
      if (locked.length > 0) editor.toggleLock(locked.map((shape) => shape.id))
    }, { icon: "unlock" }),
    item("rotate-cw", "Rotate clockwise", () => void editor.rotateShapesBy(selected(), Math.PI / 2)),
    item("rotate-ccw", "Rotate counter-clockwise", () => void editor.rotateShapesBy(selected(), -Math.PI / 2)),

    // ---- ordering ---------------------------------------------------------
    item("bring-to-front", "Bring to front", () => void editor.bringToFront(selected()), { kbd: "]" }),
    item("bring-forward", "Bring forward", () => void editor.bringForward(selected()), { icon: "bring-forward", kbd: "mod+]" }),
    item("send-backward", "Send backward", () => void editor.sendBackward(selected()), { icon: "send-backward", kbd: "mod+[" }),
    item("send-to-back", "Send to back", () => void editor.sendToBack(selected()), { kbd: "[" }),

    // ---- align / distribute / stack / stretch -----------------------------
    item("align-left", "Align left", () => void editor.alignShapes(selected(), "left"), { icon: "align-left", kbd: "alt+a" }),
    item("align-center-horizontal", "Align centre horizontally", () => void editor.alignShapes(selected(), "center-horizontal"), { icon: "align-center-horizontal", kbd: "alt+h" }),
    item("align-right", "Align right", () => void editor.alignShapes(selected(), "right"), { icon: "align-right", kbd: "alt+d" }),
    item("align-top", "Align top", () => void editor.alignShapes(selected(), "top"), { icon: "valign-top", kbd: "alt+w" }),
    item("align-center-vertical", "Align centre vertically", () => void editor.alignShapes(selected(), "center-vertical"), { icon: "valign-middle", kbd: "alt+v" }),
    item("align-bottom", "Align bottom", () => void editor.alignShapes(selected(), "bottom"), { icon: "valign-bottom", kbd: "alt+s" }),
    item("distribute-horizontal", "Distribute horizontally", () => void editor.distributeShapes(selected(), "horizontal"), { kbd: "alt+shift+h" }),
    item("distribute-vertical", "Distribute vertically", () => void editor.distributeShapes(selected(), "vertical"), { kbd: "alt+shift+v" }),
    item("stack-horizontal", "Stack horizontally", () => void editor.stackShapes(selected(), "horizontal")),
    item("stack-vertical", "Stack vertically", () => void editor.stackShapes(selected(), "vertical")),
    item("stretch-horizontal", "Stretch horizontally", () => void editor.stretchShapes(selected(), "horizontal")),
    item("stretch-vertical", "Stretch vertically", () => void editor.stretchShapes(selected(), "vertical")),
    item("flip-horizontal", "Flip horizontally", () => void editor.flipShapes(selected(), "horizontal"), { kbd: "shift+h" }),
    item("flip-vertical", "Flip vertically", () => void editor.flipShapes(selected(), "vertical"), { kbd: "shift+v" }),
    item("pack", "Pack", () => void editor.packShapes(selected())),

    // ---- modes ------------------------------------------------------------
    item("toggle-grid", "Show grid", () => editor.updateInstanceState({ isGridMode: !editor.getInstanceState().isGridMode }), { kbd: "mod+'", readonlyOk: true }),
    item("toggle-focus-mode", "Focus mode", () => editor.updateInstanceState({ isFocusMode: !editor.getInstanceState().isFocusMode }), { kbd: "mod+.", readonlyOk: true }),
    item("toggle-debug-mode", "Debug mode", () => editor.updateInstanceState({ isDebugMode: !editor.getInstanceState().isDebugMode }), { readonlyOk: true }),
    item("toggle-tool-lock", "Tool lock", () => editor.updateInstanceState({ isToolLocked: !editor.getInstanceState().isToolLocked }), { kbd: "q" }),
    item("toggle-transparent", "Transparent background", () => editor.updateInstanceState({ exportBackground: !editor.getInstanceState().exportBackground }), { readonlyOk: true }),
    item("toggle-snap-mode", "Always snap", () => editor.user.updateUserPreferences({ isSnapMode: !editor.user.getIsSnapMode() }), { readonlyOk: true }),
    item("toggle-wrap-mode", "Wrap text", () => editor.user.updateUserPreferences({ isWrapMode: !editor.user.getIsWrapMode() }), { readonlyOk: true }),
    item("toggle-dynamic-size-mode", "Dynamic size", () => editor.user.updateUserPreferences({ isDynamicSizeMode: !editor.user.getIsDynamicSizeMode() }), { readonlyOk: true }),
    item("toggle-paste-at-cursor", "Paste at cursor", () => editor.user.updateUserPreferences({ isPasteAtCursorMode: !editor.user.getIsPasteAtCursorMode() }), { readonlyOk: true }),
    item("toggle-edge-scrolling", "Edge scrolling", () => editor.user.updateUserPreferences({ edgeScrollSpeed: editor.user.getEdgeScrollSpeed() === 0 ? 1 : 0 }), { readonlyOk: true }),
    item("toggle-reduce-motion", "Reduce motion", () => editor.user.updateUserPreferences({ animationSpeed: editor.user.getAnimationSpeed() === 0 ? 1 : 0 }), { readonlyOk: true }),
    item("toggle-dark-mode", "Dark mode", () => editor.setColorMode(editor.getColorMode() === "dark" ? "light" : "dark"), { readonlyOk: true }),
    item("toggle-keyboard-shortcuts", "Keyboard shortcuts", () => editor.user.updateUserPreferences({ areKeyboardShortcutsEnabled: !editor.user.getAreKeyboardShortcutsEnabled() }), { readonlyOk: true }),

    // ---- pages ------------------------------------------------------------
    item("new-page", "New page", () => void editor.createPage({ name: `Page ${editor.getPages().length + 1}` })),
    item("duplicate-page", "Duplicate page", () => void editor.duplicatePage(editor.getCurrentPageId())),
    item("delete-page", "Delete page", () => void editor.deletePage(editor.getCurrentPageId())),
  ]

  const actions: TLUiActionsContextType = {}
  for (const entry of items) actions[entry.id] = entry
  return actions
}
