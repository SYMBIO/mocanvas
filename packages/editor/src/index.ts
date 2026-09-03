export * from "./editor/Editor"
export * from "./editor/createStore"
export * from "./editor/events"
export { HandleTable } from "./editor/HandleTable"
export * from "./editor/selectionHandles"
export { SnapManager, type SnapLine, type SnapResult } from "./editor/SnapManager"
export { HistoryManager } from "./editor/HistoryManager"
export * from "./geometry"
export * from "./records/base"
export * from "./records/binding"
export * from "./bindings/BindingUtil"
export {
  DEFAULT_COLORS,
  DEFAULT_DASHES,
  DEFAULT_FILLS,
  DEFAULT_FONTS,
  DEFAULT_H_ALIGNS,
  DEFAULT_SIZES,
  DEFAULT_V_ALIGNS,
  GEO_SHAPE_KINDS,
  STROKE_SIZES,
  FONT_SIZES,
  LIGHT_THEME,
  hexToRgba,
  type GeoShapeKind,
  type ThemeColor,
} from "./records/styles"
export * from "./records/styleProp"
export * from "./shapes/ShapeUtil"
export * from "./tools/StateNode"
export { RootState, createRootState } from "./tools/RootState"
export type { RenderBackend, DrawOptions, RGBA } from "./render/backend"
export { WebGL2Backend, createBackend } from "./render/webgl2"
export { Canvas, type CanvasProps, type CanvasComponents } from "./react/Canvas"
export { useEditor, useMaybeEditor, EditorProvider, EditorContext } from "./react/EditorContext"
export { loadEngine, loadEngineSync, EngineBridge, FLAG, PATH_OP, type StyleWords, type CameraState } from "@mocanvas/wasm"
export { useValue, track, useAtom, useComputed, useReactor, useQuickReactor } from "@mocanvas/state/react"
