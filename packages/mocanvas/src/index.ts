// Fills in the Editor members that need this package's shapes and the DOM.
import "./install"

export * from "@mocanvas/editor"
// The tldraw-5.2 indicator spellings; the compositor itself stays in the editor.
export * from "./indicators"
export * from "./ui"
export * from "./shapes"
export * from "./bindings"
export * from "./tools"
export * from "./text"
export * from "./file"
export * from "./Mocanvas"
export * from "./export"
export * from "./external"
export * from "./assets"
export * from "./config"
export * from "./interaction"
export * from "./fonts"
export * from "./path"
export * from "./stroke"

// --- workstream E: toolbar built on the override surface -----------------------
export {
  DefaultToolbar,
  MocanvasUiMenuItem,
  type DefaultToolbarProps,
  type MocanvasUiMenuItemProps,
} from "./ui/DefaultToolbar"
