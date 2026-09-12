/**
 * Two real editors in one room — the test the README's quick start needs.
 *
 * Everything else in this package is tested against stores and structural
 * stand-ins, which is why both of the bugs below survived a green suite: a
 * hand-built store is given a page id by the test, and a stand-in editor is
 * given a user id by the test, so neither of the two identities that actually
 * broke was ever the library's own. These tests build the thing the quick start
 * builds — `new Editor(...)` with nothing pinned — and assert what a person
 * looking at two tabs would: each replica shows the other's shapes, and each
 * lists the other as a collaborator on the page it is looking at.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  BaseBoxShapeUtil,
  createCurrentUser,
  createStore,
  createUserId,
  Editor,
  InstancePresenceRecordType,
  loadEngineSync,
  Rectangle2d,
  type BaseShape,
  type CurrentUser,
  type EditorRecord,
  type PageId,
  type StyleWords,
} from "@mocanvas/editor"
import { createSyncClient, type SyncClient } from "../SyncClient"
import { createMemoryHub } from "../transport"

const wasmPath = fileURLToPath(new URL("../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

/**
 * Let the room settle: the in-memory transport delivers on a microtask, and
 * presence is throttled through a timer, so both have to be allowed to run.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 10))
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

type BoxShape = BaseShape<"box", { w: number; h: number }>

class BoxUtil extends BaseBoxShapeUtil<BoxShape> {
  static override type = "box" as const
  override getDefaultProps() {
    return { w: 100, h: 100 }
  }
  override getGeometry(shape: BoxShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  override component() {
    return null
  }
  override indicator() {
    return null
  }
  override getRenderStyle(): StyleWords {
    return { fill: 0xff0000ff, stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 }
  }
}

/**
 * One tab: its own store, its own editor, nothing pinned.
 *
 * `user` is passed in rather than minted, because "two tabs of one browser" —
 * the case `createBroadcastChannelTransport` exists for — means two editors
 * that share a user id and must still see each other.
 */
function makeTab(user: CurrentUser): Editor {
  const engine = loadEngineSync(readFileSync(wasmPath))
  const editor = new Editor({
    store: createStore({ shapeUtils: [BoxUtil] }),
    shapeUtils: [BoxUtil],
    tools: [],
    engine,
    user,
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

function sameBrowserUser(name: string): CurrentUser {
  // One person, one browser: the id a real app reads out of its own session and
  // hands to every tab.
  return createCurrentUser({ id: createUserId(name), name: "Ada", color: "#3f86d8" })
}

describe("two replicas of one document", () => {
  let editors: Editor[] = []
  let clients: SyncClient[] = []

  afterEach(() => {
    for (const client of clients) client.dispose()
    for (const editor of editors) editor.dispose()
    clients = []
    editors = []
    vi.restoreAllMocks()
  })

  /** The three lines the README's "Integration" section asks for, in Node. */
  function join(editor: Editor, hub: ReturnType<typeof createMemoryHub<EditorRecord>>, clientId: string): SyncClient {
    const client = createSyncClient<EditorRecord>({
      store: editor.store,
      roomId: "room",
      transport: hub.join(),
      clientId,
      presence: { editor },
      presenceThrottleMs: 1,
      presenceHeartbeatMs: 100_000,
      presenceTimeoutMs: 100_000,
    })
    clients.push(client)
    client.connect()
    return client
  }

  function openTwoTabs(user: CurrentUser = sameBrowserUser("ada")): [Editor, Editor] {
    const hub = createMemoryHub<EditorRecord>()
    const a = makeTab(user)
    const b = makeTab(user)
    editors.push(a, b)
    join(a, hub, "tab-a")
    join(b, hub, "tab-b")
    return [a, b]
  }

  it("puts both replicas on the same page without being told which", () => {
    const [a, b] = openTwoTabs()
    // The failure this prevents: every editor minting its own random first page
    // id, so the two tabs sit on different pages of one merged document and see
    // nothing of each other.
    expect(a.getCurrentPageId()).toBe(b.getCurrentPageId())
  })

  it("keeps both shapes when two tabs draw at the same moment", async () => {
    // The bug this pins: index keys were a pure function of their neighbours,
    // so two replicas adding a shape to the same empty page minted the SAME
    // key. `index` is one register to the merge, so one of the two positions
    // was overwritten and the shapes stacked. Jitter is what separates them.
    const [a, b] = openTwoTabs()
    await flush()

    // Neither has seen the other's shape when it picks its index — which is
    // exactly the concurrent case, not a sequential one.
    a.createShapes([{ type: "box", x: 0, y: 0, props: { w: 10, h: 10 } }])
    b.createShapes([{ type: "box", x: 50, y: 0, props: { w: 10, h: 10 } }])
    await flush()

    const indices = a.getCurrentPageShapes().map((s) => s.index)
    expect(a.getCurrentPageShapes(), "both shapes survived the merge").toHaveLength(2)
    expect(new Set(indices).size, `both claimed one position: ${indices.join(", ")}`).toBe(2)
    expect(b.getCurrentPageShapes()).toHaveLength(2)
  })

  it("shows each tab the shapes drawn in the other, on the page it is looking at", async () => {
    const [a, b] = openTwoTabs()
    await flush()

    a.createShapes([{ type: "box", x: 10, y: 20, props: { w: 30, h: 40 } }])
    await flush()

    // Not "the record arrived" — "it is on the page this replica is showing",
    // which is the difference between working and looking broken.
    const onB = b.getCurrentPageShapes()
    expect(onB).toHaveLength(1)
    expect(onB[0]).toMatchObject({ type: "box", x: 10, y: 20 })

    b.createShapes([{ type: "box", x: 400, y: 500, props: { w: 10, h: 10 } }])
    await flush()
    expect(a.getCurrentPageShapes()).toHaveLength(2)
  })

  it("lists the other tab as a collaborator even though both tabs are the same user", async () => {
    const [a, b] = openTwoTabs()
    await flush()

    // Same person, two instances: both must be visible to each other. This is
    // the case that used to be filtered out as "that's me".
    expect(a.user.getId()).toBe(b.user.getId())

    const seenByA = a.getCollaboratorsOnCurrentPage()
    const seenByB = b.getCollaboratorsOnCurrentPage()
    expect(seenByA.map((p) => p.id)).toEqual([b.getInstancePresenceId()])
    expect(seenByB.map((p) => p.id)).toEqual([a.getInstancePresenceId()])
    // ...and they are the records `CollaboratorCursors` actually draws.
    expect(a.getVisibleCollaboratorsOnCurrentPage()).toHaveLength(1)
    expect(b.getVisibleCollaboratorsOnCurrentPage()).toHaveLength(1)
  })

  it("carries the other tab's cursor and selection, not just its identity", async () => {
    const [a, b] = openTwoTabs()
    await flush()

    a.createShapes([{ type: "box", x: 0, y: 0, props: { w: 10, h: 10 } }])
    await flush()
    const id = a.getCurrentPageShapes()[0]!.id
    a.setSelectedShapes([id])
    await flush()

    const [presenceOfA] = b.getCollaboratorsOnCurrentPage()
    expect(presenceOfA?.selectedShapeIds).toEqual([id])
    expect(presenceOfA?.cursor).not.toBeNull()
    expect(presenceOfA?.userName).toBe("Ada")
  })

  it("still separates two different people in the same room", async () => {
    const hub = createMemoryHub<EditorRecord>()
    const a = makeTab(sameBrowserUser("ada"))
    const b = makeTab(sameBrowserUser("grace"))
    editors.push(a, b)
    join(a, hub, "tab-a")
    join(b, hub, "tab-b")
    await flush()

    expect(a.getCollaboratorsOnCurrentPage().map((p) => p.userId)).toEqual(["user:grace"])
    expect(b.getCollaboratorsOnCurrentPage().map((p) => p.userId)).toEqual(["user:ada"])
  })

  it("never counts this instance's own presence record as a collaborator", async () => {
    const [a] = openTwoTabs()
    await flush()

    // However it got there — a server that echoes presence back, a host that
    // writes its own record into the store — our own record is still ours.
    a.store.put([
      InstancePresenceRecordType.create({
        id: a.getInstancePresenceId(),
        userId: a.user.getId(),
        currentPageId: a.getCurrentPageId() as PageId,
        lastActivityTimestamp: Date.now(),
      }),
    ])

    expect(a.getCollaborators().map((p) => p.id)).not.toContain(a.getInstancePresenceId())
    expect(a.getCollaboratorsOnCurrentPage()).toHaveLength(1)
  })

  it("says so out loud when a replica ends up alone on its page", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const hub = createMemoryHub<EditorRecord>()
    const a = makeTab(sameBrowserUser("ada"))
    const b = makeTab(sameBrowserUser("ada"))
    editors.push(a, b)
    join(a, hub, "tab-a")
    join(b, hub, "tab-b")
    await flush()
    expect(warn).not.toHaveBeenCalled()

    // B walks off to a page of its own. A is now on a page nobody else is on,
    // which is legitimate — and is also exactly what the old default page id
    // produced by accident, so the library says which it thinks it is seeing
    // instead of drawing nothing and staying quiet.
    b.createPage({ name: "elsewhere" })
    b.setCurrentPage(b.getPages().find((p) => p.name === "elsewhere")!.id)
    await flush()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain("none of the 1 peer(s)")
  })
})
