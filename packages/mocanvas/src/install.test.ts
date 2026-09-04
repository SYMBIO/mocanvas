import { describe, expect, it } from "vitest"
import { getExportImplementation, getTextMeasureProvider } from "@mocanvas/editor"

describe("importing mocanvas", () => {
  it("installs the editor members that need this package", async () => {
    // The seams are empty until something registers them...
    expect(getExportImplementation()).toBeNull()
    expect(getTextMeasureProvider()).toBeNull()

    // ...and importing the package is what does it.
    await import("./index")

    const exporter = getExportImplementation()
    expect(exporter).not.toBeNull()
    expect(typeof exporter!.getSvgString).toBe("function")
    expect(typeof exporter!.toImage).toBe("function")
    expect(typeof getTextMeasureProvider()).toBe("function")
  })
})
