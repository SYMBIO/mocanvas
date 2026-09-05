export * from "./TextMeasure"
export * from "./TextTexture"
export * from "./text-layout"
export * from "./TextEditor"

// --- workstream F: rich text (ProseMirror JSON; TipTap is an optional peer dep) --
export * from "./rich-text"
export * from "./tiptap-extensions"
export * from "./measure-html"

// --- the tldraw-shaped rich-text surface -------------------------------------
export { renderHtmlFromRichText, renderPlaintextFromRichText, renderRichTextFromHTML } from "./rich-text-render"
export {
  KeyboardShiftEnterTweakExtension,
  getTipTapDefaultExtensions,
  loadTipTapDefaultExtensions,
  type TipTapStarterKitOptions,
} from "./tiptap-defaults"
export {
  startEditingShapeWithRichText,
  useEditablePlainText,
  useEditableRichText,
  type EditableTextHandle,
} from "./useEditableText"
