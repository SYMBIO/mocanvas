# Multiplayer

How two or more people end up on one document with `@mocanvas/sync`. By the end
you will know which records travel and which stay put, how to hand the client a
channel (including one that joins two browser tabs with no server at all), what
presence carries and how often, and exactly what the merge does and does not
promise when two edits race.

Everything here is public API from `@mocanvas/sync`, `@mocanvas/editor` and
`@mocanvas/store`. [ARCHITECTURE.md](ARCHITECTURE.md) explains the store and the
rendering split underneath it; [CUSTOM_SHAPES.md](CUSTOM_SHAPES.md) covers
writing the records this document is made of.

Contents:

1. [What travels, and what does not](#1-what-travels-and-what-does-not)
2. [Wiring a client to a transport](#2-wiring-a-client-to-a-transport)
3. [Presence: cursors, camera, selection](#3-presence-cursors-camera-selection)
4. [What the merge guarantees](#4-what-the-merge-guarantees)
5. [What a server has to do](#5-what-a-server-has-to-do)
6. [Things that bite](#6-things-that-bite)

---

## 1. What travels, and what does not

Every record type in the store declares a **scope**, one of three
(`RecordScope` in `@mocanvas/store`):

| Scope | Record types | Persisted to `.tldr` | Sent to peers |
| --- | --- | --- | --- |
| `document` | `document`, `page`, `shape`, `binding`, `asset`, comments | yes | yes, as stamped diffs |
| `session` | `camera`, `instance`, `instance_page_state`, `pointer` | no | no |
| `presence` | `instance_presence`, `user` | no | yes, as whole records |

A custom record declares its own scope (`CustomRecordInfo.scope`), so it travels
or does not by the same rule.

The sync client only ever listens to one scope:

```ts
store.listen(handler, { source: "user", scope: "document" })
```

That single filter does two jobs. `scope: "document"` keeps your camera, your
selection highlight and your hover state off the wire entirely — they are
`session` records, and nobody else's editor should be moved by your scroll
wheel. `source: "user"` keeps changes you applied *from* a peer from going
straight back out again; see §6. The snapshot a joiner receives is
`store.serialize("document")`, so it carries the same set.

### Why a cursor is not in the document

A cursor moves about thirty times a second. Put it in a `document` record and
every one of those moves becomes a history entry you can undo, a field the CRDT
has to stamp, a byte in the saved file, and a tombstone when the person leaves.
So presence is a record type of its own, `instance_presence`, in the `presence`
scope: never written to a `.tldr` file, never in the undo stack (the editor's
history manager listens with `{ source: "user", scope: "document" }` too), never
stamped or merged. It travels as a `presence` message holding one whole record,
the newest replaces the last by id, and a peer unheard from for ten seconds is
dropped.

`session` records sit at the other extreme: yours, unsaved, unshared. A camera
is the clearest case — sharing it would mean two people fighting over one
viewport. What you want instead is *following*, which is a `presence` field
(`followingUserId`) plus `editor.startFollowingUser(userId)`, not a shared
camera record.

---

## 2. Wiring a client to a transport

### The contract

A transport is a duplex channel carrying `SyncMessage`s for one room. It owns
serialisation and reconnection; the client above it only sees decoded messages.

```ts
interface Transport<R extends UnknownRecord = UnknownRecord> {
  send(message: SyncMessage<R>): void
  onMessage(callback: (message: SyncMessage<R>) => void): () => void
  onOpen?(callback: () => void): () => void
  onClose?(callback: () => void): () => void
  close(): void
}
```

`onOpen` fires every time the channel becomes usable, including after a
reconnect; `onClose` every time it stops being. Both are optional, and a
transport with neither is treated as open the moment it is connected. Anything
satisfying this interface works — a WebSocket, a `BroadcastChannel`, a WebRTC
data channel, a shared worker, a mock in a test.

There are five messages, all JSON: `hello` (I joined), `snapshot` (the document
records plus the sender's stamps), `diff` (one squashed store diff, stamped
field by field), `presence`, `bye`. `encodeMessage` stamps
`version: PROTOCOL_VERSION` (3) onto every one and `decodeMessage` checks it,
returning `null` for anything malformed and a synthetic
`{ type: "unsupported", version }` for a peer on another protocol — reported
through `onError` rather than half-parsed.

### The client

```ts
import { createSyncClient, createBroadcastChannelTransport } from "@mocanvas/sync"
import type { EditorRecord } from "@mocanvas/editor"

const client = createSyncClient<EditorRecord>({
  store: editor.store,
  roomId: "my-doc",
  transport: createBroadcastChannelTransport<EditorRecord>("my-doc"),
  presence: { editor },
})

client.connect()
```

`client.getStatus()` returns a signal of `"offline" | "connecting" | "online"`,
readable from a reactor or with `useValue`. `disconnect()` sends `bye` and stops
listening; `dispose()` disconnects and closes the transport.

In React, `useSync` does the whole lifecycle for as long as the component is
mounted:

```tsx
import { CollaboratorCursors, createBroadcastChannelTransport, useSync } from "@mocanvas/sync"

const { status } = useSync(editor, {
  roomId,
  transport: () => createBroadcastChannelTransport(roomId),
})

// inside <Mocanvas onMount={setEditor}>:
{editor ? <CollaboratorCursors editor={editor} /> : null}
```

Pass a **factory**, not a transport: it is called once per connection, so a
transport is never reused across a reconnect or a room change. `enabled: false`
keeps the editor offline (a read-only view, say).

### A BroadcastChannel, with no server at all

`createBroadcastChannelTransport(roomId, { prefix })` is shipped, and it is the
whole of the multiplayer demo on the website: two tabs of one browser, one
origin, nothing deployed and nothing to keep running. Written out, it is small
enough to read:

```ts
import { decodeMessage, encodeMessage, type SyncMessage, type Transport } from "@mocanvas/sync"
import type { EditorRecord } from "@mocanvas/editor"

export function createTabTransport(roomId: string): Transport<EditorRecord> {
  const channel = new BroadcastChannel(`my-app:${roomId}`)
  const listeners = new Set<(message: SyncMessage<EditorRecord>) => void>()
  let closed = false

  channel.onmessage = (event: MessageEvent) => {
    const message = decodeMessage<EditorRecord>(event.data)
    if (!message) return
    for (const listener of Array.from(listeners)) listener(message)
  }

  return {
    send(message) {
      if (!closed) channel.postMessage(encodeMessage(message))
    },
    onMessage(callback) {
      listeners.add(callback)
      return () => void listeners.delete(callback)
    },
    onOpen(callback) {
      // Usable already — but hand control back first, so that connect() has
      // finished subscribing before the hello goes out.
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled && !closed) callback()
      })
      return () => void (cancelled = true)
    },
    close() {
      closed = true
      listeners.clear()
      channel.onmessage = null
      channel.close()
    },
  }
}
```

Two details are doing real work. The `queueMicrotask` in `onOpen` is not
decoration: `connect()` subscribes to messages and *then* to opens, and a
callback that fires synchronously would send `hello` before anything was
listening for the answer. And `BroadcastChannel` never delivers to the context
that posted, which is why there is no self-filter here — over a relay that
echoes, the client's own `clientId` check on `diff` and `presence` messages is
what saves you.

Two tabs joining the same room also need to be looking at the same page. A blank
document's first page has a fixed id (`DEFAULT_PAGE_ID`), so two editors that
each built their own store meet there by default. If one of them pins or loads a
page of its own, everything reports `online`, every message arrives, and nothing
is drawn — so the client says so once, in development, rather than leaving you
hunting a transport bug that is not there.

Tabs are *not* deduplicated by person: presence is published under
`editor.getInstancePresenceId()`, which is per editor instance, so two tabs of
one browser are two collaborators and see each other. You do not need to invent
a fake per-tab identity.

---

## 3. Presence: cursors, camera, selection

`presence: { editor }` turns on a `PresenceSync`, which builds one
`InstancePresence` record from the editor and pushes it out. It carries:

`cursor` from `editor.inputs.currentPagePoint` and the cursor type and rotation
on `getInstanceState()`; `camera` from `editor.getCamera()`; `selectedShapeIds`,
`currentPageId`, `brush`, `scribbles` and `followingUserId` from the editor's
own getters; `userId`, `userName` and `color` from `editor.user`; and
`lastActivityTimestamp`, which is `Date.now()` on the sender.

The cursor point is in page space; `CollaboratorCursors` converts it with
`editor.pageToViewport` when it draws. The camera is there so that somebody can
*follow* you, not so that your scrolling moves their viewport.

### The rate

| Constant | Default | Meaning |
| --- | --- | --- |
| `DEFAULT_PRESENCE_THROTTLE_MS` | 34 ms (~30 Hz) | upper bound on the send rate |
| `DEFAULT_PRESENCE_HEARTBEAT_MS` | 3000 ms | re-send even when nothing changed |
| `DEFAULT_PRESENCE_TIMEOUT_MS` | 10 000 ms | drop a peer we have not heard from |

Camera, page, selection and instance state are signals, so a reactor covers
them; the pointer is not, so the editor's `event` is sampled as well. Both only
*ask* for a send. The request is collapsed into the throttle window, and when it
fires the record is compared with the last one sent (`isSamePresence`, which
ignores `lastActivityTimestamp`): unchanged means nothing goes out. So a still
pointer costs one message every three seconds, not thirty a second.

Three things force a send regardless: starting, the heartbeat, and a `hello`
from a newcomer. That last one is a re-announcement — what changed is who is
listening, not the record — and without it somebody who has been sitting still
stays invisible to a joiner until the next heartbeat.

Override any of it per client: `presenceThrottleMs`, `presenceHeartbeatMs`,
`presenceTimeoutMs` on `createSyncClient` (`useSync` exposes the throttle and the
timeout).

### Reading the room

```ts
editor.getCollaborators()                                // everyone else, however stale
editor.getCollaboratorsOnCurrentPage()                   // …narrowed to this page
editor.collaborators.getVisibleCollaboratorsOnCurrentPage() // …and actually here
editor.collaborators.isCollaboratorIdle(presence)        // present, but not doing anything
```

Draw from the *visible* list: a tab left open overnight keeps writing presence
long after the person went home. `collaboratorInactiveTimeoutMs` (60 s) decides
who is still there, `collaboratorIdleTimeoutMs` (3 s) who is merely idle —
dimmed, not removed. The flip side is that a long-running participant which is
not a human, such as an agent working through a tool call, must keep its
`lastActivityTimestamp` fresh or it will vanish mid-turn.

---

## 4. What the merge guarantees

The merge lives in `packages/sync/src/crdt.ts`; this is what it actually does.

**Every leaf field of every record is its own last-writer-wins register**, keyed
by a dotted path: `x`, `props.w`, `meta.notes.title`. A local change carries one
Lamport stamp, `{ lamport, client }`. A field is overwritten only when the
incoming stamp is greater than the one held for that exact path, and equal
Lamport values are broken by comparing client ids — so the order is total and
both sides of a race reach the same answer.

A stamp covers a **subtree**, not just a leaf. Writing `meta` — setting it, or
deleting the key — dominates `meta.a`, and a write that drops a subtree keeps
descendants stamped later than itself. Treating `meta` and `meta.a` as unrelated
registers is exactly how "delete the key" racing "edit its child" lands
differently on each replica.

That gives two properties, and they are the whole guarantee:

- **Idempotent** — the same message twice changes nothing the second time.
- **Commutative** — per path the result is the maximum stamp, and a maximum does
  not care about arrival order.

Together: replicas converge however the transport reorders, duplicates or drops
messages, as long as everything is eventually delivered. `src/fuzz.test.ts` is
the evidence — random schedules of creates, nested edits, deletes, re-creates,
reordering, duplication, drops, disconnects, reconnects and snapshot joins over
an in-memory network, then a demand that every replica's document be identical
under a key-sorted serialisation.

In practice: two people editing **different fields of one shape** — one moves
it, one recolours it — keep both edits; two people editing the **same** field
pick the same winner everywhere; **creating** the same record id on two peers
merges field by field, like an edit. **Deleting** leaves a stamped tombstone, so
a late message cannot resurrect the record — a delete beats a concurrent edit
only when its stamp is greater, and an edit that outranks the delete keeps the
record alive, re-claimed whole under a fresh stamp so that every replica agrees
on which body survived. Work done while **disconnected** survives: local changes
are stamped by the store listener, which is wired from construction until
`dispose()`, so an edit made before `connect()` or after `disconnect()` is
stamped when it happens and merged on the next connection.

### What it does not cover

Field-level and order-independent is a real guarantee, and it is not the same as
"nothing is ever lost". These limits are structural, not bugs waiting on a fix:

- **Two writes to one field cannot both survive.** The register holds one value;
  the greater stamp takes it and the other is gone.
- **Arrays are opaque.** `props.points`, `selectedShapeIds` and every other array
  is *one* register holding the whole array. Two concurrent edits to one array
  pick a winner rather than merging. Per-element registers would need element
  identity, which record data does not carry.
- **The fractional `index` is one register too**, so a concurrent reorder of the
  same shape lands on one of the two orders deterministically. Reordering
  *different* shapes is fine — different records.
- **No text merge.** Two people typing into one text field pick a winner rather
  than interleaving characters. There is no operational transform and no
  character-level CRDT here.
- **Tombstones are bounded**: one hour, 5000 of them, oldest first
  (`tombstoneMaxAgeMs`, `tombstoneLimit`). That bound is a statement about how
  long a peer may be partitioned. Within it, deletes are safe against
  arbitrarily late messages; past it, a straggler's edit resurrects the record.
- **A replica that has never connected starts its clock at zero.** Its offline
  edits are real writes and its own new records always survive, but an edit to a
  field the room has written several times can sort below what is already there.
  One that has been in the room and comes back has observed the room's clock and
  does not have this problem.
- **A body that arrives without its stamps can be stale.** A put claims stamps
  only for the paths it touches, so a replica that missed a record's creation
  and then sees an edit to one field adopts the rest of that body without
  provenance. The next snapshot exchange repairs it, and every `hello`,
  `connect` and reconnect triggers one.

---

## 5. What a server has to do

Two tabs need no server. More than two, or two on different machines, need
something in the middle — and the minimum is genuinely small.

### Relay diffs

The relay forwards every message it receives on a socket to the other sockets in
the same room, verbatim. It keeps no document state at all: peers hand each
other the document with the `hello`/`snapshot` exchange, so restarting the relay
is harmless. `packages/sync/scripts/relay.mjs` is that, in about fifty lines; the
room is the URL path.

```sh
pnpm --filter @mocanvas/sync relay        # ws://localhost:5858/<room>
```

```ts
createWebSocketTransport(`ws://localhost:5858/${roomId}`, { reconnect: true })
```

`createWebSocketTransport` reconnects with exponential backoff and full jitter,
so a relay restart does not get a thundering herd from every open tab. Messages
sent while the socket is down are dropped rather than queued — the next
`hello`/`snapshot` re-establishes the document anyway, and presence is re-sent
on the heartbeat. The script ships in the package but `ws` does not: it is a
devDependency, because the relay is a development tool rather than part of the
client. Install `ws` yourself to run it elsewhere.

### Keep the authoritative document

A pure relay means the document lives only in the connected peers. When the last
one leaves, nothing holds it. If you want a copy that outlives the room, the
cheapest correct answer is to run **an ordinary peer on the server**: a store, a
sync client, and no presence.

```ts
import { createStore, type EditorRecord } from "@mocanvas/editor"
import { createSyncClient } from "@mocanvas/sync"

const store = createStore()
createSyncClient<EditorRecord>({ store, roomId, transport }).connect()

const snapshot = store.getStoreSnapshot("document") // persist this
```

It merges like everyone else, and `store.loadStoreSnapshot(snapshot)` brings it
back after a restart. Nothing on the wire privileges it: "authoritative" here
means "the peer that is always in the room", not a different role.

### Where `mergeRemoteChanges` fits

Inside the client, and you normally never call it. When a `diff` arrives, the
client asks the CRDT which fields won and applies only those:

```ts
store.mergeRemoteChanges(() => store.applyDiff(winningFields))
```

`mergeRemoteChanges` marks everything done inside it `source: "remote"`, which
is what stops the applied change from entering the local undo stack and from
being picked up by the outgoing listener and broadcast straight back.

If you are writing your own merging peer rather than using `createSyncClient` —
a server that wants the records without the client's lifecycle, say — that pair
is the whole shape of it: `createCrdt({ clientId, getRecord })`, then
`crdt.mergeRemote(diff)` for the winning fields, then
`store.mergeRemoteChanges(() => store.applyDiff(...))` to apply them. Anything
you write to the store *outside* `mergeRemoteChanges` counts as a local user
edit and will be stamped and broadcast.

---

## 6. Things that bite

### Echoing your own changes back

Two guards stop the obvious loop. Outgoing changes come from
`store.listen(cb, { source: "user", scope: "document" })`, and incoming ones are
applied inside `mergeRemoteChanges`, which reports them as `remote` — so they
never reach that listener. On top of that the client ignores `diff` and
`presence` messages carrying its own `clientId`, which matters on any transport
that echoes to the sender.

You meet the loop by writing to the store yourself on behalf of a peer —
restoring from your own persistence layer, or applying a message from a channel
of your own. Wrap it:

```ts
store.mergeRemoteChanges(() => store.applyDiff(diff))
```

Without the wrapper the change goes out as though you had drawn it, the peer
merges it and rewrites, and you have a round trip per edit.

### Undo across clients

Undo is local, and it is not a retraction. The history manager listens with
`{ source: "user", scope: "document" }`, so nothing a peer did ever enters your
stack — you cannot undo somebody else's work, which is what you want.

What surprises people is the other direction. `editor.undo()` applies the
reverse diff as an ordinary local change, so it is stamped with a *new*, greater
stamp and broadcast like any edit. Undo therefore means "write the old value
back, now", not "remove my edit from history everywhere". So undoing a move
after a peer has moved the same shape wins, because your stamp is newer — that
is a later write, not a merge conflict; and undoing a *create* deletes the
record for everyone, unless a peer's edit to it outranks the tombstone.

### Applying a remote change inside a side effect

Every side-effect handler is given the change source as its last argument:

```ts
editor.sideEffects.registerAfterChangeHandler("shape", (prev, next, source) => {
  if (source !== "user") return
  // …runs once, on the replica where the person actually did it
})
```

A handler that does not check `source` runs on every replica, for every merged
change. Sometimes that is right — a validator clamping a value should clamp
everywhere. Sometimes it is a duplicated side effect, a second network call, or
a second record created per peer.

The client copes with the honest case. It compares what it asked the store to do
with what the store actually did, and any difference — a validator rewriting a
merged record, a side effect touching another one — is stamped as a local write
and broadcast; otherwise that rewrite would exist on one replica only, since
changes made inside `mergeRemoteChanges` never leave. A rewrite that is a
function of the record and the document then settles in one round: the peers
apply a value they already hold and produce nothing further.

A side effect that is **not** a function of its inputs — one that reads the wall
clock, a random number, or per-user state — has no fixed point. It rewrites
differently on each replica, each rewrite is broadcast, and the replicas chase
each other. No design converges on that. Keep non-deterministic work out of side
effects on `document`-scope records, or gate it on `source === "user"`.

### A peer on another protocol version

A version 2 peer merges the same messages to a different answer, so the two must
not share a room. Such a message is reported once through `onError`; surface it
rather than swallowing it, because the symptom otherwise is a room where
everything looks connected and nothing arrives.
