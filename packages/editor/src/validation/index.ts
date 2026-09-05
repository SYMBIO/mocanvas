// Deliberately NOT `export *` from "./T": it declares `object`, `or`, `union`,
// `optional`, `literal`, `model` and `dict`, which must not land in the
// package's top-level namespace.
export {
  T,
  ObjectValidator,
  ArrayOfValidator,
  DictValidator,
  UnionValidator,
  type ObjectValidatorType,
  type UnionValidatorConfig,
  type ValidationLibrary,
} from "./T"
export {
  ValidationError,
  Validator,
  isOptionalValidator,
  formatValidationPath,
  prefixError,
  type Validatable,
  type TypeOf,
  type ValidationPathSegment,
} from "./validator"
export { validateProps, isValidProps } from "./props"
// The two record-shaped primitives, exported by name as well as through `T`:
// a shape's `static props` map names them directly far more often than it
// reaches for the namespace.
export { boxModelValidator, vecModelValidator } from "./T"
