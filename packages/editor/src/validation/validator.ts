/**
 * The validation core: `ValidationError`, the `Validator` class and the
 * refinement combinators every validator in {@link ./T} is built from.
 *
 * A validator is anything shaped like {@link Validatable}: `validate(value)`
 * returns the value narrowed to its type or throws, and `isValid(value)`
 * answers the same question without throwing. Keeping the contract that small
 * means a `StyleProp` — or any hand-written object — can stand in for one
 * wherever a shape's `static props` map is read.
 */

/** One step of the path to the value that failed: an object key or an array index. */
export type ValidationPathSegment = string | number

/** Render a path as `props.segments.0.x`, the form used in error messages. */
export function formatValidationPath(path: readonly ValidationPathSegment[]): string {
  return path.map((segment) => String(segment)).join(".")
}

/**
 * Thrown when a value does not match its validator.
 *
 * `rawMessage` is the failure on its own ("Expected string, got undefined")
 * and `path` says where it happened; `message` is the two joined, as in
 * `At shape.props.w: Expected number, got undefined`.
 */
export class ValidationError extends Error {
  override readonly name = "ValidationError"

  constructor(
    readonly rawMessage: string,
    readonly path: readonly ValidationPathSegment[] = [],
  ) {
    super(path.length > 0 ? `At ${formatValidationPath(path)}: ${rawMessage}` : rawMessage)
  }
}

/** Re-throw `error` with `segment` pushed onto the front of its path. */
export function prefixError<T>(segment: ValidationPathSegment, fn: () => T): T {
  try {
    return fn()
  } catch (error) {
    if (error instanceof ValidationError) throw new ValidationError(error.rawMessage, [segment, ...error.path])
    throw new ValidationError(error instanceof Error ? error.message : String(error), [segment])
  }
}

/** Anything that can check a value and narrow its type: a `Validator`, a `StyleProp`, ... */
export interface Validatable<T> {
  validate(value: unknown): T
  isValid(value: unknown): boolean
}

/** The type a validator produces. */
export type TypeOf<V extends Validatable<unknown>> = V extends Validatable<infer T> ? T : never

/** How a value reads back in an error message: quoted strings, `undefined`, `Array`, ... */
export function describeValue(value: unknown): string {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (Array.isArray(value)) return "an array"
  switch (typeof value) {
    case "string":
      return JSON.stringify(value)
    case "number":
    case "boolean":
    case "bigint":
      return String(value)
    case "function":
      return "a function"
    case "object":
      return "an object"
    default:
      return typeof value
  }
}

/** Join names the way the error messages read: `"a"`, `"a" or "b"`, `"a", "b" or "c"`. */
export function listForMessage(items: readonly string[]): string {
  if (items.length === 0) return "nothing"
  if (items.length === 1) return items[0]!
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]!}`
}

/**
 * A checked value: `validate` narrows or throws, everything else is built on
 * top of it.
 *
 * Validators are immutable — `check`, `refine`, `optional` and `nullable` all
 * return a new validator and leave the receiver alone, so one shared
 * `T.string` can be refined per shape without surprising anyone else.
 */
export class Validator<T> implements Validatable<T> {
  constructor(
    /** Narrow `value` to `T`, or throw a {@link ValidationError}. */
    readonly validateValue: (value: unknown) => T,
    /**
     * Optional fast path used when a previously validated value is known: an
     * expensive validator can skip the parts that cannot have changed.
     */
    readonly validateUsingKnownGoodVersion?: (knownGood: T, value: unknown) => T,
  ) {}

  validate(value: unknown): T {
    return this.validateValue(value)
  }

  isValid(value: unknown): boolean {
    try {
      this.validateValue(value)
      return true
    } catch {
      return false
    }
  }

  /**
   * Add a further constraint that does not change the type. The callback
   * throws (or returns nothing) — anything it throws is reported under the
   * same path as the value itself.
   *
   * ```ts
   * const even = T.integer.check("even", (n) => { if (n % 2) throw new Error("not even") })
   * ```
   */
  check(check: (value: T) => void): Validator<T>
  check(name: string, check: (value: T) => void): Validator<T>
  check(nameOrCheck: string | ((value: T) => void), maybeCheck?: (value: T) => void): Validator<T> {
    const name = typeof nameOrCheck === "string" ? nameOrCheck : undefined
    const check = typeof nameOrCheck === "string" ? maybeCheck! : nameOrCheck
    return new Validator<T>((value) => {
      const validated = this.validateValue(value)
      try {
        check(validated)
      } catch (error) {
        const message = error instanceof ValidationError ? error.rawMessage : error instanceof Error ? error.message : String(error)
        throw new ValidationError(name ? `(check ${name}) ${message}` : message, error instanceof ValidationError ? error.path : [])
      }
      return validated
    })
  }

  /** Validate, then map to another type (parsing, normalizing, branding, ...). */
  refine<U>(refine: (value: T) => U): Validator<U> {
    return new Validator<U>((value) => refine(this.validateValue(value)))
  }

  /** `T | undefined`. A missing object property is legal exactly when its validator is optional. */
  optional(): Validator<T | undefined> {
    return new Validator<T | undefined>((value) => (value === undefined ? undefined : this.validateValue(value)))
  }

  /** `T | null`. */
  nullable(): Validator<T | null> {
    return new Validator<T | null>((value) => (value === null ? null : this.validateValue(value)))
  }
}

/** True when a validator accepts `undefined`, i.e. when the property it guards may be missing. */
export function isOptionalValidator(validator: Validatable<unknown>): boolean {
  return validator.isValid(undefined)
}
