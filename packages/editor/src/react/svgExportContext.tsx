/**
 * The context an export puts around the shapes while it renders them.
 *
 * Export renders shapes *outside* the live canvas — a temporary tree, into a
 * document fragment — so a shape component cannot tell it is being exported,
 * and cannot see the editor state it would normally read. Two things it needs
 * are therefore passed down explicitly here: what the export looks like (colour
 * mode, scale, pixel ratio) and a way to say "wait for me".
 *
 * The waiting part is the load-bearing one. An export takes a snapshot of the
 * DOM at a single instant, and anything still loading at that instant is simply
 * missing from the picture — an image with no `src` yet, a grid that renders its
 * rows asynchronously. There is no error, just a blank.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import type { ShapeSvgContext } from "../shapes/ShapeUtil"
import type { AssetId } from "../records/asset"

/** What a shape can find out about the export it is being rendered into. */
export interface TLSvgExportContext extends ShapeSvgContext {
  /** The logical scale the export is being rendered at. `1` unless asked otherwise. */
  scale: number
  /** The output's device-pixel multiplier, or `null` for a pure SVG export. */
  pixelRatio: number | null
  /**
   * Hold the export open until `promise` settles.
   *
   * The escape hatch for anything that is not ready at first paint. The export
   * waits for every registered promise, up to `options.maxExportDelayMs`, and
   * then gives up — a shape that never resolves delays the export rather than
   * hanging it forever.
   */
  waitUntil(promise: Promise<unknown>): void
  /**
   * Resolve an asset at the size this export needs.
   *
   * Not the same as the on-screen resolution: an export usually wants the
   * original, where the canvas wants whatever is sharp at the current zoom.
   */
  resolveAssetUrl(assetId: AssetId, width: number): Promise<string | null>
}

const SvgExportContext = createContext<TLSvgExportContext | null>(null)

/** Props for {@link SvgExportContextProvider}. */
export interface SvgExportContextProviderProps {
  value: TLSvgExportContext
  children?: ReactNode
}

/** Puts an export context in scope. Used by the exporter; apps rarely need it. */
export function SvgExportContextProvider({ value, children }: SvgExportContextProviderProps) {
  return <SvgExportContext.Provider value={value}>{children}</SvgExportContext.Provider>
}

/**
 * The export in progress, or `null` when rendering normally.
 *
 * `null` is the answer a component gets on the live canvas, and checking for it
 * is how one component serves both: `useSvgExportContext() ? staticVersion :
 * interactiveVersion`.
 */
export function useSvgExportContext(): TLSvgExportContext | null {
  return useContext(SvgExportContext)
}

/**
 * Delay the export snapshot until this component says it is ready.
 *
 * Returns `true` once the component has reported readiness — or immediately,
 * when there is no export in progress, so the same component renders normally
 * on the canvas without a branch. Call the returned `resolve` when the content
 * is actually on screen.
 *
 * ```tsx
 * const [isReady, resolve] = useDelaySvgExport()
 * return <Grid onReady={resolve} style={{ opacity: isReady ? 1 : 0 }} />
 * ```
 *
 * The counterpart of {@link TLSvgExportContext.waitUntil} for shapes rendered
 * through `<foreignObject>`, which have no other way to reach the context's
 * promise list.
 */
export function useDelaySvgExport(): [isReady: boolean, resolve: () => void] {
  const context = useSvgExportContext()
  const [isReady, setIsReady] = useState(context === null)

  // One promise per mount, created eagerly so it is registered with the export
  // before the first paint — registering it in an effect would be too late,
  // because the exporter may already have taken its snapshot.
  const deferred = useMemo(() => {
    let resolve!: () => void
    const promise = new Promise<void>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }, [])

  useEffect(() => {
    if (!context) return
    context.waitUntil(deferred.promise)
    // Resolved on unmount as well: a component that goes away before it was
    // ready must not hold the export open until the timeout.
    return () => deferred.resolve()
  }, [context, deferred])

  return [
    isReady,
    () => {
      deferred.resolve()
      setIsReady(true)
    },
  ]
}
