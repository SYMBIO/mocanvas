/** The flagship's chrome: toolbar, style panel, icons, overlays, shortcuts. */
export * from "./DefaultUi"
export * from "./StylePanel"
export {
  Icon,
  ICONS,
  ICON_NAMES,
  ICON_GRID,
  GEO_BOX,
  GEO_ICON_PATHS,
  getGeoIconBox,
  type IconName,
  type IconProps,
} from "./icons"
export { Popover, UiTooltip, placeNear, type PopoverProps, type Placement } from "./overlays"
export { useKeyboardShortcuts, debugStatsOpen } from "./useKeyboardShortcuts"
export {
  DefaultToolbar,
  MocanvasUiMenuItem,
  type DefaultToolbarProps,
  type MocanvasUiMenuItemProps,
} from "./DefaultToolbar"
export { buildDefaultToolItems, buildDefaultActionItems, registeredToolIds } from "./tools-context"
export { useToolShortcuts, ToolShortcuts, toolKeyMap } from "./useToolShortcuts"

// ---------------------------------------------------------------------------
// The tldraw-shaped UI layer
// ---------------------------------------------------------------------------
// Grouped by the layer they belong to rather than alphabetically: primitives,
// then the contexts they read, then the menu system, then the panels built out
// of all three.

// ---- contexts ---------------------------------------------------------------
export * from "./ui-events"
export * from "./ui-translation"
export * from "./ui-breakpoint"
export * from "./ui-orientation"
export * from "./ui-a11y"
export * from "./ui-toasts"
export * from "./ui-dialogs"
export * from "./ui-components"
export * from "./ui-context-provider"
export * from "./ui-lists-provider"

// ---- primitives -------------------------------------------------------------
export * from "./ui-icon"
export * from "./ui-button"
export * from "./ui-input"
export * from "./ui-kbd"
export * from "./ui-slider"
export * from "./ui-layout"
export * from "./ui-floating"
export * from "./ui-popover"
export * from "./ui-dropdown-menu"
export * from "./ui-select"
export * from "./ui-toolbar"
export * from "./ui-tooltip"
export * from "./ui-contextual-toolbar"

// ---- menus ------------------------------------------------------------------
export * from "./ui-menu"
export * from "./menu-items"

// ---- actions, clipboard, hooks ----------------------------------------------
export * from "./ui-actions"
export * from "./ui-clipboard"
export * from "./ui-hooks"

// ---- panels -----------------------------------------------------------------
export * from "./panel-menus"
export * from "./panel-page"
export * from "./panel-navigation"
export * from "./panel-shortcuts"
export * from "./style-pickers"
export * from "./panel-style"
export * from "./panel-people"
export * from "./panel-richtext"
export * from "./panel-debug"
export * from "./toolbar-items"
export * from "./asset-toolbars"
export * from "./text-labels"
export * from "./TldrawUi"
export * from "./TldrawImage"

// ---- clipboard, export and icon typing --------------------------------------
export {
  handleNativeOrMenuCopy,
  useCopyAs,
  useExportAs,
  useMenuClipboardEvents,
  useNativeClipboardEvents,
  type TLCopyType,
  type TLUiClipboardEvents,
} from "./ui-clipboard-hooks"
export { iconTypes, type TLUiIconJsx, type TLUiIconType } from "./ui-icon-types"
