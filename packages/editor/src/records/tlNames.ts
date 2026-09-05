/**
 * The `TL`-prefixed spellings the record layer is missing.
 *
 * mocanvas names its own types without the prefix — `Shape`, `Page`, `Asset` —
 * because inside the library the prefix says nothing. Where a `TL`-spelled name
 * has no unprefixed counterpart it is defined here rather than being invented
 * twice; where one already exists, `@mocanvas/compat` aliases it and this file
 * stays out of the way.
 *
 * Aliases only. Nothing here has an implementation, and nothing here should
 * grow one — if a `TL`-named thing needs behaviour, it belongs in the module
 * that owns the concept.
 */

import type {
  Camera,
  Document,
  Instance,
  InstancePageState,
  Page,
  ShapeCreate,
  UnknownShape,
} from "./base"
import type { Asset, AssetId } from "./asset"
import type { BindingPartial, UnknownBinding } from "./binding"

/**
 * A shape to create: like `TLShapePartial`, but the id is optional because the
 * store mints one.
 */
export type TLCreateShapePartial<T extends UnknownShape = UnknownShape> = ShapeCreate<T>

/**
 * A patch to an existing binding: the id and type identify it, everything else
 * is optional.
 */
export type TLBindingUpdate<B extends UnknownBinding = UnknownBinding> = BindingPartial<B>

/**
 * A shape that points at an asset.
 *
 * Image, video and bookmark shapes all reference their bytes by `assetId`
 * rather than embedding them, so that two copies of the same picture cost one
 * upload. This is the structural test for "does this shape have bytes behind
 * it?", which is what export, copy and asset garbage collection all ask.
 */
export type TLAssetShape = UnknownShape & { props: { assetId: AssetId | null } }

/**
 * The record types this library ships, as a union.
 *
 * "Default" as opposed to whatever an app has added: a build with custom shapes
 * and custom record types has a wider union than this, and the store is generic
 * over it. This is the floor.
 */
export type TLDefaultRecord =
  | Document
  | Page
  | UnknownShape
  | UnknownBinding
  | Asset
  | Camera
  | Instance
  | InstancePageState

/**
 * The shape types this library ships.
 *
 * Spelled as the open shape rather than a closed union: which shapes a build
 * actually has depends on the utils it was given, and the record layer — which
 * ships none of them — is the wrong place to assert a list.
 */
export type TLDefaultShape = UnknownShape

/** The binding types this library ships; see {@link TLDefaultShape}. */
export type TLDefaultBinding = UnknownBinding

/** The asset types this library ships: `image`, `video` and `bookmark`. */
export type TLDefaultAsset = Asset
