import { atom, track, useEditor, useValue } from "@mocanvas/editor"
import type { Atom } from "@mocanvas/state"
import type { ReactNode } from "react"

/**
 * Debug flags: named booleans an app can flip at runtime, and the panel that
 * lists them.
 *
 * Kept out of the store on purpose. A debug flag is a property of *this
 * session's developer*, not of the document, and putting one in the store
 * would sync it to everyone else in the room.
 */

/** One flag: a name, a default, and the signal holding its current value. */
export interface DebugFlagDef<T> {
  name: string
  defaultValue: T
  /** Show it in the debug panel. */
  shouldStore?: boolean
  value: Atom<T>
}

/** A boolean debug flag. */
export type DebugFlag<T = boolean> = DebugFlagDef<T>

/** Every flag that has been created, in creation order. */
const registry: DebugFlagDef<unknown>[] = []

/** Create a flag of any type. */
export function createDebugValue<T>(name: string, defaultValue: T, shouldStore = true): DebugFlagDef<T> {
  const flag: DebugFlagDef<T> = { name, defaultValue, shouldStore, value: atom(`debug:${name}`, defaultValue) }
  registry.push(flag as DebugFlagDef<unknown>)
  return flag
}

/** Create a boolean flag. */
export function createDebugFlag(name: string, defaultValue = false): DebugFlag {
  return createDebugValue(name, defaultValue)
}

/** Every registered flag. */
export function getDebugFlags(): readonly DebugFlagDef<unknown>[] {
  return registry
}

/** What every flag resolves to before anything has been changed. */
export const DebugFlagDefaults = {
  debugSvg: false,
  debugGeometry: false,
  showCullingOutlines: false,
  logPointerEvents: false,
  throwToBlob: false,
} as const

/** The flags mocanvas itself reads. */
export const debugFlags = {
  debugSvg: createDebugFlag("debugSvg"),
  debugGeometry: createDebugFlag("debugGeometry"),
  showCullingOutlines: createDebugFlag("showCullingOutlines"),
  logPointerEvents: createDebugFlag("logPointerEvents"),
  throwToBlob: createDebugFlag("throwToBlob"),
}

/** Flags an app adds of its own. Extend it through {@link createDebugFlag}. */
export interface CustomDebugFlags {
  [name: string]: DebugFlagDef<unknown>
}

/** Longer-lived switches for work in progress. Same mechanism as a debug flag. */
export const featureFlags: CustomDebugFlags = {}

/** Register a feature flag. */
export function createFeatureFlag(name: string, defaultValue = false): DebugFlag {
  const flag = createDebugFlag(name, defaultValue)
  featureFlags[name] = flag as DebugFlagDef<unknown>
  return flag
}

function FlagRow({ flag }: { flag: DebugFlagDef<unknown> }) {
  const value = useValue(flag.value)
  if (typeof value !== "boolean") return null
  return (
    <label className="mocanvas-debug-flag">
      <input type="checkbox" checked={value} onChange={(event) => flag.value.set(event.target.checked)} />
      {flag.name}
    </label>
  )
}

export interface DebugFlagsProps {
  children?: ReactNode
}

/** The debug flag list. */
export function DebugFlags({ children }: DebugFlagsProps) {
  const flags = getDebugFlags().filter((flag) => flag.shouldStore && !(flag.name in featureFlags))
  return (
    <div className="mocanvas-debug-flags" role="group" aria-label="Debug flags">
      {flags.map((flag) => (
        <FlagRow key={flag.name} flag={flag} />
      ))}
      {children}
    </div>
  )
}

export interface FeatureFlagsProps {
  children?: ReactNode
}

/** The feature flag list. */
export function FeatureFlags({ children }: FeatureFlagsProps) {
  const flags = Object.values(featureFlags)
  if (flags.length === 0) return null
  return (
    <div className="mocanvas-debug-flags" role="group" aria-label="Feature flags">
      {flags.map((flag) => (
        <FlagRow key={flag.name} flag={flag} />
      ))}
      {children}
    </div>
  )
}

/**
 * The frame-statistics chip.
 *
 * Named for the chrome slot it fills rather than for what it shows, because
 * what it shows is whatever is worth watching — and an app replacing it is
 * filling the "small numbers in the corner" hole, not committing to these
 * particular numbers.
 */
export const DefaultDebugPanel = track(function DefaultDebugPanel() {
  const editor = useEditor()
  const stats = editor.getLastFrameStats()
  return (
    <div className="mocanvas-panel mocanvas-stats" role="status" aria-label="Frame statistics">
      <span>
        <b>{editor.getCurrentPageShapeIds().size}</b> shapes
      </span>
      <span>
        <b>{stats.drawn}</b> drawn · <b>{stats.culled}</b> culled
      </span>
      <span>
        <b>{stats.ms.toFixed(2)}</b> ms/frame
      </span>
    </div>
  )
})
