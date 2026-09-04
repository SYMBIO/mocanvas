/**
 * `T` — the validation library shape utils declare their props with.
 *
 * ```ts
 * static props = {
 *   w: T.positiveNumber,
 *   h: T.positiveNumber,
 *   label: T.string,
 *   terminal: T.literalEnum("start", "end"),
 *   offset: T.object({ x: T.number, y: T.number }),
 *   order: T.number.optional(),
 * }
 * ```
 *
 * Every member is a {@link Validator}: `validate(value)` narrows or throws a
 * {@link ValidationError} carrying the path to the offending value,
 * `isValid(value)` answers without throwing.
 */

import { isIndexKey, type IndexKey } from "@mocanvas/store"
import {
  describeValue,
  listForMessage,
  prefixError,
  ValidationError,
  Validator,
  type TypeOf,
  type Validatable,
} from "./validator"

/* ---- helpers ------------------------------------------------------------ */

function fail(message: string): never {
  throw new ValidationError(message)
}

function typeofValidator<T>(type: string): Validator<T> {
  return new Validator<T>((value) => {
    if (typeof value !== type) fail(`Expected ${type}, got ${describeValue(value)}`)
    return value as T
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/* ---- primitives --------------------------------------------------------- */

/** Any value at all, typed as `unknown`. Nothing is rejected. */
export const unknownValidator = new Validator<unknown>((value) => value)

/** Any value at all, typed as `any`. Use `unknown` unless you really mean `any`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const anyValidator = new Validator<any>((value) => value)

/** A string of any content, including the empty string. */
export const stringValidator = typeofValidator<string>("string")

/** A finite number. `NaN` and the infinities are rejected: they do not survive JSON. */
export const numberValidator = new Validator<number>((value) => {
  if (typeof value !== "number") fail(`Expected number, got ${describeValue(value)}`)
  if (!Number.isFinite(value)) fail(`Expected a finite number, got ${String(value)}`)
  return value
})

export const booleanValidator = typeofValidator<boolean>("boolean")

export const bigintValidator = typeofValidator<bigint>("bigint")

/** A whole number. */
export const integerValidator = numberValidator.check("integer", (value) => {
  if (!Number.isInteger(value)) fail(`Expected an integer, got ${String(value)}`)
})

// SEMANTICS-ASSUMED: "positive" here means "not negative" (>= 0) and "non-zero"
// means strictly greater than zero. The consumer uses `T.positiveNumber` for
// artboard sizes (which are never negative but may legitimately be animated to
// 0 in an intermediate state) and `T.nonZeroNumber` for section frames, whose
// width and height must not collapse. That reading makes both call sites
// correct; nothing in the permitted sources pins it down further.

/** A number greater than or equal to zero. */
export const positiveNumberValidator = numberValidator.check("positive", (value) => {
  if (value < 0) fail(`Expected a positive number, got ${String(value)}`)
})

/** A number strictly greater than zero. */
export const nonZeroNumberValidator = numberValidator.check("non-zero", (value) => {
  if (value <= 0) fail(`Expected a non-zero positive number, got ${String(value)}`)
})

/** A whole number greater than or equal to zero. */
export const positiveIntegerValidator = integerValidator.check("positive", (value) => {
  if (value < 0) fail(`Expected a positive integer, got ${String(value)}`)
})

/** A whole number strictly greater than zero. */
export const nonZeroIntegerValidator = integerValidator.check("non-zero", (value) => {
  if (value <= 0) fail(`Expected a non-zero positive integer, got ${String(value)}`)
})

/** Exactly one value, compared with `===`. */
export function literal<const T extends string | number | boolean | null>(expected: T): Validator<T> {
  return new Validator<T>((value) => {
    if (value !== expected) fail(`Expected ${describeValue(expected)}, got ${describeValue(value)}`)
    return expected
  })
}

/** One of a fixed set of values: `T.literalEnum("start", "end")`. */
export function literalEnum<const T extends readonly (string | number | boolean | null)[]>(
  ...values: T
): Validator<T[number]> {
  const allowed = new Set<unknown>(values)
  const description = listForMessage(values.map((value) => describeValue(value)))
  return new Validator<T[number]>((value) => {
    if (!allowed.has(value)) fail(`Expected one of ${description}, got ${describeValue(value)}`)
    return value as T[number]
  })
}

/* ---- composites --------------------------------------------------------- */

/** Keys of an object validator config whose validator also accepts `undefined`. */
type OptionalPropertyKeys<Config extends Record<string, Validatable<unknown>>> = {
  [K in keyof Config]: undefined extends TypeOf<Config[K]> ? K : never
}[keyof Config]

/** The object type a `T.object({...})` config describes. */
export type ObjectValidatorType<Config extends Record<string, Validatable<unknown>>> = {
  [K in Exclude<keyof Config, OptionalPropertyKeys<Config>>]: TypeOf<Config[K]>
} & {
  [K in OptionalPropertyKeys<Config>]?: TypeOf<Config[K]>
}

/** A validator for a plain object with a known set of properties. */
export class ObjectValidator<Shape extends object> extends Validator<Shape> {
  constructor(
    readonly config: { readonly [K in keyof Shape]: Validatable<Shape[K]> },
    private readonly shouldAllowUnknownProperties = false,
  ) {
    super((value) => {
      if (!isPlainObject(value)) fail(`Expected an object, got ${describeValue(value)}`)
      for (const key of Object.keys(value)) {
        if (!(key in config) && !shouldAllowUnknownProperties) {
          throw new ValidationError(`Unexpected property`, [key])
        }
      }
      const result: Record<string, unknown> = shouldAllowUnknownProperties ? { ...value } : {}
      for (const key of Object.keys(config) as (keyof Shape & string)[]) {
        const validator = config[key]
        const validated = prefixError(key, () => validator.validate(value[key]))
        // An absent optional property stays absent rather than becoming `undefined`.
        if (validated === undefined && !(key in value)) continue
        result[key] = validated
      }
      return result as Shape
    })
  }

  /** The same object, but properties the config does not mention are kept instead of rejected. */
  allowUnknownProperties(): ObjectValidator<Shape> {
    return new ObjectValidator<Shape>(this.config, true)
  }

  /** A new object validator with more properties. */
  extend<Extension extends Record<string, Validatable<unknown>>>(
    extension: Extension,
  ): ObjectValidator<Shape & ObjectValidatorType<Extension>> {
    return new ObjectValidator<Shape & ObjectValidatorType<Extension>>({
      ...this.config,
      ...extension,
    } as { readonly [K in keyof (Shape & ObjectValidatorType<Extension>)]: Validatable<(Shape & ObjectValidatorType<Extension>)[K]> })
  }
}

/** An object with a known set of properties. Unknown properties are rejected. */
export function object<const Config extends Record<string, Validatable<unknown>>>(
  config: Config,
): ObjectValidator<ObjectValidatorType<Config>> {
  return new ObjectValidator<ObjectValidatorType<Config>>(
    config as unknown as { readonly [K in keyof ObjectValidatorType<Config>]: Validatable<ObjectValidatorType<Config>[K]> },
  )
}

/** An array whose every item matches `item`. */
export class ArrayOfValidator<T> extends Validator<T[]> {
  constructor(readonly item: Validatable<T>) {
    super((value) => {
      if (!Array.isArray(value)) fail(`Expected an array, got ${describeValue(value)}`)
      return value.map((entry, index) => prefixError(index, () => item.validate(entry)))
    })
  }

  /** The same array, but it must hold at least one item. */
  nonEmpty(): Validator<T[]> {
    return this.check("non-empty", (value) => {
      if (value.length === 0) fail("Expected a non-empty array")
    })
  }

  /** The same array, but it must hold at least `length` items. */
  lengthGreaterThan1(): Validator<T[]> {
    return this.check("length", (value) => {
      if (value.length <= 1) fail(`Expected an array with more than one item, got ${value.length}`)
    })
  }
}

/** An array whose every item matches `item`. */
export function arrayOf<T>(item: Validatable<T>): ArrayOfValidator<T> {
  return new ArrayOfValidator<T>(item)
}

/** A `Set` whose every member matches `item`. */
export function setOf<T>(item: Validatable<T>): Validator<Set<T>> {
  return new Validator<Set<T>>((value) => {
    if (!(value instanceof Set)) fail(`Expected a Set, got ${describeValue(value)}`)
    let index = 0
    for (const entry of value) {
      const at = index++
      prefixError(at, () => item.validate(entry))
    }
    return value as Set<T>
  })
}

/** An object used as a lookup table: any key, every value matching `value`. */
export function dict<K extends string, V>(key: Validatable<K>, value: Validatable<V>): Validator<Record<K, V>> {
  return new Validator<Record<K, V>>((input) => {
    if (!isPlainObject(input)) fail(`Expected an object, got ${describeValue(input)}`)
    for (const entryKey of Object.keys(input)) {
      prefixError(entryKey, () => {
        key.validate(entryKey)
        value.validate(input[entryKey])
      })
    }
    return input as Record<K, V>
  })
}

/** A discriminated union: pick the member validator by the value of `key`. */
export function union<Key extends string, Config extends Record<string, Validatable<object>>>(
  key: Key,
  config: Config,
): Validator<TypeOf<Config[keyof Config]>> {
  const names = listForMessage(Object.keys(config).map((name) => JSON.stringify(name)))
  return new Validator<TypeOf<Config[keyof Config]>>((value) => {
    if (!isPlainObject(value)) fail(`Expected an object, got ${describeValue(value)}`)
    const variant = value[key]
    if (typeof variant !== "string" || !Object.hasOwn(config, variant)) {
      throw new ValidationError(`Expected one of ${names}, got ${describeValue(variant)}`, [key])
    }
    return config[variant]!.validate(value) as TypeOf<Config[keyof Config]>
  })
}

/** Either of two shapes, tried in order. Prefer {@link union} when there is a discriminant. */
export function or<T1, T2>(left: Validatable<T1>, right: Validatable<T2>): Validator<T1 | T2> {
  return new Validator<T1 | T2>((value) => {
    try {
      return left.validate(value)
    } catch {
      return right.validate(value)
    }
  })
}

/** `T | undefined`. */
export function optional<T>(validator: Validatable<T>): Validator<T | undefined> {
  return new Validator<T | undefined>((value) => (value === undefined ? undefined : validator.validate(value)))
}

/** `T | null`. */
export function nullable<T>(validator: Validatable<T>): Validator<T | null> {
  return new Validator<T | null>((value) => (value === null ? null : validator.validate(value)))
}

/** Name a validator so its failures read `At <name>(...): ...` instead of bare. */
export function model<T extends { readonly [key: string]: unknown }>(
  name: string,
  validator: Validatable<T>,
): Validator<T> {
  return new Validator<T>((value) => prefixError(name, () => validator.validate(value)))
}

/* ---- domain ------------------------------------------------------------- */

/** Anything that survives `JSON.stringify` unchanged: no functions, no cycles, no `undefined`. */
export const jsonValueValidator: Validator<unknown> = new Validator<unknown>((value) => {
  validateJsonValue(value, [])
  return value
})

function validateJsonValue(value: unknown, path: (string | number)[]): void {
  if (value === null) return
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new ValidationError(`Expected a finite number, got ${String(value)}`, path)
      }
      return
    case "object":
      if (Array.isArray(value)) {
        value.forEach((entry, index) => validateJsonValue(entry, [...path, index]))
        return
      }
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        throw new ValidationError(`Expected a plain object, got ${describeValue(value)}`, path)
      }
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        validateJsonValue(entry, [...path, key])
      }
      return
    default:
      throw new ValidationError(`Expected a JSON value, got ${describeValue(value)}`, path)
  }
}

/** A JSON object: the shape of every record's `meta`. */
export const jsonObjectValidator = new Validator<Record<string, unknown>>((value) => {
  if (!isPlainObject(value)) fail(`Expected an object, got ${describeValue(value)}`)
  jsonValueValidator.validate(value)
  return value
})

/** A record id of a given type: `"shape:abc"`, `"page:home"`, ... */
export function idOfType<Id extends string>(typeName: string): Validator<Id> {
  const prefix = `${typeName}:`
  return new Validator<Id>((value) => {
    if (typeof value !== "string") fail(`Expected a ${typeName} id, got ${describeValue(value)}`)
    if (!value.startsWith(prefix) || value.length <= prefix.length) {
      fail(`Expected a ${typeName} id, got ${describeValue(value)}`)
    }
    return value as Id
  })
}

/** A fractional index: the sortable key a shape's `index` holds. */
export const indexKeyValidator = new Validator<IndexKey>((value) => {
  if (typeof value !== "string" || !isIndexKey(value)) fail(`Expected an index key, got ${describeValue(value)}`)
  return value as IndexKey
})

/** A point: `{ x, y }`, optionally with the pressure/z a freehand point carries. */
export const vecModelValidator = object({
  x: numberValidator,
  y: numberValidator,
  z: numberValidator.optional(),
})

/** A box: `{ x, y, w, h }`. */
export const boxModelValidator = object({
  x: numberValidator,
  y: numberValidator,
  w: numberValidator,
  h: numberValidator,
})

/** A `src` for an image or video. Rejects `javascript:` and other script-bearing URLs. */
export const srcUrlValidator = stringValidator.check("src url", (value) => {
  if (value === "") return
  if (/^(https?:|data:|blob:|asset:|\/|\.\/|\.\.\/|#)/i.test(value)) return
  fail(`Expected a valid src url, got ${JSON.stringify(value)}`)
})

/** A link a user may be sent to. `http(s)` and mailto only. */
export const linkUrlValidator = stringValidator.check("link url", (value) => {
  if (value === "") return
  if (/^(https?:|mailto:)/i.test(value)) return
  fail(`Expected a valid link url, got ${JSON.stringify(value)}`)
})

/**
 * The validation library, as one namespace object.
 *
 * It is a plain object rather than a TS `namespace` so that it can be
 * re-exported, spread and stubbed like any other value.
 */
export const T = {
  // primitives
  any: anyValidator,
  unknown: unknownValidator,
  string: stringValidator,
  number: numberValidator,
  boolean: booleanValidator,
  bigint: bigintValidator,
  integer: integerValidator,
  positiveNumber: positiveNumberValidator,
  nonZeroNumber: nonZeroNumberValidator,
  positiveInteger: positiveIntegerValidator,
  nonZeroInteger: nonZeroIntegerValidator,
  literal,
  literalEnum,

  // composites
  object,
  arrayOf,
  setOf,
  dict,
  union,
  or,
  optional,
  nullable,
  model,

  // domain
  jsonValue: jsonValueValidator,
  jsonObject: jsonObjectValidator,
  idOfType,
  indexKey: indexKeyValidator,
  vecModel: vecModelValidator,
  boxModel: boxModelValidator,
  srcUrl: srcUrlValidator,
  linkUrl: linkUrlValidator,
} as const

/** The type of the {@link T} namespace, for anyone who wants to pass it around. */
export type ValidationLibrary = typeof T
