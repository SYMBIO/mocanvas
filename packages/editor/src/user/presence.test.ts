import { describe, expect, it } from "vitest"
import { atom, react, type Signal } from "@mocanvas/state"
import type { IndexKey } from "@mocanvas/store"
import { createStore, type EditorStore } from "../editor/createStore"
import {
  CameraRecordType,
  INSTANCE_ID,
  InstancePageStateRecordType,
  InstanceRecordType,
  PageRecordType,
  type PageId,
  type ShapeId,
} from "../records/base"
import type { InstancePresence, InstancePresenceId } from "../records/presence"
import { createPresenceStateDerivation, trackPointer, type PointerSource, type PresenceUser } from "./presence"

const PAGE_ID = PageRecordType.createId("p1")
const OTHER_PAGE_ID = PageRecordType.createId("p2")

function seedStore(): EditorStore {
  const store = createStore()
  store.put([
    PageRecordType.create({ id: PAGE_ID, name: "Page 1", index: "a1" as IndexKey }),
    PageRecordType.create({ id: OTHER_PAGE_ID, name: "Page 2", index: "a2" as IndexKey }),
    CameraRecordType.create({ id: CameraRecordType.createId("p1") }),
    CameraRecordType.create({ id: CameraRecordType.createId("p2") }),
    InstancePageStateRecordType.create({ id: InstancePageStateRecordType.createId("p1"), pageId: PAGE_ID }),
    InstancePageStateRecordType.create({ id: InstancePageStateRecordType.createId("p2"), pageId: OTHER_PAGE_ID }),
    InstanceRecordType.create({ id: INSTANCE_ID, currentPageId: PAGE_ID }),
  ])
  return store
}

function setCamera(store: EditorStore, x: number, y: number, z: number, page = "p1"): void {
  const id = CameraRecordType.createId(page)
  store.update(id, (camera) => ({ ...camera, x, y, z }))
}

function setSelection(store: EditorStore, ids: ShapeId[], page = "p1"): void {
  const id = InstancePageStateRecordType.createId(page)
  store.update(id, (state) => ({ ...state, selectedShapeIds: ids }))
}

const user: PresenceUser = { id: "user:ada", name: "Ada", color: "#ff0000" }

function derive(
  store: EditorStore,
  $user: Signal<PresenceUser> = atom("user", user),
  options: Parameters<typeof createPresenceStateDerivation>[1] = {},
): Signal<InstancePresence | null> {
  return createPresenceStateDerivation($user, { now: () => 1_000, ...options })(store)
}

describe("createPresenceStateDerivation", () => {
  it("builds an instance_presence record from the local editor state", () => {
    const store = seedStore()
    setCamera(store, 10, 20, 2)
    setSelection(store, ["shape:a" as ShapeId])

    const presence = derive(store).get()

    expect(presence).not.toBeNull()
    expect(presence?.typeName).toBe("instance_presence")
    expect(presence?.userId).toBe("user:ada")
    expect(presence?.userName).toBe("Ada")
    expect(presence?.color).toBe("#ff0000")
    expect(presence?.currentPageId).toBe(PAGE_ID)
    expect(presence?.camera).toEqual({ x: 10, y: 20, z: 2 })
    expect(presence?.selectedShapeIds).toEqual(["shape:a"])
    expect(presence?.lastActivityTimestamp).toBe(1_000)
    expect(presence?.chatMessage).toBe("")
  })

  it("returns null until the store has an instance record", () => {
    const store = createStore()
    expect(derive(store).get()).toBeNull()

    store.put([
      PageRecordType.create({ id: PAGE_ID, name: "Page 1", index: "a1" as IndexKey }),
      InstanceRecordType.create({ id: INSTANCE_ID, currentPageId: PAGE_ID }),
    ])
    expect(derive(store).get()).not.toBeNull()
  })

  it("recomputes when the camera moves", () => {
    const store = seedStore()
    const $presence = derive(store)
    const seen: (readonly [number, number, number])[] = []
    const stop = react("push", () => {
      const camera = $presence.get()?.camera
      if (camera) seen.push([camera.x, camera.y, camera.z] as const)
    })

    setCamera(store, 5, 5, 1)
    setCamera(store, 5, 5, 4)
    stop()
    setCamera(store, 99, 99, 9)

    expect(seen).toEqual([
      [0, 0, 1],
      [5, 5, 1],
      [5, 5, 4],
    ])
  })

  it("recomputes when the selection changes", () => {
    const store = seedStore()
    const $presence = derive(store)
    const seen: ShapeId[][] = []
    const stop = react("push", () => {
      seen.push($presence.get()?.selectedShapeIds ?? [])
    })

    setSelection(store, ["shape:a" as ShapeId])
    setSelection(store, ["shape:a" as ShapeId, "shape:b" as ShapeId])
    stop()

    expect(seen).toEqual([[], ["shape:a"], ["shape:a", "shape:b"]])
  })

  it("follows the current page, camera and selection together", () => {
    const store = seedStore()
    setCamera(store, 1, 1, 1)
    setCamera(store, 7, 8, 3, "p2")
    setSelection(store, ["shape:b" as ShapeId], "p2")
    const $presence = derive(store)
    expect($presence.get()?.currentPageId).toBe(PAGE_ID)

    store.update(INSTANCE_ID, (instance) => ({ ...instance, currentPageId: OTHER_PAGE_ID }))

    expect($presence.get()?.currentPageId).toBe(OTHER_PAGE_ID)
    expect($presence.get()?.camera).toEqual({ x: 7, y: 8, z: 3 })
    expect($presence.get()?.selectedShapeIds).toEqual(["shape:b"])
  })

  it("carries the brush, the cursor kind and who is being followed", () => {
    const store = seedStore()
    const $presence = derive(store)

    store.update(INSTANCE_ID, (instance) => ({
      ...instance,
      brush: { x: 0, y: 0, w: 10, h: 10 },
      cursor: { type: "grabbing", rotation: 0.5 },
      followingUserId: "user:grace",
    }))

    expect($presence.get()?.brush).toEqual({ x: 0, y: 0, w: 10, h: 10 })
    expect($presence.get()?.cursor).toMatchObject({ type: "grabbing", rotation: 0.5 })
    expect($presence.get()?.followingUserId).toBe("user:grace")
  })

  it("recomputes when the identity signal changes", () => {
    const store = seedStore()
    const $user = atom<PresenceUser>("user", user)
    const $presence = derive(store, $user)
    expect($presence.get()?.userName).toBe("Ada")

    $user.set({ id: "user:ada", name: "Ada Lovelace", color: "#00ff00" })

    expect($presence.get()?.userName).toBe("Ada Lovelace")
    expect($presence.get()?.color).toBe("#00ff00")
  })

  it("tracks a pointer signal when one is supplied", () => {
    const store = seedStore()
    const $pointer = atom("pointer", { x: 0, y: 0 })
    const $presence = derive(store, atom("user", user), { pointer: $pointer })
    expect($presence.get()?.cursor).toMatchObject({ x: 0, y: 0 })

    $pointer.set({ x: 120, y: 80 })

    expect($presence.get()?.cursor).toMatchObject({ x: 120, y: 80, type: "default", rotation: 0 })
  })

  it("tracks a chat message signal when one is supplied", () => {
    const store = seedStore()
    const $chat = atom("chat", "")
    const $presence = derive(store, atom("user", user), { chatMessage: $chat })

    $chat.set("hello")

    expect($presence.get()?.chatMessage).toBe("hello")
  })

  it("publishes under a caller-supplied id, and otherwise under one per instance", () => {
    const store = seedStore()
    const id = "instance_presence:agent:planner" as InstancePresenceId
    expect(derive(store, atom("user", user), { id }).get()?.id).toBe(id)

    const first = derive(store).get()?.id
    const second = derive(store).get()?.id
    expect(first).not.toBe(second)
  })

  it("copies the arrays it publishes, so a peer cannot be handed live store state", () => {
    const store = seedStore()
    setSelection(store, ["shape:a" as ShapeId])
    const presence = derive(store).get()

    presence?.selectedShapeIds.push("shape:injected" as ShapeId)

    const pageState = store.get(InstancePageStateRecordType.createId("p1"))
    expect(pageState?.selectedShapeIds).toEqual(["shape:a"])
  })
})

describe("trackPointer", () => {
  function fakeEditor(): PointerSource & { move(x: number, y: number): void; listeners: number } {
    const handlers = new Set<() => void>()
    const inputs = { currentPagePoint: { x: 0, y: 0 } }
    return {
      inputs,
      get listeners() {
        return handlers.size
      },
      on(_name: "event", fn: () => void) {
        handlers.add(fn)
        return () => handlers.delete(fn)
      },
      move(x: number, y: number) {
        inputs.currentPagePoint = { x, y }
        for (const fn of handlers) fn()
      },
    }
  }

  it("mirrors the editor's page point into a signal", () => {
    const editor = fakeEditor()
    const { pointer } = trackPointer(editor)
    expect(pointer.get()).toEqual({ x: 0, y: 0 })

    editor.move(3, 4)

    expect(pointer.get()).toEqual({ x: 3, y: 4 })
  })

  it("does not push when the point has not moved", () => {
    const editor = fakeEditor()
    const { pointer } = trackPointer(editor)
    const seen: string[] = []
    const stop = react("pointer", () => {
      const { x, y } = pointer.get()
      seen.push(`${x},${y}`)
    })

    editor.move(3, 4)
    editor.move(3, 4)
    editor.move(5, 4)
    stop()

    expect(seen).toEqual(["0,0", "3,4", "5,4"])
  })

  it("stops listening when told to", () => {
    const editor = fakeEditor()
    const { pointer, stop } = trackPointer(editor)
    stop()
    expect(editor.listeners).toBe(0)

    editor.move(9, 9)

    expect(pointer.get()).toEqual({ x: 0, y: 0 })
  })

  it("feeds a presence derivation end to end", () => {
    const store = seedStore()
    const editor = fakeEditor()
    const { pointer } = trackPointer(editor)
    const $presence = derive(store, atom("user", user), { pointer })

    editor.move(42, 24)

    expect($presence.get()?.cursor).toMatchObject({ x: 42, y: 24 })
  })
})
