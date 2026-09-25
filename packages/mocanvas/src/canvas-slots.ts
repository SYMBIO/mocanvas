import type { CanvasProps } from "@mocanvas/editor"

/**
 * The slots `<Canvas>` owns, out of the one map tldraw passes everything in.
 *
 * `Canvas` renders these; the chrome does not and cannot. Anything else in
 * `components` is a panel and goes to `TldrawUi`.
 */
const CANVAS_SLOTS = ["Background", "Grid", "InFrontOfTheCanvas", "Brush", "Indicators", "ErrorFallback", "ShapeErrorFallback"] as const

export function pickCanvasSlots(components: Record<string, unknown> | undefined): CanvasProps["components"] | undefined {
  if (!components) return undefined
  const out: Record<string, unknown> = {}
  for (const key of CANVAS_SLOTS) {
    const slot = (components as Record<string, unknown>)[key]
    // `undefined` is what an object literal says about every slot it does not
    // mention, so only a named one — including a `null` that removes a default
    // — counts as an instruction.
    if (slot !== undefined) out[key] = slot
  }
  return Object.keys(out).length === 0 ? undefined : (out as CanvasProps["components"])
}
