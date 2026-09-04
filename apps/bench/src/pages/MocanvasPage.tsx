import { createShapeId, loadMocanvasFile, Mocanvas, type Editor, type ShapeCreate } from "@mocanvas/mocanvas"
import {
  buildSpecs,
  cameraAt,
  captureProblems,
  dragOffset,
  fitCameraFor,
  foldWarnings,
  gpuInfo,
  memoryMB,
  nextFrame,
  pageBoxToScreen,
  panZoomCamera,
  parseTldrJson,
  runFrames,
  samplePoints,
  settleFrames,
  type BenchApi,
  type CameraLike,
  type Kind,
  type LoadResult,
  type ShapeBox,
  type ShapeSpec,
} from "../bench-api"

function toCreate(spec: ShapeSpec): ShapeCreate {
  switch (spec.kind) {
    case "geo":
      return {
        id: createShapeId(),
        type: "geo",
        x: spec.x,
        y: spec.y,
        rotation: spec.rotation,
        props: { geo: spec.geo, w: spec.w, h: spec.h, color: spec.color, fill: spec.fill },
      }
    case "draw":
      return {
        id: createShapeId(),
        type: "draw",
        x: spec.x,
        y: spec.y,
        props: { color: spec.color, segments: [{ type: "free", points: spec.points }], isComplete: true },
      }
    case "arrow":
      return {
        id: createShapeId(),
        type: "arrow",
        x: spec.x,
        y: spec.y,
        props: { color: spec.color, start: spec.start, end: spec.end, bend: spec.bend },
      }
    case "note":
      return { id: createShapeId(), type: "note", x: spec.x, y: spec.y, props: { color: spec.color, text: spec.text } }
    case "text":
      return {
        id: createShapeId(),
        type: "text",
        x: spec.x,
        y: spec.y,
        props: { color: spec.color, text: spec.text, w: 160, autoSize: false },
      }
  }
}

/**
 * Compare a loaded document against what this build of mocanvas understands.
 * Produces human-readable warnings for unknown shape/binding types and for
 * props that either side does not know about.
 */
function compatWarnings(editor: Editor, records: ReturnType<typeof parseTldrJson>["records"]): string[] {
  const out: string[] = []
  for (const r of records) {
    const type = String(r["type"] ?? "")
    const props = (r["props"] ?? {}) as Record<string, unknown>
    if (r.typeName === "shape") {
      if (!editor.hasShapeUtil(type)) {
        out.push(`shape type "${type}" is not registered`)
        continue
      }
      const defaults = editor.getShapeUtil(type).getDefaultProps() as Record<string, unknown>
      for (const k of Object.keys(props)) if (!(k in defaults)) out.push(`${type}: unknown prop "${k}"`)
      for (const k of Object.keys(defaults)) if (!(k in props)) out.push(`${type}: missing prop "${k}" (default used)`)
      if (type === "draw") {
        const segs = props["segments"]
        if (Array.isArray(segs)) {
          for (const s of segs as Record<string, unknown>[]) {
            if (!Array.isArray(s["points"])) out.push(`draw: segment uses the packed "path" form (decoded to "points" on load)`)
          }
        }
      }
    } else if (r.typeName === "binding") {
      if (!editor.hasBindingUtil(type)) {
        out.push(`binding type "${type}" is not registered`)
        continue
      }
      const defaults = editor.getBindingUtil(type).getDefaultProps() as Record<string, unknown>
      for (const k of Object.keys(props)) if (!(k in defaults)) out.push(`binding ${type}: unknown prop "${k}"`)
    }
  }
  return foldWarnings(out)
}

function install(editor: Editor): BenchApi {
  const setCam = (cam: CameraLike) => editor.setCamera(cam)
  const fitCamera = (): CameraLike | null => {
    const b = editor.getCurrentPageBounds()
    if (!b || b.w <= 0 || b.h <= 0) return null
    const cam = fitCameraFor(b, editor.getViewportScreenBounds(), editor.options.zoomMin, editor.options.zoomMax)
    setCam(cam)
    return editor.getCamera()
  }

  const api: BenchApi = {
    lib: "mocanvas",
    isReady: () => !editor.getIsDisposed(),
    shapeCount: () => editor.getCurrentPageShapeIds().size,
    gpuInfo,
    fitCamera,

    shapeBoxes(): ShapeBox[] {
      const cam = editor.getCamera()
      const out: ShapeBox[] = []
      for (const shape of editor.getCurrentPageShapesSorted()) {
        const b = editor.getShapePageBounds(shape)
        if (!b) continue
        const s = pageBoxToScreen({ x: b.x, y: b.y, w: b.w, h: b.h }, cam)
        const geo = (shape.props as { geo?: string }).geo
        out.push({ id: String(shape.id), type: shape.type, ...(geo ? { geo } : {}), ...s })
      }
      return out
    },

    async create(n: number, kind: Kind = "geo") {
      const creates = buildSpecs(n, kind).map(toCreate)
      const t0 = performance.now()
      editor.run(() => editor.createShapes(creates), { history: "ignore" })
      const t1 = performance.now()
      fitCamera()
      await settleFrames(2)
      return { ms: t1 - t0, firstFrameMs: performance.now() - t0, count: editor.getCurrentPageShapeIds().size }
    },

    async clear() {
      editor.selectNone()
      const ids = [...editor.getCurrentPageShapeIds()]
      editor.run(() => editor.deleteShapes(ids), { history: "ignore" })
      editor.history.clear()
      await settleFrames(2)
    },

    async panZoomRun(frames = 120) {
      const b = editor.getCurrentPageBounds() ?? { x: 0, y: 0, w: 1000, h: 1000 }
      const vp = editor.getViewportScreenBounds()
      const fit = fitCameraFor(b, vp, editor.options.zoomMin, editor.options.zoomMax)
      setCam(fit)
      const res = await runFrames(frames, (_i, t) => setCam(panZoomCamera(t, b, vp, fit)))
      setCam(fit)
      res.zoomFit = editor.getCamera().z
      return res
    },

    async selectAllDragRun(frames = 60) {
      editor.selectAll()
      const ids = editor.getSelectedShapeIds()
      const res = await runFrames(frames, (i) => {
        editor.run(() => editor.nudgeShapes(ids, dragOffset(i, frames)), { history: "ignore" })
      })
      editor.selectNone()
      return res
    },

    async hitTestRun(samples = 500) {
      const b = editor.getCurrentPageBounds() ?? { x: 0, y: 0, w: 1000, h: 1000 }
      const pts = samplePoints(b, samples)
      let hits = 0
      const t0 = performance.now()
      for (const p of pts) if (editor.getShapeAtPoint(p, { hitInside: true, margin: 8 })) hits++
      const t1 = performance.now()
      return { samples, avgUs: ((t1 - t0) * 1000) / samples, hits }
    },

    memoryMB,

    async loadTldr(json: unknown): Promise<LoadResult> {
      const warnings: string[] = []
      let file: ReturnType<typeof parseTldrJson>
      try {
        file = parseTldrJson(json)
      } catch (e) {
        return { ok: false, error: String(e), records: 0, shapes: 0, warnings }
      }
      const result = await captureProblems(warnings, async () => {
        try {
          const res = loadMocanvasFile(editor, file)
          if (!res.ok) return { ok: false, error: String(res.error) }
          return { ok: true }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      })
      warnings.push(...compatWarnings(editor, file.records))
      // Render a few frames with error capture so shape-geometry failures show up too.
      await captureProblems(warnings, async () => {
        fitCamera()
        await settleFrames(3)
      })
      const shapes = editor.getCurrentPageShapeIds().size
      return {
        ok: result.ok,
        ...(result.error ? { error: result.error } : {}),
        records: file.records.length,
        shapes,
        warnings: foldWarnings(warnings),
      }
    },

    async screenshotReady() {
      await document.fonts.ready
      await settleFrames(3)
      await nextFrame()
      return true
    },
  }
  return api
}

export default function MocanvasPage() {
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Mocanvas
        hideUi
        showStats={false}
        options={{ maxShapesPerPage: 1_000_000 }}
        onMount={(editor) => {
          ;(window as unknown as { editor: Editor }).editor = editor
          window.bench = install(editor)
          return () => {
            delete window.bench
          }
        }}
      />
    </div>
  )
}

// Keep `cameraAt` referenced for parity with the tldraw page's imports (tree-shaken otherwise).
void cameraAt
