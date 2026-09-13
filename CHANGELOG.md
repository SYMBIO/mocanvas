# Changelog

## 4.4.2

### A geo shape placed by a click was half the size it should be

`GeoTypeDefinition.defaultSize` — "the size a click (rather than a drag) places
this silhouette at" — was declared on the interface, documented, **populated by
nothing and read by nothing**. So `GeoTool` handed back a hard-coded 100×100
whatever the definition said, and a rectangle created by clicking came out at
half the reference's 200×200. A drag was never affected: it resizes the shape
from the pointer immediately.

Both halves are fixed: the built-ins declare a click size, and the tool asks for
it. A definition that omits one still falls back, so a custom geo type is not
required to have an opinion.

**One box for every silhouette, deliberately.** The reference gives some kinds
proportions of their own — a star nearer 200×190, a cloud nearer 300×180 — and
there is no measured table here for all twenty. One honest box beats eighteen
guesses arranged around three known numbers; an app that wants per-kind sizes
sets them through `customGeoTypes`, which overrides the table entry for entry.

`FrameShapeUtil`'s 160×90 is **not** the same bug, in case the two look
related: a frame is its own util with its own `getDefaultProps`, and it never
consulted this table. It stays as it is and stays documented in `MIGRATION.md`
§10.

## 4.4.1

### `rotateShapesBy` wraps the angle it stores

It added the delta and stored whatever came out, so rotating a shape −45° left
`-0.785…` where the wrapped angle is `5.497…`:

```
                after -45°     after a further +360°
was             -0.785398…     5.497787…
now              5.497787…     5.497787…
```

The same picture, a different number — and `rotation` is persisted and sent over
the wire, so a diff, a parity check and a sync merge all see a difference that
is not on screen. `canonicalizeRotation` was exported from this package the
whole time; `rotateShapesBy` just never called it. The interactive rotate
session had the same gap and is fixed with it, which also stops the angle
growing without bound as a shape is turned round and round.

`updateShapes` is deliberately **not** canonicalized: a caller passing an
explicit `rotation` is stating a value rather than accumulating one, and
rewriting it would silently change an angle an app chose on purpose.

## 4.4.0

Four findings from a consumer's migration. The first one is the reason to
upgrade.

### A filled shape could not be clicked in the middle

`Geometry2d.hitTestPoint` asked only whether the *caller* wanted the interior,
never whether the shape was **filled**. So a solid rectangle answered on its
outline and nowhere else:

```
geometry.isFilled                        true
geometry.hitTestPoint(centre, 0, false)  false   ← should be true
editor.getShapeAtPoint(centre)           null
```

The interior now counts when the shape is filled **or** the caller passes
`hitInside` — those are alternatives, not a requirement and a refinement.
`hitInside` means "count the interior of a HOLLOW shape as well", which is what
a marquee or a drop target wants; it was never the only way an interior should
be reachable. An unfilled shape still misses in the middle, deliberately: a
hollow rectangle is a frame around empty space, and clicking that space should
reach whatever is behind it.

The wasm engine knew about fill the whole time — `hit_test` has computed
`filled = !hollow_only && … && style.has_fill()` since it was written. The
editor was setting `hollow_only` whenever the caller had not asked for
`hitInside`, which forced outline-only on everything. That is fixed too, so both
the engine path (`getShapeAtPoint` with no filter) and the geometry path agree.

Nothing failed and nothing warned while this was wrong. Every feature built on
hit testing simply returned nothing, which reads as several unrelated bugs — the
consumer who found it had selection, comment anchoring and a comment tool all
apparently broken in different ways.

**Also fixed while testing it:** `hitInside` never worked at the editor level for
a point in the middle of a large hollow shape. The candidate set came from the
engine's box query, which finds shapes whose *outline* meets the point, and a
centre point is nowhere near one. That case now scans the page's shapes by
bounds instead. It is not the default because it is a scan rather than a tree
query, and `hitInside` is the deliberate, rare path.

### Jitter can be turned off, so generated indices can be compared

4.2.0 made every generated index key unpredictable, which is what makes
concurrent insertion safe — and defeats any test that replays one operation
through two implementations and asserts they agree. A consumer with a headless
fold and a parity suite had to choose between the fix and their tests.

Jitter is now **off under a test runner** (`NODE_ENV === "test"`), with no
configuration:

```ts
getIndexAbove("a0")  // "a1", every time, in your test suite
```

Forceable either way for the cases that need it — `MOCANVAS_INDEX_JITTER=1|0`
for a runner that sets no `NODE_ENV`, and `setIndexJitterEnabled(true | false |
null)` in code. `isIndexJitterEnabled()` reports what is in effect. A test of
the jitter itself forces it on; ours do.

Unchanged on purpose: `getIndices` echoes its `start` verbatim, jitter or not.
It is an input, not something generated, so two replicas moving into the same
empty parent do get the same first key — faithful to the reference rather than a
gap in the jitter.

### Built-in shape defaults

Measured against a consumer's table and corrected where ours was wrong:

- **`text` is no longer written into new shapes.** It is the derived flattened
  label — optional on the record, and a v5 writer stores only `richText`, as
  this package's own props map already said. Writing it into every new note,
  geo, text and arrow put a field into documents that nothing downstream reads.
  It is still accepted and read on input, so old `.tldr` files are unaffected.
- **`text.w` is 8, not 100.** Under `autoSize` that value is a *minimum* width,
  not a starting one, so a new text shape was a hundred pixels wide before a
  character was typed — the opposite of auto-sizing.

Deliberate and unchanged, for the record: `note.fontSizeAdjustment` defaults to
`0` meaning "unset", and the reader treats any value too small to be a font size
as unset too, so a file written with `1` renders identically rather than at one
pixel. `frame` stays 160×90 (documented in `MIGRATION.md` §10), and
`DEFAULT_EMBED_DEFINITIONS` stays at six services — it is a permit list, nothing
outside it is ever put in an iframe, and each entry carries hand-written URL
rewriting that should not be guessed at.

### A clearer error when a util map goes missing

`editor.getBindingUtil` / `getShapeUtil` used to fail with `TypeError: Cannot
read properties of undefined (reading '<your type>')`, which reads like an
unregistered util and is not — it means `shapeUtils` or `bindingUtils` itself
was gone. The constructor never leaves them that way; what does is a subclass
redeclaring the field:

```ts
class MyEditor extends Editor {
  readonly bindingUtils!: Record<string, BindingUtil>  // ← wipes the base's
}
```

At ES2022 a field declaration with no initializer is not a type annotation — it
defines the property as `undefined` after the base constructor has run. Use
`declare readonly bindingUtils: …` instead. The error now says so.

## 4.3.0

One fix, and it is a breaking one in a minor — the same judgement 4.1.0 made,
for the same reason. See below if you call `getIndices`.

### Breaking: `getIndices(n)` returns `n + 1` keys, starting at `a1`

```ts
getIndices(3)        // was ["a0", …2 more]   now ["a1", …3 more]
getIndices(3, "a1")  // was ["a1", …2 more]   now ["a1", "a2…", "a3…", "a4…"]
getIndices(1)        // was ["a0"] — generated nothing at all
```

`n` now counts the keys generated **above** `start`, so the array is one longer.
`start` is an index you already hold; it is echoed back verbatim, unjittered,
because it is an input rather than something this generated. The default start
moved from `a0` to `a1`.

**This change is silent.** The return type is unchanged and nothing in your
build will complain — a caller that iterates the result and creates one item per
key now creates one extra. A caller that destructures a fixed number, or indexes
by its own item count, is unaffected. Grep for `getIndices(` before upgrading;
`getIndicesAbove`, `getIndicesBelow` and `getIndicesBetween` are untouched and
still return exactly `n`.

Why this is a fix rather than a preference. The old contract was invented here:
same name as the helper migrating code is written against, same argument shape,
an answer one element short and one bucket low. That is the failure COMPAT.md
already names as the one to avoid — *"an undocumented helper that behaves
almost-right is worse than one that is absent and reported by the compiler."*
A consumer's headless fold called it in its reparent path and landed a step
below the editor on every move, while every other index path in this workspace
had already settled on the `a1` bucket in 4.2.0. It was the last holdout, and
`a0` is the bottom of the key space — handing it out as a real index leaves
nothing underneath to insert before.

`START_INDEX_KEY` (`"a1"`) is exported alongside `ZERO_INDEX_KEY` (`"a0"`) so
the distinction has a name rather than being two literals that look alike.

### Also

The post-publish registry check no longer fails a good release. It timed out on
4.2.0 while every gate had passed and every package had published correctly —
six were serving inside eighty seconds and `@mocanvas/store` took longer than
the five minutes allowed. Its budget is now fifteen minutes, and its error says
what the red means: the packages are already public by the time it runs.

### Not changed

A consumer withdrew an earlier report of five missing CSS tokens after checking
it against real usage — two have CSS fallbacks, one they define themselves, one
was in a comment, one in a test fixture. Nothing was missing. The `tsc` memory
report was likewise withdrawn: the original figures compared two checkouts on
different branches, and a clean measurement puts tldraw at 1.307 GB and mocanvas
at 1.302 GB.

## 4.2.0

A consumer re-measured 4.1.1 against their migration and confirmed the asset and
overlay fixes. Of what remained, one report was right where I had argued back
and got it wrong, one found a defect worse than the thing being discussed, one
was an unshipped half of the compat layer, and one they withdrew.

### Index keys are jittered, so two clients can insert in the same place

Plain fractional indexing is a pure function of its two neighbours, so two
clients inserting into the same gap generated the **same key** — not
occasionally, every time:

```
getIndexBetween("a0", "a2")   // "a1" on every client, always
```

A record's `index` is a single register to a last-writer-wins merge, so the two
shapes claimed one position and the merge kept one of them. This is the failure
4.1.1's own notes described for the double-seeded page — "equal index keys have
no defined order" — sitting in the multiplayer path, where it fires whenever two
people add a shape at once.

Every generated key now carries six random digits. The jitter is bounded when
the plain key is a prefix of the upper neighbour, which is the case where an
appended suffix would otherwise sort straight past it. Existing documents are
untouched: an index already written is data, ordering is relative, and the key
format is unchanged — `a1PzzxyO` was always valid.

### The first child of an empty parent moved up one step

`editor.getHighestIndexForParent()` answered `ZERO_INDEX_KEY` for an empty
parent, while `getIndexAbove(ZERO_INDEX_KEY)` from `@mocanvas/store` answers one
step above it. One package, one question, two answers — and a consumer whose
headless fold mirrors the store helper had matched a live tldraw editor on this
for months before ours stopped agreeing.

I argued the other way in 4.1.1 from a `.tldr` fixture holding shapes at `a0`,
and that argument was wrong: a shape sitting at `a0` in a saved file says
nothing about what assigned it, because it may have been reordered after it was
created. Only newly created shapes move.

### `@mocanvas/compat` now ships a stylesheet

```ts
import "@mocanvas/compat/compat.css"
```

The compat layer aliased the symbols an app imports and nothing else. The
`--tl-*` custom properties a migrated stylesheet reads had no counterpart —
there was not one `--tl-` string in the entire published build — and that gap
is invisible to every check a migration runs: TypeScript sees no CSS, the build
succeeds, the tests pass. What a consumer eventually saw was a cursor whose
white outline had quietly stopped being drawn, because
`--tl-color-selected-contrast` resolved to nothing.

Silently is the operative word. A `var()` that resolves to nothing does not
fail — it invalidates the declaration it sits in, and inside `calc()` it takes
the whole property. `compat.css` therefore gives **every** token a literal
fallback, so a token with no counterpart cannot delete the rule around it.

Two supporting changes made the mapping possible:

- **`--mocanvas-zoom` and `--mocanvas-scale`** are now stamped on the canvas
  container and restamped on zoom, so `--tl-zoom` and `--tl-scale` — 56 uses in
  one consumer's stylesheets, and previously mapped to nothing at all — carry
  real values. `getCameraCssVars` and `useCameraCssVars` are exported for an app
  that wants them directly.
- **`--mocanvas-brush-stroke`** was added to the themed set.

`MIGRATION.md` §1b now names the import and lists the tokens that resolve to a
static fallback rather than following your theme. It also carries a Next.js
note: an app coming from tldraw almost certainly lists it in
`serverExternalPackages`, and leaving mocanvas in that list turns
`…/mocanvas.css` into a request Node cannot resolve.

While writing the mapping, two of the new theme variables turned out to name
colour roles the default ramp does not carry — `TLThemeColors` has an index
signature for an app's own palette, so the typo type-checks and then emits
nothing. They were removed and a test now refuses a mapping onto a variable the
ramp never publishes.

### Withdrawn

The `tsc` memory report is withdrawn by the reporter: the original figures
compared two checkouts on different branches. A clean measurement on the same
package puts tldraw at 1.307 GB / 8.75 s and mocanvas at 1.302 GB / 7.88 s.

## 4.1.1

Follow-up to a consumer's re-measurement of 4.1.0 against a real migration
(220 files, 24 custom shape types). Two fixes, one new extension point, and two
measurements that did not confirm what was suspected.

### Assets were the one record kind nothing validated

Shapes and bindings validated correctly after 4.1.0; `asset` records did not, so
this was accepted:

```ts
store.put([{ id: "asset:bad", typeName: "asset", type: "image", props: {}, meta: {} }])
```

The per-type validators existed (`imageAssetValidator` and friends) and were
deliberately not attached, with the reason written down: turning them on would
start rejecting assets inside `parseTldrFile` written by older editors. That is
an argument for the `"keep"` policy, not for checking nothing — and it is the
same argument that was wrong for shapes. Assets now follow exactly the shape
rule: declared props are checked, props this build has never heard of are kept
so a round trip does not lose them, and an asset type nothing declares passes
through.

The three built-in asset types live in `@mocanvas/editor` rather than the
flagship, so that package registers them itself. This matters: a store built
with **no utils at all** — a sync backend, a headless pipeline — is exactly
where rows are least trustworthy, and it now refuses a corrupt asset instead of
mounting and rendering it.

### Breaking-ish: `createStore()` seeding can be turned off

4.1.0 started seeding a document and a first page, which was asked for. It
seeded *unconditionally*, so a caller that builds its own document by putting
records in afterwards ended up with **two pages at the same index** — and equal
index keys have no defined order. That cost one consumer eleven parity tests.

```ts
createStore({ seed: false })   // I own the document structure
```

Already off, without asking, when `initialData` or a `snapshot` is supplied.

### Collaborator overlays can be extended without lying to the rest of the editor

Two things made "paint some of these myself, let the inherited painter do the
rest" inexpressible:

- `render(ctx)` did not receive the overlays, so narrowing what got painted
  meant overriding `getOverlays()` — which also narrows what hit-testing, the
  cursor lookup and `onPointerDown` see. `render(ctx, overlays)` now receives
  what the manager already resolved. A util that ignores the parameter is
  unaffected.
- `CollaboratorOverlayUtilOptions` carried only `idleOpacity`, so a subclass
  redrawing a cursor had to hard-code the label's measurements. It now carries
  `fontSize`, `nameMaxWidth` and `chatMaxWidth`. (`zIndex` stays a static on the
  util — `static override zIndex = 1100` — which is how every overlay sets it.)

Capping the label width fixed a defect of its own: nothing truncated, so one
long collaborator name drew a chip across the drawing it was labelling. Text
that does not fit is now cut with an ellipsis.

### Two reports that measurement did not confirm

**The index convention is not inconsistent.** The report read
`editor.createShape` giving `a0` while the seeded page gets `a1` as two
conventions fighting. They are two conventions, and they are tldraw's:
`sample.tldr` — written by tldraw — holds its page at `a1` and its shapes at
`a0`, in one file. `getIndexAbove()` returns `a0`, the same as `createShape`,
so the helpers and the editor agree. Nothing changed here except a test that
now pins it.

**`tsc` memory does not scale with registered shape types.** The suggested
experiment, run: registering 5, 25 and 50 shape types moves instantiations by
1.6% and peak RSS not at all (~160 MB). Holding shapes at 24 and scaling files
to 220 reaches 205 MB. Neither axis reproduces a figure twenty times larger, so
`TLGlobalShapePropsMap` is not the cause and there is nothing to fix here from
this side. To find the real one, run `tsc --generateTrace trace/` in the
consumer's own tree and open the result with `@typescript/analyze-trace`; it
names the hot types directly. Send the trace and it can be read from here.

### Documented rather than changed

- **`FrameShapeUtil` creates a frame at 160×90**, where tldraw creates one at
  320×180 — same aspect, half the size. It only affects a frame created
  programmatically with no `w`/`h`; drawing one with the tool sizes it from the
  drag. Now a row in `MIGRATION.md` §10. Aligning the default is a behaviour
  change and does not belong in a patch.
- **`store.put()` accepting an unregistered shape type is deliberate** and is
  now stated in `MIGRATION.md` rather than only in `COMPAT.md`. Its other
  fields are still validated: `x` must be a number whatever the type is.

## 4.1.0

> **This minor release contains breaking changes.** They are marked below, and
> the two that will reach you without warning are these:
>
> 1. **Add `import "@mocanvas/mocanvas/mocanvas.css"` to your app.** Without it
>    the chrome renders unstyled. Until 4.0.2 your bundler picked the
>    stylesheet up on its own.
> 2. **`createStore()` now validates records and seeds a document and a page.**
>    A store built with no shape utils will no longer load a document whose geo
>    shapes predate the flip migration, and a brand new store is no longer
>    empty.
>
> A `^4.0.0` range will pull this in on its own, so read the two items above
> before upgrading rather than after.

Four things in this release were controls that existed and did nothing. They are
grouped that way below rather than by package, because that is what they have in
common and it is worth seeing at once.

### Breaking: record validation actually runs

`StoreSchema.validateRecord` returned every record untouched. Three independent
causes, each of which alone was enough:

- A record whose type was not found was returned as-is. A record carrying **no**
  `typeName` looked up as `undefined`, missed, and took the same path as foreign
  data that is deliberately allowed through.
- **No editor record type ever carried a validator.** `ShapeRecordType` and the
  rest were constructed without a `validator` key, and `RecordType.validate`
  opens with `if (!this.validator) return record`.
- `createSchema()` read `static migrations` off the utils but never `static
  props`, and `registerDefaultShapeSchema` — documented as the seam a package
  registers itself through on import — was exported and never called, so
  `defaultShapeSchemas` was permanently empty.

So the `static props` that were a breaking change in 2.0.0 were documentation.
They did nothing.

Turning validation on found a real defect in our own code:
`external/excalidraw.ts` spread `{color, dash, size}` into every converted shape
including `text`, and `textShapeProps` has no `dash`. **Every label imported from
Excalidraw carried a prop its own type rejects.**

Declared props are validated; props no util declares still pass through, so a
round trip preserves them (`binding:arrow.props.snap` in our own reference
`.tldr` depends on this). Strict rejection stays available to direct callers.

**What changes for you:** `createStore()` with no shape utils passed will no
longer load a document whose geo shapes predate the flip migration — without the
utils the migration cannot run and `flipX`/`flipY` are absent. This is
fail-closed and matches what `createSchema` documents ("pass the same lists you
pass the editor"), but it is visible.

### Breaking: the stylesheet is now imported by your app

Add one line, once, anywhere in your app:

```ts
import "@mocanvas/mocanvas/mocanvas.css"
```

Without it `<Mocanvas />` renders the canvas but the toolbar, panels, menus and
dialogs come up unstyled. This is the same arrangement as `tldraw/tldraw.css`,
and `@mocanvas/compat` users need the same line (the stylesheet lives in
`@mocanvas/mocanvas`; a package can only export files it contains).

It is listed as breaking because it changes required consumer setup: until
4.0.2 a bundler picked the stylesheet up on its own, and now it does not. It is
also a bug fix, and the bug was worse than the fix:

- **`@mocanvas/mocanvas` could not be imported outside a bundler.**
  `dist/index.js` carried `import "./ui-4C5V5GYT.css"`, which Node has no
  loader for, so vitest, SSR, and any plain `node` import threw
  `ERR_UNKNOWN_FILE_EXTENSION: Unknown file extension ".css"`. Consumers were
  working around it in their bundler config.
- **The stylesheet's name was content-hashed**, and `exports` did not list it
  at all, so there was no stable path to import instead — any import written
  against `ui-4C5V5GYT.css` would have broken at the next release.

The JavaScript entry no longer imports CSS. The stylesheet is emitted as
`dist/mocanvas.css` under a fixed name and exported as the subpath
`@mocanvas/mocanvas/mocanvas.css`, which resolves under Node, under every
bundler, and under TypeScript's `moduleResolution: "node16"` and `"bundler"`.

`@mocanvas/wasm` had the same shape of problem with a different asset: it
shipped `pkg/` with no `exports` subpath, so `import wasmUrl from
"@mocanvas/wasm/pkg/mocanvas_bg.wasm?url"` was blocked. Now exported.

### The frame loop never ticked

`Editor` wired `on("tick", …)` correctly and nothing ever emitted it. `draw` now
takes rAF's timestamp and emits the real elapsed milliseconds, clamped to 64ms
so a tab returning from hidden — where rAF does not fire at all — does not
arrive with seconds on the clock and fling the camera.

- **Laser and highlighter trails never advanced.** A separate defect in
  `ScribbleManager.tick()` compared only `points.length` and `state`, so once a
  trail reached equilibrium (one point added and one shed per frame) the record
  stopped updating and the trail froze behind a still-moving pointer.
- **Edge scrolling was dead twice over.** Beyond the missing tick,
  `edgeScrollManager.start()` was never called anywhere in the repository, so
  the tick alone would have fixed nothing. It is now started and stopped by
  `SelectTool`'s `Brushing` and `Translating`, and `EdgeScrollManager` refreshes
  `inputs.currentPagePoint` after panning so a dragged shape tracks the camera
  instead of being left behind.

The loop parks when there is no work: measured at 0 editor ticks against 122
available browser frames on an idle board.

### Menus and controls that did nothing

- **No submenu in the chrome was clickable.** Submenus are portalled as
  siblings of the menu that opened them, so each parent layer's "did this press
  land inside me?" check answered no for its own submenu's rows and closed
  everything on `pointerdown`, swallowing the click. Layers now know their
  nesting; Escape backs out of the innermost only.
- **Print printed the host web page.** It called
  `editor.getContainerWindow().print()`. It now renders the selection (or the
  page) through the SVG exporter into a hidden same-origin iframe and prints
  that. The row disables itself on an empty page.
- **`v`, `r`, `n` and the other tool keys did nothing.** `TldrawUi` never
  mounted `<ToolShortcuts/>` while `Mocanvas` had already switched off the
  hard-coded tool keys — and the shortcuts dialog advertised them anyway. The
  dialog is now generated from the same tables that install the bindings.
- **Theme moved a tick and changed no pixel.** It wrote only to user
  preferences, which `ThemeManager` — what the canvas paints from — never reads.
- **Reduce motion could not be switched off** on a machine that asks the OS for
  reduced motion, because the tick combined the two; and nothing consumed
  `animationSpeed` at all. `setCamera` now scales animation duration by it.
- **The selection was never announced to a screen reader.**
  `useSelectedShapesAnnouncer` existed, was exported, and was mounted nowhere —
  the live regions rendered and nothing ever announced into them.
- **Page rename closed the menu it needed to stay in.** The page list is also
  restructured: one actions trigger per page rather than three action rows
  printed beside every page, which made a five-page document a twenty-row menu
  with no indication which "Delete" belonged to which page.

### Twelve keyboard shortcuts the menus advertised and nothing bound

`⇧L` on Toggle lock, `⌥A/H/D/W/V/S` on the align items, `⌥⇧H/V` on distribute,
`⇧H/V` on flip, and bare `]` and `[` on bring-to-front and send-to-back all
printed in the Arrange and Actions menus and did nothing.

They are bound now, by binding the action list itself — the same way the tool
list's shortcuts are bound — so `TLUiOverrides.actions` carries its bindings
with it and the two cannot drift apart again. The shortcuts dialog has an
Actions section generated from the same map.

Two related defects went with it:

- **`⇧H` and `⇧L` selected the hand and line tools.** The tool-key handler
  lowercased the key without checking Shift, so a shifted press fell through to
  the plain tool binding underneath.
- **`⌥D` printed "Align right" in the menu and opened the frame-statistics
  overlay.** Align right keeps `⌥D` — it is one of a coherent `⌥A/H/D/W/V/S`
  set — and frame statistics moves to `⌘⌥D`.

### Gaps found by a consumer integration (MOL-2410)

Measured against a real app rather than read off the documentation.

- **`store.put()` validated nothing.** Covered above; the remaining half is
  fixed here. A store built with **no shape utils** — what a sync backend, a
  headless export or a test gets — still passed every shape straight through,
  so `x: "NOT A NUMBER"` landed in the document. Forward compatibility is about
  `props` and only `props`: a `.tldr` from a newer build may carry props this
  one cannot describe, and those are still kept verbatim, but `x`, `y`,
  `rotation`, `index`, `parentId`, `isLocked` and `opacity` are the same on
  every shape record there has ever been and are now checked whatever utils
  were passed.

- **A new store held nothing at all.** `createStore()` now seeds the document
  and its first page, so anything reading a document without mounting an editor
  sees one. Only those two: camera, instance and page-state are session records
  and belong to an editor, not to a document. Skipped when `initialData` or a
  `snapshot` is supplied.

- **The seeded page was indexed `a0`.** Every `.tldr` tldraw writes — including
  the reference fixture this project compares against — puts its first page at
  `a1`, so a mocanvas-seeded page sorted before all of them. Invisible with one
  page; it shows the moment two documents are merged. The index *helpers* still
  start at `ZERO_INDEX_KEY` and remain consistent with each other; reconciling
  the generator itself with tldraw's first key changes how every index is
  allocated and is not in this release.

- **`deleted-shapes` did not exist.** Added, carrying every id removed,
  descendants included — deleting a frame takes its children with it and a
  listener cleaning up per-shape state needs all of them. Fires after the
  removal and only when something was actually removed.

- **`renderingOnly` was declared and read by nothing.** The hit-test option now
  skips shapes the viewport has culled. Off by default: a programmatic query is
  asked about the document, and an answer that changed with the scroll position
  would be surprising. The culled set is read once per query, not per shape.

- **`TLEditorComponents.CollaboratorCursor` was declared on two component maps
  and rendered by nothing**, so an app that supplied its own cursor silently
  kept seeing ours. `CollaboratorCursors` now renders the slot when one is
  supplied — in its own HTML layer, since the default is a `div` and would not
  render inside the SVG layer — and draws nothing of its own in that case.

- **The published declarations failed a consumer's typecheck.**
  `@mocanvas/wasm`'s `pkg/mocanvas.d.ts` carries `[Symbol.dispose](): void`
  from wasm-pack, which needs TypeScript's `esnext.disposable`. A consumer on
  any ordinary target got `TS2550` pointing into *our* file, with no fix
  available but widening their own `lib` to satisfy a dependency. The file now
  carries its own `/// <reference lib="esnext.disposable" />`.

  On the reported type-check memory: not reproduced here. A consumer importing
  `@mocanvas/mocanvas` and `@mocanvas/editor` from the tarballs, with
  `skipLibCheck: false`, typechecks in **124 MB and 0.18s** (65k types, 120k
  instantiations); `tsc -b` across this repository peaks at **890 MB**. If a
  4.97 GB figure persists after the `TS2550` fix above, it needs measuring in
  the consumer's own tree.

### Documentation

`MIGRATION.md` §7 and §10 described a 3.x-era editor. §7 said slot
compatibility did not exist and was a v1 non-goal; both stopped being true
before 4.0. §10 listed `editor.resizeShape` / `stretchShapes`,
`editor.getSvgString` / `toImage`, `editor.textMeasure` / `user` / `menus`,
presence records and slot-compatible UI as missing — every one of them is
present, checked against the built package rather than the roadmap.
`ARCHITECTURE.md`'s non-goals list carried the same stale entry.

### Breaking: two menu items removed

- **Language.** mocanvas ships no message catalogues, so the default mount
  offered twenty-five languages that all rendered the same English. The menu now
  lists only locales the host supplied non-empty dictionaries for, and renders
  nothing below two. An app that ships dictionaries is unaffected and now sees
  exactly its own languages.
- **`useEnhancedA11yMode`.** The hook was backed by a module-level boolean, so
  every caller got its own copy of state and nothing read any of them. The
  preference is now the single source of truth
  (`editor.user.getIsEnhancedA11yMode()`), and `ToggleEnhancedA11yModeItem` —
  which tldraw's reference documents and which is unchanged — writes it. Turning
  it on makes the selection announcer read back position and size as well as
  what is selected.

## 4.0.2

Corrects the benchmark. No code change.

The published figures were measured under software rasterisation — the harness
assumed headless Chromium on macOS always falls back to SwiftShader, which is
wrong. On a real GPU the numbers move in both directions: creating shapes is
about 2.6× rather than the ~3× claimed, and dragging a thousand shapes is 1.8×
faster rather than the loss that was reported. "tldraw is ahead on small scenes"
was an artefact of the CPU rasteriser and is gone.

Pan and zoom is no longer quoted at all: mocanvas sits at the harness's own frame
floor in every case, so it cannot be measured and is not claimed.

## 4.0.1

Wording only. The licence sections no longer close by noting that versions
released under MIT stay available under MIT. It remains true, and `LICENSE`
section 9 still says so — a licence that quietly dropped it would read as if old
grants were being withdrawn, which is not something this or any licence can do.
It simply does not belong in the pitch.

## 4.0.0

**The licence has changed. mocanvas is no longer MIT.**

### Breaking: licence

mocanvas is now source-available. It stays free for personal and non-commercial
projects, for non-profit organisations, for development, evaluation, testing and
staging — including inside a for-profit company, so you can try it and build
against it — and for teaching and research.

Shipping it in a commercial product, service or website now requires a written
agreement: **mocanvas@symbio.agency**.

Versions released under MIT remain available under MIT, on the terms they were
released with. This applies to 4.0.0 and later. The full text is in `LICENSE`,
which every package ships.

### Added

- The README now leads with what the library is, why it exists — we built on
  tldraw, ran out of headroom, and wanted a migration rather than a rewrite —
  what the performance actually measures, and what of tldraw is supported. Each
  of those was previously somewhere further down or in a linked file.
- Measured performance tables against tldraw 5.4, with the caveat they need:
  the run had no hardware GPU, so the interaction figures are close to a worst
  case for mocanvas.

## 3.1.1

Packaging only; no code change.

The repository is private, so the links every published README carried into it
were 404s for whoever read them on npm — and with no website yet, there was
nowhere else to point. The `repository`, `homepage` and `bugs` fields are gone
from all seven manifests, the fourteen links are replaced by what they pointed
at, and each package now ships the whole `docs/` set in its tarball, copied at
`prepack`. The flagship README carries the compatibility figures and the
clean-room statement outright rather than by reference.

## 3.1.0

Every symbol the tldraw 5.4 reference documents now exists under the same name:
1,420 of 1,420, across the seven packages this project maps.

### Added

- The 51 `TL*` spellings that were still missing, all in `@mocanvas/compat`.
  Each is an alias of a type mocanvas already exported unprefixed —
  `TLGeoShapeProps` for `GeoShapeProps`, `TLImageShape` for `ImageShape` — so
  nothing was missing but the name a migrating codebase imports it by. The two
  that are concrete in tldraw rather than generic are written out as such:
  `TLSerializedStore` is `SerializedStore<EditorRecord>`, `TLStoreSchema` is
  `TLSchema`.
- `apps/bench/fixtures/tldraw-reference.txt`, the 1,491 `package/Symbol` names
  the reference documents, and `api-coverage --reference` to measure against it.
  It exits non-zero on a regression, so it can hold the line in CI instead of
  being re-derived by hand.

### Documentation

- The README now carries the clean-room statement outright: mocanvas has never
  been built by reading tldraw's source, the compatibility is built against the
  public reference, and it is measured against that same reference.
- What is *not* covered is stated in the README rather than only in COMPAT.md,
  split by reason rather than lumped together.
- COMPAT.md's rationale for the four unimplemented packages was wrong and is
  corrected. It filed `@tldraw/sync-core` under "client halves of services
  tldraw operates"; `TLSocketRoom` is in fact self-hosted — Node, Cloudflare
  Durable Objects, Bun, any WebSocket server — and only `useSyncDemo` points at
  a host tldraw runs. Not implementing tldraw's sync stack is an architecture
  choice against `@mocanvas/sync`'s own transport and field-level CRDT, not a
  service dependency. `@tldraw/mermaid` and `@tldraw/driver` are recorded as
  wanted and unbuilt, with what each would be.

### Still not covered, and said plainly

- Four documented packages are excluded on purpose: `@tldraw/sync-core` (42
  symbols), `@tldraw/mermaid` (17), `@tldraw/sync` (9) and `@tldraw/driver` (3).
- 45 exported-but-undocumented symbols, almost all `@tldraw/utils` helpers the
  umbrella re-exports (`debounce`, `modulate`, `Result`, `FileHelpers`,
  `LruCache`). `import { debounce } from "tldraw"` still fails. They are not
  written from guessed semantics: a helper that behaves almost-right is worse
  than one the compiler reports as absent.
- Names are not behaviour. Across shared symbols `@tldraw/editor` is at 86.4% of
  members, `ShapeUtil` has 52 of 77 and `Editor` 304 of 313.
  [docs/COMPAT.md](docs/COMPAT.md) has the breakdown.

## 3.0.0

A rendering release. Three things were visibly wrong on the canvas — each one
found by putting mocanvas and tldraw side by side in `apps/bench` — and fixing
the third needed a change to how the engine composites a translucent shape. The
breaking surface is small and confined to the highlighter's configuration and to
one internal buffer that `@mocanvas/wasm` describes.

### Breaking

- **`HIGHLIGHT_STROKE_SCALE` is gone**, replaced by `HIGHLIGHT_STROKE_SIZES`: a
  width per `size` rather than one multiple of `STROKE_SIZES`. No single
  multiplier can reproduce the widths tldraw draws — the ratio to a pen of the
  same size falls from about 10x at `s` to 4.9x at `xl` — so the model had to
  become a table. `HighlightShapeUtil`'s `strokeScale` option now multiplies that
  table and defaults to `1`, where it used to default to `3.2` and multiply
  `STROKE_SIZES`.
- **`Batch` carries an `isolate` field and `BATCH_WORDS` is 8**, not 7. Code that
  reads batches through `readBatch`, `readBatches` or `forEachDrawBatch` is
  unaffected; code that builds a `Batch` literal has one more field to supply.

### Fixed

- **The highlighter was far too narrow and washed out.** It drew at 3.2x the pen
  of the same size where it should draw at roughly 7.7x, and at 32% opacity where
  it should be 82%, which turned a saturated `#fddd00` into pale cream over white
  paper. Both numbers were guesses — the source said so — and both are now
  measured off the rendered result.
- **An x-box's diagonals spiked through its own outline.** The host has always
  pulled the X's ends back by half a stroke so the round cap lands on the corner,
  but only in the geometry it keeps for hit testing: a built-in geo is *drawn*
  from a path the engine generates, and that copy ran corner to corner. The
  engine is now told the stroke width, and the parity fixture captures geo paths
  at three widths instead of only at zero, which is the check that would have
  caught it.
- **A translucent stroke darkened wherever it crossed itself.** Shape opacity is
  baked into vertex alpha, so an overlapping ribbon blended twice; every other
  renderer treats it as a group — rasterize the mark, then make it see-through.
  A single-colour translucent shape now gets an isolation group and the WebGL2
  backend covers each of its pixels once, via the stencil buffer. A shape with a
  fill under its stroke is a group of two and keeps the per-triangle blend.

### Changed

- `Editor.updateViewportScreenBounds` accepts an `HTMLElement` as well as a box,
  which is both what a host has to hand and what tldraw accepts.
- `SET_GEO` carries a stroke width (7 words, was 6) and the frame's batch records
  carry an isolation group (8 words, was 7). Both are documented in
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Also in this release

Work from earlier sessions that had not been released yet: the hand-drawn outline
generator reworked around anchors and a wobble field, tessellation tolerance made
zoom-aware (a fixed *screen*-pixel error at every magnification, with a separate
coarser tolerance for sketched outlines), fills restricted to a path's closed
subpaths, selection indicators that follow the sketched outline rather than the
true one, arrow indicator and selection-frame fixes, rich-text label editing on a
TipTap surface behind a replaceable seam, and a gallery page in `apps/bench` that
renders every element through both libraries for comparison.

## 2.0.0

The API model moved from tldraw 3.x to **tldraw 5.4**. That is a different
architecture in several places, not a set of renames, so this is a major version.
[docs/MIGRATION.md](docs/MIGRATION.md) §0 walks through it; the short version is
below.

About 88% of the documented tldraw 5.4 API surface now exists, measured against an
enumeration of the public reference documentation.
[docs/COMPAT.md](docs/COMPAT.md) says what is present, what is missing, and what is
excluded on purpose.

### Breaking

- **Indicators are canvas paths.** `getIndicatorPath(shape): Path2D | TLIndicatorPath | undefined`
  replaces `indicator(shape): ReactNode`. The old hook still works and is
  deprecated; a util that implements only it is routed to the SVG layer.
  Returning `undefined` means *no outline*, not "use the default".
- **Custom shapes must register their props** through `TLGlobalShapePropsMap`
  module augmentation, or `shape.props` stays `object`. `Shape` with no type
  argument is now the union of *registered* types; use `UnknownShape` where the
  type is not known statically.
- **`static props` are validator maps**, not plain objects. `T` is exported for it.
- **`pageToScreen` changed meaning.** 1.x computed container-relative coordinates
  under that name. `pageToViewport` is now container-relative and `pageToScreen`
  is window-relative. An overlay positioned inside the canvas container wants
  `pageToViewport`; the old call was silently correct only while the container
  sat at the window origin.
- **Geometry follows the documented contract.** `Box.expandBy` and `Mat.invert`
  mutate and return `this` (`Box.ExpandBy` / `Mat.Inverse` are the pure forms);
  `Box.Expand(a, b)` is the union of two boxes, with the old scalar form kept as
  a deprecated overload; `Vec.Dot` is `Vec.Dpr` (alias kept) and `Vec.Cross`
  returns a `Vec`, with the old scalar as `Vec.Cpr`. `Vec` gained `z` for pen
  pressure, defaulting to `undefined` so `toJson()` is unchanged.
- **Double click is reported in phases** (`down`, `up`, `settle`). A handler that
  acts on every `double_click` now fires twice — filter on `info.phase`. Triple
  and quadruple click are gone; further presses inside the window stop counting
  rather than starting a second run.
- **`TLUserId` is branded.** Plain strings must go through `createUserId`.
- **Built-in shape migrations moved to `com.mocanvas.shape.*`.** Registering them
  under `com.tldraw.shape.*` claimed the reference implementation's migration
  line and made every real `.tldr` fail to load. Your own custom shape types keep
  the default prefix.
- **`ShapeUtil.getText` is a concrete method** returning `string | undefined`,
  not an optional one, so callers need no guard.
- **`Editor.getSelectionPageBounds()` returns `null`** rather than `undefined`
  when nothing is selected.
- **`EditorTextMeasure` gained `measureHtml` and `measureHtmlBatch`**, and
  `scrollWidth` on an HTML measurement is no longer optional.
- **Loading a `.tldr` keeps `props.richText`.** It used to be dropped and
  flattened into `props.text`, which lost every mark on the next save.
- **`<Mocanvas />` mounts the documented chrome** (`TldrawUi`). Its `components`
  prop now takes the UI panel map as well as the canvas slot map; the canvas-only
  map moved to `canvasComponents`.
- Selection-background and overlay React components are gone, per tldraw 5.0 —
  overlays are canvas-drawn. Node 22.12 or later.

### Added

- The **full `Editor` surface** — all 298 documented members — plus `ClickManager`,
  `ScribbleManager`, `TextManager`, `OverlayManager`, `EditorManager`, `Timers`,
  `FontManager` and `PerformanceManager`.
- The **complete geometry library**: `Vec` (107 members), `Box` (58), `Mat` (38),
  `Geometry2d` (37), `Arc2d`, `Point2d`, `Stadium2d`, `TransformedGeometry2d`,
  every documented intersection helper and arc function.
- **Every documented React UI component**, each replaceable through the
  components map, with roles, focus handling and keyboard navigation.
- **Canvas overlay painters**: brush, zoom brush, scribble, snap indicators,
  handles, selection foreground, arrow hints and the collaborator set.
- **Themes with display values**, `resolveThemes` and `registerColorsFromThemes`
  so an app can supply its own palette.
- **Rich text** on ProseMirror JSON. TipTap is an *optional* peer dependency:
  rich text renders, measures, exports and round-trips without it, and only
  WYSIWYG editing needs it.
- **Custom record types** through `createTLSchema({ records })`, alongside custom
  shapes and bindings.
- `AssetStore`, users and attribution, presence derivation, `tleditors`.
- The **highlight** shape and the **laser** tool.

### Performance

- **Built-in shapes describe their outline to the engine by parameters** instead
  of building a `Geometry2d` in JavaScript and uploading its vertices
  (`ShapeUtil.getEngineGeometry`). At 20,000 shapes that is 10–20× less
  host-side work and up to 4.6× fewer words copied. Custom shapes are unaffected
  — returning `undefined` keeps the old path.
- All 20 geo silhouettes, cubic splines and freehand smoothing now generate in
  Rust, byte-identical to the previous TypeScript, pinned by generated fixtures.

### Fixed

- `EnumStyleProp` shared its value array with the exported `DEFAULT_COLORS`
  tuple, so registering an app palette silently rewrote `DEFAULT_COLORS` for
  everyone importing it.
- `editor.click.cancelDoubleClick()` did nothing: double-click detection lived in
  the DOM event layer with its own timer, so there was no gesture to cancel.
- The mounted-editor registry only saw editors created by `<Mocanvas />`.
- Collaborator cursors and selection outlines were positioned in window space
  inside a container-space overlay.

### Known

Two performance defects, both found by measurement and both written up in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#known-performance-defects): the
spatial index degenerates when many shapes share a bounding box (20,000 at the
origin takes 1,660 ms instead of 25 ms), and snapping rebuilds geometry the
engine already holds (about 18.5 ms per drag frame at 20,000 shapes zoomed out).
Neither is fixed; both have a described fix.

## 1.0.0

First release. Rust/WebAssembly engine, WebGL2 and WebGPU backends, the document
model with `.tldr` IO, tools, bindings, styles, snapping, groups, history,
export, collaboration, and the default shapes, tools and UI.
