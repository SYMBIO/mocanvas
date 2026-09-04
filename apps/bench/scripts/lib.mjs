/**
 * Shared plumbing for the bench scripts: production build, preview server,
 * browser launch (GPU with software fallback) and page bootstrap.
 *
 * tldraw is exercised only through the pages in `src/`, which use its public
 * documented API. Nothing here reads or copies tldraw internals.
 */
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
export const REPO_ROOT = resolve(ROOT, "../..")

export const VIEWPORT = { width: 1200, height: 800 }

/** Chromium args that ask for real GPU acceleration. */
const GPU_ARGS = ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--enable-zero-copy"]
/** Chromium args that force ANGLE's SwiftShader software rasteriser. */
const SWIFTSHADER_ARGS = ["--use-gl=angle", "--use-angle=swiftshader"]
/** Always on: deterministic-ish timing plus `window.gc` for the heap metric. */
const BASE_ARGS = ["--js-flags=--expose-gc", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none"]

/** Build the bench app for production (both pages get minified, NODE_ENV=production React). */
export async function buildApp() {
  process.env.NODE_ENV = "production"
  const { build } = await import("vite")
  await build({ root: ROOT, mode: "production", logLevel: "warn" })
}

/** Serve `dist/` with `vite preview`. Returns `{ url, close }`. */
export async function startPreview(port = 5182) {
  const { preview } = await import("vite")
  const server = await preview({ root: ROOT, preview: { port, strictPort: true, host: "127.0.0.1" }, logLevel: "warn" })
  const url = server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${port}/`
  return { url: url.replace(/\/$/, ""), close: () => server.close() }
}

/**
 * Launch headless Chromium. Tries GPU args first; if the page cannot get a
 * WebGL2 context, relaunches forcing SwiftShader. Returns the browser plus a
 * `mode` string ("gpu" | "swiftshader") for the report.
 */
export async function launchBrowser({ chromium }, previewUrl) {
  const attempts = [
    { mode: "gpu", args: [...BASE_ARGS, ...GPU_ARGS] },
    { mode: "swiftshader", args: [...BASE_ARGS, ...SWIFTSHADER_ARGS] },
  ]
  let lastErr
  for (const attempt of attempts) {
    let browser
    try {
      browser = await chromium.launch({ headless: true, args: attempt.args })
      const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
      await page.goto(`${previewUrl}/?lib=mocanvas`, { waitUntil: "load" })
      const gpu = await page.evaluate(() => {
        const c = document.createElement("canvas")
        const gl = c.getContext("webgl2")
        if (!gl) return { webgl2: false, renderer: "unavailable", vendor: "unavailable" }
        const ext = gl.getExtension("WEBGL_debug_renderer_info")
        return {
          webgl2: true,
          renderer: String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
          vendor: String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
        }
      })
      await page.close()
      if (!gpu.webgl2 && attempt.mode === "gpu") {
        await browser.close()
        continue
      }
      // Even the "gpu" arg set usually lands on ANGLE/SwiftShader in headless
      // Chromium; say so rather than claiming hardware acceleration.
      const software = /swiftshader|llvmpipe|software/i.test(`${gpu.renderer} ${gpu.vendor}`)
      return { browser, mode: attempt.mode, software, gpu, args: attempt.args, version: browser.version() }
    } catch (e) {
      lastErr = e
      await browser?.close().catch(() => {})
    }
  }
  throw lastErr ?? new Error("could not launch chromium")
}

/** Open a bench page and wait until `window.bench` is installed and ready. */
export async function openBenchPage(browser, previewUrl, lib, { onConsole } = {}) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  page.setDefaultTimeout(120_000)
  const logs = []
  page.on("console", (m) => {
    const line = `${m.type()}: ${m.text()}`
    logs.push(line)
    onConsole?.(line)
  })
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`))
  await page.goto(`${previewUrl}/?lib=${lib}`, { waitUntil: "load" })
  await page.waitForFunction(() => Boolean(window.bench?.isReady()), null, { timeout: 120_000 })
  // Let fonts and the first paint settle before anyone measures.
  await page.evaluate(() => window.bench.screenshotReady())
  return { page, logs }
}

/** `page.evaluate` with a hard wall-clock cap; on timeout the page is killed so the eval rejects. */
export async function withTimeout(page, ms, fn, arg) {
  let timer
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => {
      page.close({ runBeforeUnload: false }).catch(() => {})
      rej(new Error(`timed out after ${ms} ms`))
    }, ms)
  })
  try {
    return await Promise.race([page.evaluate(fn, arg), timeout])
  } finally {
    clearTimeout(timer)
  }
}

export function median(values) {
  const xs = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b)
  if (!xs.length) return null
  const mid = xs.length >> 1
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}
