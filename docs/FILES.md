# Saving, loading and exporting

How a document gets out of the editor and back in again. By the end you will
know what a snapshot contains and how to restore one, how to read and write
`.tldr` files (including ones from the reference implementation), what runs when
an old file meets a new build, and how to produce a PNG or an SVG of a page or a
selection.

Everything here is public API from `@mocanvas/mocanvas`. Read
[ARCHITECTURE.md](ARCHITECTURE.md) for the layering and
[CUSTOM_SHAPES.md](CUSTOM_SHAPES.md) for writing a shape; this is the document
where your shapes have to survive being written to disk.

Contents:

1. [Snapshots](#1-snapshots)
2. [`.tldr` files](#2-tldr-files)
3. [Migrations](#3-migrations)
4. [Image export](#4-image-export)
5. [The clipboard and printing](#5-the-clipboard-and-printing)
6. [Assets](#6-assets)

---

## 1. Snapshots

A snapshot is the store's records as plain JSON, plus the schema version they
were written under:

```ts
interface StoreSnapshot<R> {
  store: Record<string, R> // records keyed by id
  schema: { schemaVersion: 2; sequences: { [sequenceId: string]: number } }
}
```

The schema half is not decoration: it says how far each migration sequence had
run when the records were saved, which is the only thing that lets a later build
know what to do with them (§3).

### Record scopes

Every record type declares a scope. A snapshot carries one of them, or all:

| Scope | Record types | What it is |
| --- | --- | --- |
| `document` | `document`, `page`, `shape`, `binding`, `asset`, plus any custom record types you registered (the comment types, opted into via `records:`, are document-scoped too) | The board. Shared by everybody; what a file holds. |
| `session` | `instance`, `camera`, `instance_page_state`, `pointer` | One person's viewpoint: current page, camera, selection. |
| `presence` | `instance_presence` | Other people's cursors. Never persisted. |

`editor.store.getStoreSnapshot()` defaults to `document`, which is almost always
what you want to save. Pass `"all"` for everything.

### Taking and restoring one

```ts
import type { Editor, TLEditorSnapshot } from "@mocanvas/mocanvas"

const snapshot: TLEditorSnapshot = editor.getSnapshot()
editor.loadSnapshot(snapshot)
```

`getSnapshot()` returns both halves — `{ document, session }` — because
restoring a document without a session drops the reader at the origin of page
one, and restoring a session against a different document points at shapes that
are not there. They travel together and load separately. `loadSnapshot` also
accepts a bare document snapshot (`EditorStoreSnapshot`).

Loading is **not undoable** — it replaces the document, so there is nothing
coherent to go back to — and the history is cleared rather than left holding
steps against records that no longer exist. The session half is applied
defensively: a page that is gone falls back to the first page, selected shapes
that are gone are dropped, and a session from a version this build does not know
(`CURRENT_SESSION_SCHEMA_VERSION`) is ignored entirely rather than half-applied.
Pass `{ forceOverwriteSessionState: true }` to land on the first page whatever
the session says. `getSessionStateSnapshot(editor)` gets that half on its own,
for an app that persists the document on a server and the viewpoint in
`localStorage`.

### Opening one in the component

`<Mocanvas />` takes a `store`, not a `snapshot`, so either build the store with
the document already in it or load it once the editor exists:

```tsx
import { Mocanvas, createStore, defaultShapeUtils, defaultBindingUtils } from "@mocanvas/mocanvas"

const store = createStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils, snapshot })

<Mocanvas store={store} />
<Mocanvas onMount={(editor) => editor.loadSnapshot(snapshot)} />
```

Build the store once (in a `useMemo` or outside the component) rather than on
every render. `createStore` turns its own page seeding off when `snapshot` or
`initialData` is supplied, so you do not get an empty default page beside the
loaded ones.

To draw a snapshot without mounting an editor — a thumbnail grid, a document
listing — use `<TldrawImage snapshot={…} />`. It builds a throwaway headless
editor, renders through the same SVG exporter as §4, and disposes of it, so a
thumbnail and a downloaded file agree.

---

## 2. `.tldr` files

A `.tldr` file is a snapshot in an envelope:

```json
{
  "tldrawFileFormatVersion": 1,
  "schema": { "schemaVersion": 2, "sequences": { "com.tldraw.shape.geo": 12 } },
  "records": [ { "id": "page:abc", "typeName": "page", "…": "…" } ]
}
```

The writer pretty-prints and sorts every object's keys recursively, so the same
document always produces byte-identical text — which is what makes a file
diffable and a content hash of it meaningful.

### Writing

```ts
import { serializeMocanvasFile, serializeTldrawJsonBlob, downloadBlob, TLDRAW_FILE_EXTENSION } from "@mocanvas/mocanvas"
import type { Editor } from "@mocanvas/mocanvas"

const text = serializeMocanvasFile(editor) // synchronous, returns JSON text

async function saveToDisk(editor: Editor, name: string) {
  const blob = await serializeTldrawJsonBlob(editor)
  downloadBlob(blob, `${name}${TLDRAW_FILE_EXTENSION}`)
}
```

`serializeTldrawJson` and `serializeTldrawJsonBlob` are asynchronous aliases of
`serializeMocanvasFile` — nothing in them awaits today, but the signature is
asynchronous by contract so an app that resolves assets before saving (§6) can
slot in without every call site changing. Only `document`-scope records are
written: a `.tldr` is the board, not your camera.

One inconsistency worth knowing: `TLDRAW_FILE_EXTENSION` is `".tldr"`, but the
built-in **File → Save a copy** menu item names its download `.mocanvas`. The
contents are the same JSON either way.

### Reading

```ts
import { loadMocanvasFile } from "@mocanvas/mocanvas"

const result = loadMocanvasFile(editor, await file.text())
if (!result.ok) console.error("could not read the file", result.error)
else if (result.warnings.length) showToast(result.warnings.join("\n"))
```

`loadMocanvasFile` takes the JSON text or already-parsed JSON. Before the records
reach the store they go through `normalizeLoadedRecords`, which turns what
different generations of the format spell differently into the one form the
shape utils expect — a label that arrived as a plain string becomes a rich-text
document, a freehand stroke packed as one base64 blob becomes an array of
points. It never throws: whatever it cannot make sense of comes back in
`warnings`, which names shapes whose props were repaired, segments that had to
be dropped, and shape types with no registered util. After loading it clears the
history, points the instance at a page that exists, and calls `zoomToFit`.

To inspect a file without an editor — a document picker, a server validating an
upload, a migration script — use `parseTldrawJsonFile`:

```ts
import { parseTldrawJsonFile } from "@mocanvas/mocanvas"

const parsed = parseTldrawJsonFile({ json: text })
if (parsed.ok) {
  console.log(parsed.value.records.length, "records")
} else {
  switch (parsed.error.type) {
    case "v1File": // the pre-envelope format; convertible, not loadable
    case "invalidRecords": // records missing, duplicated or not record-shaped
    case "fileFormatVersionTooNew": // envelope version above 1
    case "notATldrawFile": // not JSON, or no envelope at all
  }
}
```

Two honest caveats about that union. `fileFormatVersionTooNew` reports
`version: NaN` — the discriminant is right, the number is not carried through.
And `migrationFailed` is declared in `TldrawFileParseError` but the parser never
returns it, because parsing does not migrate: migration happens when the
snapshot goes into a store, and a failure there **throws**. Wrap
`loadMocanvasFile` in a `try` when the files are untrusted.

### A file from the reference implementation

It loads. The fixture in this repository (`apps/bench/public/compare.tldr`) is a
real tldraw file, loaded by the test suite on every run. The mechanism is the
sequence-id rule below: a migration sequence the file records but this schema
does not know is ignored with a `console.warn`, and those props load as written.
That works only because mocanvas's own built-in shape migrations live under
`com.mocanvas.shape.*`. Registering them under `com.tldraw.shape.geo` at version
1 — the naive port — made every real file fail with *"data comes from a newer
version"*, because the reference implementation's `geo` sequence was already
at 12.

The corollary matters to you: **your own custom shape types keep the
`com.tldraw.shape.<type>` prefix**, which is what `createShapePropsMigrationIds`
gives them. Nothing else claims those names, and documents in the wild already
record their progress under them.

---

## 3. Migrations

### What runs when

Every load — `store.loadStoreSnapshot`, and therefore `editor.loadSnapshot` and
`loadMocanvasFile` — does the same three things: compare the snapshot's
`schema.sequences` against the schema this build assembled from its shape,
binding, asset and custom-record utils; apply every migration each sequence has
gained since, in order; validate the records on the way in.
`store.migrateSnapshot(snapshot)` does the first two without loading. Either way
a failure raises rather than returning half-migrated data, so a caller can fail
closed.

Three outcomes are worth naming:

- **A sequence the persisted schema does not mention.** Migrations run from
  version 0 if the sequence is `retroactive` (the default), and are skipped
  otherwise. Use `retroactive: false` for a sequence added to a type that
  already existed, where older data was already in the right shape.
- **A sequence in the file this schema does not know.** Ignored, with a console
  warning. Those records load as written.
- **A sequence at a higher version than this build knows.** A hard error. There
  is no sound way to run a migration backwards that you do not have.

A pre-sequence schema (`schemaVersion: 1`, one version number per record type)
is *recognised* and reported, never guessed at: there is no sound mapping from
per-type versions to sequence versions, and guessing would re-apply migrations
that had already run.

### What "unknown props are kept" means

Two escape hatches, both deliberate:

- **A record type this schema does not know** passes through validation
  untouched. It is still checked for being record-shaped — an object with a
  string `id` and a string `typeName` — and nothing else.
- **Props a known type does not declare are kept, not rejected.** Shape and
  binding record types are built with `unknownProps: "keep"`. The declared props
  are still validated; the rest ride along.

The reason is the round trip. A `.tldr` from a newer generation of the format
legitimately carries props this build has never heard of —
`binding.props.snap` is in the fixture here — and dropping or rejecting them
would silently lose the user's data on the next save. Open such a file in an old
build, move one shape, save, and the newer props are still in it.

This is the *opposite* of the default for a record your app is *making*:
`createShapeValidator` on its own rejects undeclared props, which is right,
because there an undeclared prop is a typo or a forgotten migration.

A shape whose *type* has no registered util keeps every prop it arrived with,
and its envelope fields (`x`, `y`, `index`, `parentId`…) are still validated —
those have been true of every shape record there has ever been. It will not
render, and `loadMocanvasFile` says so in `warnings`, but it saves back out
intact.

### Changing a shape's props

When you add, remove or reinterpret a prop, you owe the format a migration.
Without one, a board saved before the change loads with the prop missing and
every consumer reading `shape.props.whatever` gets `undefined`.

```ts
import {
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  ShapeUtil,
  type MigratableProps,
} from "@mocanvas/mocanvas"

const versions = createShapePropsMigrationIds("callout", { AddTailStyle: 1 })

const calloutMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: versions.AddTailStyle, // "com.tldraw.shape.callout/1"
      up(props: MigratableProps) {
        props["tailStyle"] = "straight"
      },
      down(props: MigratableProps) {
        delete props["tailStyle"]
      },
    },
  ],
})

export class CalloutShapeUtil extends ShapeUtil<CalloutShape> {
  static override type = "callout" as const
  static override props = calloutShapeProps
  static override migrations = calloutMigrations
}
```

The helpers check what they can where the sequence is written, rather than when
somebody's document fails to open: ids in one sequence must be numbered
`1, 2, 3, …` in order and all belong to the same type. `up` may mutate the props
in place or return a replacement, but must not change the record's id — the
store checks that afterwards and refuses the snapshot if it happened. `down` is
optional; the only thing that runs it is a downward record migration
(`store.schema.migratePersistedRecord(record, persistedSchema, "down")`), so
omit it unless you need that.

### The worked example: the note shape

`packages/mocanvas/src/shapes/shape-migrations.ts` holds the whole built-in set,
and the note shape shows what a prop change really costs.

Version 1 is the cheap kind: backfill the props that post-date the shape
(`fontSizeAdjustment`, `growY`, `url`, `scale`) with what `getDefaultProps`
would give them, and derive `richText` from a legacy plain `text` label. Every
built-in has one, and every one declares a version 1 even with nothing to
backfill — the group shape's is a no-op whose only job is to name the sequence,
because an empty sequence carries no id and would fall back to
`com.tldraw.shape.group`, the claim the prefix rule forbids.

Version 2 is the expensive kind: it changes what `growY` *means*. `growY` is how
much taller than its square a note had to be for the text to fit, and it used to
be measured against a font, width and padding already multiplied by `scale`,
then added to an already-scaled box:

```
was:  height = 200 * scale + growY
now:  height = (200 + growY) * scale
```

Both are self-consistent, which is why nothing caught it: they agree whenever
`scale` is 1 or `growY` is 0, and every note the library grew itself was
correct. They disagree about every note arriving from *outside* — a `.tldr`, or
an app writing records directly — where `growY` is in unscaled units. Such a
note came out `growY * (scale - 1)` too short: at scale 1.6 it lost 37.5% of its
overflow and the text ran past the paper.

The fix is one line, `growY / scale`, run once on load. The cost is everything
round it: a second version, a `down` that multiplies back, defensive readers so
a broken `scale` cannot divide by zero, and this section. A prop is a public
interface; changing its meaning is a breaking change you pay for forever.

---

## 4. Image export

```ts
import { exportToBlob, downloadBlob } from "@mocanvas/mocanvas"

const blob = await exportToBlob(editor, {
  format: "png",    // "svg" | "png" | "jpeg" | "webp"
  padding: 32,      // page units around the bounds, default 32
  background: true, // paint the page colour, default false
  scale: 2,         // multiplies the output width/height, default 1
  darkMode: false,
  quality: 0.9,     // lossy formats only
  pixelRatio: 2,    // raster only, defaults to window.devicePixelRatio
})
downloadBlob(blob, "drawing.png")
```

Add `ids: [...]` to draw specific shapes. `exportAs(editor, format, ids?, opts?)`
is the same thing plus the download, naming the file after the current page
unless you pass `opts.name`; it is what the **Export as** menu runs.

### What gets drawn

One rule, shared by every entry point:

- Pass `ids` and you get those shapes **and all of their descendants**.
- Pass nothing and you get the selection, with its descendants.
- Pass nothing with nothing selected and you get the whole current page.

`getExportShapes(editor, ids?)` and `getExportBounds(editor, shapes)` are
exported if you want the bounds before exporting — to show the user the output
size, say. Shapes are drawn in page order, frames clip their children with a
`clipPath`, and `ShapeUtil.toBackgroundSvg` output is collected separately and
emitted before *every* shape, so a backdrop sits behind the whole drawing rather
than only behind its own shape.

`getSvgString(editor, ids?, opts?)` returns `{ svg, width, height }`, or
`undefined` when there is nothing to export. The size is the bounds times
`scale`, rounded up, in CSS pixels; raster output is that times `pixelRatio`.
Backgrounds are `SVG_LIGHT_BACKGROUND` / `SVG_DARK_BACKGROUND`, and JPEG paints
one regardless, because JPEG has no alpha and transparent areas would otherwise
come out black.

### The SVG is a renderer, not a screenshot

It is **not** a capture of the WebGL canvas. It is a second renderer that walks
the same shapes and draws them from the same geometry and the same style, into
standalone SVG markup with no external references. That is why `format: "svg"`
works in Node with no DOM; the raster formats need a browser and say so with a
clear error rather than a reference error.

Each shape resolves in three steps, highest first:

1. `ShapeUtil.toSvg(shape, ctx)` — the util's own markup, in shape-local
   coordinates. The exporter wraps it in a `<g>` carrying the page transform and
   opacity.
2. `shapeSvgRenderers` — the built-in registry, covering `geo`, `draw`, `line`,
   `arrow`, `text`, `note`, `frame`, `bookmark`, `embed` and `video`.
   `registerShapeSvgRenderer(type, renderer)` adds or replaces an entry.
3. `geometryFallbackSvg` — the shape's geometry outline drawn with its render
   style, or a hairline when it has none.

So **a custom shape appears in an export exactly when its `ShapeUtil` implements
`toSvg`** (or you registered a renderer for its type). Without either it still
appears — as its outline, which is recognisable and never right.

```ts
import { ShapeUtil, type ShapeSvgContext } from "@mocanvas/mocanvas"

class CalloutShapeUtil extends ShapeUtil<CalloutShape> {
  override toSvg(shape: CalloutShape, ctx: ShapeSvgContext) {
    const fill = ctx.darkMode ? "#1b1d22" : "#ffffff"
    return `<rect width="${shape.props.w}" height="${shape.props.h}" fill="${fill}"/>`
  }
}
```

`toSvg` may return a markup string — inserted verbatim, so **you** must escape
anything the document supplied — or a React node, which the exporter serializes.
Return `undefined` to fall through to the next step.

Two limits to be plain about. There is **no renderer for the `image` shape**, so
an image exports as its geometry outline; if you need image bytes in exports,
implement `toSvg` on your own image util (see §6 for why that is harder than it
looks). And `bookmark`, `embed` and `video` deliberately draw placeholder cards
rather than the remote media: an export has to stand on its own, and a remote
`<image href>` would either fail to load or leak a request when the file is
opened elsewhere.

### On the `Editor`

`Editor.getSvgString`, `Editor.toImage`, `Editor.getSvgElement` and
`Editor.toImageDataUrl` are the same functionality as methods, installed through
a registration seam: the implementations live in `@mocanvas/mocanvas`, which
depends on `@mocanvas/editor` and not the other way round, so they **throw** in
an app importing only the editor package. `getSvgElement` returns a live
`SVGSVGElement` and needs a DOM; `toImageDataUrl` returns a `data:` URL, about a
third larger than the blob, which is why `toImage` stays the default.

---

## 5. The clipboard and printing

```ts
import {
  copySelectionToClipboard,
  cutSelectionToClipboard,
  pasteFromClipboard,
  copyAs,
  Vec,
} from "@mocanvas/mocanvas"

await copySelectionToClipboard(editor)
await pasteFromClipboard(editor)                // at the viewport centre
await pasteFromClipboard(editor, new Vec(0, 0)) // at a page point
```

Internal copy and paste move JSON text tagged `application/mocanvas`
(`MOCANVAS_CLIPBOARD_TYPE`), produced by `editor.getContentFromCurrentPage` and
consumed by `editor.putContentOntoCurrentPage`. Both go through the async
Clipboard API and both fall back to an in-page buffer, so copy and paste still
work in a browser that has not granted clipboard permission — within the one
tab, which is where it matters most. `getClipboardTextForShapes` gives you that
text without touching the clipboard.

`copyAs(editor, format, ids?, opts?)` puts a *rendered* copy on the clipboard for
another application: `"json"` is the internal format above, and `"svg"`,
`"png"`, `"jpeg"` and `"webp"` go through `exportToBlob`. `copyBlobToClipboard`
writes images as a `ClipboardItem`; SVG, which clipboards do not accept as an
image, is written as text.

### Printing

```ts
import { canPrint, printSelection } from "@mocanvas/mocanvas"

if (canPrint(editor)) printSelection(editor)
```

`printSelection` prints the selection if there is one, otherwise the page. It is
deliberately **not** `window.print()`: the editor is a component on somebody's
page, and the host window's print view is that whole page — headers, navigation,
the article the canvas sits in, and a canvas element a print stylesheet cannot
usefully lay out. What the user asked to print is the drawing, so the drawing is
what is rendered: the same SVG the exporter produces, alone in a hidden
same-origin iframe that is printed and then thrown away (removed on
`afterprint`, and on a 60-second timer, since not every browser fires it).

It uses the instance's `exportBackground` setting and always renders light, and
returns `false` when there is nothing to print or no DOM to print in — the same
condition `canPrint` reports, which the built-in menu item disables itself on.

---

## 6. Assets

Image and video bytes do not live in the records. An `asset` record is
`document`-scoped metadata — dimensions, name, MIME type, and a `props.src`
pointing at the bytes — and a shape references it by `props.assetId`. Where the
bytes actually are is the `AssetStore`'s business:

```ts
interface AssetStore {
  upload(asset: Asset, file: File, abortSignal?: AbortSignal): Promise<{ src: string; meta?: JsonObject }>
  resolve?(asset: Asset, context: AssetContext): Promise<string | null> | string | null
  remove?(assetIds: AssetId[]): Promise<void>
}
```

Only `upload` is required. It is called once per file, before the asset record
is written, so the `src` it returns is what every collaborator sees — throw from
it to reject the file and no shape is created. Without `resolve` the editor
falls back to the asset's own `props.src`; without `remove`, deleting an asset
record leaves the bytes where they are. `resolve` receives an `AssetContext` —
camera zoom times device pixel ratio, a stepped version of the same so a
drag-resize does not re-request every frame, the network's effective type, and
`shouldResolveToOriginal`, set for copy, paste and export, where a downscaled
variant would lose data. A store with one URL per asset can ignore all of it.

Pass yours to the component or the store:

```tsx
<Mocanvas assets={myAssetStore} />
// or
createStore({ shapeUtils, bindingUtils, assets: myAssetStore })
```

It hangs off the *store* rather than the editor, as `store.props.assets`,
because assets are document-scoped: a snapshot loaded into a store, exported
from it or synced out of it all need the same uploader, and some of that happens
with no editor mounted. It is always present — an app supplying none gets
`createInMemoryAssetStore()` — so `store.props.assets.upload` is never a null
check at a call site.

Both built-in stores inline the bytes as base64 `data:` URLs:
`createInMemoryAssetStore()` (the default; it keeps a map, so `remove` works)
and `inlineBase64AssetStore` (no `resolve`, no `remove` — the `src` *is* the
data). Inlining needs no infrastructure and the bytes travel inside the
document: exactly right for a prototype or a test, exactly wrong for anything
real, where a few photographs produce a document too large to sync.
`dataUrlToFile`, `fileToDataUrl` and `fileToBase64DataUrl` convert between the
two forms — a paste handler needs the first, so a data URL on the clipboard
becomes a `File` and takes the same upload path a dropped one does.

### What this means for files and exports

A `.tldr` carries asset *records*, not bytes — unless the `src` is a data URL,
in which case it carries both and is correspondingly enormous. A file saved from
an app whose asset store hands out CDN URLs only opens correctly where those URLs
resolve. For portable files, resolve assets to data URLs before serializing; the
asynchronous signature of `serializeTldrawJson` exists for exactly that.

For image export the answer is blunter: as §4 says there is no SVG renderer for
the `image` shape at all, so image bytes are in no export by any route today. A
custom `toSvg` that embeds a data URL is the way to change that.
