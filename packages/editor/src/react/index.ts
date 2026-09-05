export { Canvas, getShapeIndicatorNode, type CanvasProps, type CanvasComponents, type TLCanvasComponentProps } from "./Canvas"
export { useEditor, useMaybeEditor, EditorProvider, EditorContext, type EditorProviderProps } from "./EditorContext"
export { HTMLContainer, SVGContainer, stopEventPropagation, type HTMLContainerProps, type SVGContainerProps } from "./containers"
export { CANVAS_THEME_VARS, getThemeCssVars, useThemeCssVars } from "./themeVars"
export { AssetUrlsProvider, useAssetUrls, type TLAssetUrls, type TLEditorAssetUrls, type TLUiAssetUrls, type AssetUrlsProviderProps } from "./assetUrls"
export { getLocaleChain, resolveUiMessage } from "./translations"
export type {
  TLComponents,
  TLCursorSlotProps,
  TLShapeWrapperSlotProps,
  TLErrorSlotProps,
  TLComponentsResolved,
  TLGridProps,
  TLUiComponentSlot,
  TLUiEventSource,
  TLUiToolItem,
  TLUiToolsContextType,
  TLUiActionItem,
  TLUiActionsContextType,
  TLUiOverrideHelpers,
  TLUiOverrides,
  TLUiTranslations,
} from "./ui-types"
export {
  MocanvasUiProvider,
  useMocanvasUi,
  useEditorComponents,
  useTools,
  useActions,
  useIsToolSelected,
  useIsEditing,
  useGlobalMenuIsOpen,
  type MocanvasUiContextValue,
  type MocanvasUiProviderProps,
  type TLUiToolsBuilder,
  type TLUiActionsBuilder,
} from "./ui-context"
export * from "./ErrorBoundary"
export * from "./containerContext"
export * from "./defaultEditorComponents"
export * from "./safeIds"
export * from "./useTransform"
// `TLOnMountHandler` is deliberately not re-exported: the flagship declares it,
// and two `export *` sources carrying one name make the barrel drop it.
export type {
  TldrawEditorBaseProps,
  TldrawEditorProps,
  TldrawEditorWithStoreProps,
  TldrawEditorWithoutStoreProps,
} from "./editorProps"
export * from "./svgExportContext"
export { useTLSchemaFromUtils, useTLStore } from "./useTLStore"
export { useViewportHeight } from "./useViewportHeight"
// Re-exported here rather than from the package barrel, so the signals layer is
// reachable from the editor without a second dependency.
export { useStateTracking } from "@mocanvas/state/react"
