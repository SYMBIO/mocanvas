import { lazy, StrictMode, Suspense } from "react"
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
    </div>
  )
}

const lib = new URLSearchParams(location.search).get("lib")
const page = lib === "mocanvas" ? <MocanvasPage /> : lib === "tldraw" ? <TldrawPage /> : <Index />

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={null}>{page}</Suspense>
  </StrictMode>,
)
