import { createContext, useCallback, useContext, type ReactNode } from "react"
import type { TLUiEventSource } from "@mocanvas/editor"

/**
 * The analytics seam: one callback the whole UI reports through.
 *
 * Every piece of chrome that does something on the user's behalf announces it
 * here rather than reaching for an app's telemetry directly, so a host can
 * instrument the editor by supplying one function instead of replacing panels.
 */

/**
 * The events the default chrome reports, and what each one carries beyond the
 * common `{ source }`.
 *
 * Open-ended on purpose: an app's own chrome reports its own names through the
 * same handler, so the map is what mocanvas promises to send, not a limit on
 * what may be sent.
 */
export interface TLUiEventMap {
  "select-tool": { id: string }
  "toggle-tool-lock": null
  "toggle-grid-mode": null
  "toggle-snap-mode": null
  "toggle-dark-mode": null
  "toggle-focus-mode": null
  "toggle-debug-mode": null
  "toggle-wrap-mode": null
  "toggle-dynamic-size-mode": null
  "toggle-paste-at-cursor": null
  "toggle-edge-scrolling": null
  "toggle-reduce-motion": null
  "toggle-transparent": null
  "toggle-lock": null
  "toggle-auto-size": null
  "change-language": { locale: string }
  "change-page": null
  "change-user-name": null
  "delete-page": null
  "duplicate-page": null
  "move-page": null
  "new-page": null
  "rename-page": null
  "align-shapes": { operation: string }
  "distribute-shapes": { operation: string }
  "stack-shapes": { operation: string }
  "flip-shapes": { operation: string }
  "pack-shapes": null
  "stretch-shapes": { operation: string }
  "reorder-shapes": { operation: string }
  "group-shapes": null
  "ungroup-shapes": null
  "duplicate-shapes": null
  "delete-shapes": null
  "select-all-shapes": null
  "select-none-shapes": null
  "rotate-cw": null
  "rotate-ccw": null
  "edit-link": null
  "convert-to-embed": null
  "convert-to-bookmark": null
  "fit-frame-to-content": null
  "remove-frame": null
  copy: null
  cut: null
  paste: null
  "copy-as": { format: string }
  "export-as": { format: string }
  print: null
  undo: null
  redo: null
  "zoom-in": null
  "zoom-out": null
  "reset-zoom": null
  "zoom-to-fit": null
  "zoom-to-selection": null
  "open-menu": { id: string }
  "close-menu": { id: string }
  "open-url": { url: string }
  "set-style": { id: string; value: unknown }
  "insert-media": null
  "unlock-all": null
  "move-to-page": null
  "share-project": null
  "a11y-repeat-shape-announce": null
}

/** The common half of every reported event: where the user did it. */
export interface TLUiEventData {
  source: TLUiEventSource
  [key: string]: unknown
}

/**
 * What a host supplies as `onUiEvent`. The name is a key of
 * {@link TLUiEventMap} for anything mocanvas reports, and any string for
 * anything an app's own chrome reports.
 */
export type TLUiEventHandler = (name: string, data: TLUiEventData) => void

const EventsContext = createContext<TLUiEventHandler | null>(null)

export interface EventsProviderProps {
  onEvent?: TLUiEventHandler
  children?: ReactNode
}

/** Publishes `onEvent` to {@link useUiEvents}. */
export function TldrawUiEventsProvider({ onEvent, children }: EventsProviderProps) {
  return <EventsContext.Provider value={onEvent ?? null}>{children}</EventsContext.Provider>
}

/**
 * Report a UI event.
 *
 * Always returns a function, so a component can call it unconditionally; with
 * no provider the call is a no-op rather than an error, which is what lets a
 * panel be rendered on its own in a test.
 */
export function useUiEvents(): TLUiEventHandler {
  const handler = useContext(EventsContext)
  return useCallback(
    (name: string, data: TLUiEventData) => {
      handler?.(name, data)
    },
    [handler],
  )
}

/**
 * The value {@link useUiEvents} returns — the handler an app passed as
 * `onUiEvent`, or a no-op.
 *
 * Named separately from {@link TLUiEventHandler} because they answer different
 * questions: the handler type is what an app *writes*, this is what a component
 * *reads*. They are the same function today; keeping the two names means the
 * context can gain a second member later without changing every app's handler
 * signature.
 */
export type TLUiEventContextType = TLUiEventHandler
