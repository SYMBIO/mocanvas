/**
 * The documented shapes around building and consuming an editor store.
 *
 * `createStore.ts` is the implementation. This module names the things a host
 * talks about: what a store is built *from*, what a store that may still be
 * arriving looks like, and what a listener is handed.
 */
import type { HistoryEntry, MigrationSequence, SerializedStore } from "@mocanvas/store"
import type { AssetStore } from "../assets/AssetStore"
import type { CustomRecordInfo } from "../records/customRecord"
import type { EditorRecord, EditorStore, EditorStoreSnapshot } from "./createStore"
import type { PropsMigrationSource } from "../migrations/propsMigrations"

/**
 * What every way of building a store has in common: the data to start from and
 * where its asset bytes live.
 *
 * Separate from the *schema* options because the two are chosen independently.
 * A host usually has one schema for the whole application and a different
 * document to open in it every time somebody clicks a file.
 */
export interface TLStoreBaseOptions {
  /** Records to start from, as a plain serialized map. */
  initialData?: SerializedStore<EditorRecord>
  /** A snapshot to start from, in preference to `initialData`. */
  snapshot?: EditorStoreSnapshot
  /** Name given to the document's first page. */
  defaultName?: string
  /** Id for the store itself. Useful in a log when a page holds several. */
  id?: string
  /**
   * Where the bytes behind this document's assets live.
   *
   * Kept by identity, so a caller can compare `store.props.assets` against what
   * it passed. Defaults to an in-memory store.
   */
  assets?: AssetStore
}

/** The schema half: what record types this store may contain. */
export interface TLStoreSchemaOptions {
  /** The shape utils the document will be read with; their `static migrations` join the schema. */
  shapeUtils?: readonly PropsMigrationSource[]
  /** Binding utils, for the same reason. */
  bindingUtils?: readonly PropsMigrationSource[]
  /** The app's own top-level record types, beyond shapes and bindings. */
  records?: Readonly<Record<string, CustomRecordInfo<string>>>
  /** Further migration sequences to register. */
  migrations?: MigrationSequence[]
}

/** Everything needed to build a store: the data and the schema. */
export type TLStoreOptions = TLStoreBaseOptions & TLStoreSchemaOptions

/**
 * A store, or the reason there isn't one yet.
 *
 * A store that has to be fetched, migrated or synced before it can be shown is
 * not just "a store that is empty" — an editor mounted on an empty store lets
 * somebody start drawing into a document that is about to be replaced. So the
 * store is only present in the states where it is genuinely ready, and the
 * union makes it impossible to read one out of a state where it is not.
 *
 * `synced-remote` carries a connection status of its own because being offline
 * is not an error: the document is complete and editable, the edits are simply
 * queued.
 */
export type TLStoreWithStatus =
  /** No synchronisation is involved; the store is purely local and ready. */
  | { readonly status: "not-synced"; readonly store: EditorStore }
  /** Still arriving. Show a loading state; there is nothing to edit yet. */
  | { readonly status: "loading" }
  /** It will not arrive. Show the error; there is nothing to edit. */
  | { readonly status: "error"; readonly error: Error }
  /** Restored from local persistence and ready. */
  | { readonly status: "synced-local"; readonly store: EditorStore }
  /** Synchronised with a peer or a server, and ready. */
  | {
      readonly status: "synced-remote"
      readonly store: EditorStore
      readonly connectionStatus: "online" | "offline"
    }

/**
 * What a store listener is handed: the records that changed, and who changed
 * them.
 *
 * `source` is the field that matters. A change a peer made must not go on this
 * client's undo stack, and a change this client made must be broadcast — both
 * decisions are made from this one field, and getting it wrong produces
 * symptoms (undo reversing somebody else's work) that look nothing like their
 * cause.
 */
export type TLStoreEventInfo = HistoryEntry<EditorRecord>
