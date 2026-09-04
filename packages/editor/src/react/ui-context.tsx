import { useValue } from "@mocanvas/state/react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react"
import type { Editor } from "../editor/Editor"
import type { ShapeId } from "../records/base"
import { EditorProvider, useMaybeEditor } from "./EditorContext"
import type {
  TLComponents,
  TLComponentsResolved,
  TLUiActionsContextType,
  TLUiOverrideHelpers,
  TLUiOverrides,
  TLUiToolItem,
  TLUiToolsContextType,
} from "./ui-types"

/**
 * The UI context: one place holding the chrome map and the tool/action lists
 * after mocanvas's defaults and the app's overrides have been merged.
 *
 * The provider lives above the chrome, so a component an app drops into a
 * {@link TLComponents} slot — its own toolbar, its own context menu — reads
 * exactly the same lists the default chrome would have rendered from.
 */

/** Everything the UI hooks read. */
export interface MocanvasUiContextValue {
  components: TLComponentsResolved
  tools: TLUiToolsContextType
  actions: TLUiActionsContextType
}

const EMPTY_UI: MocanvasUiContextValue = {
  components: {} as TLComponentsResolved,
  tools: {},
  actions: {},
}

const MocanvasUiContext = createContext<MocanvasUiContextValue | null>(null)

/**
 * Builds the list a `TLUiOverrides` callback starts from. Supplied by the
 * package that owns the default chrome (`@mocanvas/mocanvas`), so the editor
 * core carries no icons or labels of its own.
 */
export type TLUiToolsBuilder = (editor: Editor, helpers: TLUiOverrideHelpers) => TLUiToolsContextType
export type TLUiActionsBuilder = (editor: Editor, helpers: TLUiOverrideHelpers) => TLUiActionsContextType

export interface MocanvasUiProviderProps {
  editor: Editor
  /** Chrome overrides. Merged over `defaultComponents`. */
  components?: TLComponents
  /** The default chrome, supplied by whoever owns it. */
  defaultComponents?: TLComponents
  /** Tool/action overrides. */
  overrides?: TLUiOverrides
  /** The tool list the overrides start from. */
  defaultTools?: TLUiToolsBuilder
  /** The action list the overrides start from. */
  defaultActions?: TLUiActionsBuilder
  children?: ReactNode
}

/**
 * Merge chrome. A slot the app left `undefined` keeps the default; a slot the
 * app set to `null` is removed (which is how chrome is hidden); anything else
 * replaces the default.
 *
 * `undefined` cannot mean "remove" here, because that is what an object
 * literal listing only the slots it cares about says about every other slot.
 */
function mergeComponents(defaults: TLComponents, overrides: TLComponents | undefined): TLComponentsResolved {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(defaults)) {
    out[key] = value ?? null
  }
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) continue
      out[key] = value
    }
  }
  return out as TLComponentsResolved
}

/** The helpers handed to an override callback. */
function makeHelpers(editor: Editor): TLUiOverrideHelpers {
  return {
    msg: (id) => id,
    insertMedia: () => {
      const doc = editor.getContainer().ownerDocument
      const input = doc.createElement("input")
      input.type = "file"
      input.multiple = true
      input.accept = "image/*,video/*"
      input.style.display = "none"
      input.addEventListener("change", () => {
        const files = Array.from(input.files ?? [])
        input.remove()
        if (files.length === 0) return
        void editor.putExternalContent({ type: "files", files, point: editor.getViewportPageCenter() })
      })
      doc.body.appendChild(input)
      input.click()
    },
  }
}

/**
 * Provides the merged chrome map and tool/action lists. Also provides the
 * editor, so chrome mounted outside `<Canvas>` — a context menu that has to
 * wrap the canvas, for instance — can still call `useEditor()`.
 */
export function MocanvasUiProvider(props: MocanvasUiProviderProps) {
  const { editor, components, defaultComponents, overrides, defaultTools, defaultActions, children } = props

  const value = useMemo<MocanvasUiContextValue>(() => {
    const helpers = makeHelpers(editor)
    const baseTools = defaultTools ? defaultTools(editor, helpers) : {}
    const baseActions = defaultActions ? defaultActions(editor, helpers) : {}
    return {
      components: mergeComponents(defaultComponents ?? {}, components),
      tools: overrides?.tools ? overrides.tools(editor, baseTools, helpers) : baseTools,
      actions: overrides?.actions ? overrides.actions(editor, baseActions, helpers) : baseActions,
    }
  }, [editor, components, defaultComponents, overrides, defaultTools, defaultActions])

  return (
    <EditorProvider value={editor}>
      <MocanvasUiContext.Provider value={value}>{children}</MocanvasUiContext.Provider>
    </EditorProvider>
  )
}

/**
 * The merged UI context. Outside a {@link MocanvasUiProvider} this is empty
 * rather than an error: a shape body or a stray panel rendered without the
 * chrome should render, not crash.
 */
export function useMocanvasUi(): MocanvasUiContextValue {
  return useContext(MocanvasUiContext) ?? EMPTY_UI
}

/**
 * The chrome map after defaults and overrides. Use it to render a slot from
 * inside another slot — the pattern a context menu needs, since it has to
 * render the `Canvas` inside its own trigger.
 */
export function useEditorComponents(): TLComponentsResolved {
  return useMocanvasUi().components
}

/**
 * The UI tool list after overrides. Keyed by item id; an id that is not
 * registered is `undefined`, which is the normal state on a trimmed or
 * read-only editor — render nothing for it rather than inventing an item.
 */
export function useTools(): TLUiToolsContextType {
  return useMocanvasUi().tools
}

/** The UI action list after overrides. */
export function useActions(): TLUiActionsContextType {
  return useMocanvasUi().actions
}

/**
 * Whether a tool item is the active one, tracked reactively.
 *
 * Takes the item rather than its id, and accepts `undefined`, so a toolbar
 * button can call it before it has decided whether to render at all — a hook
 * cannot be called conditionally.
 *
 * An item carrying `meta.geo` drives the shared `geo` tool, so being active
 * means *both* that `geo` is the current tool and that it is set to that
 * item's kind; otherwise the item's id is compared to the current tool id.
 */
export function useIsToolSelected(tool: TLUiToolItem | undefined): boolean {
  const editor = useMaybeEditor()
  const id = tool?.id
  const geo = typeof tool?.meta?.["geo"] === "string" ? (tool.meta["geo"] as string) : undefined
  return useValue(
    "isToolSelected",
    () => {
      if (!editor || id === undefined) return false
      const current = editor.getCurrentToolId()
      if (geo === undefined) return current === id
      if (current !== "geo") return false
      const node = editor.getStateDescendant("geo") as { geo?: string } | undefined
      return (node?.geo ?? "rectangle") === geo
    },
    [editor, id, geo],
  )
}

/**
 * Whether a shape is being edited — its text caret is live, so its DOM body
 * takes pointer events. With no argument: whether anything is being edited.
 */
export function useIsEditing(shapeId?: ShapeId): boolean {
  const editor = useMaybeEditor()
  return useValue(
    "isEditing",
    () => {
      if (!editor) return false
      const editing = editor.getEditingShapeId()
      return shapeId === undefined ? editing !== null : editing === shapeId
    },
    [editor, shapeId],
  )
}

/**
 * Register a menu as globally open, so the editor can stand down while it is.
 *
 * The editor keeps the set of open menu ids on its instance state; a canvas
 * that knows a menu is open suppresses the interactions that would fight it.
 * Returns the current state and a setter, in the shape a controlled menu
 * component wants (`[open, onOpenChange]`).
 *
 * `onChange` is called with the new value whenever the setter runs — the seam
 * for the work a menu does on open, such as settling an in-flight gesture.
 * The id is removed again when the component unmounts, so a menu that is
 * torn down while open cannot leave the editor suppressed forever.
 */
export function useGlobalMenuIsOpen(
  id: string,
  onChange?: (isOpen: boolean) => void,
): readonly [boolean, (next: boolean) => void] {
  const editor = useMaybeEditor()
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const isOpen = useValue("globalMenuIsOpen", () => editor?.getInstanceState().openMenus.includes(id) ?? false, [editor, id])

  const setIsOpen = useCallback(
    (next: boolean) => {
      if (editor) {
        const open = editor.getInstanceState().openMenus
        const has = open.includes(id)
        if (next && !has) editor.updateInstanceState({ openMenus: [...open, id] })
        else if (!next && has) editor.updateInstanceState({ openMenus: open.filter((m) => m !== id) })
      }
      onChangeRef.current?.(next)
    },
    [editor, id],
  )

  useEffect(() => {
    if (!editor) return
    return () => {
      const open = editor.getInstanceState().openMenus
      if (open.includes(id)) editor.updateInstanceState({ openMenus: open.filter((m) => m !== id) })
    }
  }, [editor, id])

  return [isOpen, setIsOpen] as const
}
