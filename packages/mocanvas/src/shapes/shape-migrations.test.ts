import { describe, expect, it } from "vitest"
import { createPropsMigrationSequences } from "@mocanvas/editor"
import { parseMigrationId } from "@mocanvas/store"
import { defaultShapeUtils } from "./index"
import { defaultBindingUtils } from "../bindings"
import {
  arrowBindingMigrations,
  arrowShapeMigrations,
  arrowShapeVersions,
  drawShapeMigrations,
  groupShapeMigrations,
  noteShapeMigrations,
} from "./shape-migrations"

/** Run a sequence's `up` steps over a props bag, the way the store would. */
function up(migrations: { sequence: readonly { up: (p: Record<string, unknown>) => void }[] }, props: Record<string, unknown>) {
  const next = { ...props }
  for (const step of migrations.sequence) step.up(next)
  return next
}

describe("built-in props migrations", () => {
  it("never claims a sequence id under the reference implementation's prefix", () => {
    // The one that matters: `com.tldraw.shape.geo` is at version 12 in real
    // files, so registering it here at version 1 fails every load.
    const sequences = createPropsMigrationSequences({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils })
    expect(sequences.length).toBeGreaterThan(0)
    for (const sequence of sequences) {
      expect(sequence.sequenceId.startsWith("com.tldraw."), sequence.sequenceId).toBe(false)
    }
  })

  it("declares a sequence for every built-in shape, none of them empty", () => {
    const sequences = createPropsMigrationSequences({ shapeUtils: defaultShapeUtils })
    expect(sequences).toHaveLength(defaultShapeUtils.length)
    for (const sequence of sequences) {
      // An empty props sequence has no id to read, so the schema would name it
      // `com.tldraw.shape.<type>` — exactly what the check above forbids.
      expect(sequence.sequence.length, sequence.sequenceId).toBeGreaterThan(0)
    }
  })

  it("numbers every id from 1, under the type it belongs to", () => {
    for (const [type, migrations] of [
      ["arrow", arrowShapeMigrations],
      ["draw", drawShapeMigrations],
      ["group", groupShapeMigrations],
      ["note", noteShapeMigrations],
    ] as const) {
      migrations.sequence.forEach((step, index) => {
        const { sequenceId, version } = parseMigrationId(step.id)
        expect(sequenceId).toBe(`com.mocanvas.shape.${type}`)
        expect(version).toBe(index + 1)
      })
    }
  })

  it("backfills the props elbow routing added, and leaves stored ones alone", () => {
    expect(arrowShapeVersions.BackfillMissingProps).toBe("com.mocanvas.shape.arrow/1")
    expect(up(arrowShapeMigrations, { bend: 0 })).toMatchObject({ kind: "arc", elbowMidPoint: 0.5, labelPosition: 0.5, scale: 1 })
    expect(up(arrowShapeMigrations, { kind: "elbow", elbowMidPoint: 0.2 })).toMatchObject({ kind: "elbow", elbowMidPoint: 0.2 })
  })

  it("derives a rich-text label from a legacy plain-text one", () => {
    const migrated = up(noteShapeMigrations, { text: "one\ntwo" })
    expect(migrated["richText"]).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "one" }] },
        { type: "paragraph", content: [{ type: "text", text: "two" }] },
      ],
    })
    // The plain text stays: it is the derived form everything else reads.
    expect(migrated["text"]).toBe("one\ntwo")
  })

  it("leaves an existing rich-text label untouched", () => {
    const richText = { type: "doc", content: [{ type: "paragraph" }] }
    expect(up(noteShapeMigrations, { richText, text: "ignored" })["richText"]).toBe(richText)
  })

  it("gives a group a sequence even though it has nothing to backfill", () => {
    expect(groupShapeMigrations.sequence).toHaveLength(1)
    expect(up(groupShapeMigrations, {})).toEqual({})
  })

  it("names the arrow binding's sequence under our own prefix too", () => {
    const step = arrowBindingMigrations.sequence[0]!
    expect(parseMigrationId(step.id).sequenceId).toBe("com.mocanvas.binding.arrow")
  })

  it("copies backfilled values rather than sharing one object between records", () => {
    const a = up(arrowShapeMigrations, {})
    const b = up(arrowShapeMigrations, {})
    expect(a["richText"]).not.toBe(b["richText"])
  })
})
