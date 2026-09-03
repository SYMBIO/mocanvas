import { useEditor, type DefaultFontStyle, type DefaultHorizontalAlignStyle, type DefaultVerticalAlignStyle, type UnknownShape } from "@mocanvas/editor"
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react"
import { getFontFamily } from "../shapes/shape-theme"
import { LINE_HEIGHT } from "../shapes/text-helpers"
import { toDisplayText } from "./TextMeasure"

export interface TextLabelProps {
  shape: UnknownShape
  text: string
  isEditing: boolean
  font: DefaultFontStyle
  fontSize: number
  /** CSS color of the text. */
  color: string
  align: DefaultHorizontalAlignStyle
  verticalAlign: DefaultVerticalAlignStyle
  /** Soft-wrap at `width`. When false the label only breaks at explicit newlines. */
  wrap: boolean
  /** Box the label is laid out in, in shape-local px. Omit for an intrinsically sized label. */
  width?: number
  height?: number
  /** Padding on every side of the text, in px (default 0). */
  padding?: number
  /** Shown in place of an empty label when not editing. */
  placeholder?: string
  /** Single-line labels commit on Enter and never contain newlines (frame names). */
  singleLine?: boolean
  /** Called with the new text; at most once per animation frame while typing. */
  onChange(text: string): void
}

export function alignToJustify(align: DefaultHorizontalAlignStyle): CSSProperties["justifyContent"] {
  switch (align) {
    case "start":
    case "start-legacy":
      return "flex-start"
    case "end":
    case "end-legacy":
      return "flex-end"
    default:
      return "center"
  }
}

export function alignToTextAlign(align: DefaultHorizontalAlignStyle): CSSProperties["textAlign"] {
  switch (align) {
    case "start":
    case "start-legacy":
      return "left"
    case "end":
    case "end-legacy":
      return "right"
    default:
      return "center"
  }
}

export function verticalAlignToAlignItems(align: DefaultVerticalAlignStyle): CSSProperties["alignItems"] {
  switch (align) {
    case "start":
      return "flex-start"
    case "end":
      return "flex-end"
    default:
      return "center"
  }
}

/** Upper bound between a keystroke and its store write when animation frames are paused. */
const FLUSH_FALLBACK_MS = 32

const stop = (e: { stopPropagation(): void }) => {
  e.stopPropagation()
}

/**
 * A shape's text label. Static text when idle; while editing, a plain-text
 * `<textarea>` overlays an invisible copy of the text so the box keeps the
 * exact size the static label would have.
 */
export function TextLabel(props: TextLabelProps): ReactNode {
  const { text, isEditing, font, fontSize, color, align, verticalAlign, wrap, width, height, padding = 0, placeholder, singleLine } = props

  const textStyle: CSSProperties = {
    position: "relative",
    fontFamily: getFontFamily(font),
    fontSize,
    fontWeight: "normal",
    lineHeight: LINE_HEIGHT,
    color,
    textAlign: alignToTextAlign(align),
    whiteSpace: wrap ? "pre-wrap" : "pre",
    overflowWrap: wrap ? "break-word" : "normal",
    wordBreak: "normal",
    padding,
    boxSizing: "border-box",
    maxWidth: "100%",
    minWidth: isEditing ? fontSize + padding * 2 : undefined,
    width: wrap ? "100%" : undefined,
    margin: 0,
  }

  const outerStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: width ?? "max-content",
    height: height ?? "auto",
    display: "flex",
    justifyContent: alignToJustify(align),
    alignItems: verticalAlignToAlignItems(verticalAlign),
    pointerEvents: isEditing ? "auto" : "none",
    userSelect: isEditing ? "text" : "none",
    WebkitUserSelect: isEditing ? "text" : "none",
  }

  if (!isEditing) {
    const shown = text.length === 0 && placeholder ? placeholder : toDisplayText(text)
    return (
      <div className="mocanvas-text-label" style={outerStyle}>
        <div style={{ ...textStyle, opacity: text.length === 0 && placeholder ? 0.5 : 1 }}>{shown}</div>
      </div>
    )
  }

  return (
    <div className="mocanvas-text-label mocanvas-text-label-editing" style={outerStyle}>
      <TextEditor {...props} textStyle={textStyle} singleLine={singleLine ?? false} />
    </div>
  )
}

interface TextEditorProps extends TextLabelProps {
  textStyle: CSSProperties
  singleLine: boolean
}

function TextEditor({ text, onChange, textStyle, singleLine, wrap, color }: TextEditorProps): ReactNode {
  const editor = useEditor()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState(text)
  const valueRef = useRef(text)
  const pendingRef = useRef<string | null>(null)
  const rafRef = useRef(0)
  const timerRef = useRef(0)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const flush = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = 0
    }
    if (pendingRef.current !== null) {
      const next = pendingRef.current
      pendingRef.current = null
      onChangeRef.current(next)
    }
  }, [])

  const commit = useCallback(
    (next: string) => {
      valueRef.current = next
      setValue(next)
      pendingRef.current = next
      // One store write per frame; the timer covers hidden tabs where rAF is paused.
      if (!rafRef.current) rafRef.current = requestAnimationFrame(flush)
      if (!timerRef.current) timerRef.current = window.setTimeout(flush, FLUSH_FALLBACK_MS)
    },
    [flush],
  )

  // External changes (undo, collaboration) while nothing is pending.
  useEffect(() => {
    if (pendingRef.current === null && text !== valueRef.current) {
      valueRef.current = text
      setValue(text)
    }
  }, [text])

  // Focus with the caret at the end on mount; flush on unmount.
  useLayoutEffect(() => {
    const el = ref.current
    if (el) {
      el.focus({ preventScroll: true })
      const end = el.value.length
      el.setSelectionRange(end, end)
    }
    return () => flush()
  }, [flush])

  const finish = useCallback(() => {
    flush()
    editor.setEditingShape(null)
    editor.complete()
  }, [editor, flush])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (e.key === "Escape") {
      e.preventDefault()
      finish()
      return
    }
    if (e.key === "Tab") {
      e.preventDefault()
      return
    }
    if (e.key === "Enter" && singleLine && !e.shiftKey) {
      e.preventDefault()
      finish()
    }
  }

  const displayed = toDisplayText(value)

  return (
    <div style={textStyle} onPointerDown={stop} onPointerMove={stop} onPointerUp={stop}>
      {/* Invisible copy of the text keeps the box sized exactly like the static label. */}
      <div aria-hidden="true" style={{ visibility: "hidden", pointerEvents: "none" }}>
        {displayed}
      </div>
      <textarea
        ref={ref}
        className="mocanvas-text-editor"
        value={value}
        rows={1}
        wrap={wrap ? "soft" : "off"}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        data-gramm="false"
        onChange={(e) => {
          const raw = e.currentTarget.value
          commit(singleLine ? raw.replace(/[\r\n]+/g, "") : raw)
        }}
        onBlur={flush}
        onKeyDown={onKeyDown}
        onKeyUp={stop}
        onPointerDown={stop}
        onPointerMove={stop}
        onPointerUp={stop}
        onContextMenu={stop}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          margin: 0,
          border: "none",
          outline: "none",
          background: "transparent",
          resize: "none",
          overflow: "hidden",
          boxSizing: "border-box",
          padding: textStyle.padding,
          fontFamily: textStyle.fontFamily,
          fontSize: textStyle.fontSize,
          fontWeight: textStyle.fontWeight,
          lineHeight: textStyle.lineHeight,
          color,
          caretColor: color,
          textAlign: textStyle.textAlign,
          whiteSpace: textStyle.whiteSpace,
          overflowWrap: textStyle.overflowWrap,
          wordBreak: textStyle.wordBreak,
          letterSpacing: "inherit",
          userSelect: "text",
          WebkitUserSelect: "text",
          pointerEvents: "auto",
          cursor: "text",
          touchAction: "auto",
        }}
      />
    </div>
  )
}
