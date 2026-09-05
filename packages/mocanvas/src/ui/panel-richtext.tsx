import { track, useEditor } from "@mocanvas/editor"
import { Icon } from "./icons"
import { TldrawUiContextualToolbar } from "./ui-contextual-toolbar"
import { TldrawUiToolbarButton } from "./ui-toolbar"
import type { TLUiRichTextToolbarProps } from "./ui-components"

/**
 * The formatting bar over a text shape that is being edited.
 *
 * Follows the shape rather than docking, because the thing being formatted is
 * on the canvas and a docked bar makes the user look away from it to press a
 * button.
 */

export interface DefaultRichTextToolbarContentProps {
  /** Which marks to offer. Defaults to bold, italic, strikethrough, code, link. */
  marks?: readonly string[]
}

/** The formatting buttons. */
export function DefaultRichTextToolbarContent({ marks: only }: DefaultRichTextToolbarContentProps = {}) {
  const editor = useEditor()
  // SEMANTICS-ASSUMED: the editor stores whatever rich-text editor the host
  // attached, without a type of its own (TipTap is an optional peer
  // dependency). The bar asks for the two methods it needs and falls back to
  // rendering nothing when they are absent.
  const rich = editor.getRichTextEditor() as { isActive?(mark: string): boolean; toggleMark?(mark: string): void } | null

  // Without a rich-text editor attached there is no mark to toggle, so the bar
  // offers nothing rather than offering buttons that do nothing.
  if (!rich) return null

  const marks = [
    { id: "bold", label: "Bold", glyph: "B", weight: 700 },
    { id: "italic", label: "Italic", glyph: "I", style: "italic" as const },
    { id: "strike", label: "Strikethrough", glyph: "S", decoration: "line-through" as const },
    { id: "code", label: "Code", glyph: "<>" },
  ]

  const shown = only ? marks.filter((mark) => only.includes(mark.id)) : marks

  return (
    <>
      {shown.map((mark) => (
        <TldrawUiToolbarButton
          key={mark.id}
          type="icon"
          title={mark.label}
          isActive={rich.isActive?.(mark.id) ?? false}
          onClick={() => rich.toggleMark?.(mark.id)}
        >
          <span style={{ fontWeight: mark.weight, fontStyle: mark.style, textDecoration: mark.decoration }}>{mark.glyph}</span>
        </TldrawUiToolbarButton>
      ))}
      <TldrawUiToolbarButton type="icon" title="Link" isActive={rich.isActive?.("link") ?? false} onClick={() => rich.toggleMark?.("link")}>
        <Icon name="line" />
      </TldrawUiToolbarButton>
    </>
  )
}

/**
 * The rich-text bar. Shown only while a shape's text is being edited, and
 * hidden while the pointer is down so it does not chase a drag.
 */
export const DefaultRichTextToolbar = track(function DefaultRichTextToolbar({ children }: TLUiRichTextToolbarProps) {
  const editor = useEditor()
  const editingId = editor.getEditingShapeId()
  if (!editingId) return null
  const bounds = editor.getShapePageBounds(editingId)
  if (!bounds) return null
  return (
    <TldrawUiContextualToolbar label="Text formatting" getSelectionBounds={() => ({ x: bounds.minX, y: bounds.minY, w: bounds.width, h: bounds.height })}>
      {children ?? <DefaultRichTextToolbarContent />}
    </TldrawUiContextualToolbar>
  )
})
