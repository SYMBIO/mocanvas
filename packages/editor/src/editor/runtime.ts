/**
 * The handful of things the editor does *to the page* rather than to the
 * document: open a link, reload, throw away local state.
 *
 * They are funnelled through one replaceable object because the environments a
 * canvas gets embedded in — an Electron shell, a VS Code webview, an Obsidian
 * plugin, a test — each need a different answer, and none of them can let a
 * library call `window.open` directly. A host swaps them once with
 * {@link setRuntimeOverrides} and every call site follows.
 */

/** The side effects a host may take over. */
export interface TLRuntime {
  /** Open a URL. `target` follows `window.open`'s second argument. */
  openWindow(url: string, target?: string): void
  /** Reload the page the editor is mounted in. */
  refreshPage(): void
  /**
   * Throw away everything this origin has stored locally and reload.
   *
   * Returns a promise so a host that has to await its own storage teardown
   * can; the default implementation resolves immediately.
   */
  hardReset(): Promise<void>
}

/**
 * A stable per-tab identifier.
 *
 * Session state is stored per tab, not per origin: two tabs on the same board
 * are two people as far as camera, selection and presence are concerned, and
 * they must not overwrite each other's saved viewport. It is kept in
 * `sessionStorage` so it survives a reload of *this* tab and nothing else,
 * which is exactly the lifetime a session has.
 */
export const TAB_ID: string = readOrCreateTabId()

const TAB_ID_KEY = "mocanvas.tabId"

function readOrCreateTabId(): string {
  const fresh = `tab:${Math.random().toString(36).slice(2, 10)}`
  try {
    if (typeof sessionStorage === "undefined") return fresh
    const existing = sessionStorage.getItem(TAB_ID_KEY)
    if (existing) return existing
    sessionStorage.setItem(TAB_ID_KEY, fresh)
    return fresh
    // Storage throws rather than returning null in a partitioned or
    // storage-blocked context, so a failure here has to be survivable: an
    // in-memory id is still unique per tab, it just does not survive a reload.
  } catch {
    return fresh
  }
}

const defaults: TLRuntime = {
  openWindow(url: string, target = "_blank") {
    if (typeof window === "undefined") return
    // `noopener` severs `window.opener`, without which the opened page can
    // navigate this one. Every link out of a canvas is user content.
    window.open(url, target, "noopener noreferrer")
  },
  refreshPage() {
    if (typeof window === "undefined") return
    window.location.reload()
  },
  async hardReset() {
    if (typeof window === "undefined") return
    clearLocalState()
    window.location.reload()
  },
}

/**
 * The live runtime. Read through this rather than capturing a member, so an
 * override applied after startup is still seen.
 */
export const runtime: TLRuntime = { ...defaults }

/**
 * Replace some or all of the runtime's side effects.
 *
 * Merges, so a host that only needs to intercept link opening leaves reload and
 * reset alone. Call it once, before an editor is mounted.
 */
export function setRuntimeOverrides(overrides: Partial<TLRuntime>): void {
  Object.assign(runtime, overrides)
}

/** Open a URL through the current {@link runtime}. */
export function openWindow(url: string, target?: string): void {
  runtime.openWindow(url, target)
}

/** Reload the page through the current {@link runtime}. */
export function refreshPage(): void {
  runtime.refreshPage()
}

/**
 * Throw away this origin's local editor state and reload.
 *
 * The escape hatch for a person whose local session state has become
 * unopenable — a half-migrated snapshot, a camera saved as `NaN`. It touches
 * *local* storage only: nothing synced, nothing on a server, and no document
 * that lives anywhere but this browser.
 */
export function hardReset(): Promise<void> {
  return runtime.hardReset()
}

/**
 * The prefix every key this library writes to web storage carries, so a hard
 * reset can find its own keys and leave the host application's alone.
 */
export const LOCAL_STATE_PREFIX = "mocanvas."

function clearLocalState(): void {
  for (const storage of [safeStorage(() => localStorage), safeStorage(() => sessionStorage)]) {
    if (!storage) continue
    try {
      const keys: string[] = []
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (key?.startsWith(LOCAL_STATE_PREFIX)) keys.push(key)
      }
      for (const key of keys) storage.removeItem(key)
    } catch {
      // A blocked storage is already as reset as it can be.
    }
  }
  if (typeof indexedDB !== "undefined" && typeof indexedDB.deleteDatabase === "function") {
    try {
      indexedDB.deleteDatabase("mocanvas")
    } catch {
      // Same reasoning: nothing useful to do, and the reload still happens.
    }
  }
}

function safeStorage(get: () => Storage): Storage | null {
  try {
    return get()
  } catch {
    return null
  }
}

/** What {@link hardResetEditor} needs of an editor, so this module needs no import cycle. */
export interface TLResettableEditor {
  dispose(): void
}

/**
 * Tear one editor down and hard-reset the origin.
 *
 * Disposing first matters: the editor holds timers, animation frames and store
 * listeners, and a reload that races them logs a stack of errors from work that
 * was already meaningless. It also drops the reference the reset is about to
 * invalidate, which is the difference between a clean restart and a leak.
 */
export async function hardResetEditor(editor: TLResettableEditor): Promise<void> {
  editor.dispose()
  await hardReset()
}
