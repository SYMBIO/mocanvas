/**
 * The TipTap side of rich text — for the apps that have TipTap.
 *
 * mocanvas measures, lays out, rasterizes, exports and round-trips rich text
 * with no TipTap at all; the library is an *optional peer dependency* and is
 * needed only to edit a label in a WYSIWYG surface. Two ProseMirror instances
 * on one page break schema identity in ways that are miserable to diagnose, so
 * an app that already ships TipTap must keep exactly one copy — which is
 * precisely what a peer dependency enforces.
 *
 * Everything here therefore imports TipTap *dynamically*, from a module id
 * built at runtime, so a bundler in an app that never calls these does not try
 * to resolve them.
 */

import { RICH_TEXT_MARKS, RICH_TEXT_NODES, type RichTextExtension } from "./tiptap-extensions"

/** The `StarterKit` options an app may override. Structural, so TipTap's own type fits. */
export interface TipTapStarterKitOptions {
  [option: string]: unknown
}

/**
 * mocanvas's default TipTap extension set, with `StarterKit` configured.
 *
 * Returns TipTap `Extension` instances when the peer dependency is installed.
 * When it is not, it returns the description-driven default set instead — the
 * same list `tipTapDefaultExtensions` holds — so a caller that only wanted to
 * pass something to `textOptions.tipTapConfig.extensions` still gets a working
 * configuration rather than a crash. A caller that genuinely needs live TipTap
 * extensions can tell the two apart: the descriptions carry a `kind` field and
 * real extensions do not.
 */
export function getTipTapDefaultExtensions(starterKitOptions: Partial<TipTapStarterKitOptions> = {}): readonly RichTextExtension[] {
  const starterKit = loadedStarterKit
  if (!starterKit) return [...RICH_TEXT_NODES, ...RICH_TEXT_MARKS]
  const configured = typeof starterKit.configure === "function" ? starterKit.configure(starterKitOptions) : starterKit
  return [configured as RichTextExtension, KeyboardShiftEnterTweakExtension]
}

interface ConfigurableExtension extends RichTextExtension {
  configure?(options: object): RichTextExtension
}

let loadedStarterKit: ConfigurableExtension | null = null

/**
 * Load TipTap's `StarterKit` so {@link getTipTapDefaultExtensions} can return
 * real extensions.
 *
 * Separate from `getTipTapDefaultExtensions` because that one has to be
 * synchronous — it is called while building the editor's options object — and
 * a dynamic import is not. An app calls this once at startup and then uses the
 * synchronous getter everywhere.
 */
export async function loadTipTapDefaultExtensions(): Promise<readonly RichTextExtension[]> {
  if (!loadedStarterKit) {
    const moduleId = "@tiptap/starter-kit"
    let loaded: unknown
    try {
      loaded = await import(/* @vite-ignore */ /* webpackIgnore: true */ moduleId)
    } catch (cause) {
      throw new Error(
        "mocanvas: `@tiptap/starter-kit` is an optional peer dependency and is not installed. Run `npm install @tiptap/starter-kit@^3 @tiptap/core@^3 @tiptap/pm@^3`, or use `tipTapDefaultExtensions` instead.",
        { cause },
      )
    }
    loadedStarterKit = ((loaded as { default?: unknown }).default ?? loaded) as ConfigurableExtension
  }
  return getTipTapDefaultExtensions()
}

/**
 * Makes Shift+Enter insert a line break instead of splitting the block.
 *
 * ProseMirror's default is the other way round, which is wrong for a canvas
 * label: a note or a geo label is one block of text with several lines in it,
 * not a document of paragraphs, and Enter has to commit the edit on a
 * single-line label. Binding the break to Shift+Enter is what makes both
 * behaviours available without a modifier key doing two jobs.
 *
 * Declared as a description rather than as a live TipTap extension so importing
 * it costs nothing; the editor factory an app registers is what turns it into
 * a real key binding.
 */
export const KeyboardShiftEnterTweakExtension: RichTextExtension & {
  kind: "keymap"
  keys: Readonly<Record<string, string>>
} = {
  name: "keyboardShiftEnterTweak",
  kind: "keymap",
  keys: { "Shift-Enter": "setHardBreak" },
}
