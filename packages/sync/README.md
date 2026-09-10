# @mocanvas/sync

Multiplayer for a mocanvas store: document changes travel as record diffs,
cursors and selections travel as presence records. Conflicting edits are merged
field by field by a small CRDT (`src/crdt.ts`), so two people editing different
properties of one shape both keep their work and every replica converges.

Part of mocanvas; the canvas itself is `@mocanvas/mocanvas`.

## Install

```bash
npm install @mocanvas/sync react
```

`react` (>= 18) is a peer dependency, used by `useSync` and
`<CollaboratorCursors />`.

## Quick start

```ts
import { createSyncClient, createBroadcastChannelTransport } from "@mocanvas/sync"

const client = createSyncClient({
  store: editor.store,
  roomId: "my-doc",
  transport: createBroadcastChannelTransport("my-doc"),
  presence: { editor },
})
client.connect()
```

`getStatus()` returns a signal holding `"offline" | "connecting" | "online"`,
so it can be read from a reactor or with `useValue`. `dispose()` disconnects
and closes the transport.

## Integration

Three lines in an app that already renders `<Mocanvas>`:

```tsx
const { status } = useSync(editor, { roomId, transport: () => createBroadcastChannelTransport(roomId) })
// ...inside <Mocanvas onMount={setEditor}>:
{editor ? <CollaboratorCursors editor={editor} /> : null}
```

`CollaboratorCursors` draws every other person's pointer, name chip and
selection outlines in screen space. It positions itself absolutely, so it goes
anywhere inside the canvas container.

## Protocol

Every message is one JSON object on the wire.

| message    | fields                       | meaning                                              |
| ---------- | ---------------------------- | ---------------------------------------------------- |
| `hello`    | `clientId`, `version`        | I joined. Established peers answer with a `snapshot`. |
| `snapshot` | `records`, `state`           | Every document record, plus the sender's CRDT stamps. |
| `diff`     | `clientId`, `seq`, `diff`    | One squashed store diff, stamped field by field.      |
| `presence` | `clientId`, `record`         | The sender's `instance_presence` record.              |
| `bye`      | `clientId`                   | I am leaving; drop my presence.                       |

`encodeMessage` stamps `version: PROTOCOL_VERSION` (currently 3) onto every
message. `decodeMessage` returns `null` for anything malformed and a synthetic
`{ type: "unsupported", version }` for a message from another protocol version,
so a peer on a different build is reported through `onError` rather than
half-parsed. Nothing on the wire can crash this client.

- Outgoing diffs come from `store.listen(cb, { source: "user", scope: "document" })`,
  so nothing applied from a peer is ever echoed back and nothing in `session`
  or `presence` scope is persisted into the document stream. Each one is
  stamped by the CRDT before it goes out, whether or not the transport is up.
- Incoming messages are merged field by field and only the fields that won are
  applied, inside `store.mergeRemoteChanges(() => store.applyDiff(winning))`,
  which marks them `source: "remote"`: they do not enter the local undo stack
  and do not re-broadcast.
- A replica with **no stamps at all** — a tab that has just loaded and has not
  been edited — takes the first `snapshot` it is offered whole, records and
  stamps together, and sends nothing before that. One stamp is enough to make
  it merge instead: a replica with work of its own never has that work replaced
  by a peer's body.
- Local changes are stamped by the store listener, which is wired up when the
  client is built and stays wired until `dispose()`. An edit made before
  `connect()`, or after `disconnect()`, is therefore stamped **when it happens**
  and goes out on the next connection. It is not silently unstamped work that
  would lose to every stamped write in the room.
- On a reconnect the client re-sends `hello` and its own snapshot, so work done
  while the transport was down flows both ways.
- If the store rewrites a merged record — a validator clamping a value, a side
  effect touching another record — that rewrite is stamped as a local write and
  broadcast. Otherwise it would exist on one replica only, since changes made
  inside `mergeRemoteChanges` are reported as `remote` and never leave.
- Presence records are derived from the editor's camera,
  `inputs.currentPagePoint` and selection, throttled to at most 30 Hz, and
  re-sent on a heartbeat. A collaborator is dropped on `bye` or after 10s of
  silence.

## Conflict policy: a CRDT over the record fields

Every leaf field of every record is its own last-writer-wins register. A local
change carries one Lamport stamp — `{ lamport, client }` — and a field is
overwritten only when the incoming stamp is greater than the one already held
for that exact path. Equal `lamport` values are broken by comparing the client
ids, so the comparison is a total order and both sides of a race reach the same
answer from the same pair. Paths are dotted: `x`, `props.w`, `meta.notes.title`.

A stamp covers a **subtree**, not just a leaf. Writing `meta` — setting it, or
deleting the key — dominates `meta.a`: a claim loses to any stamp at or above
its own path, and a write that drops a subtree keeps the descendants stamped
later than itself. Comparing `meta` and `meta.a` as unrelated registers is how
"delete the key" racing "edit the key's child" ends up different on each side.

The result is that merging is **idempotent** — the same message twice changes
nothing the second time — and **commutative**: two messages in either order
reach the same state, because the outcome per path is the maximum stamp and a
maximum does not care about arrival order. Replicas converge no matter how the
transport reorders or duplicates messages. `src/fuzz.test.ts` is the evidence:
a seeded generator builds random schedules of creates, nested edits, deletes,
re-creates, reordered, duplicated and dropped messages, disconnects, reconnects
and snapshot joins over an in-memory network, then quiesces and demands that
every replica's document be byte-identical under a key-sorted serialisation.

What that means in practice:

- Two people dragging **different** shapes: fine, as before.
- Two people editing **different fields of the same shape** — one moves it while
  the other recolours it — now keep both edits. This is the case the old
  per-record policy lost.
- Two people editing the **same** field pick the same winner on every replica.
  The loser's value is gone; there is no merging inside a single value.
- **Creating** the same record id on two peers merges field by field, exactly
  like an edit.
- **Deleting** leaves a stamped tombstone rather than a hole, so an older edit
  arriving late cannot resurrect the record. A delete beats a concurrent edit
  only when its stamp is the greater one; an edit with a greater stamp keeps
  the record alive.
- **A record kept alive by an edit that outranks a delete comes back whole.**
  The tombstone takes the provenance of every field it outranks, so the fields
  written *before* the delete have nothing left to settle them and each replica
  would otherwise keep whatever leftover it happened to hold. The replica that
  keeps the record re-claims its whole body under a fresh stamp and sends it,
  and that body — not a leftover — is what every replica ends up with.
- Peers that were offline while others edited keep their work: on reconnect the
  two sides exchange state and merge both ways. That holds for a client that
  was `disconnect()`ed as much as for one whose socket dropped.

### What is one register, and what that costs

- **Arrays are opaque.** `props.points`, `selectedShapeIds` and every other
  array is one register holding the whole array, not one register per element.
  Two concurrent edits to one array pick a winner instead of merging. Splitting
  an array into per-element registers needs element identity, which the record
  data does not carry, and would produce interleaved nonsense — a half-merged
  draw stroke is worse than one of the two strokes.
- **The fractional `index` is one register too.** A concurrent reorder of the
  same shape therefore lands on one of the two orders deterministically rather
  than merging them. Two people reordering *different* shapes is fine: those
  are different records.
- **An object is recursed into**, so `meta.a` and `meta.b` are separate
  registers, but an empty object is itself a leaf. Two replicas that each add a
  different key to one object agree on the keys and their values; the order the
  keys sit in the JSON may differ, and object key order is not part of the value.
  Tests compare documents key-sorted for that reason, and only for that reason.
- **A record body is one register of its own.** A put carries `base`: the stamp
  its whole record was the sender's current view as of. A receiver that has no
  stamp at all for some path — because it never saw the record created, only an
  edit to one of its fields — takes that path from the body carrying the
  greatest `base`, so two such receivers cannot settle on different bodies.

### Tombstones are bounded

A tombstone for a record that is gone is kept for one hour, and at most 5000 of
them are kept at once (`tombstoneMaxAgeMs`, `tombstoneLimit` on
`createSyncClient`); the oldest go first. Once a tombstone has been collected,
an edit older than it has nothing left to lose against and **resurrects the
record**. The bound is therefore a statement about how long a peer may be
partitioned: within it, deletes are safe against arbitrarily late messages;
past it, a straggler's edit can bring a deleted record back. Live records keep
their field stamps for as long as the document holds them.

### What it is not, and what it does not promise

There is still no operational transform, no server-authoritative log, and no
character-level text merge: concurrent edits to one text field pick a winner
rather than interleaving. The store remains the source of truth — the CRDT owns
stamps, never values — so nothing here needs Yjs or Automerge, and adding one
would mean replacing the store rather than sitting under it.

Four limits are real, and none of them is a bug to be fixed later:

- **Two writes to one field cannot both survive.** The register holds one value
  and the greater stamp takes it. Same for the interior of an array or a string:
  there is no identity inside a value to merge along.
- **A message that is never delivered is not merged.** A put carries stamps for
  the paths it claims, not for the whole record, so a replica that missed a
  record's creation and then sees an edit to one field adopts the rest of that
  body without provenance. It is repaired by the next snapshot exchange, which
  every `hello`, `connect` and reconnect triggers, from any peer that does hold
  those stamps. Between the loss and that exchange, it can be stale.
- **A replica that has never connected starts its clock at zero.** Its offline
  edits are stamped when they happen, so they are real writes and its own new
  records always survive; but an edit to a field the room has already written
  several times can sort below what is there. A replica that has been in the
  room and comes back has observed the room's clock and does not have this
  problem, which is the case the offline requirement is about.
- **A side effect that is not a function of its inputs cannot converge.** Store
  rewrites are stamped and broadcast (see the protocol notes above), so one that
  rewrites the same way everywhere settles in a single round: peers apply a
  value they already hold and produce nothing further. One that rewrites
  differently on each replica has no fixed point, here or in any other design.

## Transports

```ts
createBroadcastChannelTransport(roomId)              // tabs of one browser, no server
createWebSocketTransport(url, { reconnect: true })   // a relay; exponential backoff with jitter
createMemoryTransportPair()                          // two peers in one process (tests)
createMemoryHub()                                    // n peers in one process (tests)
```

A `Transport` is `{ send, onMessage, onOpen?, onClose?, close }` and owns its
own serialization and reconnection. Anything implementing that interface works
— a WebRTC data channel, a shared worker, a mock.

## Running the relay

The relay forwards messages between the sockets in a room and keeps no state,
so restarting it is harmless: peers re-share the document with
`hello`/`snapshot`. The room is the URL path.

```sh
pnpm --filter @mocanvas/sync relay        # ws://localhost:5858/<room>
PORT=9000 pnpm --filter @mocanvas/sync relay
```

```ts
createWebSocketTransport(`ws://localhost:5858/${roomId}`, { reconnect: true })
```

The relay script ships in the package but `ws` does not — it is a
devDependency here, because the relay is a development tool and not part of
the client. Install `ws` yourself to run it outside this repository.

## Tests

```sh
pnpm --filter @mocanvas/sync test
```

## License

**Source-available, not open source.** Free to use for:

- personal, non-commercial projects;
- non-profit organisations;
- development, evaluation, testing and staging — including inside a for-profit
  company, so you can try it and build against it before committing;
- teaching and academic research.

**Shipping it in a commercial product, service or website needs a written
agreement with us.** That includes anything sold, anything that earns revenue
directly or through advertising, and internal tools running a for-profit
business.

To arrange one, or if you are unsure which side of the line you are on, write to
**mocanvas@symbio.agency** — we would rather answer the question than have you
guess.

The full terms are in `LICENSE`, shipped in this package.
