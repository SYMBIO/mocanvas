/**
 * The WYSIWYG surface a label is edited in: a TipTap editor, mounted into the
 * container the label hands over.
 *
 * ## Why this exists at all
 *
 * Everything mocanvas *does* with rich text — measure it, lay it out, rasterize
 * it, export it, round-trip it through a `.tldr` — is derived from the document
 * JSON and needs no editor. Only editing does. That is why the seam in
 * `tiptap-extensions` is a seam and not a hard call, and why a host can replace
 * this with its own.
 *
 * Without it a label edits through a plain `<textarea>` over the text projection
 * of the document, which costs two things at once: no formatting commands, so
 * `cmd+B` does nothing; and a visible jump on entering edit mode, because a
 * textarea lays text out its own way and the static label is HTML. Both are the
 * same missing piece.
 *
 * ## Why StarterKit, minus three
 *
 * The document model a mocanvas label understands is described by
 * `tipTapDefaultExtensions`, and StarterKit covers it with three exceptions that
 * have no place inside a shape's label: a blockquote, a code block and a
 * horizontal rule are all block furniture for a page, not a caption. They are
 * turned off rather than left to produce documents the renderer would then have
 * to be taught to draw.
 */
import { Editor as TipTapEditor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import type { RichTextEditorFactory, RichTextEditorHandle, RichTextEditorMountOptions, RichTextExtension } from "./tiptap-extensions"
import { registerRichTextEditorFactory } from "./tiptap-extensions"
import type { RichTextNode } from "./rich-text"

/** Block types a label has no use for; see the note above. */
const DISABLED_STARTER_KIT_NODES = { blockquote: false, codeBlock: false, horizontalRule: false } as const

/**
 * Whether an entry of the extension list is a real TipTap extension rather than
 * one of the plain descriptions `tipTapDefaultExtensions` is made of.
 *
 * The list serves both: the description-driven paths read `kind` and `tag` off
 * it, and a host that has TipTap can put actual extensions in the same array.
 * Only the real ones can be handed to an editor, and a description passed to one
 * throws, so they are told apart by the shape TipTap itself gives them.
 */
function isTipTapExtension(entry: RichTextExtension): boolean {
  const e = entry as { type?: unknown; config?: unknown }
  return typeof e.type === "string" && typeof e.config === "object" && e.config !== null
}

/** Mount a TipTap editor into `container` and report what the user types. */
export const tipTapRichTextEditorFactory: RichTextEditorFactory = (options: RichTextEditorMountOptions): RichTextEditorHandle => {
  const { container, initialValue, extensions, singleLine, onChange, onFinish } = options

  const editor = new TipTapEditor({
    element: container,
    content: initialValue,
    extensions: [StarterKit.configure(DISABLED_STARTER_KIT_NODES), ...extensions.filter(isTipTapExtension)] as never,
    editorProps: {
      handleKeyDown: (_view, event) => {
        if (event.key === "Escape") {
          onFinish()
          return true
        }
        // A single-line label — a frame's name — takes Enter as "done" and only
        // shift+Enter as a break, the same bargain every single-line field makes.
        if (event.key === "Enter" && singleLine && !event.shiftKey) {
          onFinish()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: e }) => {
      onChange(e.getJSON() as RichTextNode & { type: "doc" })
    },
  })

  // ProseMirror ships a focus ring of its own — a 1px orange outline on the
  // focused editable. On a page it marks the field being typed into; on a canvas
  // the shape is already outlined, and the ring lands *inside* it as a second,
  // differently coloured box. Worse, an outline traces line boxes rather than the
  // block, so on a label of one short line it comes out stepped, which reads as a
  // rendering fault rather than a focus ring.
  const dom = editor.view.dom as HTMLElement
  dom.style.outline = "none"

  return {
    focus() {
      editor.commands.focus("end")
    },
    destroy() {
      // `destroy` also removes the ProseMirror DOM it built, which is what the
      // contract asks for: the container is the label's, not the editor's.
      editor.destroy()
    },
  }
}

/**
 * Install the TipTap surface as the default.
 *
 * Called from the package's install path, so a label is editable with
 * formatting out of the box. A host that wants its own — one already running
 * TipTap, and so wanting the editor built from *its* copy of ProseMirror —
 * calls {@link registerRichTextEditorFactory} afterwards and replaces this.
 */
export function installDefaultRichTextEditor(): () => void {
  return registerRichTextEditorFactory(tipTapRichTextEditorFactory)
}
