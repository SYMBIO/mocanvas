export {
  createRecordType,
  isRecordLike,
  parseRecordId,
  RecordType,
  uniqueId,
  UNIQUE_ID_LENGTH,
  type BaseRecord,
  type EphemeralKeys,
  type IdOf,
  type RecordCreateProps,
  type RecordDataKeys,
  type RecordFromId,
  type RecordId,
  type RecordScope,
  type RecordTypeConfig,
  type StoreValidator,
  type UnknownRecord,
} from "./ids"

export {
  compareIndexKeys,
  getIndexAbove,
  getIndexBelow,
  getIndexBetween,
  getIndices,
  getIndicesAbove,
  getIndicesBelow,
  getIndicesBetween,
  isIndexJitterEnabled,
  isIndexKey,
  setIndexJitterEnabled,
  sortByIndex,
  validateIndexKey,
  START_INDEX_KEY,
  ZERO_INDEX_KEY,
  type IndexKey,
} from "./indexKey"

export { compareZKeys, indexKeyToZKey, zKeyToBigInt, ZKEY_SIGNIFICANT_DIGITS, type ZKey } from "./zkey"

export {
  applyChangeToDiff,
  cloneRecordsDiff,
  createEmptyRecordsDiff,
  isRecordsDiffEmpty,
  reverseRecordsDiff,
  squashRecordDiffs,
  squashRecordDiffsMutable,
  type RecordsDiff,
} from "./RecordsDiff"

export {
  applyMigrationToStore,
  applyRecordMigration,
  createMigrationIds,
  createMigrationSequence,
  createRecordMigrationSequence,
  parseMigrationId,
  type Migration,
  type MigrationId,
  type MigrationResult,
  type MigrationSequence,
  type RecordMigration,
  type SerializedSchema,
  type SerializedSchemaV2,
  type SerializedStore,
  type StoreMigration,
} from "./migrate"

export {
  StoreSchema,
  type RecordTypeMap,
  type StoreSchemaOptions,
  type StoreSnapshot,
  type StoreValidationFailure,
  type StoreValidationPhase,
} from "./StoreSchema"

export {
  freezeRecord,
  isRecordShallowEqual,
  Store,
  StoreQueries,
  StoreSideEffects,
  type ChangeSource,
  type HistoryEntry,
  type RecordFromTypeName,
  type StoreAfterChangeHandler,
  type StoreAfterCreateHandler,
  type StoreAfterDeleteHandler,
  type StoreBeforeChangeHandler,
  type StoreBeforeCreateHandler,
  type StoreBeforeDeleteHandler,
  type StoreListener,
  type StoreError,
  type StoreListenerFilters,
  type StoreObject,
  type StoreObjectRecordType,
  type StoreOperationCompleteHandler,
  type StoreOptions,
  type StoreQueryFilter,
  type StoreRecord,
  type StoreSideEffectHandlers,
  type StoreValidators,
} from "./Store"

export {
  parseTldrFile,
  serializeTldrFile,
  storeSnapshotToTldrFile,
  TLDR_FILE_FORMAT_VERSION,
  tldrFileToStoreSnapshot,
  type ParseTldrFileResult,
  type TldrFile,
  type TldrFileParseError,
} from "./tldr"

export {
  createComputedCache,
  type ComputedCache,
  type ComputedCacheContext,
  type CreateComputedCacheOpts,
  type CreateComputedCacheOptions,
} from "./computedCache"

export { assertIdType, devFreeze } from "./devFreeze"

export {
  applyCollectionDiff,
  getIndexablePropertyOf,
  isCollectionDiffEmpty,
  matchesQuery,
  matchesQueryValue,
  type CollectionDiff,
  type QueryExpression,
  type QueryValueMatcher,
  type RSIndex,
  type RSIndexDiff,
  type RSIndexMap,
} from "./query"

export {
  isSerializedSchemaV1,
  MigrationFailureReason,
  type LegacyBaseMigrationsInfo,
  type LegacyMigration,
  type LegacyMigrations,
  type SerializedSchemaV1,
  type StandaloneDependsOn,
} from "./legacy"

export {
  createInMemoryStorage,
  type SynchronousRecordStorage,
  type SynchronousStorage,
} from "./storage"

// The reactive collections, re-exported so `@mocanvas/store` is a complete
// answer to "where do the store's data structures live?".
export { AtomMap, AtomSet } from "@mocanvas/state"

export { getGraphemeLength, getGraphemes, iterateGraphemes } from "./graphemes"
