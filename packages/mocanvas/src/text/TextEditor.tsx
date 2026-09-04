import { useEditor, type DefaultFontStyle, type DefaultHorizontalAlignStyle, type DefaultVerticalAlignStyle, type UnknownShape } from "@mocanvas/editor"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react"
import { getFontFamily } from "../shapes/shape-theme"
import { LINE_HEIGHT } from "../shapes/text-helpers"
import { getRichTextExtensions, renderHtmlFromRichTextForMeasurement } from "./measure-html"
import { applyPlainTextToRichText, isRichText, richTextToText, type RichText, type RichTextSource } from "./rich-text"
import { RICH_TEXT_BLOCK_CSS, toDisplayText } from "./TextMeasure"
import { getRichTextEditorFactory, type RichTextEditorFactory } from "./tiptap-extensions"

export interface TextLabelProps {
  shape: UnknownShape
  /**
   * The label as plain text. Ignored for rendering when
   * {@link TextLabelProps.richText} is set; still the value the plain-text
   * editing fallback starts from.
   */
  text: string
  /**
   * The label as a rich-text document, when the store holds one. A shape may
   * carry either `props.text` or `props.richText`; both render here.
   */
  richText?: RichTextSource
  isEditing: boolean
  /**
   * The label's font style token. Named `font` before v5; `font` is still
   * accepted and means the same thing.
   */
  fontFamily?: DefaultFontStyle
  /** @deprecated v5 renamed this to `fontFamily`. */
  font?: DefaultFontStyle
  fontSize: number
  /** CSS color of the text. */
  color: string
  /** Horizontal alignment. Named `align` before v5; `align` is still accepted. */
  textAlign?: DefaultHorizontalAlignStyle
  /** @deprecated v5 renamed this to `textAlign`. */
  align?: DefaultHorizontalAlignStyle
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
  /**
   * Called with the new rich-text document, at the same rate as `onChange`.
   * A shape whose store prop is `richText` passes this; without it the label
   * still edits, and only the plain text is written back.
   */
  onChangeRichText?(value: RichText): void
}

/** The label's font style token, from either spelling. */
export function labelFontFamily(props: Pick<TextLabelProps, "font" | "fontFamily">): DefaultFontStyle {
  return props.fontFamily ?? props.font ?? "draw"
}

/** The label's horizontal alignment, from either spelling. */
export function labelTextAlign(props: Pick<TextLabelProps, "align" | "textAlign">): DefaultHorizontalAlignStyle {
  return props.textAlign ?? props.align ?? "middle"
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
  const { text, richText, isEditing, fontSize, color, verticalAlign, wrap, width, height, padding = 0, placeholder, singleLine } = props
  const align = labelTextAlign(props)
  const font = labelFontFamily(props)
  const editor = useEditor()
  // The document is what renders when there is one; `text` is the fallback.
  const rich = isRichText(richText) ? richText : null
  const plain = rich ? richTextToText(rich) : text
  const html = useMemo(() => (rich ? renderHtmlFromRichTextForMeasurement(editor, rich) : null), [editor, rich])

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
    const empty = plain.length === 0
    if (rich && !(empty && placeholder)) {
      return (
        <div className="mocanvas-text-label" style={outerStyle}>
          <RichTextBlockStyles />
          {/* The HTML is generated by `richTextToHtml` from a known node and
              mark table: text is escaped and link hrefs are scheme-checked, so
              nothing a document carries reaches the DOM as markup. */}
          <div className="mocanvas-rich-text" style={textStyle} dangerouslySetInnerHTML={{ __html: html ?? "" }} />
        </div>
      )
    }
    const shown = empty && placeholder ? placeholder : toDisplayText(plain)
    return (
      <div className="mocanvas-text-label" style={outerStyle}>
        <div style={{ ...textStyle, opacity: empty && placeholder ? 0.5 : 1 }}>{shown}</div>
      </div>
    )
  }

  // A host that installed a rich-text editor (a TipTap one, in practice) gets
  // the full surface for a rich-text label; everything else edits the plain text.
  const factory = getRichTextEditorFactory()
  const useRichSurface = factory !== null && props.onChangeRichText !== undefined && rich !== null
  return (
    <div className="mocanvas-text-label mocanvas-text-label-editing" style={outerStyle}>
      {useRichSurface ? (
        <RichTextEditorSurface {...props} richText={rich!} onChangeRichText={props.onChangeRichText!} factory={factory!} textStyle={textStyle} singleLine={singleLine ?? false} />
      ) : (
        <TextEditor {...props} text={plain} textStyle={textStyle} singleLine={singleLine ?? false} />
      )}
    </div>
  )
}

/**
 * The block rules a rich-text label lays out under — the same ones the
 * measuring probe uses, so the rendered label is the size that was measured.
 * Rendered once per label; the browser deduplicates identical rules and the
 * cost of a repeated `<style>` is far below that of a stylesheet the host has
 * to remember to import.
 */
function RichTextBlockStyles(): ReactNode {
  return <style>{RICH_TEXT_BLOCK_CSS.replace(/__SCOPE__/g, ".mocanvas-rich-text")}</style>
}

interface TextEditorProps extends TextLabelProps {
  textStyle: CSSProperties
  singleLine: boolean
}

function TextEditor(props: TextEditorProps): ReactNode {
  const { text, onChange, onChangeRichText, richText, textStyle, singleLine, wrap, color } = props
  const editor = useEditor()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState(text)
  const valueRef = useRef(text)
  const pendingRef = useRef<string | null>(null)
  const rafRef = useRef(0)
  const timerRef = useRef(0)
  const richRef = useRef(richText)
  richRef.current = richText
  const onChangeRef = useRef<(next: string) => void>(() => {})
  onChangeRef.current = (next: string) => {
    onChange(next)
    // A store that holds `richText` gets the document too. Formatting the
    // plain-text surface cannot express survives an edit that did not change
    // the text; see `applyPlainTextToRichText`.
    onChangeRichText?.(applyPlainTextToRichText(richRef.current, next))
  }

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

interface RichTextEditorSurfaceProps extends TextEditorProps {
  richText: RichText
  onChangeRichText(value: RichText): void
  factory: RichTextEditorFactory
}

/**
 * The WYSIWYG editing surface, mounted by whatever factory the host registered
 * with `registerRichTextEditorFactory` — a TipTap editor, for an app that has
 * the optional peer dependency.
 *
 * mocanvas only owns the box: the factory builds the editor into `container`,
 * reports documents back through `onChange`, and tears everything down in
 * `destroy`. Nothing about TipTap is imported here, so a build without it never
 * reaches this component.
 */
function RichTextEditorSurface({ richText, onChangeRichText, factory, textStyle, singleLine }: RichTextEditorSurfaceProps): ReactNode {
  const editor = useEditor()
  const ref = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChangeRichText)
  onChangeRef.current = onChangeRichText
  const initial = useRef(richText)

  useLayoutEffect(() => {
    const container = ref.current
    if (!container) return
    const handle = factory({
      container,
      initialValue: initial.current,
      extensions: getRichTextExtensions(editor),
      singleLine,
      onChange: (value) => onChangeRef.current(value as RichText),
      onFinish: () => {
        editor.setEditingShape(null)
        editor.complete()
      },
    })
    handle.focus()
    return () => handle.destroy()
  }, [editor, factory, singleLine])

  return (
    <div
      ref={ref}
      className="mocanvas-rich-text mocanvas-rich-text-editor"
      style={{ ...textStyle, userSelect: "text", WebkitUserSelect: "text", pointerEvents: "auto", cursor: "text" }}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onKeyDown={stop}
      onKeyUp={stop}
      onContextMenu={stop}
    />
  )
}
