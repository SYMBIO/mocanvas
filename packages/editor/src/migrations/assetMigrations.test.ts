import { describe, expect, it } from "vitest"
import {
  ASSET_MIGRATION_SEQUENCE_PREFIX,
  assetMigrations,
  BUILTIN_ASSET_MIGRATION_SEQUENCE_PREFIX,
  createAssetPropsMigrationIds,
  createAssetPropsMigrationSequence,
  createBuiltInAssetPropsMigrationIds,
  rootBindingMigrations,
  rootShapeMigrations,
} from "./assetMigrations"

describe("asset props migration ids", () => {
  it("number an app's asset type under the default prefix", () => {
    const versions = createAssetPropsMigrationIds("figma-file", { AddNodeId: 1, AddScale: 2 })
    expect(versions.AddNodeId).toBe(`${ASSET_MIGRATION_SEQUENCE_PREFIX}.figma-file/1`)
    expect(versions.AddScale).toBe(`${ASSET_MIGRATION_SEQUENCE_PREFIX}.figma-file/2`)
  })

  it("keep an asset's sequence distinct from a shape's of the same name", () => {
    // `com.tldraw.asset.image` and `com.tldraw.shape.image` are separate
    // migration lines; a document records its progress through each on its own.
    expect(createAssetPropsMigrationIds("image", { A: 1 }).A).not.toBe("com.tldraw.shape.image/1")
  })

  it("put built-in asset types under their own prefix, not the reference implementation's", () => {
    // Registering `com.tldraw.asset.image` at version 1 would claim the
    // reference implementation's line, and every file it wrote would then fail
    // to load as "data from a newer version".
    const versions = createBuiltInAssetPropsMigrationIds("image", { AddFileSize: 1 })
    expect(versions.AddFileSize).toBe(`${BUILTIN_ASSET_MIGRATION_SEQUENCE_PREFIX}.image/1`)
    expect(versions.AddFileSize.startsWith("com.tldraw.")).toBe(false)
  })
})

describe("createAssetPropsMigrationSequence", () => {
  const versions = createAssetPropsMigrationIds("image", { AddFileSize: 1, AddName: 2 })

  it("accepts an empty sequence", () => {
    expect(createAssetPropsMigrationSequence({ sequence: [] }).sequence).toEqual([])
  })

  it("accepts a well-numbered sequence", () => {
    const migrations = createAssetPropsMigrationSequence({
      sequence: [
        { id: versions.AddFileSize, up() {} },
        { id: versions.AddName, up() {} },
      ],
    })
    expect(migrations.sequence.map((m) => m.id)).toEqual([versions.AddFileSize, versions.AddName])
  })

  it("refuses a sequence numbered out of order", () => {
    expect(() => createAssetPropsMigrationSequence({ sequence: [{ id: versions.AddName, up() {} }] })).toThrow(
      /out of order/,
    )
  })

  it("refuses ids from two different sequences", () => {
    const other = createAssetPropsMigrationIds("video", { A: 2 })
    expect(() =>
      createAssetPropsMigrationSequence({
        sequence: [
          { id: versions.AddFileSize, up() {} },
          { id: other.A, up() {} },
        ],
      }),
    ).toThrow(/does not belong to the same/)
  })
})

describe("root migration sequences", () => {
  it("are empty placeholders under mocanvas's own ids", () => {
    for (const sequence of [rootShapeMigrations, rootBindingMigrations, assetMigrations]) {
      expect(sequence.sequence).toEqual([])
      // Not retroactive: an empty sequence added to a record type that already
      // existed must not claim that older data needs migrating.
      expect(sequence.retroactive).toBe(false)
      expect(sequence.sequenceId.startsWith("com.mocanvas.")).toBe(true)
    }
  })

  it("do not collide with each other", () => {
    const ids = [rootShapeMigrations, rootBindingMigrations, assetMigrations].map((s) => s.sequenceId)
    expect(new Set(ids).size).toBe(3)
  })
})
