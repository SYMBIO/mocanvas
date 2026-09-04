import type { ComponentType } from "react"
import type { Editor } from "../editor/Editor"

/**
 * The UI override surface: the types an app uses to replace mocanvas's chrome
 * and to add its own tools to it.
 *
 * Two independent maps, deliberately kept apart:
 *
 * - {@link TLComponents} replaces *chrome* — the toolbar, the style panel, the
 *   context menu, the layers rendered in front of and behind the canvas.
 * - {@link TLUiOverrides} rewrites the *data* the default chrome renders from:
 *   the tool items and the actions, including their keyboard shortcuts.
 *
 * An app that wants its own toolbar usually needs both: `overrides.tools` to
 * register the tool item (which is what gives it a shortcut at all), and
 * `components.Toolbar` to render it.
 */

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/**
 * A component slot. `undefined` keeps mocanvas's default, `null` removes the
 * slot entirely, and a component replaces it.
 */
export type TLUiComponentSlot<P = object> = ComponentType<P> | null | undefined

/**
 * The chrome override map, passed as `components`.
 *
 * ## What is *not* here
 * The selection and interaction overlays — brush, zoom brush, scribble, snap
 * indicators, handles, selection foreground/background, shape indicators,
 * collaborator brush/scribble/hint — are **not** component slots. They are
 * drawn onto the canvas itself rather than composed as React elements, so
 * overriding them is a rendering concern, not a chrome concern. The canvas
 * takes its own, much smaller override map (`<Canvas components={…}>`) for the
 * few of those it does let you replace.
 *
 * Every slot is optional. A slot's component is rendered with no props unless
 * noted; read the editor with `useEditor()`.
 */
export interface TLComponents {
  /**
   * The canvas surface itself. Provided so chrome that has to *wrap* the
   * canvas — a right-click menu, which needs the canvas inside its trigger —
   * can render it in place; read it with {@link useEditorComponents}.
   */
  Canvas?: TLUiComponentSlot
  /** Behind the canvas: the page's backdrop plate. */
  Background?: TLUiComponentSlot
  /** Behind the shapes, in page space: a grid, a guide layer. */
  Grid?: TLUiComponentSlot
  /** Behind the shapes, in page space, above the grid. */
  OnTheCanvas?: TLUiComponentSlot
  /** Above the shapes, in container space: pins, badges, floating bars. */
  InFrontOfTheCanvas?: TLUiComponentSlot
  /** The tool bar. */
  Toolbar?: TLUiComponentSlot
  /** The style panel for the current selection. */
  StylePanel?: TLUiComponentSlot
  /** The zoom / navigation cluster. */
  NavigationPanel?: TLUiComponentSlot
  /** The zoom menu inside the navigation panel. */
  ZoomMenu?: TLUiComponentSlot
  /** The top-left menu plate. */
  MenuPanel?: TLUiComponentSlot
  /** The page picker. */
  PageMenu?: TLUiComponentSlot
  /** The selection actions menu. */
  ActionsMenu?: TLUiComponentSlot
  /** The quick-actions row. */
  QuickActions?: TLUiComponentSlot
  /** The small helper buttons above the toolbar (e.g. "back to content"). */
  HelperButtons?: TLUiComponentSlot
  /** The right-click menu. */
  ContextMenu?: TLUiComponentSlot
  /** The contextual bar shown for a selected image. */
  ImageToolbar?: TLUiComponentSlot
  /** The contextual bar shown for a selected video. */
  VideoToolbar?: TLUiComponentSlot
  /** The top-right panel: share, collaborators. */
  SharePanel?: TLUiComponentSlot
  /** The top strip above the menu panel. */
  TopPanel?: TLUiComponentSlot
  /** The frame-statistics / debug chip. */
  DebugPanel?: TLUiComponentSlot
  /** The keyboard-shortcuts dialog. */
  KeyboardShortcutsDialog?: TLUiComponentSlot
  /** Shown while the engine is loading. */
  LoadingScreen?: TLUiComponentSlot
  /** The tooltip layer. */
  Tooltip?: TLUiComponentSlot
}

/** The chrome map after mocanvas's defaults have been merged in. */
export type TLComponentsResolved = { [K in keyof TLComponents]-?: ComponentType | null }

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * Where a UI item was activated from. Passed to `onSelect` so an app can tell
 * a toolbar click from a keyboard shortcut when it reports analytics.
 */
export type TLUiEventSource = "toolbar" | "kbd" | "menu" | "context-menu" | "unknown"

/**
 * One entry in the UI tool list: everything the chrome needs to draw a tool
 * and to bind its shortcut. Registering an item is what gives a tool a
 * keyboard shortcut — a state-chart tool that is registered on the editor but
 * has no item here is reachable only through `editor.setCurrentTool`.
 */
export interface TLUiToolItem {
  /**
   * The item's id. For a tool that maps one-to-one onto a state-chart node
   * this is the tool id; for one of several items driving the same node (the
   * geo shapes all drive `geo`) it is the item's own id, and `meta` carries
   * what distinguishes it.
   */
  id: string
  /** Display text. Already localized: mocanvas does not translate it. */
  label: string
  /** Icon name. An unknown name falls back to the label's initial. */
  icon: string
  /**
   * Keyboard shortcut. Comma-separated alternatives, so a tool can answer to
   * more than one key (`"d,b,x"`); merge into this rather than replacing it
   * when adding a binding, or you silently drop the others.
   */
  kbd?: string
  /** Keep the shortcut live on a read-only editor. Defaults to `false`. */
  readonlyOk?: boolean
  /** Render the item, but inert. */
  disabled?: boolean
  /** Activate the tool. */
  onSelect(source?: TLUiEventSource): void
  /**
   * Anything the item needs beyond the above. mocanvas reads one key:
   * `geo`, the geo kind an item selects, so the toolbar can show which of the
   * geo items is the active one.
   */
  meta?: Record<string, unknown>
}

/** The UI tool list, keyed by {@link TLUiToolItem.id}. */
export type TLUiToolsContextType = Record<string, TLUiToolItem>

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** One entry in the UI action list — undo, delete, group, and friends. */
export interface TLUiActionItem {
  id: string
  label: string
  icon?: string
  kbd?: string
  readonlyOk?: boolean
  disabled?: boolean
  onSelect(source?: TLUiEventSource): void
  meta?: Record<string, unknown>
}

/** The UI action list, keyed by {@link TLUiActionItem.id}. */
export type TLUiActionsContextType = Record<string, TLUiActionItem>

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

/**
 * Editor-side helpers handed to an override callback, so it can build items
 * that do the things the default chrome does without reaching for the DOM.
 *
 * SEMANTICS-ASSUMED: the consumer's overrides never read this argument (both
 * of its override functions take it and ignore it), so its exact membership is
 * not pinned by any call site. It is kept to the two things an item genuinely
 * cannot do for itself — resolve a UI string, and run the editor's own file
 * picker — rather than guessed at more widely.
 */
export interface TLUiOverrideHelpers {
  /**
   * Resolve a UI string id to its display text. An id mocanvas does not know
   * passes through unchanged, so a localized literal is always safe to use as
   * a label.
   */
  msg(id: string): string
  /**
   * Open the editor's file picker and put the chosen files onto the current
   * page. Uses the editor's own container document, so it works in an iframe
   * or a popped-out window.
   */
  insertMedia(): void
}

/**
 * Rewrite the UI's tool and action lists, passed as `overrides`.
 *
 * Each callback receives the list built so far and returns the list to use.
 * Mutating the argument and returning it is supported (it is a fresh object
 * per build), but returning a new object is clearer.
 *
 * There is one `overrides` slot, so an app composing two of these chains them
 * itself: call the inner one first, then work on its result. That ordering
 * matters — a chained override that adds a shortcut to a tool the inner one
 * registers has to run second, or the tool is not there yet.
 */
export interface TLUiOverrides {
  /** Rewrite the tool list. */
  tools?(editor: Editor, tools: TLUiToolsContextType, helpers: TLUiOverrideHelpers): TLUiToolsContextType
  /** Rewrite the action list. */
  actions?(editor: Editor, actions: TLUiActionsContextType, helpers: TLUiOverrideHelpers): TLUiActionsContextType
}
