# Changelog

## 4.8.10

The bottom edge is one row again.

### The toolbar stays on the zoom bar's row

Below 1290px it moved up to a row of its own, and the row it left behind held
one 152px zoom bar and 440px of nothing. Two rows of chrome for one row of
content, on the canvas that had the least to spare.

It reserves the zoom bar's width on its left now and centres in what is left
of that row — the bargain the actions row already makes beside the style dock.
The right end is reserved only when the stats chip is actually on the row,
which outside debug mode it is not. One tool moves into the overflow menu to
pay for it: eight inline instead of nine on a 606px canvas, and a row of
canvas back.

Reserving 300px a side is what a bar that has to stay on the container's
centre costs, and that is still what happens above 1290px, where the canvas
can pay it.

`--mocanvas-ui-dock-left` and `--mocanvas-ui-dock-right` are the two ends,
each defaulting to `--mocanvas-ui-dock`, which still means both. All three
must stay plain lengths or a `var()` to one: `readBarMetrics` reads them with
`parseFloat` to decide how many tools stay inline, and while `var()` is
substituted into a custom property's computed value, `calc()` is not.

### A phone with no debug panel gets its empty row back

The phone layout put the toolbar two rows up, clearing the zoom bar and the
stats chip below it. The stats chip is a debug panel, so on every phone-width
editor that is not being debugged — all of them — the second row was empty.
It is counted only when the chip is there.

## 4.8.9

Three things about a canvas in a column, all of them from the same screenshot.

### The toolbar keeps its ends clear

Below 1290px the bar stops reserving room for the zoom bar and the stats chip,
because they are on other rows by then — and it took the whole width instead.
Thirteen tools on a 606px canvas left 26px at each end, which reads as a strip
of chrome across the document rather than a plate on it.

It now keeps a button and a half clear at each end and spills the rest into the
overflow menu: nine tools inline instead of thirteen at that width, and still
all thirteen on anything wider than about 700px. The phone layout is unchanged
— there is no room there to spend on elegance.

The reservation stays a plain length, and a test says so: `readBarMetrics`
parses it with `parseFloat` to decide the split, so writing the same value as
`calc(1.5 * var(--mocanvas-ui-btn))` would read as `NaN`, fall back to 300px,
and collapse the bar to two buttons.

### The common actions move into the menu plate sooner

Undo, redo, delete and duplicate ride in the menu plate beside the page picker
when there is room, and take a row of their own above the toolbar when there is
not. The threshold was 840px, about twice what the pair needs: a page picker is
around 150px and five actions about 220. It is 580px now, so everything between
the two stops spending a row of canvas on buttons that had room in a plate
already on screen. "Back to content" moves down a row to match.

### A floating layer stays inside the editor

`placeNear` clamped to the window, so the style panel of a 606px editor on a
1600px screen opened beside its trigger, stayed obediently inside the browser,
and hung 74px outside the editor it belongs to. It now clamps to the editor's
container, with the window as the fallback for chrome rendered without one, and
carries a `max-height` measured from that container so a panel taller than a
short embed scrolls inside the plate instead of running out of the bottom of
it. `placeNear` takes the box as an optional sixth argument; called as before,
it behaves as before.

The style panel also had the wrong plate around it. `.mocanvas-popover` is five
40px columns — the shape the tool and shape pickers want — and the panel is
292px of rows, so it was being laid out in the first column and hung out of its
own plate to the right. A popover holding a panel is `display: block` now.

## 4.8.8

The chrome measures its container, not the window.

### An editor in a column of a wide window is a narrow editor

`BreakPointProvider` has always measured the editor's container, and says why
in its own comment: an editor embedded in a sidebar is narrow even on a wide
screen, and a media query cannot see that. The stylesheet was media queries
throughout.

So an editor 606px wide in a 1600px window was handed the desktop layout. The
toolbar reserves 300px on each side for the zoom bar and the stats chip, which
made its width budget `calc(100% - 624px)` — eighteen pixels less than nothing.
It collapsed to a 10px column: one button per row, two rows of it, the other
eleven tools in the overflow menu, standing in the middle of the canvas.

Both width rules are `@container mocanvas-ui` now, and `Mocanvas` names that
container on the element the chrome positions against. The thresholds are
unchanged — 1290px for the toolbar's own row, 560px for the phone layout — and
they now mean what they always said they meant. A test asserts that no width
rule is a media query; `prefers-color-scheme` and `prefers-reduced-motion` are
about the reader rather than the room and stay as they are.

An app that assembles `TldrawUi` inside a container of its own gets the wide
layout until it sets `container-type: inline-size` and `container-name:
mocanvas-ui` on that container.

### The share panel goes when there is nobody to share with

The people menu renders nothing when nobody else is on the page — that is
deliberate, and documented on it. The plate around it rendered anyway, so a
single-player editor had a 10px rounded blob in its top-right corner: a border,
a background and eight pixels of padding around no content at all. It was on
every screenshot of this library and nobody could say what it was.

## 4.8.7

Two more the same screenshot shows, both in the bottom edge of a narrow embed.

### The actions row leaves the style dock its end of the line

`.mocanvas-style-dock` holds the right end of the line the common actions sit
in — that is what the rule says it is for. The actions row was centred on the
whole container with `translateX(-50%)`, so it grew out from the middle until
the two met: on a 333px embed the dock was drawn on top of the last action,
four pixels of overlap and a button you could not press.

The row is now centred the way the toolbar is, between the insets by auto
margins, and reserves the dock's width while the dock is on the line. Centred
in what is left rather than on the container: reserving on both sides to keep
it on the true centre costs twice the width, and at the widths this dock
appears at that is width the row does not have. A row wider than its line wraps
inside it now instead of hanging off both ends.

The same variable comment that promised `--mocanvas-ui-dock` would keep the
toolbar, zoom bar and stats chip from colliding did not cover the row above
them; a test asserts the reservation now, next to the one about the offset
those three share.

### The style swatch follows the same rule as the panel it stands for

A selected shape that declares no styles — every custom shape that has not
asked for a colour or a dash — still has an opacity, so the docked panel shows
one. The narrow layout's swatch dropped out on a second, stricter rule and
rendered nothing, which made opacity a thing you could only reach on a wide
screen. Both now ask the same question, and a test renders the two layouts
against the same editor to keep them asking it.

## 4.8.6

Three things in the default UI that were wrong in a way only a screenshot shows.

### The style panel appears when it has a subject

It was on permanently. The styles a tool *would* apply exist whether or not
that tool is the pointer, so picking the arrow, selecting nothing and just
looking at the board still put a full panel of colours, fills and dashes over
the right-hand side of the canvas.

It now appears when there is something to style: a selection, or a tool that is
about to create a shape. With `select`, `hand`, `zoom`, `eraser` or `laser`
active and nothing selected, there is nothing to be about, and it stays away.
The narrow-layout swatch follows the same rule.

### The legacy alignments are gone from the picker

`start-legacy`, `end-legacy` and `middle-legacy` are in the align style because
a file written by an older tldraw carries them and has to keep loading. They
were also offered as choices — and having no icon, they rendered as three text
buttons reading "Start Legacy", "End Legacy", "Middle Legacy", each wider than
the row it sat in.

They are no longer offered. A shape that already has one still shows it, so the
panel never claims a shape is aligned some other way than it is; the style
itself is unchanged, so nothing stops loading.

### The toolbar's overflow is a grid

`.mocanvas-toolbar-overflow` was written into the markup and never given a
rule, so the buttons fell back to normal flow: nine tools became a single
column taller than the canvas they were meant to be used on. It is a four-wide
grid now, the shape the shape-picker beside it already uses.

A test asserts that each class the chrome positions with actually has a rule.
This is the third time the same thing has happened — a class name in the markup
that the stylesheet has never heard of renders, and only a screenshot can see
it.

## 4.8.5

### Four new guides ship with the package

`AGENTS.md`, `TOOLS.md`, `SYNC.md` and `FILES.md` — about 1,700 lines between
them, in the tarball and on the website, which renders `/docs/<slug>` out of
`node_modules` so both read the same text at the same version.

- **Driving the editor from an agent.** The claim the library is sold on, set
  out precisely: a document with no browser, one API a person and a program
  both call, reading the document back, and what `history: "ignore"` does and
  does not promise.
- **Writing a tool.** `StateNode` as a state machine rather than a click
  handler: what the states are for, what each hook is handed, and which parts
  only look load-bearing.
- **Multiplayer.** The transport, presence, and exactly what converges when two
  edits race — stated as the merge code supports it, with the non-guarantees
  named rather than glossed.
- **Saving and exporting.** Snapshots, `.tldr`, what migrations do when an old
  file meets a new build, and image export.

Three corrections to the existing guides went in with them, all found while
the new ones were being written against the source: CUSTOM_SHAPES.md §9 said
the default toolbar cannot grow a button for your tool (it can, through
`overrides.tools`), MIGRATION.md said `ShapeUtil.toSvg` is not a `ShapeUtil`
member (it is, and a util's own implementation beats the registry), and
FILES.md was finished after the first commit of it.

Nothing in the library's code changed.

**4.8.4 was abandoned mid-publish.** `@mocanvas/wasm@4.8.4` reached the
registry before the run was cancelled and the other six did not, so 4.8.4 is a
version that only one package has. Nothing depends on it — 4.8.3 pins
`wasm@4.8.3` — and this release supersedes it. Cancelling was the wrong call:
letting it finish and correcting the guides in the next release would have cost
a version number instead of leaving an orphan.

## 4.8.3

### Every package now says where it comes from

`repository`, `homepage` and `bugs` are in each `package.json`. They were
missing, which nobody noticed while the repository was private — and the moment
it went public, publishing started failing: npm verifies a provenance bundle
against `repository.url`, and an empty one does not match the repository the
build came from. The link on each package's npm page is the visible half of the
same fix.

### `getContainer` is optional, so a headless editor stops inventing a DOM node

The claim this library is sold on is that a document exists without a browser,
and until now the first thing a headless caller met was a required
`getContainer: () => HTMLElement`. So every agent on a server, every fold job
and every test began by fabricating an element:

```ts
new Editor({ store, shapeUtils, tools, engine, getContainer: () => ({}) as HTMLElement })
```

Nothing inside ever needed it. `safeContainer()` has always treated a missing or
throwing container as "no container", which is why that cast worked at all — it
was the signature insisting, not the runtime. It is optional now, and this
library's own test harness stopped passing the fake one.

Omit it and `editor.getContainer()` throws a sentence saying the editor is
headless, rather than handing back something that fails two layers further
down. Passing one behaves exactly as before.

## 4.8.2

### Breaking, and a regression in 4.8.1: `history: "ignore"` stopped ignoring

**Upgrade straight past 4.8.1 if you use it.** `editor.run(fn, { history: "ignore" })`
put its writes into the undo stack after all, so the user's next Cmd+Z reverted
them along with their own edit — an agent's shape, or a collaborator's committed
turn, taken back as part of undoing something else, and not restorable, because
from that user's side it was never a step of theirs. That is other people's work
lost, which is why this is a patch of its own rather than part of the next one.

4.8.1 made `run` open a store operation, which was the fix it was for, and put
the ignore *inside* it:

```ts
store.atomic(() => history.ignore(fn))   // 4.8.1 — wrong way round
history.ignore(() => store.atomic(fn))   // 4.8.2
```

The history manager is a **store listener**. It reads its ignore counter when
the notification arrives, and the whole point of 4.8.1 was that the
notification now arrives once, at the end of the operation — by which time
`ignore` had already returned and put the counter back to zero. Nothing in the
suite here covered `run` + `ignore` + `undo` together, so it went out green.

### What `history: "ignore"` does not promise

Found while fixing the above, and **not** a regression — it behaves the same on
4.8.0 and earlier. An ignored write to the *same record* the user then undoes
is still reverted:

```ts
mark(); updateShapes([{ id: S, x: 100 }])
run(() => updateShapes([{ id: S, y: 250 }]), { history: "ignore" })
undo()   // S.x back to 0 — and S.y back to 0 as well
```

Undo restores whole records rather than fields, so putting S back as it was at
the mark puts back every field of S, ignored ones included. `history: "ignore"`
promises the write is not a *step* in the undo stack; it cannot promise that
some other step will not overwrite it. There is now a test saying so, so the
next person to meet it knows which of the two they are looking at.

## 4.8.1

Three follow-ups to 4.8.0, all from the same consumer re-measuring it. The
first is a gap in 4.8.0's own fix; the other two are older than it.

### `editor.run` really is one operation now

4.8.0 made the *store* notify once per operation, and missed that `editor.run`
never opened a store operation at all:

```ts
run(fn) { return transact(() => fn()) }   // a signal transaction, nothing more
```

A `transact` batches recomputation. It does not make the writes inside one
operation, so each `updateShapes` still opened and closed its own — and two of
them in one `run` reached a listener as two notifications, the first carrying a
state the document was only ever halfway through. Anything built out of `run`
was affected, `duplicateShapes` included, which is why a shape and its binding
arrived in separate batches.

`run` opens a store operation now. One history entry, one notification, however
many writes the callback makes.

### A completion is told the source its changes were made with

```ts
store.extractingChanges(() => store.mergeRemoteChanges(() => …))

was:  afterChange remote … operationComplete user     ← disagree about the same write
now:  afterChange remote … operationComplete remote
```

The source was captured when the *outermost* operation opened, so a remote
merge nested inside something else completed as `user`. A handler that skips
remote echoes — which is what a sync layer puts there — treated a peer's write
as this user's own and sent it back out.

Reported only when the operation is of one mind. One carrying both sources
keeps the outer one, because the user half is real work and a handler must not
skip it.

### A completion survives its pending entries being drained

Whether an operation ran its completion was decided by looking at the pending
entries — so anything that emptied them mid-operation made the completion
vanish silently, handlers and all, while the writes themselves had happened.
A consumer lost a whole derived-layout pass this way: the dirty set filled and
nothing ever processed it, so one shape's height was corrected and the thing
hugging it kept the old one.

"Did this operation write anything" is now a question about the store rather
than about whether the record of it is still sitting there. An operation that
genuinely wrote nothing still runs no completion.

**Neither of the last two was a regression in 4.8.0**, though both surfaced
while checking it: the guard that swallowed the completion is identical in
4.7.1, and the source has been captured at the outer operation since it was
written.

## 4.8.0

Four parity breaks against tldraw 5.1.1, all measured A/B by a consumer rather
than found here — which is the point worth noting about all four: the types
were silent, our own tests passed, and each one was internally consistent. They
only disagree with the reference, and a consumer moving across hits them as
behaviour that looks like a bug in their own code.

### Breaking: an operation notifies its listeners once, not once per write

`store.listen` was called after every write inside a batch, so a listener saw
every intermediate state the operation passed through:

```
editor.run(() => { update(y: 100); update(y: 200) })

was:  2 notifications — y=[100, 0], then y=[100, 200]   ← the middle never existed
now:  1 notification  — y=[100, 200]
```

A batch that reports its own intermediate states is not a batch. This is not
cosmetic for the two things people actually put on a listener: a sync binding
published each half-applied step to its peers, so a peer rendered a state that
was never intended here; and a save-on-change handler wrote the document once
per *step* instead of once per gesture. It also broke sequencing — a listener
watching for a shape had already run by the time the same operation added that
shape's binding, so anything reading both in one notification found only one.

Entries are squashed per consecutive run of the same source, so a remote merge
nested inside a user gesture stays separate and in order; a listener filtered
to one source is never handed the other's changes.

**If you relied on per-write notifications**, take the same information from a
side effect: `registerAfterChangeHandler` still runs per record.

### Breaking: `deleted-shapes` fires before the before-delete handlers

```
was:  beforeDelete(frame) → beforeDelete(kid) → EVENT
now:  EVENT → beforeDelete(frame) → beforeDelete(kid)
```

The before-delete handler is the only place a delete can be refused, and
whether a shape's own parent is going in the same gesture is the one thing it
cannot work out for itself — that is what the event carries. Announcing the set
afterwards told the handler what it needed once the decision was already made,
so a child vetoing on its parent's behalf vetoed nothing: the parent survived
and its children did not.

Two things the old order bought are now gone, and both are worth checking for:
a listener reads the editor with the shapes **still in it** (read the document
without them in an `after-delete` handler instead), and the emit is inside the
gesture, so a listener that throws takes the deletion with it.

### Breaking: a write inside `operationComplete` completes too

An `operationComplete` handler that wrote got an `afterChange` for its write
but no second `operationComplete`. That silently breaks the pattern these
handlers are written against — "set a guard on my own write, clear it in the
completion that closes that write" — because the guard is never cleared, and
the *next* real gesture is the one it eats. A consumer spent a day on seventeen
failing tests that looked like a geometry bug.

Handlers now re-run for what they themselves wrote, until a round writes
nothing. Bounded at 100 rounds, after which the store gives up loudly rather
than freezing the tab: a handler that writes every time it runs would otherwise
never settle. The whole cascade is still **one** operation to the outside — one
history entry, one listener notification.

### Breaking: a note's `growY` is stored unscaled

`growY` is how much taller than its square a note had to become for its text to
fit. It was stored already multiplied by `scale`:

```
was:  height = 200 * scale + growY
now:  height = (200 + growY) * scale
```

Both are self-consistent — they agree whenever `scale` is 1 or `growY` is 0 —
and every note this codebase grew itself was correct, which is why no test here
ever failed. What they disagree about is every note that arrives from outside:
a `.tldr` file, or an app writing records directly, where the prop has always
meant the unscaled thing. Such a note came out `growY * (scale - 1)` too short,
so at scale 1.6 it lost 37.5% of its overflow and the text ran past the paper.
`.tldr` export was wrong in the same way, in the other direction.

**Existing documents migrate**: note props gain version 2, which divides the
stored `growY` by the scale it was measured at. A record with a missing or
zero `scale` is left alone rather than migrated to `Infinity`.

### Not changed: the grid still starts on

`isGridMode` defaults to `true` here and `false` in the reference. That is the
deliberate change 4.5.0 made and the reason is in that entry; it stays. An app
that wants the reference's resting state should set it rather than inherit it —
a library default is the wrong thing to be load-bearing in either direction.

## 4.7.1

### Submenus open beside their row, not underneath it

Every submenu in the chrome opened *below* its own row, in the parent menu's
column — so the parent's remaining rows were pushed out of the way and the
panel grew towards the bottom of the screen. The longest submenu is the one
most likely to need the room, and it was the one that ran out of it: after
4.7.0 put nine toggles behind `Preferences`, opening it on a short window
pushed the bottom of the list past the edge.

They fly out to the side now, tops aligned with the row that owns them, which
is what every platform menu does and what keeps the whole chain readable at
once. `placeNear` gained a `"side"` placement for it:

- to the right of the row, or to its left when the right would overflow —
  flipping rather than clamping, so a submenu near the right edge never lands
  on top of its own parent;
- tops aligned, then clamped, so a submenu longer than the room below its row
  slides up instead of off the bottom;
- one taller than the window sits at the top edge.

The chevron on those rows points right rather than down, since a down chevron
on a row that flies out sideways reads as "this expands in place".

`Side` — the `FloatingLayer` placement — gained `"side"` alongside `"above"`
and `"below"`; both existing values behave exactly as before.

## 4.7.0

Two changes to the default chrome, both visible the moment you open it.

### Breaking: the preferences are behind one row, and the help menu is off

Eleven preference toggles were listed flat in the main menu — the first screen
of it read "Always snap / Tool lock / Show grid / Wrap text / Paste at cursor",
with Edit, View and Export pushed up above a wall of settings nobody changes
twice. They are now a `Preferences` submenu.

Inside it, the three that group into a subject of their own get a submenu each:

```
Preferences ▸  Always snap, Tool lock, Show grid, Wrap text, Focus mode,
               Edge scrolling, Dynamic size, Paste at cursor, Debug mode
               ─────
               Accessibility ▸   Input ▸   Theme ▸
```

`AccessibilityMenu` and `InputModeMenu` were both written, exported, and
rendered nowhere — the first is where Reduce motion and Enhanced accessibility
moved to, the second is the pen-mode choice, which had never appeared in any
menu at all. **Language stays outside the submenu**, because it is not a
preference about the canvas: it is the language the menu itself is in, and
looking for it inside a menu you cannot read is the one case where nesting
costs something real.

`PreferencesGroup` keeps its name and its export, so a custom menu that renders
it keeps working — it renders a submenu now rather than a flat group.

**The help menu is no longer in the default chrome.** Its trigger was a bare
`?` with no plate and no placement, so it sat in the container's top-left
corner underneath the menu plate — the same failure 4.6.0 and 4.6.1 fixed in
the actions row and the style swatch, in the last control that still had it.
Behind it were the accessibility preferences and print/shortcuts, all of which
the main menu already carries, so there was nothing there that was not one row
away. `components={{ HelpMenu: DefaultHelpMenu }}` puts it back, and it is
docked at the bottom-right now rather than stranded.

**Not changed:** submenus still open below their parent rather than flying out
to the side.

## 4.6.1

### The style trigger was stranded in the same corner

Follow-up to 4.6.0, which moved the actions row and missed the control beside
it. On a layout too narrow for the docked style panel, the trigger is a single
swatch — and it was rendered outside every `.mocanvas-panel`, which is the
selector the UI's variables are declared on. So its `width` read an undefined
variable and was dropped along with any placement: it landed in the
container's top-left corner at the size of its icon, under the menu plate.

It now sits in a plate of its own at the right end of the actions row's line,
mirroring the zoom bar at the left end of the row below.

**And a third rule was computing the toolbar's offset.** 4.6.0 published
`--mocanvas-ui-toolbar-bottom` so the rows above the toolbar could follow it,
and converted two of the three places that set it. The one left behind was the
phone-width rule, so below 560px the actions row was drawn on top of the
toolbar again. All three derive from the variable now, and a test asserts that
the toolbar's edge is placed from it and nowhere else — an invariant no
rendering test can catch, since jsdom lays nothing out and a screenshot only
covers the width it was taken at.

## 4.6.0

### The common actions had no home

Undo, redo, delete and duplicate were drawn as a bare row with no
`mocanvas-panel` class — and that class is the selector the UI's own variables
are declared on. So `gap` and `bottom` in the row's rule were both invalid at
computed-value time, which drops them: no gap, no dock, and the buttons landed
unstyled and cramped at the top edge of the canvas. The actions menu's trigger
had no placement at all and sat in the container's top-left corner, half under
the menu plate.

They now live where the room is:

- **Wide** (tablet and up), in the top-left plate beside the page picker,
  separated by a hairline — one bar that says where you are and what you can do
  to what you have selected.
- **Narrow**, docked above the toolbar, a thumb's reach from the tools they
  follow.

The actions menu rides at the end of that row in both. One row, one place: a
copy is never drawn in both, and the trigger is never left unplaced.

**`--mocanvas-ui-toolbar-bottom`** is new, and is where the toolbar's bottom
edge is published. The rows that stack above it — the actions row, "Back to
content" — derive from it instead of recomputing it, which is how the actions
row came to be drawn on top of the toolbar on a narrow layout the first time.

**Slots are unchanged.** `components={{ QuickActions: null }}` still removes the
row, and a replacement still appears in whichever place the row belongs to;
the panel renders the slot rather than its own copy. Removing the row removes
the actions menu it carries — replace the row if you want one without the
other.

## 4.5.2

### The grid answered the camera backwards in both directions

Zoom in and it vanished; zoom out and it turned into a grey sheen. Both are
the opposite of what a grid is for, and both came from the same two decisions
in `DefaultGrid`.

**Zooming in.** The dot was a fixed 1px radius. At 8× the cell is 80 screen
pixels, so what remained was a speck every 80px — a lattice you cannot see is
not a lattice. The radius is now a fraction of the cell, `cell / 16`, floored
at 0.75px so it never disappears and capped at 5px so a deep zoom draws dots
rather than blobs.

**Zooming out.** A second, heavier lattice was drawn every fifth cell at a
*fixed* 0.9 opacity while the fine one faded. So the fine grid dissolved on
schedule and the coarse one stayed, at full strength, until the cells were a
few pixels apart. That is the sheen. There is one lattice now, one opacity,
and it fades out together: solid at a 12px cell, gone by 6px.

```
cell = gridSize × zoom      (screen pixels)
dot   r = clamp(cell / 16, 0.75, 5)
grid  opacity = clamp((cell - 6) / 6, 0, 1)   — nothing rendered at 0
```

Both thresholds are pixel numbers because that is what an eye judges. With the
default `gridSize` of 10 the grid bows out below about 60% zoom; a document
that wants it further out sets a larger step — `documentSettings.gridSize`,
which is also the snap step, so the dots stay magnets at every zoom.

**No re-levelling, deliberately.** The spacing is always the document's step
rather than a power of it picked per zoom. A corner on a multiple of the step
sits on a dot at *every* zoom, which re-levelling breaks on the intermediate
steps — a grid that bows out when it gets too dense is the better trade.

**The dots were also being clipped.** Drawn at the tile's corner, an SVG
pattern throws away the three quarters that fall outside the tile — at the old
1px radius a barely-noticeable speck, at 5px a quarter-disc. The dot is drawn
at the tile centre now and the tile is shifted back half a cell, which puts it
on the same lattice point whole.

The every-fifth heavier dot is gone with the second lattice. It existed so the
eye could count without the fine grid being dark enough to read alone; a dot
that scales with the cell reads on its own.

## 4.5.1

### The grid was still invisible, and this time it was painted over

4.4.3 mounted the `Grid` slot. 4.5.0 darkened it and turned it on. Neither put
a single dot on a screen, because the grid is a DOM layer **beneath** the GPU
canvas and the renderer cleared every frame to an opaque near-white:

```
<div class="mocanvas">
  <svg class="mocanvas-grid">   position:absolute, z-index:auto
  <canvas>                      position:absolute, z-index:auto  ← paints over it
```

The clear colour was `[0.976, 0.98, 0.984, 1]` — **alpha 1** — so the grid was
drawn and then covered, every frame. It had a node, the right patterns and the
right colour, and measured zero pixels. That is precisely what a test asserting
"the element is in the document" cannot see, which is why this shipped twice.

The canvas now clears fully transparent and the page colour is painted by the
container instead, where the layers beneath the canvas can sit on top of it.
The `Background` slot was dead for the same reason and is now visible too.

**Dark mode gets a dark page.** The colour comes from the theme, which carries
one per colour mode and publishes it as `--mocanvas-background`. The old clear
colour was a static light value painted in both modes, so an editor in dark
mode drew its shapes on a near-white page. Nothing changes for an editor in
light mode: `--mocanvas-background` is `#f9fafb`, the exact colour the clear
used. The *default* colour scheme is still `"light"` rather than `"system"` —
call `editor.theme.setColorScheme("system")` to follow the window.

**`backgroundColor` is deprecated**, not removed. An app that set it keeps the
colour it set, now painted on the container; it no longer describes anything
the renderer does. Prefer the theme, or `style={{ background }}` on `<Canvas>`
— either follows the colour mode, which a fixed RGBA cannot.

## 4.5.0

One break, and two halves of the same repair: the boundaries that were supposed
to keep a broken shape from taking the editor down existed and caught nothing.

### Breaking: the grid is on by default

`isGridMode` starts `true`. The grid is how a person judges size and alignment
on a drawing surface, and starting blank made the feature invisible to anyone
who never opened the menu. An app that wants a blank page sets it back:

```ts
editor.updateInstanceState({ isGridMode: false })
```

**This change is silent** — nothing in your build will complain, the canvas just
comes up with a grid on it. It is visual only: `isGridMode` already drove
snapping, and that behaviour is unchanged.

The grid also had to be *visible* to be worth defaulting on. The dots were drawn
at 0.5 and 0.8 opacity over a `#dfe2e5` grid colour, which measures 1.10:1
against a white canvas — below what an eye separates from the page, so switching
the grid on looked like it had done nothing even after 4.4.3 wired it up. The
colour and the opacities both moved; either alone still read as a blank canvas.
`--mocanvas-grid` overrides the colour as before.

### One broken shape took the whole editor down

`ErrorBoundary` was written, exported, and **mounted nowhere**. `ErrorFallback`
and `ShapeErrorFallback` were documented slots nothing rendered. `Canvas`'s own
docstring described the arrangement — each shape body in a boundary, the editor
as a whole in another — and described something that did not exist, so a
`TypeError` in one custom `ShapeUtil.component` unmounted the editor and usually
the page with it.

Mounting the boundaries was not enough, and this is the part worth reading if
you maintain something similar. Written inline:

```tsx
<ShapeBoundary shape={shape}>
  {util.component(shape)}
</ShapeBoundary>
```

the call runs while the *parent* renders its children — before the boundary
exists — so the throw still went straight past it. It reads as if it were
inside. The call now happens in a component of its own, which is the only thing
that puts it inside the boundary's subtree; that component is tracked, since
moving the call also moved the reactive scope a shape body reads its signals in.

A shape that throws now leaves a dashed marker at its own bounds and logs the
type and id — `mocanvas: the "box" shape shape:… failed to render` — because
"Cannot read properties of undefined" with no shape id is the hardest kind of
report to act on. The rest of the page keeps working. There is no retry: a shape
that threw once throws again on the next render, and a boundary that remounted
it would spin.

### Either error fallback can come from the `components` prop

`ErrorFallback` and `ShapeErrorFallback` were provider-only while every other
slot on `<Canvas components={…}>` was prop-only — the same names resolved from
two different places depending on which boundary you meant. Nothing said so, and
the prop's own type invites it, so a host that wrote
`components={{ ErrorFallback }}` got the built-in screen and no indication why.

The cause was structural: the editor-wide boundary sits above the body the prop
is passed to, and the per-shape one three components below it, so neither could
read the prop at all. Both now resolve prop first, then the provider, then the
built-in, with `null` at either level read as an answer — render nothing — rather
than as a miss to fall through. Provider-only configuration is unaffected.

## 4.4.3

### "Show grid" drew no grid

The menu item toggled `isGridMode`, the tick moved, snapping started working —
and the canvas looked identical, because **nothing rendered a grid**.

Both halves existed. `TLComponents.Grid` was documented in three paragraphs,
down to why it is handed the camera rather than subscribing to it. `DefaultGrid`
was written: two SVG patterns, a fine cell at the document's step and a heavier
one every fifth, fading out as the camera zooms away so a grid finer than a few
pixels does not become noise. `Canvas` rendered neither.

So every unit test passed, because there was nothing wrong with the grid. It was
never asked for. `Canvas` now renders the slot while grid mode is on, handing it
the camera and `documentSettings.gridSize`; `components={{ Grid: MyGrid }}`
replaces it and `{ Grid: null }` switches it off.

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
