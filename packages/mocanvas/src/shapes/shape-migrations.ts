/**
 * The props migration sequence of every built-in shape, and of the built-in
 * `arrow` binding.
 *
 * A sequence is what lets a board saved before a prop existed still load. Every
 * built-in's version 1 does the same job: **backfill the props that post-date
 * the shape**, with the value the shape's own `getDefaultProps` would give
 * them. That is not cosmetic — the shape utils read their props through
 * `read*` helpers with defaults precisely because records arrive incomplete,
 * and a consumer reading `shape.props.scale` off the store directly gets
 * `undefined` on an old board unless something fills it in. The migration does
 * it once on load instead of on every read.
 *
 * Two rules this file is careful about:
 *
 * 1. **The sequence id must be ours.** Every id comes from
 *    {@link createBuiltInShapePropsMigrationIds}, which puts it under
 *    `com.mocanvas.shape.*`. A `.tldr` written by the reference implementation
 *    records its own progress under `com.tldraw.shape.<type>` at a version far
 *    past 1, and a schema that claims the same id at version 1 makes every such
 *    file fail to load with "data comes from a newer version".
 *    `src/tldr-compat.test.ts` pins it.
 * 2. **No sequence here is empty.** An empty props sequence carries no id of
 *    its own — there is no migration to read one off — so the schema falls back
 *    to naming it `com.tldraw.shape.<type>`, which is exactly the claim rule 1
 *    forbids. A shape with nothing to backfill therefore still declares a
 *    version 1, as a no-op whose only job is to name the sequence.
 *
 * `down` is a no-op throughout for the same reason: version 1 adds only values
 * that clients older than it already tolerated — they are the values those
 * clients implied by leaving the prop out — so there is nothing to undo.
 */

import {
  createBindingPropsMigrationSequence,
  createBuiltInBindingPropsMigrationIds,
  createBuiltInShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  type MigratableProps,
  type PropsMigrations,
} from "@mocanvas/editor"
import { toRichText } from "../text/rich-text"

/**
 * Build a built-in shape's version-1 sequence: fill in `defaults` for props
 * that are absent, and — for a label-bearing shape — derive `richText` from a
 * legacy plain-text label, which is the shape v5 changed the most.
 */
function backfillMigration(
  type: string,
  defaults: Readonly<Record<string, unknown>>,
  options: { richTextFromText?: boolean } = {},
): PropsMigrations {
  const versions = createBuiltInShapePropsMigrationIds(type, { BackfillMissingProps: 1 })
  return createShapePropsMigrationSequence({
    sequence: [
      {
        id: versions.BackfillMissingProps,
        up(props: MigratableProps) {
          if (options.richTextFromText && props["richText"] === undefined) {
            props["richText"] = toRichText(typeof props["text"] === "string" ? props["text"] : "")
          }
          for (const [key, value] of Object.entries(defaults)) {
            if (props[key] === undefined) props[key] = structuredClone(value)
          }
        },
        down() {},
      },
    ],
  })
}

/** Named versions of the arrow shape's props; see {@link arrowShapeMigrations}. */
export const arrowShapeVersions = createBuiltInShapePropsMigrationIds("arrow", {
  BackfillMissingProps: 1,
})

/**
 * The arrow shape's props migrations.
 *
 * Elbow routing arrived after the arrow did, so an arrow saved before it has
 * neither `kind` nor `elbowMidPoint`. `"arc"` is the routing every such arrow
 * was drawn with, and `0.5` puts a middle leg exactly halfway — where an elbow
 * arrow is created — so an old arrow switched to elbow routing by hand looks
 * like a new one.
 */
export const arrowShapeMigrations = backfillMigration(
  "arrow",
  { kind: "arc", elbowMidPoint: 0.5, labelPosition: 0.5, scale: 1 },
  { richTextFromText: true },
)

/** The draw shape's props migrations; see the module comment. */
export const drawShapeMigrations = backfillMigration("draw", {
  isComplete: true,
  isClosed: false,
  isPen: false,
  scale: 1,
})

/** The highlight shape's props migrations; see the module comment. */
export const highlightShapeMigrations = backfillMigration("highlight", {
  isComplete: true,
  isPen: false,
  scale: 1,
})

/** The line shape's props migrations; see the module comment. */
export const lineShapeMigrations = backfillMigration("line", { spline: "line", scale: 1 })

/** The text shape's props migrations; see the module comment. */
export const textShapeMigrations = backfillMigration("text", { autoSize: true, scale: 1 }, { richTextFromText: true })

/** The note shape's props migrations; see the module comment. */
export const noteShapeMigrations = backfillMigration(
  "note",
  { fontSizeAdjustment: 0, growY: 0, url: "", scale: 1 },
  { richTextFromText: true },
)

/** The frame shape's props migrations; see the module comment. */
export const frameShapeMigrations = backfillMigration("frame", { name: "" })

/**
 * The group shape's props migrations.
 *
 * A group carries no props, so version 1 is a no-op — declared anyway so the
 * sequence is named `com.mocanvas.shape.group` rather than falling back to the
 * reference implementation's id. See rule 2 in the module comment.
 */
export const groupShapeMigrations = backfillMigration("group", {})

/** The image shape's props migrations; see the module comment. */
export const imageShapeMigrations = backfillMigration("image", {
  assetId: null,
  playing: true,
  url: "",
  crop: null,
  flipX: false,
  flipY: false,
  altText: "",
})

/** The video shape's props migrations; see the module comment. */
export const videoShapeMigrations = backfillMigration("video", {
  assetId: null,
  time: 0,
  playing: true,
  url: "",
  altText: "",
})

/** The bookmark shape's props migrations; see the module comment. */
export const bookmarkShapeMigrations = backfillMigration("bookmark", { assetId: null, url: "" })

/** The embed shape's props migrations; see the module comment. */
export const embedShapeMigrations = backfillMigration("embed", { url: "" })

/**
 * The arrow binding's props migrations.
 *
 * Nothing to backfill — an arrow binding has carried the same four props for as
 * long as it has existed — but the sequence is still declared, so that the
 * binding's first prop change has somewhere to go and so that its id is ours
 * rather than the fallback `com.tldraw.binding.arrow`.
 */
export const arrowBindingMigrations = createBindingPropsMigrationSequence({
  sequence: [
    {
      id: createBuiltInBindingPropsMigrationIds("arrow", { Initial: 1 }).Initial,
      up() {},
      down() {},
    },
  ],
})
