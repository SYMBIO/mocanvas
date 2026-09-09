import { lazy, StrictMode, Suspense } from "react"
import { buildGallery } from "./gallery"
import { createRoot } from "react-dom/client"

const MocanvasPage = lazy(() => import("./pages/MocanvasPage"))
const TldrawPage = lazy(() => import("./pages/TldrawPage"))

function Index() {
  return (
    <div style={{ padding: 24, fontFamily: "system-ui", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>mocanvas bench</h1>
      <p>Each page exposes the same <code>window.bench</code> API. Driven by <code>scripts/bench.mjs</code>.</p>
      <ul>
        <li><a href="/?lib=mocanvas">?lib=mocanvas</a></li>
        <li><a href="/?lib=tldraw">?lib=tldraw</a></li>
      </ul>
      <p style={{ marginTop: 24 }}>
        For looking rather than measuring, add <code>&amp;ui=1</code> for a switcher that flips
        between the two on the same view (backtick flips it):{" "}
        <a href="/?lib=mocanvas&ui=1">side-by-side comparison</a>.
      </p>
    </div>
  )
}

/** Wait for the page's editor, then run `fn` against it. */
async function withEditor(fn: (ed: any) => void | Promise<void>) {
  const w = window as any
  for (let i = 0; i < 600 && !w.bench?.isReady(); i++) await new Promise((r) => setTimeout(r, 50))
  if (!w.editor) return
  await fn(w.editor)
}

/** Put `what` on the canvas. Identical code on both pages, so the two views are comparable. */
async function applyShape(what: string) {
  await withEditor(async (ed) => {
    ed.selectAll()
    ed.deleteShapes(ed.getSelectedShapeIds())
    if (what === "gallery") {
      const bench = (window as any).bench
      buildGallery(ed as never, (r, e) => console.warn(`gallery row "${r}" failed:`, e), bench?.compressSegments?.bind(bench))
      return
    }
    if (what === "fixture") {
      const doc = await (window as any).fetch("/compare.tldr").then((r: Response) => r.json())
      await (window as any).bench.loadTldr(doc)
      ed.zoomToFit({ animation: { duration: 0 } })
      return
    }
    ed.createShape({
      type: "geo",
      x: 0,
      y: 0,
      props: { geo: "ellipse", w: 800, h: 800, dash: "draw", size: "xl", color: "red", fill: "none" },
    })
    ed.setCamera({ x: 200, y: 0, z: 1 }, { animation: { duration: 0 }, force: true })
  })
}

/**
 * A switcher for comparing the two renderings by eye.
 *
 * Behind `?ui=1` and nothing else, because `scripts/bench.mjs` screenshots these
 * pages whole and diffs them pixel for pixel — anything painted over the canvas
 * would land in that diff and be counted as a difference between the libraries.
 * The bench never passes the flag, so it never sees this.
 */
function Switcher({ lib }: { lib: string }) {
  const other = lib === "mocanvas" ? "tldraw" : "mocanvas"
  const go = (to: string) => {
    const q = new URLSearchParams(location.search)
    q.set("lib", to)
    location.search = String(q)
  }
  // The choice is remembered in the URL, not in the page: switching library
  // reloads, and a comparison you have to rebuild after every flip is no
  // comparison at all.
  const choose = (what: string) => {
    const q = new URLSearchParams(location.search)
    q.set("shape", what)
    history.replaceState(null, "", `?${q}`)
    void applyShape(what)
  }
  const action = {
    padding: "6px 10px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    background: "#fff",
    font: "500 12px system-ui",
    color: "#374151",
    cursor: "pointer",
  }
  const tab = (name: string) => ({
    padding: "6px 14px",
    border: "none",
    borderRadius: 6,
    font: "600 13px system-ui",
    cursor: name === lib ? "default" : "pointer",
    background: name === lib ? "#111827" : "transparent",
    color: name === lib ? "#fff" : "#374151",
  })
  return (
    <div
      style={{
        position: "fixed",
        zIndex: 999999,
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        gap: 4,
        padding: 4,
        borderRadius: 9,
        background: "rgba(255,255,255,0.92)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.16)",
        backdropFilter: "blur(6px)",
      }}
    >
      <button style={tab("mocanvas")} onClick={() => lib !== "mocanvas" && go("mocanvas")}>mocanvas</button>
      <button style={tab("tldraw")} onClick={() => lib !== "tldraw" && go("tldraw")}>tldraw</button>
      <span style={{ alignSelf: "center", padding: "0 6px", font: "12px system-ui", color: "#6b7280" }}>
        <kbd>`</kbd> toggles
      </span>
      <span style={{ alignSelf: "center", width: 1, height: 20, background: "#e5e7eb" }} />
      <button style={action} onClick={() => choose("circle")}>big circle</button>
      <button style={action} onClick={() => choose("fixture")}>fixture</button>
      <button style={action} onClick={() => choose("gallery")}>gallery</button>
    </div>
  )
}

const params = new URLSearchParams(location.search)
const lib = params.get("lib")
const showUi = params.get("ui") === "1"
const page = lib === "mocanvas" ? <MocanvasPage /> : lib === "tldraw" ? <TldrawPage /> : <Index />

if (showUi && lib) {
  const remembered = params.get("shape")
  if (remembered) void applyShape(remembered)
  // Backtick, in the capture phase. Every letter worth reaching for is already a
  // tool shortcut in both editors — `t` picks the text tool and the canvas eats
  // the event before it ever reaches here — and capture is what stops the canvas
  // swallowing this one too.
  addEventListener(
    "keydown",
    (e) => {
      const el = document.activeElement
      if (e.key !== "`" || e.metaKey || e.ctrlKey || e.altKey) return
      if (el instanceof HTMLElement && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return
      e.preventDefault()
      e.stopPropagation()
      const q = new URLSearchParams(location.search)
      q.set("lib", lib === "mocanvas" ? "tldraw" : "mocanvas")
      location.search = String(q)
    },
    true,
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={null}>
      {page}
      {showUi && lib ? <Switcher lib={lib} /> : null}
    </Suspense>
  </StrictMode>,
)
