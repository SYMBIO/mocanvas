/**
 * Session state read and written against a *store*, with no editor involved.
 *
 * The editor-facing versions of this live in `snapshots.ts`. These exist for
 * the two moments when there is no editor to ask: persisting the session as it
 * changes (which has to keep working while the editor is being torn down and
 * rebuilt), and restoring it into a store that is about to have an editor
 * mounted on top of it.
 *
 * Session state is per person and per tab — camera, selection, current page —
 * and it is stored separately from the document for a reason: two people on one
 * board are looking at different parts of it, and restoring one person's
 * viewport for everybody would be a bug, not a feature.
 */
import { computed, type Signal } from "@mocanvas/state"
import {
  CameraRecordType,
  INSTANCE_ID,
  InstancePageStateRecordType,
  PageRecordType,
  type Camera,
  type InstancePageState,
  type Page,
  type PageId,
} from "../records/base"
import type { EditorStore } from "./createStore"
import { CURRENT_SESSION_SCHEMA_VERSION, type TLSessionPageState, type TLSessionStateSnapshot } from "./snapshots"

/** Options for {@link loadSessionStateSnapshotIntoStore}. */
export interface TLLoadSessionStateSnapshotOptions {
  /**
   * Ignore the page the snapshot recorded and stay on the current one.
   *
   * What a host deep-linking into a specific page needs: the URL is a stronger
   * statement of intent than "where you were last time", and applying both in
   * order would visibly jump the person from one page to the other.
   */
  forceOverwriteSessionState?: boolean
}

/**
 * A signal of the store's current session state.
 *
 * Reactive, so a host persisting the session can `react` on it and write
 * whenever it actually changes, instead of polling or hooking every command
 * that might have moved the camera.
 *
 * Answers `null` before the store has an `instance` record — i.e. before the
 * editor has started — because "no session yet" and "an empty session" would
 * otherwise be indistinguishable, and persisting the second over a good saved
 * one loses the person's place.
 */
export function createSessionStateSnapshotSignal(store: EditorStore): Signal<TLSessionStateSnapshot | null> {
  return computed<TLSessionStateSnapshot | null>("sessionStateSnapshot", () => getSessionStateSnapshotFromStore(store))
}

/** Read the session state straight out of a store. */
export function getSessionStateSnapshotFromStore(store: EditorStore): TLSessionStateSnapshot | null {
  const instance = store.get(INSTANCE_ID)
  if (!instance) return null

  const pageStates: TLSessionPageState[] = []
  for (const page of store.allRecords()) {
    if (page.typeName !== "page") continue
    const pageId = (page as Page).id
    const suffix = pageId.slice("page:".length)
    const state = store.get(InstancePageStateRecordType.createId(suffix))
    const camera = store.get(CameraRecordType.createId(suffix)) as Camera | undefined
    if (!state || !camera) continue
    pageStates.push({
      pageId,
      camera: { x: camera.x, y: camera.y, z: camera.z },
      selectedShapeIds: [...state.selectedShapeIds],
      focusedGroupId: state.focusedGroupId,
    })
  }

  return {
    version: CURRENT_SESSION_SCHEMA_VERSION,
    currentPageId: instance.currentPageId,
    isFocusMode: instance.isFocusMode,
    isGridMode: instance.isGridMode,
    isDebugMode: instance.isDebugMode,
    isToolLocked: instance.isToolLocked,
    exportBackground: instance.exportBackground,
    pageStates,
  }
}

/**
 * Apply a session snapshot to a store.
 *
 * Defensive throughout, because the two halves can disagree: the snapshot was
 * taken against a document that has since been edited by somebody else, or
 * loaded next to a different document entirely. A page that is gone is skipped,
 * a selection of deleted shapes is dropped, and a snapshot from a schema version
 * this build does not know is ignored rather than half-applied — half-applied
 * session state is how a person ends up on a blank page with a camera pointing
 * at nothing.
 */
export function loadSessionStateSnapshotIntoStore(
  store: EditorStore,
  snapshot: TLSessionStateSnapshot,
  opts: TLLoadSessionStateSnapshotOptions = {},
): void {
  if (snapshot.version !== CURRENT_SESSION_SCHEMA_VERSION) return

  const instance = store.get(INSTANCE_ID)
  if (!instance) return

  const livePageIds = new Set<PageId>()
  for (const record of store.allRecords()) {
    if (record.typeName === "page") livePageIds.add((record as Page).id)
  }
  if (livePageIds.size === 0) return

  const updates: (Camera | InstancePageState)[] = []
  for (const pageState of snapshot.pageStates) {
    if (!livePageIds.has(pageState.pageId)) continue
    const suffix = pageState.pageId.slice("page:".length)

    const existing = store.get(InstancePageStateRecordType.createId(suffix))
    if (existing) {
      const selectedShapeIds = pageState.selectedShapeIds.filter((id) => store.has(id))
      const focusedGroupId =
        pageState.focusedGroupId && store.has(pageState.focusedGroupId) ? pageState.focusedGroupId : null
      updates.push({ ...existing, selectedShapeIds, focusedGroupId })
    }

    const camera = store.get(CameraRecordType.createId(suffix)) as Camera | undefined
    if (camera) updates.push({ ...camera, ...pageState.camera })
  }

  const currentPageId =
    !opts.forceOverwriteSessionState && snapshot.currentPageId && livePageIds.has(snapshot.currentPageId)
      ? snapshot.currentPageId
      : instance.currentPageId

  store.put([
    ...updates,
    {
      ...instance,
      currentPageId: livePageIds.has(currentPageId) ? currentPageId : firstPageId(livePageIds),
      isFocusMode: snapshot.isFocusMode,
      isGridMode: snapshot.isGridMode,
      isDebugMode: snapshot.isDebugMode,
      isToolLocked: snapshot.isToolLocked,
      exportBackground: snapshot.exportBackground,
    },
  ])
}

/** Page ids sort stably, so "the first page" is the same page on every client. */
function firstPageId(ids: ReadonlySet<PageId>): PageId {
  return [...ids].sort()[0] ?? PageRecordType.createId("page")
}
