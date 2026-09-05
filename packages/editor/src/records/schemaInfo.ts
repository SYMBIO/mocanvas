/**
 * What `createTLSchema` is told about the things it has to build a schema for.
 *
 * A schema needs three things from every shape, binding, asset or custom record
 * type an app registers: its props (to validate), its migrations (to load older
 * documents), and — for records the app declares outright — where the records
 * live. Utils happen to carry the first two as statics, which is why a util can
 * be passed straight in; but nothing about a schema requires a util, and
 * `SchemaPropsInfo` is that minimum stated on its own.
 */

import type { MigrationSequence } from "@mocanvas/store"
import type { PropsMigrations } from "../migrations/propsMigrations"
import type { UnknownRecordProps } from "./props"

/**
 * The props-and-migrations pair a schema needs for one shape, binding or asset
 * type.
 *
 * A `ShapeUtil` subclass satisfies this structurally through its `static props`
 * and `static migrations`, so `createTLSchema({ shapes: { geo: GeoShapeUtil } })`
 * type-checks without the util having to declare anything extra.
 */
export interface SchemaPropsInfo {
  /** One validator per prop; the same map a util declares as `static props`. */
  readonly props?: UnknownRecordProps | undefined
  /**
   * How the props have changed over time: either a props migration sequence
   * (the usual case) or a full store `MigrationSequence` for a type that needs
   * to touch more than its own props.
   */
  readonly migrations?: PropsMigrations | MigrationSequence | undefined
}

/**
 * What a schema is told about the `user` record type.
 *
 * Attribution is the reason this exists: an app that shows "created by" on a
 * shape has to store *something* about the person, and what that something is
 * differs per app — an email here, a tenant-scoped id there, a display name and
 * an avatar url somewhere else. Rather than guess, the schema takes the app's
 * own fields and validates them.
 *
 * Purely local: nothing here talks to a service. The host app resolves ids to
 * people however it already does.
 */
export interface UserSchemaInfo {
  /** One validator per user field the app wants persisted. */
  readonly props?: UnknownRecordProps | undefined
  /** Migrations for those fields, as user records already in documents change. */
  readonly migrations?: PropsMigrations | MigrationSequence | undefined
}
