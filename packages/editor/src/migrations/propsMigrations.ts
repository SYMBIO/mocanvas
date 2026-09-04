/**
 * Props migrations for shapes and bindings.
 *
 * A shape util declares how its props have changed over time:
 *
 * ```ts
 * const versions = createShapePropsMigrationIds("section", { Initial: 1 })
 *
 * export const sectionMigrations = createShapePropsMigrationSequence({
 *   sequence: [
 *     {
 *       id: versions.Initial,
 *       up(props) { props.name ??= "" },
 *       down(props) { delete props.name },
 *     },
 *   ],
 * })
 * ```
 *
 * The `up`/`down` functions see the shape's **props**, not the whole record,
 * and mutate them in place (returning a replacement object works too). An
 * empty sequence is legal and useful: it is the placeholder a persisted shape
 * ships from day one, so that the first prop addition has somewhere to go.
 *
 * These sequences are not store migration sequences on their own — they carry
 * no `sequenceId`, because the shape type supplies it. {@link toMigrationSequence}
 * turns one into the record-scoped `MigrationSequence` the store understands,
 * and {@link createPropsMigrationSequences} does that for a whole set of utils
 * so the result can be handed to `createSchema()`.
 */

import { createMigrationIds, createMigrationSequence, parseMigrationId, type MigrationId, type MigrationSequence, type UnknownRecord } from "@mocanvas/store"

/** Props as a migration sees them: whatever was persisted, not yet validated. */
export type MigratableProps = Record<string, unknown>

/** One step of a props migration sequence. */
export interface PropsMigration {
  readonly id: MigrationId
  /** Bring props up to this version. Mutate in place, or return a replacement. */
  readonly up: (props: MigratableProps) => void | MigratableProps
  /** Undo {@link up}. Without it, older clients cannot read newer data. */
  readonly down?: ((props: MigratableProps) => void | MigratableProps) | undefined
}

/**
 * A shape's or binding's props migrations, in version order. This is what
 * `static migrations` on a util holds.
 */
export interface PropsMigrations {
  readonly sequence: readonly PropsMigration[]
  /**
   * Whether data saved before this sequence existed should have every
   * migration applied to it (`true`, the default) or be assumed up to date.
   * Backfilling a prop onto boards saved before the prop existed is the whole
   * point, so the default is what you want.
   */
  readonly retroactive?: boolean | undefined
}

/** The `sequenceId` of shape type `type`'s props migrations. */
export const SHAPE_MIGRATION_SEQUENCE_PREFIX = "com.tldraw.shape"
/** The `sequenceId` of binding type `type`'s props migrations. */
export const BINDING_MIGRATION_SEQUENCE_PREFIX = "com.tldraw.binding"

// SEMANTICS-ASSUMED: the `com.tldraw.` prefix is deliberate and load-bearing
// for compatibility, not a leftover. A persisted `.tldr` file records how far
// each sequence had run under ITS id, and files written by tldraw-shaped
// clients name a shape type's sequence `com.tldraw.shape.<type>`. Renaming the
// prefix would make every already-saved document look like it had never run
// any migration, so mocanvas keeps the on-disk name.

/** The `sequenceId` under which shape type `type`'s props migrations are registered. */
export function shapePropsMigrationSequenceId(type: string): string {
  return `${SHAPE_MIGRATION_SEQUENCE_PREFIX}.${type}`
}

/** The `sequenceId` under which binding type `type`'s props migrations are registered. */
export function bindingPropsMigrationSequenceId(type: string): string {
  return `${BINDING_MIGRATION_SEQUENCE_PREFIX}.${type}`
}

/**
 * Migration ids for a shape type, from friendly version names:
 *
 * ```ts
 * const versions = createShapePropsMigrationIds("format", { AddColor: 1 })
 * // versions.AddColor === "com.tldraw.shape.format/1"
 * ```
 */
export function createShapePropsMigrationIds<const Type extends string, const Versions extends Record<string, number>>(
  shapeType: Type,
  versions: Versions,
): { readonly [K in keyof Versions]: `${typeof SHAPE_MIGRATION_SEQUENCE_PREFIX}.${Type}/${Versions[K]}` } {
  return createMigrationIds(shapePropsMigrationSequenceId(shapeType) as `${typeof SHAPE_MIGRATION_SEQUENCE_PREFIX}.${Type}`, versions)
}

/** Migration ids for a binding type; see {@link createShapePropsMigrationIds}. */
export function createBindingPropsMigrationIds<const Type extends string, const Versions extends Record<string, number>>(
  bindingType: Type,
  versions: Versions,
): { readonly [K in keyof Versions]: `${typeof BINDING_MIGRATION_SEQUENCE_PREFIX}.${Type}/${Versions[K]}` } {
  return createMigrationIds(
    bindingPropsMigrationSequenceId(bindingType) as `${typeof BINDING_MIGRATION_SEQUENCE_PREFIX}.${Type}`,
    versions,
  )
}

/**
 * Check a props migration sequence and hand it back.
 *
 * The ids must all belong to one sequence and be numbered `1, 2, 3, …` in
 * order — the same rule the store applies, checked here so that a mistake
 * surfaces where the sequence is written rather than when a document is
 * loaded. An empty sequence is valid.
 */
export function createShapePropsMigrationSequence(migrations: PropsMigrations): PropsMigrations {
  return validatePropsMigrations(migrations, "shape")
}

/** Check a binding props migration sequence; see {@link createShapePropsMigrationSequence}. */
export function createBindingPropsMigrationSequence(migrations: PropsMigrations): PropsMigrations {
  return validatePropsMigrations(migrations, "binding")
}

function validatePropsMigrations(migrations: PropsMigrations, kind: "shape" | "binding"): PropsMigrations {
  const sequence = migrations.sequence ?? []
  let sequenceId: string | undefined
  sequence.forEach((migration, index) => {
    const parsed = parseMigrationId(migration.id)
    sequenceId ??= parsed.sequenceId
    if (parsed.sequenceId !== sequenceId) {
      throw new Error(
        `Migration ${migration.id} does not belong to the same ${kind} as ${sequenceId}/1: a props migration sequence describes one ${kind} type`,
      )
    }
    if (parsed.version !== index + 1) {
      throw new Error(`Migration ${migration.id} is out of order: expected version ${index + 1}`)
    }
    if (typeof migration.up !== "function") {
      throw new Error(`Migration ${migration.id} has no up function`)
    }
  })
  return {
    sequence: [...sequence],
    ...(migrations.retroactive === undefined ? {} : { retroactive: migrations.retroactive }),
  }
}

/* ---- turning props migrations into store migrations --------------------- */

/** What a props migration sequence is attached to. */
export interface PropsMigrationTarget {
  /** `"shape"` or `"binding"`: the `typeName` of the records it migrates. */
  readonly typeName: "shape" | "binding"
  /** The shape or binding type, e.g. `"format"`. */
  readonly type: string
}

function isPlainObject(value: unknown): value is MigratableProps {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Turn a props migration sequence into the record-scoped
 * `MigrationSequence` the store applies.
 *
 * Each step is wrapped so that it only sees records of the right `typeName`
 * and `type`, and only ever touches their `props`. A record whose `props` is
 * missing or not an object is left alone rather than crashing the load: the
 * validator downstream is the right place for that complaint.
 */
export function toMigrationSequence(target: PropsMigrationTarget, migrations: PropsMigrations): MigrationSequence {
  const sequenceId =
    target.typeName === "shape" ? shapePropsMigrationSequenceId(target.type) : bindingPropsMigrationSequenceId(target.type)

  const matches = (record: UnknownRecord): boolean =>
    record.typeName === target.typeName && (record as { type?: unknown }).type === target.type

  const wrap = (fn: (props: MigratableProps) => void | MigratableProps) => (record: UnknownRecord): UnknownRecord => {
    const props = (record as { props?: unknown }).props
    if (!isPlainObject(props)) return record
    const next = { ...props }
    const replacement = fn(next)
    return { ...record, props: replacement ?? next } as UnknownRecord
  }

  return createMigrationSequence({
    sequenceId,
    ...(migrations.retroactive === undefined ? {} : { retroactive: migrations.retroactive }),
    sequence: migrations.sequence.map((migration) => {
      if (parseMigrationId(migration.id).sequenceId !== sequenceId) {
        throw new Error(
          `Migration ${migration.id} was created for another type; ${target.typeName} "${target.type}" expects ids under "${sequenceId}"`,
        )
      }
      return {
        id: migration.id,
        scope: "record" as const,
        filter: matches,
        up: wrap(migration.up),
        ...(migration.down ? { down: wrap(migration.down) } : {}),
      }
    }),
  })
}

/** A util as this module needs to see it: a type name and maybe some migrations. */
export interface PropsMigrationSource {
  readonly type: string
  readonly migrations?: unknown
}

/** Whether `value` is a props migration sequence (as opposed to a store one, or nothing). */
export function isPropsMigrations(value: unknown): value is PropsMigrations {
  return typeof value === "object" && value !== null && Array.isArray((value as { sequence?: unknown }).sequence)
}

/**
 * The store migration sequences for a set of shape and binding utils.
 *
 * Utils with no `static migrations` contribute nothing; a util whose
 * `migrations` is already a full `MigrationSequence` (it has a `sequenceId`)
 * is passed through untouched, so a shape can still ship a hand-built
 * sequence. Feed the result to `createSchema()`.
 */
export function createPropsMigrationSequences(options: {
  shapeUtils?: readonly PropsMigrationSource[] | undefined
  bindingUtils?: readonly PropsMigrationSource[] | undefined
}): MigrationSequence[] {
  const out: MigrationSequence[] = []
  const collect = (typeName: "shape" | "binding", utils: readonly PropsMigrationSource[] | undefined) => {
    for (const util of utils ?? []) {
      const migrations = util.migrations
      if (!migrations) continue
      if (typeof (migrations as MigrationSequence).sequenceId === "string") {
        out.push(migrations as MigrationSequence)
        continue
      }
      if (!isPropsMigrations(migrations)) {
        throw new Error(`${typeName} "${util.type}" has a \`migrations\` that is neither a props nor a store migration sequence`)
      }
      out.push(toMigrationSequence({ typeName, type: util.type }, migrations))
    }
  }
  collect("shape", options.shapeUtils)
  collect("binding", options.bindingUtils)
  return out
}
