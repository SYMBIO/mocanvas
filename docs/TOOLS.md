# Writing a tool

A tool is a small state machine that turns pointer and keyboard events into
document changes. By the end of this you will have a `card` tool with three
states, an Escape that leaves nothing behind, a cursor of its own, a toolbar
button and a key, registered on `<Mocanvas />` in two lines.

[CUSTOM_SHAPES.md](CUSTOM_SHAPES.md) covers the same ground from the other
side — it builds a shape and gives it a tool in §8. This guide is about the
machine itself: what the states are for, what each hook is handed, and which
parts of `StateNode` are load-bearing and which only look like they are.

Contents:

1. [What a tool is](#1-what-a-tool-is)
2. [The smallest tool: one state, one click](#2-the-smallest-tool)
3. [What a handler is handed](#3-what-a-handler-is-handed)
4. [Reading the pointer: `editor.inputs`](#4-reading-the-pointer)
5. [Three states: idle, pointing, dragging](#5-three-states)
6. [Cancelling, completing, and the history mark](#6-cancelling-and-completing)
7. [Tool lock](#7-tool-lock)
8. [Cursors](#8-cursors)
9. [Registering the tool](#9-registering-the-tool)
10. [A toolbar button and a keyboard shortcut](#10-a-toolbar-button-and-a-shortcut)
11. [When to subclass `BaseBoxShapeTool` instead](#11-basebox)
12. [Declared but inert](#12-declared-but-inert)
13. [The whole file](#13-the-whole-file)

---

## 1. What a tool is

Every tool is a `StateNode`, and every `StateNode` is a node in one tree. The
editor builds a root node from the tools you register; each tool is a child of
that root, and each tool's own states are its children. `editor.root` is the top
of it.

```ts
export interface StateNodeConstructor {
  new (editor: Editor, parent?: StateNode): StateNode
  id: string
  initial?: string
  children?(): StateNodeConstructor[]
  isLockable?: boolean
  useCoalescedEvents?: boolean
}
```

A node with children is a *branch* and **must** declare `initial`, or the
constructor throws with `has children but no initial state`. A node without
children is a *leaf*, and leaves are where the work happens.

Events arrive at the root and walk down the active path: each node runs its own
handler first, then forwards to its active child — but only if that child is
still the active one, so a handler that transitions stops the event there rather
than delivering it to a state that has already exited. `editor.getPath()`
returns the live path as a string, e.g. `"root.card.dragging"`, and
`editor.isIn("card.dragging")` / `editor.isInAny(...)` test it.

Move between sibling states with `this.parent!.transition("id", info)`. The old
state's `onExit` runs, then the new one's `onEnter`, and `info` is passed
straight to that `onEnter`. `transition` also takes a dotted path —
`transition("select.idle")` enters `select` and then walks into its `idle` child
rather than stopping at whatever `select` calls initial. That is how one tool
hands control to a *specific* state of another.

---

## 2. The smallest tool

A tool that places something on click needs exactly one state:

```ts
import { createShapeId, StateNode, type PointerEventInfo, type StateNodeConstructor } from "@mocanvas/editor"

class Idle extends StateNode {
  static override id = "idle"

  override onEnter(): void {
    this.editor.setCursor({ type: "cross" })
  }

  override onPointerDown(info: PointerEventInfo): void {
    if (info.button !== 0) return
    const editor = this.editor
    const { originPagePoint } = editor.inputs
    editor.markHistoryStoppingPoint("create card")
    const id = createShapeId()
    editor.createShape({
      id,
      type: "geo",
      x: originPagePoint.x - 130,
      y: originPagePoint.y - 80,
      props: { geo: "rectangle", w: 260, h: 160 },
    })
    editor.select(id)
    if (!editor.getInstanceState().isToolLocked) editor.setCurrentTool("select")
  }

  override onCancel(): void {
    this.editor.setCurrentTool("select")
  }
}

/** Click to place a card. */
export class CardTool extends StateNode {
  static override id = "card"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [Idle]
}
```

`static id` is the whole identity of a tool: it is what `setCurrentTool("card")`
takes, what `getCurrentToolId()` returns, and the key it is registered under.
Registering two constructors with the same id replaces one with the other rather
than adding both.

Note what is *not* here. There is no `onExit` putting the cursor back and no
cleanup of any kind — the click either finishes the whole gesture or does
nothing, so there is nothing to unwind. `NoteTool` and `TextTool` are this tool
with a different `createShape` call.

---

## 3. What a handler is handed

Handlers are optional methods on `StateNode`. Implement the ones you need:

| Hook | Info type |
| --- | --- |
| `onEnter(info, from)` / `onExit(info, to)` | `Record<string, unknown>`, plus the sibling's id |
| `onPointerDown` / `onPointerMove` / `onPointerUp` | `PointerEventInfo` |
| `onRightClick` / `onMiddleClick` | `PointerEventInfo` |
| `onDoubleClick` | `ClickEventInfo` |
| `onKeyDown` / `onKeyUp` / `onKeyRepeat` | `KeyboardEventInfo` |
| `onWheel` | `WheelEventInfo` |
| `onCancel` / `onComplete` / `onInterrupt` | `CancelEventInfo` / `CompleteEventInfo` / `InterruptEventInfo` |
| `onTick` | `TickEventInfo` |

Every info object carries `shiftKey`, `altKey`, `ctrlKey`, `metaKey` and
`accelKey` — the last being the platform accelerator, `meta` on Apple and `ctrl`
elsewhere, so you never have to test the platform yourself.

`PointerEventInfo` adds `point` (viewport space), `pointerId`, `button`, `isPen`
and a discriminated `target`: `{ target: "canvas" }`, `{ target: "shape"; shape }`,
`{ target: "selection"; handle? }` or `{ target: "handle"; shape; handle }`. Test
`info.button !== 0` early — the middle button is already spoken for (the editor
pans with it whatever tool is selected) and the right button belongs to the
context menu.

Two hooks are worth knowing about before you reach for them. `onDoubleClick` is
the only multi-click the editor reports; triple and quadruple click were removed
because they were never distinguishable from a fast double click on a trackpad.
And `onTick` only fires if something dispatches a tick event into the tree —
nothing in the editor or the default canvas does. For per-frame work use
`editor.on("tick", (elapsed) => …)` instead, which the canvas's render loop does
emit.

---

## 4. Reading the pointer

`editor.inputs` is live pointer and modifier state, updated by the dispatch loop
*before* your handler runs. The fields a creation gesture actually needs:

| Field | Meaning |
| --- | --- |
| `originPagePoint` | Page-space point the gesture started at |
| `currentPagePoint` | Page-space pointer position now |
| `previousPagePoint` | Where it was at the previous event |
| `isDragging` | `true` once the pointer passed the drag threshold |
| `isPointing` | A pointer button is down |
| `shiftKey`, `altKey`, `ctrlKey`, `metaKey`, `accelKey` | Modifiers |
| `isPen` | The active pointer is a pen |

The `*ScreenPoint` twins are in **viewport** space — container-relative pixels,
which is the space canvas events arrive in — not window space. Use
`editor.pageToScreen(...)` if you need a window-relative point.

Every field also has a `get…()` accessor over the same storage:
`inputs.getCurrentPagePoint()` and `inputs.currentPagePoint` are the same value.
The accessors exist so the state can move behind a signal later without every
call site changing, so prefer them in new code. The built-in tools destructure
the fields directly, which is why the examples here do too.

One sharp edge: **`isDragging` is already cleared by the time `onPointerUp`
arrives.** A state that needs to know whether the gesture was a drag has to
remember it, which is what `ArrowTool` does with a private `dragged` flag. The
three-state machine below dodges the problem — being in `dragging` at all *is*
the flag.

---

## 5. Three states

The built-in tools use two states, `idle` and `pointing`, and let `pointing`
handle both outcomes by asking `isDragging` on every move. That is one fewer
state to keep in sync, and it is why `BaseBoxShapeTool` looks the way it does.
Three states — `idle`, `pointing`, `dragging` — cost one more `transition` and
buy back something worth having: each state has one job, and neither gesture
state has to ask what kind of gesture it is in.

| State | Holds | Leaves on |
| --- | --- | --- |
| `idle` | Nothing. Sets the cursor. | Pointer down with button 0 → `pointing` |
| `pointing` | Nothing yet — a press that ends here is a *click* | Drag threshold → `dragging`; pointer up → place and finish |
| `dragging` | The shape id and the history mark | Pointer up or complete → finish; cancel → bail to mark |

The hop between them is the whole of `pointing`'s move handler:

```ts
override onPointerMove(): void {
  if (this.editor.inputs.isDragging) this.parent!.transition("dragging")
}
```

Creating nothing until the drag starts is what makes the two endings different.
A click places a default-sized card **centred on the point**, which reads as
dropping a stamp; a drag creates at the origin and sizes to the pointer, which
reads as drawing a rectangle. `GeoTool` and `BaseBoxShapeTool` both take the same
care, in one state instead of two.

`setCurrentTool` reaches the same `onEnter` channel from outside the tree:
`editor.setCurrentTool("geo", { geo: "ellipse" })` lands in `GeoTool.onEnter`,
which reads `info["geo"]`. Anything you can put in a plain object, a tool can be
entered with.

---

## 6. Cancelling and completing

Three editor methods dispatch an event with no pointer behind it:

- `editor.cancel()` — abandon the gesture. The root state already calls this on
  Escape, provided nothing is being edited.
- `editor.complete()` — finish the gesture where it stands.
- `editor.interrupt()` — the gesture lost its pointer: the window blurred, a
  dialog took over.

Only `cancel` has a caller inside the editor. `complete` and `interrupt` exist
for a host that can detect something the canvas cannot, and are worth handling
even though nothing in mocanvas dispatches them today. All three reach your tool
as `onCancel`, `onComplete` and `onInterrupt`. Two rules make them behave:

**Mark before the first mutation, bail to the mark on cancel.**
`markHistoryStoppingPoint(name)` returns a mark id; `bailToMark(id)` rolls the
document back to it. Together they make the whole creation gesture one undo step
and make Escape leave nothing behind. `ArrowTool` uses the same pair for a second
purpose — an arrow shorter than four page units bails on pointer *up*, so a
mis-click never leaves a zero-length arrow with live bindings.

**Treat `onComplete` as a pointer up.** In practice that is one line delegating
to whatever `onPointerUp` does. A state that ignores it can be left running by a
host that completes gestures.

Handle Escape in `onCancel`, not in `onKeyDown`. The root state turns Escape into
a cancel event and dispatches it *from inside* the keydown, so a tool that also
watched `onKeyDown` for `"Escape"` would see its own `onCancel` run first and
then get a keydown for a gesture that no longer exists.

---

## 7. Tool lock

Tool lock is a single boolean on the instance record,
`editor.getInstanceState().isToolLocked`, toggled by the padlock at the end of
the toolbar and by `Q`. It means: after this tool finishes one thing, stay armed
for the next instead of falling back to select.

Nothing enforces it. Each tool reads it and decides, which is the one piece of
etiquette a creation tool has to get right:

```ts
function returnToIdle(node: StateNode): void {
  const editor = node.editor
  const locked = editor.getInstanceState().isToolLocked
  node.parent!.transition("idle")
  if (!locked) editor.setCurrentTool("select")
}
```

Transition to `idle` *first*, then switch tools; the other order leaves the tool
you just left holding a stale current state. A tool with no "finished" moment —
select, hand — simply never reads the flag, and the toolbar hides the padlock for
those.

---

## 8. Cursors

The cursor lives on the instance record too. `setCursor` merges over the current
value and skips the write when nothing changed:

```ts
this.editor.setCursor({ type: "cross" })
```

The built-in tools spell it out as
`updateInstanceState({ cursor: { type: "cross", rotation: 0 } })`, which is the
same thing with more punctuation. The canvas maps seven names to CSS —
`default`, `cross` (`crosshair`), `grab`, `grabbing`, `move`, `pointer`, `text` —
and passes anything else through as a raw CSS cursor value, so
`setCursor({ type: "ns-resize" })` works and `setCursor({ type: "nonsense" })`
silently renders as nothing.

Two things to know:

- **Nothing resets it for you.** The convention every built-in tool follows is
  that each tool's idle state sets its cursor in `onEnter`, and the select tool's
  idle sets `default`. A tool whose idle state sets no cursor inherits whatever
  the previous tool left.
- **`rotation` is ignored locally.** The canvas reads only `type`. `rotation` is
  carried into presence, so collaborators see your cursor at the angle you set —
  it is not dead, just not visible to you.

---

## 9. Registering the tool

`tools` on `<Mocanvas />` is **additive**: it is appended to the built-in
`defaultTools`, so do not re-list the built-ins.

```tsx
import { Mocanvas } from "@mocanvas/mocanvas"
import { CardTool } from "./CardTool"

export function App() {
  return <Mocanvas tools={[CardTool]} />
}
```

`initialState` picks which tool the editor starts in; without it the editor
starts in whichever tool leads the list, which for the defaults is `select`.

For a *smaller* tool set, build the list yourself from the exported pieces —
`defaultTools` is everything, `defaultShapeTools` is only the tools that place a
shape — and hand the result to a bare `Editor`. Naming a constructor twice is
harmless, since registration is by `id`.

`editor.removeTool(id)` takes a tool out of service at runtime without rebuilding
the editor: the node stays in the tree, but it stops being selectable and an
editor sitting in it is moved to the first remaining tool. That is the supported
way to disable drawing in a review mode. `editor.hasTool(id)` asks whether one is
still in service.

---

## 10. A toolbar button and a shortcut

The chrome renders from a *data* list, not from a hard-coded set of buttons.
`TLUiOverrides.tools` rewrites that list, and everything downstream follows.

```tsx
const overrides: TLUiOverrides = {
  tools(editor, tools) {
    tools["card"] = {
      id: "card",
      label: "Card",
      icon: "geo-rectangle",
      kbd: "c",
      onSelect: () => void editor.setCurrentTool("card"),
    }
    return tools
  },
}
```

That is the whole of it, because of three things the default chrome already
does:

- The toolbar collects any item whose id is not part of its own layout and
  renders it after a divider, so a tool added this way gets a place rather than
  being silently dropped.
- An icon name the set does not have falls back to the label's first letter, so
  your tool gets a pressable, labelled button without shipping artwork into
  mocanvas. `geo-rectangle` above is a real name; `"card"` would render a `C`.
- `kbd` is bound by the tool-shortcut hook the default UI mounts. Only plain
  single-key bindings are handled there — anything with a `+` belongs to the
  action shortcuts, and binding it in both places would fire it twice.
  Comma-separated alternatives let one tool answer to several keys (`"c,k"`); the
  first declaration of a key wins, so a later item cannot steal a key an earlier
  one already answers to.

`label` is display text, not a string id — mocanvas ships no strings of its own,
so localise it yourself. (`overrides.translations` and `helpers.msg` exist for
apps whose own chrome wants one dictionary.)

Two smaller notes. `readonlyOk: true` keeps a shortcut live on a read-only
editor; leave it off for anything that writes. And re-selecting the tool you are
already in is a no-op — `setCurrentTool` returns early — so a tool that carries an
argument, the way the geo items carry a kind, has to pass `{ force: true }` to
re-enter.

There is one `overrides` slot. An app composing two of them chains them itself,
inner first, because an override that adds a shortcut to a tool the inner one
registers has to run second.

For an editor with no default chrome, drive the tool from your own component with
`useEditor()` and `track()` — see [CUSTOM_SHAPES.md](CUSTOM_SHAPES.md) §9 — or
replace the `Toolbar` slot through `components`, which [UI.md](UI.md) covers.

---

## 11. `BaseBoxShapeTool`

If your tool drags out a box shape — anything with `w` and `h` props — the state
chart above already exists as a base class, and subclassing it is four lines:

```ts
import { BaseBoxShapeTool } from "@mocanvas/mocanvas"

class SectionTool extends BaseBoxShapeTool {
  static override id = "section"
  static override initial = "idle"
  override shapeType = "section"
}
```

It gives you drag-to-size with Shift-to-square, click-to-place centred on the
point, the history mark and the cancel, and tool lock. Three hooks customise it:
`minSize` (the smallest a drag may produce), `getDefaultSize()` (what a click
places, defaulting to the shape util's own `getDefaultProps()` so the tool and a
programmatic `createShape` agree on what "a new one" means), and
`getCreateProps()` (props to seed the shape with, for identity decided at
placement time — a frame's `Frame 3`).

`onCreate(shape)` runs once the shape is final. Its default implementation *is*
the tool-lock behaviour, so an override replaces that too and has to repeat
whichever ending it wants. `FrameTool` is the worked example: it adopts the
shapes the new frame encloses, then repeats the lock check.

Write the machine by hand when the gesture is not a box — a freehand stroke, an
arrow with a bound end, a marquee that creates nothing.

---

## 12. Declared but inert

Three members of the tool API exist on the type but are read by nothing in the
editor. They are listed here so you do not spend an afternoon wondering why
setting them changed nothing.

- **`static isLockable`**, and the `isLockableTool` getter over it. Declared on
  `StateNode`, defaulting to `true`, and never consulted. Tool lock is read by
  each tool from `getInstanceState().isToolLocked`, as in §7; the toolbar hides
  its padlock from a hard-coded list of tool ids, not from this flag.
- **`static useCoalescedEvents`**. Declared, never consulted. Pointer events are
  not coalesced.
- **`shapeType`**. A real field, but only `BaseBoxShapeTool` reads it, from its
  own subclass. On a hand-written tool it is documentation for your own code.

`setCurrentToolIdMask` is likewise a stub with an empty body, reserved for a tool
that wants to report an id other than its own.

---

## 13. The whole file

```ts
import {
  createShapeId,
  StateNode,
  type Editor,
  type PointerEventInfo,
  type ShapeId,
  type StateNodeConstructor,
} from "@mocanvas/editor"

/** What a click, as opposed to a drag, places. */
const DEFAULT_CARD = { w: 260, h: 160 }
/** Smallest card a drag may produce, in page units. */
const MIN_CARD = 16

/** One card, with the look that makes it a card rather than a bare rectangle. */
function createCard(editor: Editor, x: number, y: number, w: number, h: number): ShapeId {
  const id = createShapeId()
  editor.createShape({
    id,
    type: "geo",
    x,
    y,
    props: { geo: "rectangle", fill: "semi", color: "blue", dash: "solid", w, h },
  })
  editor.select(id)
  return id
}

/**
 * Back to idle, and back to select unless tool lock says to stay armed. Idle
 * first: switching tools before the transition leaves this tool holding a stale
 * current state.
 */
function returnToIdle(node: StateNode): void {
  const editor = node.editor
  const locked = editor.getInstanceState().isToolLocked
  node.parent!.transition("idle")
  if (!locked) editor.setCurrentTool("select")
}

class Idle extends StateNode {
  static override id = "idle"

  override onEnter(): void {
    this.editor.setCursor({ type: "cross" })
  }

  override onPointerDown(info: PointerEventInfo): void {
    if (info.button === 0) this.parent!.transition("pointing", info)
  }

  override onCancel(): void {
    this.editor.setCurrentTool("select")
  }
}

/**
 * Button down, not yet a drag. Nothing is created here: a press that ends in
 * this state is a click, and a click places a default-sized card CENTRED on the
 * point — dropping a stamp, not starting a rectangle at the cursor.
 */
class Pointing extends StateNode {
  static override id = "pointing"

  override onPointerMove(): void {
    if (this.editor.inputs.isDragging) this.parent!.transition("dragging")
  }

  override onPointerUp(): void {
    this.place()
  }

  override onComplete(): void {
    this.place()
  }

  override onCancel(): void {
    this.parent!.transition("idle")
  }

  private place(): void {
    const editor = this.editor
    const { originPagePoint } = editor.inputs
    editor.markHistoryStoppingPoint("create card")
    const { w, h } = DEFAULT_CARD
    createCard(editor, originPagePoint.x - w / 2, originPagePoint.y - h / 2, w, h)
    returnToIdle(this)
  }
}

/** Past the drag threshold: the card exists and follows the pointer. */
class Dragging extends StateNode {
  static override id = "dragging"
  private shapeId: ShapeId | null = null
  private markId = ""

  override onEnter(): void {
    const editor = this.editor
    // One undo entry for the whole gesture, and the point Escape rolls back to.
    this.markId = editor.markHistoryStoppingPoint("create card")
    const { originPagePoint } = editor.inputs
    this.shapeId = createCard(editor, originPagePoint.x, originPagePoint.y, MIN_CARD, MIN_CARD)
    this.resize()
  }

  override onPointerMove(): void {
    this.resize()
  }

  override onPointerUp(): void {
    this.finish()
  }

  override onComplete(): void {
    this.finish()
  }

  override onCancel(): void {
    if (this.markId) this.editor.bailToMark(this.markId)
    this.shapeId = null
    this.parent!.transition("idle")
  }

  private resize(): void {
    const editor = this.editor
    const id = this.shapeId
    if (!id) return
    const shape = editor.getShape(id)
    if (!shape) return
    const { originPagePoint, currentPagePoint, shiftKey } = editor.inputs
    let w = currentPagePoint.x - originPagePoint.x
    let h = currentPagePoint.y - originPagePoint.y
    if (shiftKey) {
      const m = Math.max(Math.abs(w), Math.abs(h))
      w = Math.sign(w || 1) * m
      h = Math.sign(h || 1) * m
    }
    // Dragging up or left moves the origin instead of producing a negative box.
    let x = originPagePoint.x
    let y = originPagePoint.y
    if (w < 0) x += w
    if (h < 0) y += h
    editor.updateShape({
      id: shape.id,
      type: "geo",
      x,
      y,
      props: { w: Math.max(MIN_CARD, Math.abs(w)), h: Math.max(MIN_CARD, Math.abs(h)) },
    })
  }

  private finish(): void {
    this.shapeId = null
    returnToIdle(this)
  }
}

/** Drag out a card, or click to place a default-sized one. */
export class CardTool extends StateNode {
  static override id = "card"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [Idle, Pointing, Dragging]
  override shapeType = "geo"
}
```

And the mount:

```tsx
import { Mocanvas, type TLUiOverrides } from "@mocanvas/mocanvas"
import "@mocanvas/mocanvas/mocanvas.css"
import { CardTool } from "./CardTool"

const overrides: TLUiOverrides = {
  tools(editor, tools) {
    tools["card"] = {
      id: "card",
      label: "Card",
      icon: "geo-rectangle",
      kbd: "c",
      onSelect: () => void editor.setCurrentTool("card"),
    }
    return tools
  },
}

export function App() {
  return <Mocanvas tools={[CardTool]} overrides={overrides} />
}
```

---

See also: [CUSTOM_SHAPES.md](CUSTOM_SHAPES.md) for the shape a tool creates,
[UI.md](UI.md) for the chrome the toolbar button lands in, and
[ARCHITECTURE.md](ARCHITECTURE.md) for where the dispatch loop sits.
