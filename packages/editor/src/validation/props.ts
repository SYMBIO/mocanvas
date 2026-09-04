/**
 * Validating a record's props against the `static props` map its util declares.
 *
 * The map is `{ [propName]: validator }`, where a validator is anything with
 * `validate`/`isValid` — including a `StyleProp`. This is the runtime half of
 * `RecordProps<T>`: the types say what the map must look like, these functions
 * use it.
 */

import type { RecordPropsType, UnknownRecordProps } from "../records/props"
import { prefixError, ValidationError, type ValidationPathSegment } from "./validator"

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Validate `value` against a props map.
 *
 * Every declared prop is validated; props the map does not declare are
 * rejected, because an undeclared prop is either a typo or a prop whose
 * migration was forgotten. Errors are reported under `path` (pass
 * `["shape", "props"]` to get `At shape.props.w: …`).
 */
export function validateProps<Props extends UnknownRecordProps>(
  props: Props,
  value: unknown,
  path: readonly ValidationPathSegment[] = [],
): RecordPropsType<Props> {
  if (!isPlainObject(value)) {
    throw new ValidationError(`Expected an object, got ${value === null ? "null" : typeof value}`, path)
  }
  const run = () => {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(props, key)) throw new ValidationError("Unexpected property", [key])
    }
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(props)) {
      const validated = prefixError(key, () => props[key]!.validate(value[key]))
      if (validated === undefined && !(key in value)) continue
      out[key] = validated
    }
    return out as RecordPropsType<Props>
  }
  return path.reduceRight<() => RecordPropsType<Props>>(
    (next, segment) => () => prefixError(segment, next),
    run,
  )()
}

/** Whether `value` matches a props map. Never throws. */
export function isValidProps<Props extends UnknownRecordProps>(props: Props, value: unknown): boolean {
  try {
    validateProps(props, value)
    return true
  } catch {
    return false
  }
}
