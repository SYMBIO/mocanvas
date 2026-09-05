/**
 * Props migrations for asset types, and the record-level migration sequences
 * the built-in record types themselves run under.
 *
 * Assets get their own factory pair rather than reusing the shape one because
 * the sequence id has to name an *asset* type: `com.tldraw.asset.image` and
 * `com.tldraw.shape.image` are different migration lines, and a document
 * records its progress through each separately. Sharing a prefix would make an
 * image asset's third migration look like an image shape's third migration.
 */

import { createMigrationIds, type MigrationSequence } from "@mocanvas/store"
import {
  createShapePropsMigrationSequence,
  type PropsMigrations,
} from "./propsMigrations"

/** The `sequenceId` prefix of asset type `type`'s props migrations. */
export const ASSET_MIGRATION_SEQUENCE_PREFIX = "com.tldraw.asset"

/**
 * As {@link ASSET_MIGRATION_SEQUENCE_PREFIX}, for asset types **this library
 * ships**.
 *
 * Same reasoning as `BUILTIN_SHAPE_MIGRATION_SEQUENCE_PREFIX`: registering
 * `com.tldraw.asset.image` at version 1 would claim the reference
 * implementation's migration line, and every file it wrote — whose image asset
 * sequence is further along — would fail to load as "data from a newer
 * version". An app's own asset types keep the default prefix, which nothing
 * else claims.
 */
export const BUILTIN_ASSET_MIGRATION_SEQUENCE_PREFIX = "com.mocanvas.asset"

/** The `sequenceId` under which asset type `type`'s props migrations are registered. */
export function assetPropsMigrationSequenceId(type: string): string {
  return `${ASSET_MIGRATION_SEQUENCE_PREFIX}.${type}`
}

/**
 * Migration ids for an asset type, from friendly version names:
 *
 * ```ts
 * const versions = createAssetPropsMigrationIds("image", { AddFileSize: 1 })
 * // versions.AddFileSize === "com.tldraw.asset.image/1"
 * ```
 */
export function createAssetPropsMigrationIds<
  const Type extends string,
  const Versions extends Record<string, number>,
>(
  assetType: Type,
  versions: Versions,
): { readonly [K in keyof Versions]: `${typeof ASSET_MIGRATION_SEQUENCE_PREFIX}.${Type}/${Versions[K]}` } {
  return createMigrationIds(
    assetPropsMigrationSequenceId(assetType) as `${typeof ASSET_MIGRATION_SEQUENCE_PREFIX}.${Type}`,
    versions,
  )
}

/**
 * Migration ids for an asset type **this library ships**, under
 * {@link BUILTIN_ASSET_MIGRATION_SEQUENCE_PREFIX}.
 */
export function createBuiltInAssetPropsMigrationIds<
  const Type extends string,
  const Versions extends Record<string, number>,
>(
  assetType: Type,
  versions: Versions,
): { readonly [K in keyof Versions]: `${typeof BUILTIN_ASSET_MIGRATION_SEQUENCE_PREFIX}.${Type}/${Versions[K]}` } {
  return createMigrationIds(
    `${BUILTIN_ASSET_MIGRATION_SEQUENCE_PREFIX}.${assetType}` as `${typeof BUILTIN_ASSET_MIGRATION_SEQUENCE_PREFIX}.${Type}`,
    versions,
  )
}

/**
 * Check an asset props migration sequence and hand it back.
 *
 * Same rules as the shape and binding forms: the ids must belong to one
 * sequence and run `1, 2, 3, …` in order, checked here so a mistake surfaces
 * where the sequence is written rather than when a document fails to open.
 */
export function createAssetPropsMigrationSequence(migrations: PropsMigrations): PropsMigrations {
  return createShapePropsMigrationSequence(migrations)
}

/* ---- root sequences ----------------------------------------------------- */

/**
 * Migrations that apply to *every* shape, whatever its type — the record's own
 * fields rather than any type's props.
 *
 * Empty, and deliberately so: it is the placeholder a change to the shape
 * record itself would go into, so that the first such change has a numbered
 * home instead of needing a new sequence id invented under pressure. Registered
 * from day one means every document already records a version for it.
 */
export const rootShapeMigrations: MigrationSequence = {
  sequenceId: "com.mocanvas.shape",
  retroactive: false,
  sequence: [],
}

/** As {@link rootShapeMigrations}, for the binding record itself. */
export const rootBindingMigrations: MigrationSequence = {
  sequenceId: "com.mocanvas.binding",
  retroactive: false,
  sequence: [],
}

/** As {@link rootShapeMigrations}, for the asset record itself. */
export const assetMigrations: MigrationSequence = {
  sequenceId: "com.mocanvas.asset",
  retroactive: false,
  sequence: [],
}

/* ---- the built-in asset types ------------------------------------------- */

/**
 * The `image` asset's props migrations.
 *
 * Empty, under mocanvas's own prefix. Empty because the props have not changed
 * since they were first written, and present anyway because the first change
 * needs a numbered sequence to go into — inventing one later, after documents
 * have been saved, is what makes a migration line unrecoverable.
 *
 * `retroactive: false` for the same reason: an empty sequence must not claim
 * that documents written before it existed need migrating.
 */
export const imageAssetMigrations: MigrationSequence = {
  sequenceId: `${BUILTIN_ASSET_MIGRATION_SEQUENCE_PREFIX}.image`,
  retroactive: false,
  sequence: [],
}

/** The `video` asset's props migrations; see {@link imageAssetMigrations}. */
export const videoAssetMigrations: MigrationSequence = {
  sequenceId: `${BUILTIN_ASSET_MIGRATION_SEQUENCE_PREFIX}.video`,
  retroactive: false,
  sequence: [],
}

/** The `bookmark` asset's props migrations; see {@link imageAssetMigrations}. */
export const bookmarkAssetMigrations: MigrationSequence = {
  sequenceId: `${BUILTIN_ASSET_MIGRATION_SEQUENCE_PREFIX}.bookmark`,
  retroactive: false,
  sequence: [],
}

/**
 * The migration sequences for the asset types this library ships.
 *
 * Handed to `createSchema` as a group so a build cannot register two of the
 * three and silently drop the version line of the one it forgot.
 */
export const defaultAssetMigrations: readonly MigrationSequence[] = [
  imageAssetMigrations,
  videoAssetMigrations,
  bookmarkAssetMigrations,
]
