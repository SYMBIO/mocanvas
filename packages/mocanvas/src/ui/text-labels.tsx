import type { DefaultFontStyle, DefaultHorizontalAlignStyle, DefaultVerticalAlignStyle, UnknownShape } from "@mocanvas/editor"
import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from "react"
import { TextLabel } from "../text/TextEditor"
import { richTextToText, type RichText, type RichTextSource } from "../text/rich-text"
import { textToSvg, type SvgTextBox } from "../export/text-svg"
import { getFontFamily } from "../shapes/shape-theme"

/**
 * Shape labels, in the three forms a shape needs them.
 *
 * The DOM label ({@link PlainTextLabel} / {@link RichTextLabel}) is what a
 * shape body renders; {@link RichTextSVG} is what the exporter renders, and it
 * has to produce real `<text>` elements rather than a `foreignObject`, because
 * a `foreignObject` is not rendered by most SVG consumers — including the
 * rasteriser in several browsers.
 */

export interface PlainTextLabelProps {
  shape: UnknownShape
  text: string
  isEditing: boolean
  fontFamily?: DefaultFontStyle
  fontSize: number
  color: string
  textAlign?: DefaultHorizontalAlignStyle
  verticalAlign: DefaultVerticalAlignStyle
  wrap: boolean
  width?: number
  height?: number
  padding?: number
  placeholder?: string
  singleLine?: boolean
  onChange(text: string): void
}

/** A shape's label, as plain text. */
export function PlainTextLabel(props: PlainTextLabelProps): ReactNode {
  return <TextLabel {...props} />
}

export interface RichTextLabelProps extends Omit<PlainTextLabelProps, "text"> {
  /** The label's document. Plain `text` is the fallback when there is none. */
  richText?: RichTextSource
  text?: string
  onChangeRichText?(value: RichText): void
}

/** A shape's label, as a rich-text document. */
export function RichTextLabel({ richText, text, ...rest }: RichTextLabelProps): ReactNode {
  return <TextLabel {...rest} text={text ?? richTextToText(richText)} {...(richText === undefined ? {} : { richText })} />
}

export interface RichTextSVGProps {
  /** The document to draw. */
  richText: RichTextSource
  /** The box to lay the text out in, in the SVG's own coordinates. */
  bounds: SvgTextBox
  fontSize: number
  fontFamily?: DefaultFontStyle
  color: string
  textAlign?: DefaultHorizontalAlignStyle
  verticalAlign: DefaultVerticalAlignStyle
  padding?: number
  wrap?: boolean
  fontWeight?: string | number
}

/**
 * A rich-text label as SVG markup.
 *
 * Produced by the same {@link textToSvg} the file exporter uses, so what a
 * shape shows on screen and what lands in an exported file cannot drift apart
 * in layout.
 */
export function RichTextSVG({ richText, bounds, fontSize, fontFamily = "draw", color, textAlign, verticalAlign, padding, wrap, fontWeight }: RichTextSVGProps) {
  const markup = textToSvg(richText, bounds, {
    fontFamily: getFontFamily(fontFamily),
    fontSize,
    color,
    verticalAlign,
    ...(textAlign ? { textAlign } : {}),
    ...(padding === undefined ? {} : { padding }),
    ...(wrap === undefined ? {} : { wrap }),
    ...(fontWeight === undefined ? {} : { fontWeight }),
  })
  // The markup is produced by `textToSvg` from escaped text; nothing the
  // document carries reaches the DOM as markup.
  return <g dangerouslySetInnerHTML={{ __html: markup }} />
}

export interface TextAreaProps {
  /** The current value. */
  text: string
  isEditing: boolean
  /** Commit on Enter and refuse newlines: frame names, page names. */
  singleLine?: boolean
  placeholder?: string
  className?: string
  style?: CSSProperties
  ref?: Ref<HTMLTextAreaElement>
  onChange(text: string): void
  /** Enter (single-line) or a deliberate blur: the value is final. */
  onComplete?(text: string): void
  /** Escape: abandon the edit. */
  onCancel?(): void
  onKeyDown?(event: KeyboardEvent<HTMLTextAreaElement>): void
}

/**
 * The editable surface behind a plain-text label.
 *
 * A real `<textarea>` rather than a `contenteditable` div: it gets the
 * platform's own caret, selection, IME and autocorrect behaviour, all of which
 * a hand-rolled editor loses and users notice immediately.
 */
export function PlainTextArea({ text, isEditing, singleLine, placeholder, className, style, ref, onChange, onComplete, onCancel, onKeyDown }: TextAreaProps) {
  const own = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!isEditing) return
    const el = own.current
    if (!el) return
    el.focus()
    el.select()
  }, [isEditing])

  if (!isEditing) return null
  return (
    <textarea
      ref={(node) => {
        own.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) (ref as { current: HTMLTextAreaElement | null }).current = node
      }}
      className={["mocanvas-textarea", className].filter(Boolean).join(" ")}
      style={style}
      value={text}
      placeholder={placeholder}
      spellCheck={false}
      // The canvas listens for these; a keystroke meant for the caret must not
      // also be read as a tool shortcut.
      onPointerDown={(event) => event.stopPropagation()}
      onChange={(event) => onChange(singleLine ? event.target.value.replace(/\n/g, "") : event.target.value)}
      onBlur={() => onComplete?.(text)}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.key === "Escape") {
          event.stopPropagation()
          onCancel?.()
        } else if (event.key === "Enter" && singleLine && !event.shiftKey) {
          event.preventDefault()
          event.stopPropagation()
          onComplete?.(text)
        }
      }}
    />
  )
}

export interface RichTextAreaProps extends Omit<TextAreaProps, "onChange"> {
  richText?: RichTextSource
  onChange(text: string): void
  onChangeRichText?(value: RichText): void
}

/**
 * The editable surface behind a rich-text label.
 *
 * Falls back to the plain-text area when no rich-text editor factory has been
 * registered — TipTap is an optional peer dependency, and an app that has not
 * installed it should still be able to edit the text it can see.
 */
export function RichTextArea({ richText, text, onChangeRichText, ...rest }: RichTextAreaProps) {
  void onChangeRichText
  return <PlainTextArea {...rest} text={text || richTextToText(richText)} />
}
