import { MocanvasUiProvider, useEditor, useMaybeEditor, type TLUiOverrides, type TLUiTranslations } from "@mocanvas/editor"
import { useMemo, type ReactNode } from "react"
import { buildDefaultActionItems, buildDefaultToolItems } from "./tools-context"
import { BreakPointProvider } from "./ui-breakpoint"
import { TldrawUiA11yProvider, useA11y } from "./ui-a11y"
import { TldrawUiComponentsProvider, type TLUiComponents } from "./ui-components"
import { TldrawUiDialogsProvider, useDialogs } from "./ui-dialogs"
import { TldrawUiEventsProvider, type TLUiEventHandler } from "./ui-events"
import { TldrawUiToastsProvider, useToasts } from "./ui-toasts"
import { TldrawUiTooltipProvider } from "./ui-tooltip"
import { TldrawUiTranslationProvider, useTranslation } from "./ui-translation"

/**
 * One provider that mounts every UI context in the right order.
 *
 * The order is not arbitrary: translations read the editor's locale, the
 * announcer and the toasts are rendered by components that read the
 * breakpoint, and the tooltip layer must be inside the container provider so
 * it portals into the editor rather than the page. Getting this wrong produces
 * failures that only show up in an embedded editor, so it is written down once
 * here instead of at every call site.
 */
export interface TLUiContextProviderProps {
  /** Reported UI events. */
  onUiEvent?: TLUiEventHandler
  /** The UI chrome map. */
  components?: TLUiComponents
  /** Extra UI strings, keyed by locale then id. */
  overrides?: TLUiOverrides
  /** Pin the layout to its narrowest form. */
  forceMobile?: boolean
  children?: ReactNode
}

/**
 * Publishes the tool and action lists the chrome renders from.
 *
 * This is the context `useTools()` and `useActions()` read, and nothing else
 * builds it: without this wrapper every list-driven component — every toolbar
 * button, every menu item — sees an empty list and correctly renders nothing,
 * which is indistinguishable from an editor that has no tools. It therefore
 * belongs here, beside the other UI contexts, rather than at one call site.
 *
 * The editor is read from context instead of taken as a prop so that
 * {@link TldrawUiContextProvider} keeps working standalone; with no editor
 * above it there is nothing to build a list from, so it passes through.
 */
function UiListsProvider({ overrides, children }: { overrides?: TLUiOverrides; children?: ReactNode }) {
  const editor = useMaybeEditor()
  if (!editor) return <>{children}</>
  return (
    <MocanvasUiProvider
      editor={editor}
      defaultTools={buildDefaultToolItems}
      defaultActions={buildDefaultActionItems}
      {...(overrides ? { overrides } : {})}
    >
      {children}
    </MocanvasUiProvider>
  )
}

/** Mounts the UI contexts. Render inside an editor provider. */
export function TldrawUiContextProvider({ onUiEvent, components, overrides, forceMobile, children }: TLUiContextProviderProps) {
  const translations: TLUiTranslations | undefined = overrides?.translations
  return (
    <TldrawUiEventsProvider {...(onUiEvent ? { onEvent: onUiEvent } : {})}>
      <TldrawUiTranslationProvider {...(translations ? { overrides: translations } : {})}>
        <BreakPointProvider {...(forceMobile ? { forceMobile } : {})}>
          <TldrawUiA11yProvider>
            <TldrawUiToastsProvider>
              <TldrawUiDialogsProvider>
                <TldrawUiComponentsProvider {...(components ? { overrides: components } : {})}>
                  <UiListsProvider {...(overrides ? { overrides } : {})}>
                    <TldrawUiTooltipProvider>{children}</TldrawUiTooltipProvider>
                  </UiListsProvider>
                </TldrawUiComponentsProvider>
              </TldrawUiDialogsProvider>
            </TldrawUiToastsProvider>
          </TldrawUiA11yProvider>
        </BreakPointProvider>
      </TldrawUiTranslationProvider>
    </TldrawUiEventsProvider>
  )
}

/**
 * Everything a menu item's `onSelect` normally reaches for, in one object.
 *
 * A menu item that wants to raise a toast, open a dialog, announce something
 * or resolve a string would otherwise call four hooks — and could not, because
 * an item is data rather than a component. Bundling them is what lets an
 * action be defined as a plain function that takes these.
 */
export function useDefaultHelpers() {
  const editor = useEditor()
  const { addToast, removeToast, clearToasts } = useToasts()
  const { addDialog, removeDialog, clearDialogs } = useDialogs()
  const { announce } = useA11y()
  const msg = useTranslation()

  return useMemo(
    () => ({
      addToast,
      removeToast,
      clearToasts,
      addDialog,
      removeDialog,
      clearDialogs,
      announce,
      msg,
      /** Open the editor's file picker and drop what is chosen onto the page. */
      insertMedia: () => {
        const doc = editor.getContainerDocument()
        if (!doc) return
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
    }),
    [editor, addToast, removeToast, clearToasts, addDialog, removeDialog, clearDialogs, announce, msg],
  )
}

/** What {@link useDefaultHelpers} hands back. */
export type TLUiDefaultHelpers = ReturnType<typeof useDefaultHelpers>
