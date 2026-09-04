# @mocanvas/sync

Multiplayer for a mocanvas store: document changes travel as record diffs,
cursors and selections travel as presence records.

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
| `snapshot` | `records`                    | Every document-scope record as the sender sees them.  |
| `diff`     | `clientId`, `seq`, `diff`    | One squashed `RecordsDiff` of document records.       |
| `presence` | `clientId`, `record`         | The sender's `instance_presence` record.              |
| `bye`      | `clientId`                   | I am leaving; drop my presence.                       |

- Outgoing diffs come from `store.listen(cb, { source: "user", scope: "document" })`,
  so nothing applied from a peer is ever echoed back and nothing in `session`
  or `presence` scope is persisted into the document stream.
- Incoming diffs are applied inside
  `store.mergeRemoteChanges(() => store.applyDiff(diff))`, which marks them
  `source: "remote"`: they do not enter the local undo stack and do not
  re-broadcast.
- A newcomer applies the first `snapshot` it is offered and ignores the rest.
  Answering a `hello` makes a peer "established", so a snapshot meant for
  someone else can never overwrite its work.
- Presence records are derived from the editor's camera,
  `inputs.currentPagePoint` and selection, throttled to at most 30 Hz, and
  re-sent on a heartbeat. A collaborator is dropped on `bye` or after 10s of
  silence.
- `decodeMessage` returns `null` for anything malformed, so a peer running a
  different version cannot crash this one. `PROTOCOL_VERSION` is checked on
  `hello`.

## Conflict policy: last writer wins, per record

There is no operational transform and no CRDT here. Diffs are applied in
arrival order and the last write to a record id is the one that survives.

What that means in practice:

- Two people dragging **different** shapes is always fine.
- Two people dragging the **same** shape converge on whoever sent last; the
  other person's drag is discarded, not merged.
- Concurrent edits to **different fields of the same record** (one person
  moves a shape while another recolours it) lose one of the two changes: a
  record is replaced wholesale, not merged field by field.
- A delete racing an update can resurrect the record: the update carries the
  full record and is applied after the removal.
- Peers that were offline while others edited rejoin with `hello` and take a
  peer's snapshot, so anything they changed offline is overwritten.

This is enough for cursors-and-shapes collaboration on a small trusted room.
Anything needing real convergence guarantees wants a server-authoritative log
or a CRDT under `applyDiff`; the transport and message types here do not have
to change for that.

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

`ws` is a devDependency of this package only: the relay is a development tool,
not part of the shipped client.

## Tests

```sh
pnpm --filter @mocanvas/sync test
```
