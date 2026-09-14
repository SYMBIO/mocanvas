# Driving the editor from an agent

mocanvas ships no model, no prompt and no agent. It ships a document that exists
without a browser, and one `Editor` API that a person's toolbar and a program's
code both call. This guide is for somebody pointing a model at that API: how to
build an editor with no screen, write to it, read the document back, and where
the sharp edges are. Everything here is public API from `@mocanvas/mocanvas` /
`@mocanvas/editor`.

Contents:

1. [The shape of the thing](#1-the-shape-of-the-thing)
2. [A document with no browser](#2-a-document-with-no-browser)
3. [Writing](#3-writing)
4. [Reading back](#4-reading-back)
5. [Keeping an agent's writes out of a person's undo stack](#5-keeping-an-agents-writes-out-of-a-persons-undo-stack)
6. [Reproducible runs](#6-reproducible-runs)
7. [Validation on the way in](#7-validation-on-the-way-in)
8. [A worked example: a plan, drawn](#8-a-worked-example-a-plan-drawn)

---

## 1. The shape of the thing

There is no agent API. An agent calls `editor.createShapes(...)`, and so does the
toolbar; an agent calls `editor.markHistoryStoppingPoint("style")`, and so does
the style panel — that exact call is in `packages/mocanvas/src/ui/StylePanel.tsx`.
"Convert to embed", "fit frame to content" and "auto size" in
`packages/mocanvas/src/ui/menu-items.tsx` are each a `markHistoryStoppingPoint`
followed by ordinary editor calls.

Three things follow. **There is no second surface to keep in sync** — a method an
agent can reach is one the UI already exercises, under the same tests. **Nothing
an agent does is outside the document**: writes go through `editor.run`, which
opens one store operation, so a sync layer sees an agent's work the way it sees a
person's. And **nothing an agent does is un-undoable by a person** — an agent's
writes are recorded steps by default, so Cmd+Z takes them back. §5 covers turning
that off, and what turning it off does not promise. The UI layer is described in
[UI.md](UI.md); none of it is required.

---

## 2. A document with no browser

`createStore()` builds a store with the editor's record types and seeds the two
records every document has — the document itself and page 1 — so a store no
editor has touched is already a readable document:

```ts
import { createStore, defaultShapeUtils, defaultBindingUtils } from "@mocanvas/mocanvas"

const store = createStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils })
```

Pass the same util lists you will give the editor: their `static migrations` are
collected into the schema, so a board persisted before a prop existed is backfilled
on load. Pass `seed: false` when you will supply your own page afterwards, or that
store ends up with two pages at the same index — and equal indices have no defined
order.

The WebAssembly engine loads once per realm: `await loadEngine()` in a browser,
which needs no bundler configuration, and `loadEngineSync(bytes)` in Node — what
this repository's own tests use.

```ts
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { loadEngineSync } from "@mocanvas/mocanvas"

const wasmPath = fileURLToPath(import.meta.resolve("@mocanvas/wasm/pkg/mocanvas_bg.wasm"))
const engine = loadEngineSync(readFileSync(wasmPath))
```

`await loadEngine()` does work in Node, but not by the route you want: it fetches
`new URL("../pkg/mocanvas_bg.wasm", import.meta.url)`, Node's `fetch` cannot read a
`file:` URL, and the loader falls back to a base64 copy embedded in the package
with a one-time warning.

### The editor, with no element

```ts
import { Editor, defaultShapeUtils, defaultBindingUtils, defaultTools } from "@mocanvas/mocanvas"

const editor = new Editor({
  store,
  shapeUtils: defaultShapeUtils,
  bindingUtils: defaultBindingUtils,
  tools: defaultTools,
  engine,
})
```

**No `getContainer`.** It became optional in 4.8.3, and optional is the point: an
editor with no screen has no element to give, and requiring one made every headless
caller begin by inventing a fake DOM node (`getContainer: () => ({}) as HTMLElement`).
Nothing inside ever needed it — `Editor`'s private `safeContainer()` has always
treated a missing or throwing container as "no container". It was the type
insisting, not the runtime.

Ask for the element anyway and `editor.getContainer()` — and `editor.container`,
which calls it — **throws**, saying this editor was built without `getContainer` so
it has no container, which is expected for a headless editor: a stated condition
rather than a `TypeError` two layers down. Everything that merely *looks* for one
copes. `getContainerDocument()` and `getContainerWindow()` return `undefined`, and
`focus()` and `blur()` are DOM no-ops that still record the state on the instance
record, so `getIsFocused()` stays answerable.

Two things are genuinely different without a DOM. **Text is estimated, not
measured** — `TextMeasure` falls back to `estimateTextSize` where no `document`
exists, so label sizes and any auto-grown height (`growY`) are close but not
identical to a browser's. And **the viewport is 0×0 until you say otherwise**: call
`editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1600, h: 1000 })` before
`zoomToFit()`, or the move is deferred and a warning says so. Importing
`@mocanvas/mocanvas` in plain Node works; the JS entry stopped importing the
stylesheet after 4.0.2. Call `editor.dispose()` when the run is over.

---

## 3. Writing

`createShapes`, `updateShapes` and `deleteShapes` are the three verbs. Each takes an
array and returns the editor, so they chain.

```ts
import { createShapeId, type GeoShape } from "@mocanvas/mocanvas"

const id = createShapeId("summary")

editor.createShapes<GeoShape>([
  { id, type: "geo", x: 0, y: 0, props: { geo: "rectangle", w: 240, h: 120 } },
])
editor.updateShapes<GeoShape>([{ id, type: "geo", x: 40, props: { w: 300 } }])
editor.deleteShapes([id])
```

- **Props you leave out come from `getDefaultProps()`**, which keeps a model's
  output short.
- **Style props you leave out come from the *instance*.** `createShapes` fills any
  unset style prop from `stylesForNextShape` — the colour and size the last
  interaction left behind. Right for a person, surprising for a program: if the
  same input should give the same document, set style props explicitly.
- **`updateShapes` merges `props` and `meta` and replaces everything else.** A
  partial naming a shape that is not there is skipped rather than throwing, as is a
  `null` or `undefined` entry.
- **`deleteShapes` takes descendants with the parent**, skips locked shapes, and
  clears the selection, hover and editing state of anything it removes.

### One gesture, one `run`, one mark

```ts
editor.markHistoryStoppingPoint("lay out the diagram")
editor.run(() => {
  editor.createShapes(boxes)
  editor.createShapes(arrows)
  editor.updateShapes(adjustments)
})
```

`editor.run(fn)` opens an operation on the *store*, not merely a signal transaction:
one history entry, one notification, however many writes happen inside. Before 4.8.1
it was a `transact` alone, so two `updateShapes` calls in one `run` reached a
listener as two notifications, the first carrying a half-applied state the document
was never meant to be in — and a sync binding published that state to its peers.

`markHistoryStoppingPoint(name?)` puts a mark in the history and returns its id.
**One gesture should be one mark.** The unit a person expects Cmd+Z to take back is
the thing they asked for — "draw the plan", not "the fourteenth arrow of the plan" —
and the mark defines that unit. `editor.mark(name)` is an alias;
`editor.bailToMark(id)` abandons a half-finished gesture using the returned id.

---

## 4. Reading back

The half an agent needs and rarely gets: asking what is on the page, and where,
without anything having been drawn. All of it works headless, because geometry and
hit-testing live in the engine rather than in the renderer.

```ts
editor.getCurrentPageShapes()          // Shape[] — store order
editor.getCurrentPageShapesSorted()    // draw order, depth-first through children
editor.getCurrentPageShapeIds()        // Set<ShapeId>
editor.getShape<GeoShape>(id)          // one shape, or undefined
```

`getShape` takes an id or a shape and returns the discriminated `Shape` union by
default, so `if (shape.type === "geo")` narrows `shape.props` at the call site. Pass
a type argument for a specific shape, or `UnknownShape` for a type nothing
registered.

```ts
editor.getShapePageBounds(id)      // Box | undefined — one shape, in page space
editor.getShapeGeometryBounds(id)  // Box | undefined — the same box, shape-local
editor.getCurrentPageBounds()      // Box | undefined — the union, undefined when empty
```

`getCurrentPageBounds()` is **geometry, not ink**: the union of
`getShapePageBounds()`, deliberately excluding the half-stroke pad the engine keeps
for culling. The pad is per-shape, so including it would inflate the box and shift
its centre whenever the outermost shapes carried different stroke widths — making
"centre this on the page" depend on how thickly it was drawn. `Box` gives you
`center`, `minX`/`maxX`/`minY`/`maxY`, `corners` and `containsPoint`.

```ts
editor.getShapeAtPoint({ x: 420, y: 260 })   // UnknownShape | undefined, topmost
editor.getShapesAtPoint({ x: 420, y: 260 })  // UnknownShape[], topmost first
```

Both call `flushEngine()` first, so a shape created a line earlier is already in the
spatial index: **no frame has to be rendered for a hit test to be correct**, and none
is. The default answers "the interior of a filled shape, or the outline of any
shape", which is what a pointer would hit. `{ hitInside: true }` also counts the
interior of a *hollow* shape; that case goes the geometry route rather than the
engine's index, which is a page scan, so it is a deliberate opt-in. Tolerance comes
from `editor.getHitTestMargin()`, divided by the current zoom — headless with no
camera moved, that zoom is 1; pass `{ margin }` to fix it yourself if a run should
not depend on the configured default. `editor.getPointInShapeSpace(shape, point)`
converts a page point into a shape's local frame, which is what you want before
comparing against `w` and `h`.

---

## 5. Keeping an agent's writes out of a person's undo stack

```ts
editor.run(() => {
  editor.updateShapes(layoutCorrections)
}, { history: "ignore" })
```

`history: "ignore"` means the writes inside the callback are **not a step in the undo
stack**. Use it for work the user did not ask for and would not think of as their own
edit: a derived layout pass, a label re-flow, an annotation an agent maintains in the
background. Without it, a person's next Cmd+Z takes back your housekeeping instead of
their last edit.

The nesting matters. The history manager is a store *listener*: it reads its ignore
counter when the notification arrives, which — now that `run` is one operation — is
after the callback has returned. So the ignore goes outside the operation, not inside
it:

```ts
store.atomic(() => history.ignore(fn))   // 4.8.1 — wrong way round
history.ignore(() => store.atomic(fn))   // 4.8.2 onwards
```

4.8.1 had it inside, and ignored writes went into the undo stack after all. If you are
on 4.8.1, upgrade straight past it.

### What it does not promise

This is the part that bites in production. **An ignored write to a record the user
then undoes is still reverted.**

```ts
editor.markHistoryStoppingPoint()
editor.updateShapes([{ id: S, type: "geo", x: 100 }])

editor.run(() => editor.updateShapes([{ id: S, type: "geo", y: 250 }]), { history: "ignore" })

editor.undo()   // S.x back to 0 — and S.y back to 0 as well
```

Undo restores **whole records, not fields**. Putting `S` back as it was at the mark
puts back every field of `S`, the ignored one included. `history: "ignore"` promises
your write is not a *step*; it cannot promise that some other step will not overwrite
it. This is not a regression and not a mocanvas quirk — it behaves the same on 4.8.0
and earlier, and the same in the reference implementation this API is shaped after. A
test in this repository asserts it, so the next person to meet it can tell which of
the two problems they have.

The practical consequence: **if an agent's output must survive a user's undo, put it
in records the user is not editing.** A separate shape, or an app record type of your
own, is safe; a field tucked into a shape the user is dragging is not. The same option
also takes `"record"` (the default) and `"record-preserveRedoStack"`, which records
the step without discarding a redo stack the user might still want.

---

## 6. Reproducible runs

Two runs of the same agent over the same input should produce the same document, or
you cannot diff them, snapshot them in a test, or tell a model's change from a
library's. Two things stand in the way; both are controllable.

**Ids.** `createShapeId()` with no argument generates a random unique part;
`createShapeId("box-1")` returns `shape:box-1` verbatim. Name your ids from your input
and the same plan yields the same records. `createBindingId` is the same.

**Index-key jitter.** A record's `index` is a fractional index — an order key that
sorts lexicographically and between which new keys can always be generated. Plain
fractional indexing is a pure function of its two neighbours, so two clients inserting
into the same gap generate the *same* key every single time; `index` is one register to
a last-writer-wins merge, so one of the two shapes is merged away. mocanvas appends six
random digits from a 61-character alphabet, so the keys differ while staying in the
same gap. That is what makes concurrent insertion safe — and it makes every generated
key unpredictable, which is exactly wrong for a run you want to compare. So jitter is
off under a test runner. The resolution order, in `packages/store/src/indexKey.ts`:

1. An explicit `setIndexJitterEnabled(true | false)` wins for the rest of the process;
   `null` restores the default.
2. Otherwise `MOCANVAS_INDEX_JITTER`, if set. `"0"`, `"false"` and `"off"` mean off;
   anything else means on.
3. Otherwise `NODE_ENV === "test"` turns it off.
4. Otherwise it is on.

The environment variable is the one to reach for in a runner that does not set
`NODE_ENV`, or that sets it to `test` when you did not want that. Both helpers come
from `@mocanvas/store`; `@mocanvas/editor` re-exports the index-key *generators* but
not these two. It is process-wide rather than per-call because those generators are
free functions reached from everywhere, `Editor` included.

```ts
import { setIndexJitterEnabled } from "@mocanvas/store"

setIndexJitterEnabled(false)   // process-wide; pass null to restore the default
```

With named ids and jitter off, `serializeMocanvasFile(editor)` returns a string you can
compare byte for byte between runs, and `store.getStoreSnapshot()` returns the records
and the schema version for a structural assertion.

---

## 7. Validation on the way in

Records are checked against their type as they enter the store, so a malformed shape
from a model throws at `put` — the moment it is written — rather than mounting and
failing somewhere in geometry or rendering. `Store.put` calls `schema.validateRecord`
for every record, before any `before*` side effect and before the record is frozen and
written. The message names the path:

```
At shape.props.w: Expected number, got undefined
```

An unregistered shape type is caught earlier still: `createShapes` asks
`getShapeUtil(partial.type)` first, which throws `No ShapeUtil registered for type
"flowchart"` without touching the store. What each shape is validated against is its
util's `static props` map — the same map [CUSTOM_SHAPES.md](CUSTOM_SHAPES.md) shows you
writing, which is why validation covers your own shapes and not only the built-in ones.

Failures throw by default. `StoreSchema.create` accepts an `onValidationFailure`
handler that can repair a record and return it instead — how a `.tldr` file from an
older version gets loaded rather than rejected — but `createStore` does not plumb that
option through, so a store built the ordinary way throws. For an agent that is usually
right: a model that produced `w: "180"` should be told, not silently corrected.

---

## 8. A worked example: a plan, drawn

A plan is data — boxes and arrows with stable names. Turning it into a document is one
function, and nothing in it is agent-specific: the same code behind a toolbar button
would be the same code.

```ts
import { createShapeId, toRichText, type ArrowShape, type Editor, type GeoShape } from "@mocanvas/mocanvas"

export interface Plan {
  boxes: { name: string; label: string; x: number; y: number; w?: number; h?: number }[]
  arrows: { from: string; to: string; label?: string }[]
}

export function drawPlan(editor: Editor, plan: Plan): void {
  editor.markHistoryStoppingPoint("draw plan")

  editor.run(() => {
    editor.createShapes<GeoShape>(
      plan.boxes.map((box) => ({
        id: createShapeId(box.name),
        type: "geo",
        x: box.x,
        y: box.y,
        // Styles are explicit: anything left out would come from
        // `stylesForNextShape`, whatever the last interaction left there.
        props: {
          geo: "rectangle",
          w: box.w ?? 180,
          h: box.h ?? 90,
          richText: toRichText(box.label),
          color: "black",
          fill: "none",
          dash: "draw",
          size: "m",
        },
      })),
    )

    for (const edge of plan.arrows) {
      const fromId = createShapeId(edge.from)
      const toId = createShapeId(edge.to)
      const from = editor.getShapePageBounds(fromId)
      const to = editor.getShapePageBounds(toId)
      if (!from || !to) continue

      const arrowId = createShapeId(`${edge.from}->${edge.to}`)

      // The arrow sits at the page origin, so its local space and page space are the
      // same frame and the two centres go straight in. These are the *static*
      // terminals; the bindings below take over while they exist.
      editor.createShape<ArrowShape>({
        id: arrowId,
        type: "arrow",
        x: 0,
        y: 0,
        props: {
          kind: "arc",
          start: { x: from.center.x, y: from.center.y },
          end: { x: to.center.x, y: to.center.y },
          ...(edge.label ? { richText: toRichText(edge.label) } : {}),
        },
      })

      editor.createBindings([
        { type: "arrow", fromId: arrowId, toId: fromId, props: { terminal: "start" } },
        { type: "arrow", fromId: arrowId, toId: toId, props: { terminal: "end" } },
      ])
    }
  })
}
```

### Why the bindings, and why the arrow still ends on the edge

The two points above are box *centres*, not edge points — and the drawn arrow runs edge
to edge anyway. That is the binding doing it, not arithmetic you were spared writing.
`ArrowShapeUtil.getGeometry` resolves its terminals through
`getArrowTerminalsInArrowSpace` on every read: a bound terminal starts at the anchor
inside the bound shape's bounds (the default `normalizedAnchor` is `{ x: 0.5, y: 0.5 }`,
the centre) and is pulled back to where the arrow body first crosses that shape's
**outline** on its way from the opposite terminal, then back a little further, by
`ARROW_TERMINAL_GAP_STROKES` (2.7) times the stroke width. An arrowhead resting on a
border reads as part of that border; a small gap reads as pointing at it.

So the geometry is right from the moment the binding exists, before anything is rendered
— `editor.getShapePageBounds(arrowId)` already reflects it. The static `props.start` /
`props.end` are a fallback: `ArrowBindingUtil` rewrites them when the bound shape
changes, and freezes the terminal at its current position if the bound shape is deleted
or the binding is isolated. Give them sensible values, as above, so an isolated arrow
does not snap to the origin. The consequence you actually wanted is that moving a box
afterwards moves the arrows with it, whether the move came from your agent or from
someone dragging it.

```ts
drawPlan(editor, {
  boxes: [
    { name: "ingest", label: "Ingest", x: 0, y: 0 },
    { name: "parse", label: "Parse", x: 320, y: 0 },
    { name: "store", label: "Store", x: 640, y: 0 },
  ],
  arrows: [{ from: "ingest", to: "parse" }, { from: "parse", to: "store", label: "validated" }],
})

editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1600, h: 1000 })
editor.zoomToFit()

editor.getCurrentPageBounds()                 // Box over the three shapes
editor.getShapeAtPoint({ x: 90, y: 45 })?.id  // shape:ingest
```

Undo takes the whole plan back in one step, because the whole plan was one `run` after
one mark. That is the property worth protecting as the agent grows: one gesture, one
mark, whatever the model decided to do inside it.

---

## Where to go next

- [CUSTOM_SHAPES.md](CUSTOM_SHAPES.md) — a shape of your own, and the `static props`
  map that validates it.
- [UI.md](UI.md) — the default interface, for the half a person drives.
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the store, the command stream and the engine
  fit together.
- [COMPAT.md](COMPAT.md) — what exists against the tldraw 5.4 API model, and what
  deliberately does not.
