/**
 * What kind of machine and browser the canvas is running on.
 *
 * Two objects, split by whether a value can change while the page is open:
 * {@link tlenv} is decided once at load, {@link tlenvReactive} is an atom that
 * updates. Reading a changing value off the static object is the bug this split
 * exists to prevent — a laptop with a touchscreen switches between mouse and
 * finger mid-session, and a UI that measured its hit targets at load gets it
 * wrong for the rest of the session.
 */
import { atom, type Atom } from "@mocanvas/state"

/** Fixed facts about the browser and platform, detected once at load. */
export interface TLEnvironment {
  /** Safari proper. Chrome and Firefox on iOS are WebKit but are *not* Safari. */
  isSafari: boolean
  isFirefox: boolean
  isChromeForIos: boolean
  /** iPad or iPhone. */
  isIos: boolean
  isAndroid: boolean
  /** macOS, iOS included — i.e. "the accelerator key is Cmd". */
  isDarwin: boolean
  /** Whether raster export can work at all: `Promise` and `HTMLCanvasElement` both exist. */
  hasCanvasSupport: boolean
  /**
   * Whether the *hardware* has a touch screen. Stays true on a touchscreen
   * laptop while a mouse is in use — for the pointer actually in use read
   * {@link TLReactiveEnvironment.isCoarsePointer}.
   */
  isTouchDevice: boolean
}

/** Environment facts that can change while the page is open. */
export interface TLReactiveEnvironment {
  /**
   * Whether the pointer in use right now is imprecise — a finger or a pen.
   * Drives hit-test margins and touch-target sizes.
   */
  isCoarsePointer: boolean
  /** Whether the display this window is on can show the Display P3 gamut. */
  supportsP3ColorSpace: boolean
}

function detect(): TLEnvironment {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return {
      isSafari: false,
      isFirefox: false,
      isChromeForIos: false,
      isIos: false,
      isAndroid: false,
      isDarwin: false,
      hasCanvasSupport: false,
      isTouchDevice: false,
    }
  }
  const ua = navigator.userAgent
  const platform = navigator.platform ?? ""
  // iPadOS 13+ reports itself as a Mac; the touch-point count is what tells
  // the two apart, and it is the only signal that has stayed reliable.
  const isIpad = platform === "MacIntel" && navigator.maxTouchPoints > 1
  const isIos = /iPad|iPhone|iPod/.test(ua) || isIpad
  const isChromeForIos = /CriOS/.test(ua)
  const isFirefox = /Firefox|FxiOS/.test(ua)
  return {
    isSafari: /Safari/.test(ua) && !/Chrome|Chromium|Android/.test(ua) && !isChromeForIos,
    isFirefox,
    isChromeForIos,
    isIos,
    isAndroid: /Android/.test(ua),
    isDarwin: /Mac|iPod|iPhone|iPad/.test(platform) || isIos,
    hasCanvasSupport: typeof Promise !== "undefined" && typeof HTMLCanvasElement !== "undefined",
    isTouchDevice: "ontouchstart" in window || navigator.maxTouchPoints > 0,
  }
}

/**
 * Browser and platform facts, decided at load.
 *
 * Frozen: everything on it is a constant for the life of the page, and a host
 * that patches one is masking a detection bug rather than fixing it.
 */
export const tlenv: Readonly<TLEnvironment> = Object.freeze(detect())

function matches(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  return window.matchMedia(query).matches
}

function readReactiveEnvironment(): TLReactiveEnvironment {
  return {
    // Firefox on the desktop reports `(any-pointer: coarse)` true whenever a
    // touchscreen is *attached*, which makes every hit target jump to touch
    // size on a machine being driven by a mouse. Pin it to fine there and let
    // the pointer-down check below correct it if a finger actually arrives.
    isCoarsePointer: tlenv.isFirefox && !tlenv.isAndroid && !tlenv.isIos ? false : matches("(any-pointer: coarse)"),
    supportsP3ColorSpace: matches("(color-gamut: p3)"),
  }
}

/**
 * Environment facts that change during a session. An atom, so a component can
 * `useValue(tlenvReactive)` and re-render when the person picks up a pen.
 */
export const tlenvReactive: Atom<TLReactiveEnvironment> = atom("tlenvReactive", readReactiveEnvironment())

/**
 * Re-read the reactive environment from the DOM.
 *
 * Exported so a host that mounts the editor into a second window — an Electron
 * pop-out, a presentation display with a different gamut — can tell the atom to
 * look again; the listeners below already cover the ordinary case.
 */
export function refreshReactiveEnvironment(): void {
  const next = readReactiveEnvironment()
  const current = tlenvReactive.get()
  if (next.isCoarsePointer === current.isCoarsePointer && next.supportsP3ColorSpace === current.supportsP3ColorSpace) {
    return
  }
  tlenvReactive.set(next)
}

/**
 * Note the kind of pointer that just produced an event.
 *
 * The media query alone is not enough: it describes what the machine *has*, and
 * a touchscreen laptop has both. Anything that is not a mouse counts as coarse,
 * so a pen switches the UI to touch sizing too.
 *
 * SEMANTICS-ASSUMED: the editor's own event plumbing is expected to call this;
 * it is exported so a host driving synthetic input can keep the atom honest.
 */
export function noteReactivePointerType(pointerType: string | undefined): void {
  if (!pointerType) return
  const isCoarse = pointerType !== "mouse"
  if (tlenvReactive.get().isCoarsePointer === isCoarse) return
  tlenvReactive.update((env) => ({ ...env, isCoarsePointer: isCoarse }))
}

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  for (const query of ["(any-pointer: coarse)", "(color-gamut: p3)"]) {
    const list = window.matchMedia(query)
    // `addEventListener` on a MediaQueryList is unsupported on older WebKit,
    // where the legacy `addListener` is the only form; neither is worth a
    // failed load, so both are attempted defensively.
    if (typeof list.addEventListener === "function") list.addEventListener("change", refreshReactiveEnvironment)
    else if (typeof (list as unknown as { addListener?: (fn: () => void) => void }).addListener === "function") {
      ;(list as unknown as { addListener: (fn: () => void) => void }).addListener(refreshReactiveEnvironment)
    }
  }
}
