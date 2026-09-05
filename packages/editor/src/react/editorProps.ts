/**
 * The props of the editor component, split by where the store comes from.
 *
 * The split is the interesting part. An editor needs a store, and there are
 * exactly two ways to give it one: hand over a store you built and own, or
 * describe the document and let the component build one. Those are mutually
 * exclusive — passing shape utils *and* a store would silently ignore the utils,
 * because the store's schema was fixed when it was created — so the props are a
 * union rather than one interface with everything optional. The type is what
 * stops the mistake.
 */
import type { ReactNode } from "react"
import type { MigrationSequence } from "@mocanvas/store"
import type { Editor, EditorConfig } from "../editor/Editor"
import type { EditorStore, EditorStoreSnapshot } from "../editor/createStore"
import type { TLCameraOptions } from "../editor/CameraOptions"
import type { TLDeepLinkOptions } from "../editor/deepLinks"
import type { TLTextOptions, TldrawOptions } from "../editor/tldrawOptions"
import type { TLStoreWithStatus } from "../editor/storeTypes"
import type { TLAnyAssetUtilConstructor } from "../assets/AssetUtil"
import type { ShapeUtilConstructor } from "../shapes/ShapeUtil"
import type { BindingUtilConstructor } from "../bindings/BindingUtil"
import type { StateNodeConstructor } from "../tools/StateNode"
import type { TLAnyOverlayUtilConstructor } from "../editor/OverlayManager"
import type { CurrentUser } from "../user/userPreferences"
import type { TLGetShapeVisibility } from "../editor/culling"
import type { TLThemeId, TLThemes } from "../theme/types"
import type { TLAssetUrls, TLEditorComponents } from "./index"
import type { CustomRecordInfo } from "../records/customRecord"

/** Called once the editor exists. Return a cleanup to run when it goes away. */
export type TLOnMountHandler = (editor: Editor) => (() => void) | undefined | void

/**
 * The props both forms of the editor component accept.
 *
 * Everything here is about the editor's *behaviour and appearance*; the
 * document itself comes from one of the two branches below.
 */
export interface TldrawEditorBaseProps {
  /** URLs for the fonts the editor should load. */
  assetUrls?: TLAssetUrls
  /** Asset utils to register: how each kind of attachment is made and resolved. */
  assetUtils?: readonly TLAnyAssetUtilConstructor[]
  /** Focus the editor when it mounts. */
  autoFocus?: boolean
  /** Binding utils to register. */
  bindingUtils?: readonly BindingUtilConstructor[]
  /**
   * The camera's policy.
   *
   * @deprecated Use `options.camera`. Kept because it was the only spelling for
   * several versions and removing it would break every app that used it.
   */
  cameraOptions?: Partial<TLCameraOptions>
  /** Rendered inside the editor's container, above the canvas. */
  children?: ReactNode
  /** A class name for the editor's container. */
  className?: string
  /** Light, dark, or follow the OS. Defaults to `"light"`. */
  colorScheme?: "light" | "dark" | "system"
  /** Replacements for the editor's own components: cursors, grid, error fallbacks. */
  components?: TLEditorComponents
  /**
   * Mirror the camera into the URL.
   *
   * @deprecated Use `options.deepLinks`.
   */
  deepLinks?: TLDeepLinkOptions | true
  /** The id of the tool to start in. */
  initialState?: string
  /** Which registered theme starts out current. Defaults to `"default"`. */
  initialTheme?: TLThemeId
  /**
   * Accepted and ignored.
   *
   * mocanvas is MIT-licensed and performs no licence check, paints no
   * watermark and sends no telemetry. The prop exists so that code written
   * against the reference implementation compiles unchanged; passing a key does
   * nothing, and passing none costs nothing.
   */
  licenseKey?: string
  /** Called once the editor exists. Return a cleanup for when it goes away. */
  onMount?: TLOnMountHandler
  /** The editor's behavioural options. */
  options?: Partial<TldrawOptions & EditorConfig>
  /** Overlay utils to register: the painters for canvas UI drawn over the shapes. */
  overlayUtils?: readonly TLAnyOverlayUtilConstructor[]
  /** Shape utils to register. */
  shapeUtils?: readonly ShapeUtilConstructor[]
  /**
   * Rich-text configuration.
   *
   * @deprecated Use `options.text`. The two are the same object.
   */
  textOptions?: TLTextOptions
  /** Named themes to register, merged over the built-in `default`. */
  themes?: Partial<TLThemes>
  /** Tools to add to the editor's state chart. */
  tools?: readonly StateNodeConstructor[]
  /** Who is using the editor, as the owner of their preferences. */
  user?: CurrentUser
  /**
   * The host's hook for hiding shapes without deleting them — layers, filters,
   * a review mode. Consulted per shape in the render path, so it must be cheap
   * and pure.
   */
  getShapeVisibility?: TLGetShapeVisibility
}

/**
 * The branch where the host owns the store.
 *
 * Shape and binding utils are *not* accepted here, and that is deliberate
 * rather than an oversight: the store's schema was decided when the store was
 * built, and utils passed at this point could not affect it. Accepting them
 * would let a document load against a schema that does not match the utils
 * rendering it.
 */
export interface TldrawEditorWithStoreProps extends TldrawEditorBaseProps {
  /** The store to use, or a store that may still be arriving. */
  store: EditorStore | TLStoreWithStatus
  /** Not accepted with `store`: the schema is already fixed. */
  shapeUtils?: never
  bindingUtils?: never
  migrations?: never
  snapshot?: never
  initialData?: never
  persistenceKey?: never
  sessionId?: never
  defaultName?: never
  records?: never
}

/** The branch where the component builds the store from what the document needs. */
export interface TldrawEditorWithoutStoreProps extends TldrawEditorBaseProps {
  store?: undefined
  /** Further migration sequences to register in the schema. */
  migrations?: readonly MigrationSequence[]
  /** A snapshot to open. */
  snapshot?: EditorStoreSnapshot
  /** Records to open, as a plain serialized map. */
  initialData?: EditorStoreSnapshot["store"]
  /**
   * Persist the document under this key, in this browser.
   *
   * Local only — IndexedDB in the page, nothing sent anywhere. Two editors
   * given the same key share a document and stay in step.
   */
  persistenceKey?: string
  /**
   * Which *session* the persisted state belongs to. Defaults to the tab.
   *
   * Session state is the camera, the selection and the current page: two tabs
   * on one board are two viewpoints, and sharing them would drag one person's
   * camera around whenever the other scrolled.
   */
  sessionId?: string
  /** Name given to the document's first page. */
  defaultName?: string
  /** The app's own top-level record types, beyond shapes and bindings. */
  records?: Readonly<Record<string, CustomRecordInfo<string>>>
}

/** What the editor component accepts: exactly one of the two branches above. */
export type TldrawEditorProps = TldrawEditorWithStoreProps | TldrawEditorWithoutStoreProps
