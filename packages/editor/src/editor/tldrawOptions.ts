/**
 * Every knob the editor has, in one object.
 *
 * These are *behavioural* settings — how long a long press is, when a drag
 * starts, how far to pad an export — as opposed to the *structural* ones (which
 * shapes exist, which store to use) that go in {@link ./Editor.EditorOptions}.
 * They are deliberately one flat bag rather than nested groups: an app usually
 * overrides three or four of them, and every level of nesting is a level a
 * caller has to reconstruct in order to change one number.
 *
 * The bag is read once per editor, at construction, and then treated as
 * immutable. Things that genuinely change at runtime — the camera policy, the
 * theme — have their own setters on the editor.
 */
import type { ComponentType, ReactNode } from "react"
import type { TLCameraOptions } from "./CameraOptions"
import type { TLDeepLinkOptions } from "./deepLinks"
import type { TLClipboardPasteRawInfo } from "./eventTypes"
import type { TLContent } from "./externalContent"
import type { VecModel } from "./events"

/**
 * Rich-text configuration, as an app supplies it.
 *
 * Deliberately structural and untyped in its payload: the editor never looks
 * inside `extensions`, it only carries them to whatever rich-text
 * implementation is installed, and typing them here would make the editor
 * package depend on a text stack it does not ship.
 */
export interface TLTextOptions {
  tipTapConfig?: {
    extensions?: readonly unknown[]
  }
}

/**
 * One band of the alignment grid.
 *
 * The grid is not a single spacing: at low zoom a 1px lattice is a grey wash,
 * and at high zoom a 64px one is useless. Each band says which zoom range it
 * covers and how far apart its lines are, and the renderer picks the band whose
 * range contains the current zoom, fading between neighbours.
 */
export interface TLGridStep {
  /** Lowest zoom this band applies at. */
  min: number
  /** Zoom at which this band is drawn at full strength. */
  mid: number
  /** Line spacing, in page units. */
  step: number
}

/** Where the quick actions (undo, redo, delete, duplicate) render. */
export type TLActionShortcutsLocation =
  /** Always in the menu panel. */
  | "menu"
  /** Always in the toolbar. */
  | "toolbar"
  /** Menu panel on tablet-sized screens and up, toolbar below that. */
  | "swap"

/** The full option bag. Pass a `Partial` of it; everything unset falls back to {@link defaultTldrawOptions}. */
export interface TldrawOptions {
  // ---- limits ---------------------------------------------------------------
  /** Most shapes one page may hold. Creating past it is refused and reported. */
  maxShapesPerPage: number
  /** Most pages a document may hold. Set to 1 to make the document single-page. */
  maxPages: number
  /** Most files accepted from a single drop or paste. */
  maxFilesAtOnce: number

  // ---- interaction timing ---------------------------------------------------
  /** Longest gap between two clicks that still counts as a double click. */
  doubleClickDurationMs: number
  /** Window in which a further click extends a multi-click. */
  multiClickDurationMs: number
  /** How long a press must last to become a long press. */
  longPressDurationMs: number
  /** Duration of a medium-length camera animation: zoom to fit, zoom to selection. */
  animationMediumMs: number
  /** How long a tooltip waits before appearing. */
  tooltipDelayMs: number

  // ---- drag detection -------------------------------------------------------
  /**
   * How far a pointer must move before it is a drag, squared.
   *
   * Squared throughout so drag detection never takes a square root: it runs on
   * every pointer move, and the comparison is exactly as correct either way.
   */
  dragDistanceSquared: number
  /** The same threshold for a coarse pointer, where a still finger still wobbles. */
  coarseDragDistanceSquared: number
  /** Drag threshold for UI elements rather than canvas content. */
  uiDragDistanceSquared: number
  /** UI drag threshold for a coarse pointer. */
  uiCoarseDragDistanceSquared: number

  // ---- handles and hit testing ---------------------------------------------
  /** Radius of a selection handle's hit area, in screen pixels. */
  handleRadius: number
  /** Handle radius for a coarse pointer. */
  coarseHandleRadius: number
  /** Extra tolerance around a shape when hit testing, in screen pixels. */
  hitTestMargin: number
  /** Hit-test tolerance for a coarse pointer. */
  coarseHitTestMargin: number
  /** Assumed pointer width used to widen the edge-scroll zone for touch. */
  coarsePointerWidth: number

  // ---- edge scrolling -------------------------------------------------------
  /** How long the pointer must sit at an edge before scrolling starts. */
  edgeScrollDelay: number
  /** How long scrolling takes to reach full speed. */
  edgeScrollEaseDuration: number
  /** Screen pixels per frame at full speed, before the user's speed preference. */
  edgeScrollSpeed: number
  /** Width of the band at the viewport edge that triggers scrolling. */
  edgeScrollDistance: number

  // ---- camera ---------------------------------------------------------------
  /** How quickly a flung camera loses speed. `0…1`; higher stops sooner. */
  cameraSlideFriction: number
  /** How long after the last camera write the camera counts as settled. */
  cameraMovingTimeoutMs: number
  /** How close the viewport must get to a followed collaborator's before it snaps. */
  followChaseViewportSnap: number
  /** Whether holding space turns the pointer into a pan. */
  spacebarPanning: boolean
  /** Whether dragging with the right button pans. */
  rightClickPanning: boolean
  /** Padding left around the content by `zoomToFit` and friends. */
  zoomToFitPadding: number
  /** The camera's starting policy. Change it later with `Editor.setCameraOptions`. */
  camera: TLCameraOptions
  /** Mirror the camera into the URL. `true` for the defaults, or an options object. */
  deepLinks?: TLDeepLinkOptions | true | undefined

  // ---- snapping -------------------------------------------------------------
  /** Distance, in screen pixels, at which snapping takes hold. */
  snapThreshold: number
  /** Whether a locked shape can be clicked or brushed into a selection. */
  selectLockedShapes: boolean
  /** Gap left when placing an adjacent shape, duplicating, stacking or packing. */
  adjacentShapeMargin: number

  // ---- collaboration --------------------------------------------------------
  /** After this long without a presence refresh, a collaborator stops being drawn. */
  collaboratorInactiveTimeoutMs: number
  /** After this long, a collaborator reads as idle. */
  collaboratorIdleTimeoutMs: number
  /** How often collaborator liveness is re-checked. */
  collaboratorCheckIntervalMs: number

  // ---- export ---------------------------------------------------------------
  /** Padding around exported SVG content, in page units. */
  defaultSvgPadding: number
  /** How long an export waits for fonts and images before giving up. */
  maxExportDelayMs: number
  /** How far image bounds are expanded when flattening a selection to one image. */
  flattenImageBoundsExpand: number
  /** Padding added when flattening a selection to one image. */
  flattenImageBoundsPadding: number
  /**
   * A React provider wrapped around exported content.
   *
   * Export renders shapes outside the editor's own tree, so a custom shape that
   * reads a context — a theme, an i18n provider — renders wrong (or throws)
   * unless that context is re-established here.
   */
  exportProvider: ComponentType<{ children: ReactNode }>

  // ---- grid -----------------------------------------------------------------
  /** The grid's bands, coarsest first. See {@link TLGridStep}. */
  gridSteps: readonly TLGridStep[]

  // ---- performance ----------------------------------------------------------
  /** Serve a cached zoom level while the camera is moving, on a busy page. */
  debouncedZoom: boolean
  /** Shape count above which `debouncedZoom` takes effect. */
  debouncedZoomThreshold: number
  /** How many fonts to wait for before the canvas is shown at all. */
  maxFontsToLoadBeforeRender: number
  /** Zoom below which text shadows stop being drawn. */
  textShadowLod: number

  // ---- UI and features ------------------------------------------------------
  /** Whether double-clicking empty canvas creates a text shape. */
  createTextOnCanvasDoubleClick: boolean
  /** Whether the number keys select toolbar items. */
  enableToolbarKeyboardShortcuts: boolean
  /** Where the quick actions render. */
  actionShortcutsLocation: TLActionShortcutsLocation
  /** How long the laser trail stays fully visible. */
  laserDelayMs: number
  /** How long the laser trail takes to fade. */
  laserFadeoutMs: number
  /** Whether the quick-zoom brush keeps the viewport's scale. */
  quickZoomPreservesScreenBounds: boolean
  /**
   * The application's name, used in accessibility labels ("Canvas for
   * <branding>").
   *
   * Accepted and used for labelling only. mocanvas paints no watermark and
   * performs no licence check, so there is no vendor branding for this to turn
   * on or off — the label is the whole of it.
   */
  branding?: string | undefined
  /** CSP nonce stamped on any style tag the editor injects. */
  nonce?: string | undefined

  // ---- assets ---------------------------------------------------------------
  /** How long a temporary asset preview stays paintable before it expires. */
  temporaryAssetPreviewLifetimeMs: number

  // ---- rich text ------------------------------------------------------------
  /** Rich-text configuration. Also accepted as the top-level `textOptions`. */
  text?: TLTextOptions | undefined

  // ---- clipboard hooks ------------------------------------------------------
  /**
   * Called before a selection is written to the clipboard by copy or cut.
   *
   * Return modified content to transform it, `false` to cancel the write, or
   * nothing to pass it through untouched.
   */
  onBeforeCopyToClipboard?(info: { content: TLContent; isCut: boolean }): TLContent | false | void
  /**
   * Called after a paste has been parsed but before any shape is created.
   * Only fires for a paste — a file drop does not go through the clipboard.
   */
  onBeforePasteFromClipboard?(info: { content: TLContent; point?: VecModel }): TLContent | false | void
  /**
   * Called first for a keyboard or menu paste, before the editor tries to
   * parse the clipboard at all. Return `false` to take the paste over
   * completely.
   */
  onClipboardPasteRaw?(info: TLClipboardPasteRawInfo): false | void

  // ---- drop hook ------------------------------------------------------------
  /**
   * Called when something is dropped on the canvas, before the editor's own
   * handling. Return `true` to claim the drop.
   *
   * Named `experimental__` because its signature is expected to change; it is
   * here because there is no other way to intercept a drop before assets are
   * created for it.
   */
  experimental__onDropOnCanvas?(info: { point: VecModel; event: DragEvent }): boolean | void
}

/**
 * A no-op provider: export renders its content directly unless an app supplies
 * one of its own. Declared here rather than inlined so the default object stays
 * referentially stable across reads.
 */
function PassThroughExportProvider({ children }: { children: ReactNode }): ReactNode {
  return children
}

/**
 * Every default, as one object.
 *
 * Spread it to build your own bag, or read a single value out of it to find out
 * what the editor would have done.
 */
export const defaultTldrawOptions: TldrawOptions = {
  maxShapesPerPage: 4000,
  maxPages: 40,
  maxFilesAtOnce: 100,

  doubleClickDurationMs: 450,
  multiClickDurationMs: 200,
  longPressDurationMs: 500,
  animationMediumMs: 320,
  tooltipDelayMs: 700,

  dragDistanceSquared: 16,
  coarseDragDistanceSquared: 36,
  uiDragDistanceSquared: 16,
  uiCoarseDragDistanceSquared: 625,

  handleRadius: 12,
  coarseHandleRadius: 20,
  hitTestMargin: 3,
  coarseHitTestMargin: 4,
  coarsePointerWidth: 12,

  edgeScrollDelay: 200,
  edgeScrollEaseDuration: 200,
  edgeScrollSpeed: 25,
  edgeScrollDistance: 8,

  cameraSlideFriction: 0.09,
  cameraMovingTimeoutMs: 64,
  followChaseViewportSnap: 2,
  spacebarPanning: true,
  rightClickPanning: true,
  zoomToFitPadding: 128,
  // Spelled out rather than referencing `DEFAULT_CAMERA_OPTIONS`, which lives in
  // `CameraOptions.ts`: importing it would be this module’s only runtime import,
  // and the defaults are the one thing that must not depend on load order.
  camera: {
    isLocked: false,
    wheelBehavior: "pan",
    panSpeed: 1,
    zoomSpeed: 1,
    zoomSteps: [0.1, 0.25, 0.5, 1, 2, 4, 8],
  },

  snapThreshold: 8,
  selectLockedShapes: false,
  adjacentShapeMargin: 10,

  collaboratorInactiveTimeoutMs: 60_000,
  collaboratorIdleTimeoutMs: 3_000,
  collaboratorCheckIntervalMs: 1_200,

  defaultSvgPadding: 32,
  maxExportDelayMs: 5_000,
  flattenImageBoundsExpand: 64,
  flattenImageBoundsPadding: 16,
  exportProvider: PassThroughExportProvider,

  gridSteps: [
    { min: -1, mid: 0.15, step: 64 },
    { min: 0.05, mid: 0.375, step: 16 },
    { min: 0.15, mid: 1, step: 4 },
    { min: 0.7, mid: 2.5, step: 1 },
  ],

  debouncedZoom: true,
  debouncedZoomThreshold: 500,
  maxFontsToLoadBeforeRender: Number.POSITIVE_INFINITY,
  textShadowLod: 0.35,

  createTextOnCanvasDoubleClick: true,
  enableToolbarKeyboardShortcuts: true,
  actionShortcutsLocation: "swap",
  laserDelayMs: 1_200,
  laserFadeoutMs: 500,
  quickZoomPreservesScreenBounds: true,

  temporaryAssetPreviewLifetimeMs: 180_000,
}
