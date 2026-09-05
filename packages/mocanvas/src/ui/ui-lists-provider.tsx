import { useEditor, useValue, type TLUiActionsContextType, type TLUiToolsContextType } from "@mocanvas/editor"
import { createContext, useContext, useMemo, type ReactNode } from "react"

/**
 * Standalone providers for the tool and action lists.
 *
 * `MocanvasUiProvider` already builds and publishes both, and is what
 * `TldrawUi` uses. These two exist for the case it does not cover: publishing
 * a *different* list to one subtree — a read-only preview inside an editing
 * app, or a second toolbar driven by a curated subset — without a second
 * editor context.
 *
 * A subtree with neither provider falls through to whatever
 * `MocanvasUiProvider` published, so wrapping is additive.
 */

const ToolsOverrideContext = createContext<TLUiToolsContextType | null>(null)
const ActionsOverrideContext = createContext<TLUiActionsContextType | null>(null)

export interface TLUiToolsProviderProps {
  /** The list to publish, or a function that rewrites the inherited one. */
  tools: TLUiToolsContextType | ((inherited: TLUiToolsContextType) => TLUiToolsContextType)
  children?: ReactNode
}

/** Publishes a tool list to its subtree. */
export function TldrawUiToolsProvider({ tools, children }: TLUiToolsProviderProps) {
  const inherited = useContext(ToolsOverrideContext) ?? {}
  const value = useMemo(() => (typeof tools === "function" ? tools(inherited) : tools), [tools, inherited])
  return <ToolsOverrideContext.Provider value={value}>{children}</ToolsOverrideContext.Provider>
}

export interface ActionsProviderProps {
  /** The list to publish, or a function that rewrites the inherited one. */
  actions: TLUiActionsContextType | ((inherited: TLUiActionsContextType) => TLUiActionsContextType)
  children?: ReactNode
}

/** Publishes an action list to its subtree. */
export function TldrawUiActionsProvider({ actions, children }: ActionsProviderProps) {
  const inherited = useContext(ActionsOverrideContext) ?? {}
  const value = useMemo(() => (typeof actions === "function" ? actions(inherited) : actions), [actions, inherited])
  return <ActionsOverrideContext.Provider value={value}>{children}</ActionsOverrideContext.Provider>
}

/** The tool list published by the nearest {@link TldrawUiToolsProvider}, if any. */
export function useToolsOverride(): TLUiToolsContextType | null {
  return useContext(ToolsOverrideContext)
}

/** The action list published by the nearest {@link TldrawUiActionsProvider}, if any. */
export function useActionsOverride(): TLUiActionsContextType | null {
  return useContext(ActionsOverrideContext)
}

/**
 * Whether the editor is in a state where the UI lists are worth reading at
 * all — an editor that has been disposed still renders, but nothing it lists
 * can be acted on.
 */
export function useUiListsAreLive(): boolean {
  const editor = useEditor()
  return useValue("uiListsAreLive", () => !editor.getIsDisposed(), [editor])
}
