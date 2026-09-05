/**
 * Saving and restoring a whole editor.
 *
 * There are two halves to "where I was", and conflating them is the classic
 * bug. The **document** is the board: shapes, bindings, assets, pages — shared
 * by everyone, and the thing a file format holds. The **session** is this
 * person at this moment: which page they are on, where their camera is, what
 * they had selected. Restoring a document without the session drops the reader
 * at the origin of page one; restoring a session against a different document
 * points at shapes that are not there.
 *
 * So they travel together in {@link TLEditorSnapshot} but load separately, and
 * the session half is applied defensively — every id in it is checked against
 * the document that was just loaded.
 */
import { transact } from "@mocanvas/state"
import type { StoreSnapshot } from "@mocanvas/store"
import {
  CameraRecordType,
  InstancePageStateRecordType,
  type Camera,
  type InstancePageState,
  type PageId,
  type ShapeId,
} from "../records/base"
import type { EditorRecord } from "./createStore"
import type { Editor } from "./Editor"

/** Bumped when the shape of {@link TLSessionStateSnapshot} changes. */
export const CURRENT_SESSION_SCHEMA_VERSION = 1

/** Per-page session state worth restoring. */
export interface TLSessionPageState {
  pageId: PageId
  camera: { x: number; y: number; z: number }
  selectedShapeIds: ShapeId[]
  focusedGroupId: ShapeId | null
}

/**
 * Where one person was looking, independently of the document.
 *
 * Kept per page rather than only for the current one, so switching back to a
 * page you visited earlier in the session returns you to where you left it.
 */
export interface TLSessionStateSnapshot {
  version: number
  currentPageId: PageId | undefined
  isFocusMode: boolean
  isGridMode: boolean
  isDebugMode: boolean
  isToolLocked: boolean
  exportBackground: boolean
  pageStates: TLSessionPageState[]
}

/** A document and a person's place in it, saved together. */
export interface TLEditorSnapshot {
  document: StoreSnapshot<EditorRecord>
  session: TLSessionStateSnapshot
}

/** Which halves of a snapshot to take or restore. */
export interface TLLoadSnapshotOptions {
  /**
   * Force the session to land on this page instead of the one it recorded.
   * Useful when a host deep-links into a specific page.
   */
  forceOverwriteSessionState?: boolean
}

/** Just the session half of the current editor state. */
export function getSessionStateSnapshot(editor: Editor): TLSessionStateSnapshot {
  const instance = editor.getInstanceState()
  const pageStates: TLSessionPageState[] = []
  for (const page of editor.getPages()) {
    const state = editor.store.get(InstancePageStateRecordType.createId(page.id.slice("page:".length)))
    const camera = editor.store.get(cameraIdFor(page.id)) as Camera | undefined
    if (!state || !camera) continue
    pageStates.push({
      pageId: page.id,
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
 * Everything needed to reopen this editor exactly as it is: the document, and
 * where the person using it was.
 *
 * The document half is migrated on load, not here, so a snapshot taken today
 * still opens in a build shipped next year.
 */
export function getSnapshot(editor: Editor): TLEditorSnapshot {
  return {
    document: editor.store.getStoreSnapshot("document"),
    session: getSessionStateSnapshot(editor),
  }
}

/**
 * Restore a snapshot, or just its document half.
 *
 * Loading is not undoable — it replaces the document, so there is nothing
 * coherent for an undo to go back to — and the history is cleared afterwards
 * rather than left holding steps against records that no longer exist.
 *
 * Every id in the session half is validated against the document that was just
 * loaded: a page that is gone falls back to the first page, and selected shapes
 * that are gone are dropped. A session from an unknown future version is
 * ignored entirely rather than half-applied.
 */
export function loadSnapshot(
  editor: Editor,
  snapshot: TLEditorSnapshot | StoreSnapshot<EditorRecord>,
  opts: TLLoadSnapshotOptions = {},
): void {
  const isEditorSnapshot = "document" in snapshot && "session" in snapshot
  const document = isEditorSnapshot ? snapshot.document : (snapshot as StoreSnapshot<EditorRecord>)
  const session = isEditorSnapshot ? snapshot.session : undefined

  transact(() => {
    editor.store.loadStoreSnapshot(document)
    // The document half is `document` scope only, so the SESSION records —
    // camera and per-page state — still belong to the pages that were just
    // replaced. Rebuilding them first is what makes a snapshot from another
    // editor land somewhere coherent rather than on a page that is gone.
    ensureSessionRecords(editor)
    if (session && session.version === CURRENT_SESSION_SCHEMA_VERSION) {
      applySessionState(editor, session, opts)
    }
  })
  editor.clearHistory()
}

/**
 * Give every page a camera and a page-state record, and point the instance at a
 * page that exists.
 *
 * Runs after any load, session or not: a bare document snapshot carries no
 * session at all, and leaving `currentPageId` naming a deleted page shows an
 * empty canvas with shapes sitting on a page nobody can reach.
 */
function ensureSessionRecords(editor: Editor): void {
  const pages = editor.getPages()
  if (pages.length === 0) return
  const created: (InstancePageState | Camera)[] = []
  for (const page of pages) {
    const suffix = page.id.slice("page:".length)
    const stateId = InstancePageStateRecordType.createId(suffix)
    if (!editor.store.has(stateId)) {
      created.push(InstancePageStateRecordType.create({ id: stateId, pageId: page.id }))
    }
    const cameraId = CameraRecordType.createId(suffix)
    if (!editor.store.has(cameraId)) created.push(CameraRecordType.create({ id: cameraId }))
  }
  if (created.length > 0) editor.store.put(created)

  const currentPageId = editor.getInstanceState().currentPageId
  if (!pages.some((page) => page.id === currentPageId)) editor.setCurrentPage(pages[0]!.id)
}

function applySessionState(editor: Editor, session: TLSessionStateSnapshot, opts: TLLoadSnapshotOptions): void {
  const pages = editor.getPages()
  if (pages.length === 0) return
  const livePageIds = new Set(pages.map((page) => page.id))

  for (const pageState of session.pageStates) {
    if (!livePageIds.has(pageState.pageId)) continue
    const stateId = InstancePageStateRecordType.createId(pageState.pageId.slice("page:".length))
    const existing = editor.store.get(stateId)
    if (existing) {
      editor.store.put([
        {
          ...existing,
          selectedShapeIds: pageState.selectedShapeIds.filter((id) => !!editor.getShape(id)),
          focusedGroupId: pageState.focusedGroupId && editor.getShape(pageState.focusedGroupId) ? pageState.focusedGroupId : null,
        },
      ])
    }
    const camera = editor.store.get(cameraIdFor(pageState.pageId)) as Camera | undefined
    if (camera) editor.store.put([{ ...camera, ...pageState.camera }])
  }

  const targetPageId =
    !opts.forceOverwriteSessionState && session.currentPageId && livePageIds.has(session.currentPageId)
      ? session.currentPageId
      : pages[0]!.id
  editor.setCurrentPage(targetPageId)
  editor.updateInstanceState({
    isFocusMode: session.isFocusMode,
    isGridMode: session.isGridMode,
    isDebugMode: session.isDebugMode,
    isToolLocked: session.isToolLocked,
    exportBackground: session.exportBackground,
  })
}

/** The camera record id belonging to a page. */
function cameraIdFor(pageId: PageId): Camera["id"] {
  return CameraRecordType.createId(pageId.slice("page:".length))
}
