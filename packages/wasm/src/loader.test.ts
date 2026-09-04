import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"

const wasmPath = fileURLToPath(new URL("../pkg/mocanvas_bg.wasm", import.meta.url))

/**
 * A fresh copy of the module (and of the wasm-pack glue under it), so each test
 * gets its own uninitialised engine singleton.
 */
async function freshModule(): Promise<typeof import("./index")> {
  vi.resetModules()
  return import("./index")
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("loadEngine default path", () => {
  it("falls back to the embedded copy when the URL does not serve WebAssembly", async () => {
    // What a dev server's SPA fallback answers with: 200, and HTML in the body.
    const html = new TextEncoder().encode("<!doctype html><html></html>")
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(html, { status: 200, headers: { "content-type": "text/html" } }))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { loadEngine } = await freshModule()

    const bridge = await loadEngine()
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(bridge.shapeCount).toBe(0)

    expect(warn).toHaveBeenCalledOnce()
    const message = String(warn.mock.calls[0]![0])
    expect(message).toContain("mocanvas_bg.wasm")
    expect(message).toContain("embedded")
    expect(message).toContain("optimizeDeps")

    // Warns once, not once per call — and the module is only loaded once.
    const again = await loadEngine()
    expect(again.shapeCount).toBe(0)
    expect(warn).toHaveBeenCalledOnce()
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it("takes the fetched bytes when the URL does serve WebAssembly", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(readFileSync(wasmPath), { status: 200 }))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { loadEngine } = await freshModule()

    const bridge = await loadEngine()
    expect(bridge.shapeCount).toBe(0)
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(warn).not.toHaveBeenCalled()
  })

  it("lets an explicit input fail on its own terms, with no fallback", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { loadEngine } = await freshModule()

    const html = new TextEncoder().encode("<!doctype html><html></html>")
    await expect(loadEngine(html)).rejects.toThrow()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })
})
