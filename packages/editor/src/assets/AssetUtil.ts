/**
 * The base class an app extends to teach the editor a new kind of attachment.
 *
 * An *asset util* is to a file what a shape util is to a shape. It says which
 * MIME types it can take, how to turn one of those files into an `asset`
 * record, and what an asset of its type starts out looking like. Registering
 * one is how a PDF, a CAD file or a 3D model becomes something a person can
 * drop on the canvas, without anybody touching the drop handler.
 *
 * The editor drives utils through the structural `TLAssetUtilLike` contract in
 * `editor/assetUtils.ts`; this class is the ergonomic way to satisfy it. The
 * two are separate so the editor can accept a util from a package it has never
 * heard of, and so neither file has to own the other.
 */
import type { Asset, AssetId } from "../records/asset"
import type { UnknownRecordProps } from "../records/props"
import type { Editor } from "../editor/Editor"

/** What {@link AssetUtil.configure} may be called on. */
export interface TLAssetUtilClass {
  // A mixin base has to accept a rest parameter; the one argument every asset
  // util actually takes is the editor.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...args: any[]): any
  options?: object
}

/** The settings an asset util reads. Extend it in a subclass to add your own. */
export interface TLAssetUtilOptions {
  [key: string]: unknown
}

/**
 * Describes how one kind of asset behaves. One instance per asset type per
 * editor.
 *
 * Only {@link type} and {@link getDefaultProps} are required. A util that just
 * needs the editor to accept a new file type is a dozen lines.
 */
export abstract class AssetUtil<A extends Asset = Asset> {
  /** The `Asset["type"]` this util handles. Set it on the subclass. */
  static type: string

  /**
   * Validators for this asset type's `props`, so the store rejects a malformed
   * asset on write rather than failing to paint it later.
   */
  static props?: UnknownRecordProps

  /** The migration sequence for this asset type's props. */
  static migrations?: unknown

  /**
   * A subclass of this util with `options` merged in.
   *
   * The point is to let an app change a util's behaviour without subclassing
   * it: `MyAssetUtil.configure({ maxSize: 1e7 })` is a new class, so two
   * editors on one page can run the same util configured differently.
   */
  static configure<C extends TLAssetUtilClass>(this: C, options: Partial<TLAssetUtilOptions>): C {
    const Base = this
    const merged = { ...((Base as { options?: object }).options ?? {}), ...(options as object) }
    const Configured = class extends Base {}
    Object.defineProperty(Configured, "options", { value: merged, writable: true, configurable: true, enumerable: true })
    Object.defineProperty(Configured, "name", {
      value: `${(Base as { name?: string }).name ?? "AssetUtil"}(configured)`,
      configurable: true,
    })
    return Configured as unknown as C
  }

  /** This util's settings; see {@link AssetUtil.configure}. */
  readonly options: TLAssetUtilOptions

  constructor(readonly editor: Editor) {
    this.options = ((this.constructor as { options?: object }).options ?? {}) as TLAssetUtilOptions
  }

  /** The asset type this util handles, read off the constructor. */
  get type(): A["type"] {
    return (this.constructor as unknown as TLAssetUtilConstructor<A>).type as A["type"]
  }

  /** What an asset of this type starts out as. */
  abstract getDefaultProps(): A["props"]

  /**
   * The MIME types this util can build an asset from.
   *
   * Empty by default: a util that only *resolves* assets created elsewhere
   * should not claim any file type, and claiming one it cannot handle would
   * shadow the util that can.
   */
  getSupportedMimeTypes(): readonly string[] {
    return []
  }

  /**
   * Whether this util will take a file of this MIME type.
   *
   * Matching is case-insensitive, and a `type/*` entry matches every subtype —
   * browsers report `image/jpeg` and `image/jpg` for the same file, and a util
   * should not have to enumerate the ways a platform spells a format.
   */
  acceptsMimeType(mimeType: string): boolean {
    const wanted = mimeType.toLowerCase()
    return this.getSupportedMimeTypes().some((supported) => {
      const candidate = supported.toLowerCase()
      if (candidate === wanted) return true
      if (!candidate.endsWith("/*")) return false
      return wanted.startsWith(candidate.slice(0, -1))
    })
  }

  /**
   * Turn a file into an asset record, or `null` when this util cannot.
   *
   * Returning `null` rather than throwing is deliberate: a drop of ten files
   * where one is unreadable should create nine assets, not fail. The default
   * answers `null`, which is right for a util whose assets are not made from
   * files at all — a bookmark is made from a URL.
   */
  async getAssetFromFile(_file: File, _assetId: AssetId): Promise<A | null> {
    return null
  }
}

/** An asset util as an app registers it: the class, not an instance. */
export interface TLAssetUtilConstructor<A extends Asset = Asset, U extends AssetUtil<A> = AssetUtil<A>> {
  new (editor: Editor): U
  readonly type: A["type"]
  readonly props?: UnknownRecordProps
  readonly migrations?: unknown
}

/**
 * Any asset util constructor, whatever asset type it handles.
 *
 * The type a *list* of utils is declared as. `TLAssetUtilConstructor<Asset>`
 * would not do: constructors are invariant in their asset type, so a list typed
 * that way rejects every concrete util in it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TLAnyAssetUtilConstructor = TLAssetUtilConstructor<any, any>
