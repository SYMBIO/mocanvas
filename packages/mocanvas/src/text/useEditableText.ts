/**
 * The wiring a shape's text label needs to be editable.
 *
 * A label is a DOM element sitting over the canvas, and the same handful of
 * questions come up for every shape that has one: is this shape being edited,
 * should a double click start editing it, what happens on Escape, where does a
 * paste go. These two hooks answer them once, so a custom shape's label is a
 * spread of props rather than a re-implementation.
 *
 * Two hooks rather than one because the two label kinds differ in exactly one
 * respect — what `handleChange` writes back — and collapsing them into one hook
 * with a mode flag would make every call site say which mode it is anyway.
 */

import { useCallback, useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react"
import { useEditor, useValue, type ShapeId } from "@mocanvas/editor"
import { richTextToText, type RichText, type RichTextSource } from "./rich-text"

/** Everything a label component needs, from either hook. */
export interface EditableTextHandle {
  /** Stop editing when focus leaves the label. */
  handleBlur: () => void
  /** Select the whole label when it takes focus, so typing replaces it. */
  handleFocus: () => void
  /** Start editing on a double click. */
  handleDoubleClick: (e: { nativeEvent: Event } | Event) => void
  /** Swallow pointer-down inside the input so the canvas does not start a drag. */
  handleInputPointerDown: (e: ReactPointerEvent) => void
  /** Escape commits, Enter commits a single-line label. */
  handleKeyDown: (e: KeyboardEvent) => void
  /** Let a paste inside the label reach the label rather than the canvas. */
  handlePaste: (e: ClipboardEvent | ReactClipboardEvent<HTMLTextAreaElement>) => void
  /** Whether this shape is the one being edited. */
  isEditing: boolean
  /** Whether the label has no text; `undefined` before it is known. */
  isEmpty: boolean | undefined
  /**
   * Whether the editing surface may mount.
   *
   * One frame behind {@link isEditing}: a contenteditable that mounts in the
   * same commit as the state change steals focus before the canvas has
   * finished handling the click that caused it.
   */
  isReadyForEditing: boolean
  /** Ref for the element the text is edited in. */
  rInput: RefObject<HTMLDivElement | null>
}

/** The half of the handle that does not depend on what the label stores. */
function useEditableTextCore(shapeId: ShapeId, isEmpty: boolean | undefined, singleLine: boolean): EditableTextHandle {
  const editor = useEditor()
  const rInput = useRef<HTMLDivElement | null>(null)
  const isEditing = useValue("isEditingShape", () => editor.getEditingShapeId() === shapeId, [editor, shapeId])
  const [isReadyForEditing, setIsReadyForEditing] = useState(false)

  useEffect(() => {
    if (!isEditing) {
      setIsReadyForEditing(false)
      return
    }
    // One frame's delay; see `isReadyForEditing`.
    const raf = requestAnimationFrame(() => setIsReadyForEditing(true))
    return () => cancelAnimationFrame(raf)
  }, [isEditing])

  const handleBlur = useCallback(() => {
    if (editor.getEditingShapeId() === shapeId) editor.setEditingShape(null)
  }, [editor, shapeId])

  const handleFocus = useCallback(() => {
    const element = rInput.current
    if (!element || typeof window === "undefined") return
    const selection = window.getSelection?.()
    if (!selection) return
    const range = document.createRange()
    range.selectNodeContents(element)
    selection.removeAllRanges()
    selection.addRange(range)
  }, [])

  const handleDoubleClick = useCallback(
    (e: { nativeEvent: Event } | Event) => {
      const native = "nativeEvent" in e ? e.nativeEvent : e
      native.stopPropagation?.()
      editor.setEditingShape(shapeId)
    },
    [editor, shapeId],
  )

  const handleInputPointerDown = useCallback((e: ReactPointerEvent) => {
    // The canvas listens on the container; without this a drag inside the
    // label would translate the shape instead of selecting text.
    e.stopPropagation()
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        editor.setEditingShape(null)
        return
      }
      if (singleLine && e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        editor.setEditingShape(null)
      }
    },
    [editor, singleLine],
  )

  const handlePaste = useCallback((e: ClipboardEvent | ReactClipboardEvent<HTMLTextAreaElement>) => {
    // The canvas's own paste handler would turn the clipboard into shapes.
    e.stopPropagation()
  }, [])

  return { handleBlur, handleFocus, handleDoubleClick, handleInputPointerDown, handleKeyDown, handlePaste, isEditing, isEmpty, isReadyForEditing, rInput }
}

/** The handle for a label that stores a rich-text document. */
export function useEditableRichText(
  shapeId: ShapeId,
  type: string,
  richText?: RichTextSource,
): EditableTextHandle & { handleChange: (next: { richText: RichText }) => void } {
  const editor = useEditor()
  const core = useEditableTextCore(shapeId, richText === undefined ? undefined : richTextToText(richText).length === 0, false)

  const handleChange = useCallback(
    ({ richText: next }: { richText: RichText }) => {
      editor.updateShape({ id: shapeId, type, props: { richText: next } } as never)
    },
    [editor, shapeId, type],
  )

  return { ...core, handleChange }
}

/** The handle for a label that stores a plain string. */
export function useEditablePlainText(
  shapeId: ShapeId,
  type: string,
  text?: string,
): EditableTextHandle & { handleChange: (next: { text: string }) => void } {
  const editor = useEditor()
  const core = useEditableTextCore(shapeId, text === undefined ? undefined : text.length === 0, true)

  const handleChange = useCallback(
    ({ text: next }: { text: string }) => {
      editor.updateShape({ id: shapeId, type, props: { text: next } } as never)
    },
    [editor, shapeId, type],
  )

  return { ...core, handleChange }
}

/**
 * Put a shape into text-editing mode from outside the label.
 *
 * The path a tool or a menu item takes: creating a note and dropping the caret
 * into it, or "Edit text" in the context menu. Selecting the shape first is
 * deliberate — editing a shape that is not selected leaves the selection UI
 * pointing somewhere else.
 */
export function startEditingShapeWithRichText(
  editor: ReturnType<typeof useEditor>,
  shapeOrId: ShapeId | { id: ShapeId },
  options: { selectAll?: boolean } = {},
): void {
  const id = typeof shapeOrId === "string" ? shapeOrId : shapeOrId.id
  const shape = editor.getShape(id)
  if (!shape) return
  editor.run(() => {
    editor.setSelectedShapes([id])
    editor.setEditingShape(id)
  })
  if (options.selectAll === false) return
  // The label's own `handleFocus` selects everything once it mounts; nothing
  // else can, because the editing surface does not exist yet at this point.
}
