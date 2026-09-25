import {
  type TLAnyOverlayUtilConstructor,
  ContainerProvider,
  EditorProvider,
  AssetUrlsProvider,
  Canvas,
  createStore,
  Editor,
  loadEngine,
  type AssetStore,
  type CanvasProps,
  type BindingUtilConstructor,
  type CurrentUser,
  type EditorStore,
  type ShapeUtilConstructor,
  type StateNodeConstructor,
  type TLAssetUrls,
  type TLColorScheme,
  type TLComponents,
  type TLTextOptions,
  type TLThemeId,
  type TLThemesInput,
  type TLUiOverrides,
} from "@mocanvas/editor"
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { defaultBindingUtils } from "./bindings"
import { defaultShapeUtils } from "./shapes"
import { defaultTools } from "./tools"
import { defaultOverlayUtils } from "./indicators"
import { TldrawUi } from "./ui/TldrawUi"
import type { TLUiComponents } from "./ui/ui-components"
import { pickCanvasSlots } from "./canvas-slots"
import type { TLUiEventHandler } from "./ui/ui-events"
import { useKeyboardShortcuts } from "./ui/useKeyboardShortcuts"
import { useExternalContent } from "./external/useExternalContent"

/**
 * What `onMount` is: called once with the editor as soon as it exists, and on
 * nothing else. Return a function to run when the editor is torn down — the
 * place to undo whatever the handler wired up.
 */
export type TLOnMountHandler = (editor: Editor) => void | (() => void)

/**
 * The documented name for the props `<Mocanvas />` takes. `MocanvasProps` is the
 * same interface under this library's own name; both are exported so either
 * spelling works.
 */
export type TldrawBaseProps = MocanvasProps

export interface MocanvasProps {
  /** Reuse a store (e.g. for persistence or collaboration). */
  store?: EditorStore
  /** Reported UI events — a menu opened, an action run. */
  onUiEvent?: TLUiEventHandler
  /** Pin the chrome to its narrowest layout, whatever the container's width. */
  forceMobile?: boolean
  /**
   * Replace the canvas overlay painters. Defaults to `defaultOverlayUtils`;
   * pass your own list to swap one out or drop it.
   */
  overlayUtils?: readonly TLAnyOverlayUtilConstructor[]
  /** Extra shape utils beyond the defaults. */
  shapeUtils?: readonly ShapeUtilConstructor[]
  /** Extra binding utils beyond the defaults. */
  bindingUtils?: readonly BindingUtilConstructor[]
  /** Extra tools beyond the defaults. */
  tools?: readonly StateNodeConstructor[]
  initialState?: string
  onMount?: TLOnMountHandler
  /** Hide mocanvas's own panels. The canvas, and any slot the app filled, still render. */
  hideUi?: boolean
  showStats?: boolean
  className?: string
  style?: CSSProperties
  children?: ReactNode
  /**
   * The chrome map: which panels render, and what renders them. Includes the
   * `Canvas` slot, which mocanvas fills — see {@link TLComponents}.
   */
  /**
   * Replace or remove a component.
   *
   * Two maps reach this prop and their slot names are disjoint: the editor's
   * canvas-level slots (`TLComponents`) and the UI chrome's panels
   * (`TLUiComponents`). It accepts either or both — an intersection alone would
   * reject a value already typed as just one of them, because neither is
   * assignable to the other.
   */
  components?: TLComponents | TLUiComponents | (TLComponents & TLUiComponents)
  /** Rewrite the tool and action lists the chrome renders from. */
  overrides?: TLUiOverrides
  /**
   * The much smaller *canvas* override map — the selection indicators, the
   * brush, the canvas backdrop. A different thing from `components`, which is
   * chrome; these are drawn on the canvas surface itself.
   */
  canvasComponents?: CanvasProps["components"]
  /**
   * Where asset bytes live. Threaded to both the store this component creates
   * and the editor, so a dropped image is uploaded through the app's own
   * storage. Ignored for the store when `store` is supplied — that store
   * already carries its own.
   */
  assets?: AssetStore
  /** Themes to register, merged over the built-in `default`. */
  themes?: TLThemesInput
  /** Which theme starts out current. */
  initialTheme?: TLThemeId
  /** Light, dark, or follow the host window. */
  colorScheme?: TLColorScheme
  /** Rich-text configuration handed to the editor. */
  textOptions?: TLTextOptions
  /**
   * Who is using this editor: the app-owned holder of their preferences. Pass
   * one to control preferences from app state; omit it and the editor keeps
   * its own.
   */
  user?: CurrentUser
  /**
   * Base paths for files an app self-hosts, published for chrome that needs
   * them via `useAssetUrls()`. mocanvas's own chrome loads none.
   */
  assetUrls?: TLAssetUrls
  /**
   * Accepted and ignored. mocanvas's licence is a written agreement rather
   * than a key the canvas verifies at runtime, so there is nothing to check; the
   * prop exists so an app migrating from a licensed canvas does not have to
   * strip it from every mount, and so that leaving it in place stays a no-op
   * rather than becoming a type error.
   */
  licenseKey?: string
  /** Editor config overrides. */
  options?: ConstructorParameters<typeof Editor>[0]["options"]
}

/** One identity for "no asset urls configured", so the context value is stable. */
const EMPTY_ASSET_URLS: TLAssetUrls = {}

/** Batteries-included canvas: default shapes, tools, shortcuts and UI. */
/**
 * Say so, once, when the stylesheet never arrived.
 *
 * Every panel's metrics — button size, padding, the plate's own colours — are
 * custom properties declared in `mocanvas.css`. Without it the chrome still
 * renders, and renders wrong in ways that read as bugs in the library: buttons
 * at their content's size, a toolbar with no plate behind it. The component
 * cannot import the stylesheet itself (a bundler that cannot handle a CSS
 * import from a dependency is a worse failure than this warning), so it checks
 * and says so.
 *
 * Dev only: the check costs a `getComputedStyle` per mount, and in production
 * the branch is stripped.
 *
 * It deliberately does *not* check `--tl-zoom`, the tldraw-compat variable.
 * That one comes from `@mocanvas/compat/compat.css`, which most consumers have
 * no reason to load, so a warning about it here would cry wolf at everyone who
 * is not migrating. `assertCompatStylesLoaded` in `@mocanvas/compat` is the
 * check for that, and a migrating app calls it where it wants it.
 */
function warnIfStylesheetMissing(container: HTMLElement | null): void {
  if (process.env["NODE_ENV"] === "production") return
  if (!container || typeof getComputedStyle !== "function") return
  const probe = container.querySelector(".mocanvas") ?? container
  if (getComputedStyle(probe).getPropertyValue("--mocanvas-ui-panel").trim()) return
  // eslint-disable-next-line no-console
  console.warn(
    "[mocanvas] The chrome's stylesheet is not loaded, so panels will render without their metrics or colours. " +
      'Add `import "@mocanvas/mocanvas/mocanvas.css"` where you import the component.',
  )
}

export function Mocanvas(props: MocanvasProps) {
  const {
    store,
    shapeUtils,
    bindingUtils,
    tools,
    initialState,
    onMount,
    hideUi,
    overlayUtils,
    onUiEvent,
    forceMobile,
    showStats,
    className,
    style,
    children,
    components,
    overrides,
    canvasComponents,
    assets,
    themes,
    initialTheme,
    colorScheme,
    textOptions,
    user,
    assetUrls,
    options,
  } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const [editor, setEditor] = useState<Editor | null>(null)

  useEffect(() => warnIfStylesheetMissing(containerRef.current), [])

  useEffect(() => {
    let disposed = false
    let ed: Editor | null = null
    let cleanup: void | (() => void)
    let unregister: (() => void) | undefined
    loadEngine().then((engine) => {
      if (disposed) {
        engine.dispose()
        return
      }
      const allShapeUtils = [...defaultShapeUtils, ...(shapeUtils ?? [])]
      const allBindingUtils = [...defaultBindingUtils, ...(bindingUtils ?? [])]
      ed = new Editor({
        // The util lists go to the store as well as to the editor: that is what
        // registers their `static migrations`, so a board saved before a prop
        // existed is backfilled on load rather than refused by the validator.
        store: store ?? createStore({ shapeUtils: allShapeUtils, bindingUtils: allBindingUtils, ...(assets ? { assets } : {}) }),
        shapeUtils: allShapeUtils,
        bindingUtils: allBindingUtils,
        tools: [...defaultTools, ...(tools ?? [])],
        // The overlay painters — brush, scribble, snap lines, handles, the
        // selection foreground and the collaborator set. An app that replaces
        // one passes its own list, the way it does for shape utils.
        overlayUtils: overlayUtils ?? defaultOverlayUtils,
        engine,
        ...(initialState ? { initialState } : {}),
        getContainer: () => containerRef.current!,
        ...(assets ? { assets } : {}),
        ...(themes ? { themes } : {}),
        ...(initialTheme ? { initialTheme } : {}),
        ...(colorScheme ? { colorScheme } : {}),
        ...(textOptions ? { textOptions } : {}),
        ...(user ? { user } : {}),
        ...(options ? { options } : {}),
      })
      setEditor(ed)
      // `emit("mount")` is what enrols the editor in `tleditors` — the editor
      // does it itself — so it comes before `onMount`, whose handler may reach
      // for `tleditors.getMounted()` and expect to find this editor there.
      ed.emit("mount")
      cleanup = onMount?.(ed)
    })
    return () => {
      disposed = true
      unregister?.()
      unregister = undefined
      cleanup?.()
      ed?.dispose()
      setEditor(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  // The UI tool list binds the plain-key tool switches whenever the chrome is
  // mounted, so the hard-coded set is only wanted on a chrome-less editor.
  useKeyboardShortcuts(editor, { tools: hideUi === true })
  useExternalContent(editor, containerRef)

  // The canvas goes through the `Canvas` chrome slot rather than wrapping the
  // chrome, so a `components.ContextMenu` can render it inside its own trigger.
  // tldraw keeps the editor's own layers in the same `components` map as the
  // panels, so an app that passes `Background`, `Grid` or `InFrontOfTheCanvas`
  // there means the canvas. Route them to it: the chrome cannot render them,
  // and silently dropping them loses a whole layer of the app — a toolbar
  // pinned over the selection, comment pins, an agent's cursor — with nothing
  // on screen to say why. `canvasComponents` still wins where both name a slot,
  // being the more specific prop.
  const mergedCanvasComponents = useMemo(() => {
    const fromComponents = pickCanvasSlots(components as Record<string, unknown> | undefined)
    if (!fromComponents && !canvasComponents) return undefined
    return { ...fromComponents, ...canvasComponents }
  }, [components, canvasComponents])

  const canvas = useMemo(
    () =>
      editor ? (
        <Canvas editor={editor} {...(mergedCanvasComponents ? { components: mergedCanvasComponents } : {})}>
          {children}
        </Canvas>
      ) : null,
    [editor, mergedCanvasComponents, children],
  )

  return (
    <AssetUrlsProvider assetUrls={assetUrls ?? EMPTY_ASSET_URLS}>
      {/*
        `containerType` makes this element a query container named
        `mocanvas-ui`, which is how the chrome's stylesheet asks how much room
        it has. It cannot ask a media query: the breakpoint provider measures
        this element precisely because an editor in a 600px column of a 1600px
        window is a narrow editor, and the window does not know that. Until
        this was here the stylesheet asked anyway, and such an editor was
        handed the desktop reservation — `calc(100% - 624px)` of a 606px
        container — so the toolbar's width budget went negative and it stacked
        one button per row down the middle of the canvas.
      */}
      <div
        ref={containerRef}
        className={className}
        style={{ position: "relative", width: "100%", height: "100%", containerType: "inline-size", containerName: "mocanvas-ui", ...style }}
      >
        {editor ? (
          // `TldrawUi` is the documented chrome: it owns the context
          // providers the component slots read from, and renders the canvas as
          // its child rather than taking it as a prop.
          //
          // `ContainerProvider` publishes the element above: the chrome needs
          // it to portal its floating layers out of whichever panel opened
          // them — a popover left inside the toolbar is trapped in that
          // panel's stacking context and paints *under* its neighbours — and
          // to measure the editor for the breakpoint, which is what makes the
          // chrome respond to an embed's width rather than the window's.
          <EditorProvider editor={editor}>
            <ContainerProvider container={editor.getContainer()}>
              <TldrawUi
                {...(components ? { components: components as TLUiComponents } : {})}
                {...(overrides ? { overrides } : {})}
                {...(onUiEvent ? { onUiEvent } : {})}
                {...(forceMobile ? { forceMobile } : {})}
                hideUi={hideUi === true}
              >
                {canvas}
              </TldrawUi>
            </ContainerProvider>
          </EditorProvider>
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#9ca3af", fontFamily: "system-ui" }}>loading engine…</div>
        )}
      </div>
    </AssetUrlsProvider>
  )
}
