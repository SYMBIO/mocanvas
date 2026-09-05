import { nanoid } from "nanoid"

/** Length of the unique part of a generated record id. */
export const UNIQUE_ID_LENGTH = 21

/** Generate a URL-safe unique id (21 chars by default). */
export function uniqueId(size: number = UNIQUE_ID_LENGTH): string {
  return nanoid(size)
}

/**
 * A branded string id. The brand carries the record type so that ids of
 * different record types cannot be mixed up at compile time.
 */
export type RecordId<R extends UnknownRecord> = string & { __type__: R }

/** Every record has an id and a type name. */
export interface BaseRecord<TypeName extends string, Id extends RecordId<UnknownRecord>> {
  readonly id: Id
  readonly typeName: TypeName
}

export type UnknownRecord = BaseRecord<string, RecordId<UnknownRecord>>

export type IdOf<R extends UnknownRecord> = R["id"]

/** Extract the record type an id refers to. */
export type RecordFromId<K extends RecordId<UnknownRecord>> = K extends RecordId<infer R> ? R : never

/**
 * Where a record lives:
 * - `document`: persisted, shared between collaborators (shapes, pages, ...)
 * - `session`: persisted locally only (camera, current page, ...)
 * - `presence`: shared but never persisted (cursors, ...)
 */
export type RecordScope = "document" | "session" | "presence"

export interface StoreValidator<R extends UnknownRecord> {
  validate(record: unknown): R
  /**
   * Optional fast path: validate `newRecord` knowing that `knownGoodVersion`
   * is a valid record of the same type. Implementations may skip the parts
   * that did not change.
   *
   * Declared as a property that may be `undefined` rather than as an optional
   * method, so that a validator carrying an explicit `undefined` — which is
   * what a class with an optional constructor argument produces — still
   * satisfies this under `exactOptionalPropertyTypes`.
   */
  validateUsingKnownGoodVersion?: ((knownGoodVersion: R, newRecord: unknown) => R) | undefined
}

/** Keys of `R` that hold data (everything except `id` and `typeName`). */
export type RecordDataKeys<R extends UnknownRecord> = Exclude<keyof R, "id" | "typeName">

export type EphemeralKeys<R extends UnknownRecord> = { readonly [K in RecordDataKeys<R>]: boolean }

export interface RecordTypeConfig<R extends UnknownRecord> {
  readonly scope: RecordScope
  readonly validator?: StoreValidator<R> | undefined
  /**
   * Keys whose changes should not be considered "real" document changes,
   * e.g. transient UI flags. Used by `Store.applyDiff({ ignoreEphemeralKeys })`.
   */
  readonly ephemeralKeys?: EphemeralKeys<R> | undefined
}

/**
 * Properties the caller must pass to `create()`: the record's data keys minus
 * whatever `withDefaultProperties` provides. `id` is always optional.
 */
export type RecordCreateProps<R extends UnknownRecord, RequiredProps extends keyof R> = Pick<
  R,
  RequiredProps
> &
  Partial<Omit<R, RequiredProps | "typeName">>

/**
 * Describes one kind of record in the store: how to make ids, defaults,
 * validation, and where the record lives (its scope).
 */
export class RecordType<R extends UnknownRecord, RequiredProps extends keyof R = RecordDataKeys<R>> {
  readonly typeName: R["typeName"]
  readonly scope: RecordScope
  readonly validator: StoreValidator<R> | undefined
  readonly ephemeralKeys: EphemeralKeys<R> | undefined
  readonly ephemeralKeySet: ReadonlySet<string>

  constructor(
    typeName: R["typeName"],
    private readonly config: RecordTypeConfig<R> & {
      readonly createDefaultProperties: () => Partial<Omit<R, "id" | "typeName">>
    },
  ) {
    this.typeName = typeName
    this.scope = config.scope
    this.validator = config.validator
    this.ephemeralKeys = config.ephemeralKeys
    const ephemeral = new Set<string>()
    if (config.ephemeralKeys) {
      for (const [key, value] of Object.entries(config.ephemeralKeys)) {
        if (value) ephemeral.add(key)
      }
    }
    this.ephemeralKeySet = ephemeral
  }

  /** Create a new record with defaults applied. A fresh id is generated when none is given. */
  create(properties: RecordCreateProps<R, RequiredProps>): R {
    const result: Record<string, unknown> = {
      ...this.config.createDefaultProperties(),
      ...(properties as Record<string, unknown>),
    }
    if (result["id"] === undefined) result["id"] = this.createId()
    result["typeName"] = this.typeName
    return result as R
  }

  /** Shallow-clone a record (props/meta are shared). */
  clone(record: R): R {
    return { ...record }
  }

  /** Make an id of this type: `${typeName}:${uniquePart}`. */
  createId(customUniquePart?: string): IdOf<R> {
    return `${this.typeName}:${customUniquePart ?? uniqueId()}` as IdOf<R>
  }

  /** Recover the unique part of an id of this type. */
  parseId(id: IdOf<R>): string {
    if (!this.isId(id)) {
      throw new Error(`Id ${JSON.stringify(id)} is not a ${this.typeName} id`)
    }
    return (id as string).slice(this.typeName.length + 1)
  }

  isId(id?: string): id is IdOf<R> {
    if (typeof id !== "string") return false
    if (id.length <= this.typeName.length + 1) return false
    if (id.charCodeAt(this.typeName.length) !== 58 /* ':' */) return false
    return id.startsWith(this.typeName)
  }

  isInstance(record?: unknown): record is R {
    return (
      typeof record === "object" &&
      record !== null &&
      (record as { typeName?: unknown }).typeName === this.typeName
    )
  }

  /**
   * Return a new RecordType whose `create()` fills in the given defaults, so
   * those properties become optional for callers.
   */
  withDefaultProperties<DefaultProps extends RecordDataKeys<R>>(
    createDefaultProperties: () => Pick<R, DefaultProps>,
  ): RecordType<R, Exclude<RequiredProps, DefaultProps>> {
    return new RecordType<R, Exclude<RequiredProps, DefaultProps>>(this.typeName, {
      scope: this.scope,
      validator: this.validator,
      ephemeralKeys: this.ephemeralKeys,
      createDefaultProperties: createDefaultProperties as () => Partial<Omit<R, "id" | "typeName">>,
    })
  }

  /** Run the validator (if any). Throws on invalid input. */
  validate(record: unknown, recordBefore?: R): R {
    if (!this.validator) return record as R
    if (recordBefore !== undefined && this.validator.validateUsingKnownGoodVersion) {
      return this.validator.validateUsingKnownGoodVersion(recordBefore, record)
    }
    return this.validator.validate(record)
  }
}

/**
 * Define a record type.
 *
 * ```ts
 * const Book = createRecordType<Book>('book', { scope: 'document' })
 *   .withDefaultProperties(() => ({ inStock: true }))
 * const b = Book.create({ title: 'Dune' })  // -> { id: 'book:...', typeName: 'book', title, inStock }
 * ```
 */
export function createRecordType<R extends UnknownRecord>(
  typeName: R["typeName"],
  config: RecordTypeConfig<R>,
): RecordType<R, RecordDataKeys<R>> {
  return new RecordType<R, RecordDataKeys<R>>(typeName, {
    scope: config.scope,
    validator: config.validator,
    ephemeralKeys: config.ephemeralKeys,
    createDefaultProperties: () => ({}),
  })
}

/** Split any `${typeName}:${unique}` id into its parts. */
export function parseRecordId(id: string): { typeName: string; uniquePart: string } {
  const colon = id.indexOf(":")
  if (colon <= 0 || colon === id.length - 1) {
    throw new Error(`Malformed record id ${JSON.stringify(id)}`)
  }
  return { typeName: id.slice(0, colon), uniquePart: id.slice(colon + 1) }
}

/** Assert that `value` looks like a record: an object with string `id` and `typeName`. */
export function isRecordLike(value: unknown): value is UnknownRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { typeName?: unknown }).typeName === "string"
  )
}
