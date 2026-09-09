// tldraw is used here only through its public, documented API (see docs/BENCHMARK.md).
import "tldraw/tldraw.css"

import { BaseBoxShapeUtil, HTMLContainer } from "tldraw"
import { makeGalleryCardUtil } from "../gallery-card"
import {
  compressLegacySegments,
  createBindingId,
  createShapeId,
  getIndices,
  getPointsFromDrawSegment,
  getSnapshot,
  renderPlaintextFromRichText,
  Tldraw,
  toRichText,
  type Editor,
  type TLArrowBinding,
  type TLArrowShape,
  type TLBindingCreate,
  type TLCreateShapePartial,
  type TLDrawShape,
  type TLFrameShape,
  type TLGeoShape,
  type TLLineShape,
  type TLNoteShape,
  type TLShape,
  type TLTextShape,
} from "tldraw"
import {
  buildSpecs,
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

type AnyCreate = TLCreateShapePartial<TLShape>

function toCreate(spec: ShapeSpec): AnyCreate {
  switch (spec.kind) {
    case "geo": {
      const c: TLCreateShapePartial<TLGeoShape> = {
        id: createShapeId(),
        type: "geo",
        x: spec.x,
        y: spec.y,
        rotation: spec.rotation,
        props: { geo: spec.geo, w: spec.w, h: spec.h, color: spec.color, fill: spec.fill },
      }
      return c
    }
    case "draw": {
      const c: TLCreateShapePartial<TLDrawShape> = {
        id: createShapeId(),
        type: "draw",
        x: spec.x,
        y: spec.y,
        props: {
          color: spec.color,
          segments: compressLegacySegments([{ type: "free", points: spec.points.map((p) => ({ x: p.x, y: p.y, z: 0.5 })) }]),
          isComplete: true,
        },
      }
      return c
    }
    case "arrow": {
      const c: TLCreateShapePartial<TLArrowShape> = {
        id: createShapeId(),
        type: "arrow",
        x: spec.x,
        y: spec.y,
        props: { color: spec.color, start: spec.start, end: spec.end, bend: spec.bend },
      }
      return c
    }
    case "note": {
      const c: TLCreateShapePartial<TLNoteShape> = {
        id: createShapeId(),
        type: "note",
        x: spec.x,
        y: spec.y,
        props: { color: spec.color, richText: toRichText(spec.text) },
      }
      return c
    }
    case "text": {
      const c: TLCreateShapePartial<TLTextShape> = {
        id: createShapeId(),
        type: "text",
        x: spec.x,
        y: spec.y,
        props: { color: spec.color, richText: toRichText(spec.text), w: 160, autoSize: false },
      }
      return c
    }
  }
}

/** The rendering-comparison fixture: one of each built-in shape family, plus a binding and a frame. */
function createFixture(editor: Editor): void {
  const rect = createShapeId("fx-rect")
  const arrowBent = createShapeId("fx-arrow-bent")
  const frame = createShapeId("fx-frame")
  const pts = Array.from({ length: 40 }, (_, k) => {
    const t = k / 39
    return { x: t * 260, y: 40 + 30 * Math.sin(t * Math.PI * 3), z: 0.5 }
  })
  const [i1, i2, i3] = getIndices(3)
  const shapes: AnyCreate[] = [
    {
      id: rect,
      type: "geo",
      x: 100,
      y: 100,
      props: { geo: "rectangle", w: 200, h: 120, color: "blue", fill: "semi", richText: toRichText("Hello box") },
    } satisfies TLCreateShapePartial<TLGeoShape>,
    { id: createShapeId("fx-ellipse"), type: "geo", x: 380, y: 100, props: { geo: "ellipse", w: 160, h: 160, color: "red", fill: "solid" } } satisfies TLCreateShapePartial<TLGeoShape>,
    { id: createShapeId("fx-star"), type: "geo", x: 620, y: 100, props: { geo: "star", w: 140, h: 140, color: "yellow", fill: "semi" } } satisfies TLCreateShapePartial<TLGeoShape>,
    { id: createShapeId("fx-triangle"), type: "geo", x: 820, y: 100, props: { geo: "triangle", w: 140, h: 120, color: "green", fill: "none" } } satisfies TLCreateShapePartial<TLGeoShape>,
    { id: createShapeId("fx-hexagon"), type: "geo", x: 1020, y: 100, props: { geo: "hexagon", w: 140, h: 140, color: "violet", fill: "solid" } } satisfies TLCreateShapePartial<TLGeoShape>,
    {
      id: createShapeId("fx-draw"),
      type: "draw",
      x: 100,
      y: 320,
      props: { color: "black", segments: compressLegacySegments([{ type: "free", points: pts }]), isComplete: true },
    } satisfies TLCreateShapePartial<TLDrawShape>,
    {
      id: arrowBent,
      type: "arrow",
      x: 480,
      y: 420,
      props: { color: "black", start: { x: 0, y: 0 }, end: { x: -220, y: -170 }, bend: 40, arrowheadEnd: "arrow" },
    } satisfies TLCreateShapePartial<TLArrowShape>,
    {
      id: createShapeId("fx-arrow-straight"),
      type: "arrow",
      x: 620,
      y: 320,
      props: { color: "orange", start: { x: 0, y: 0 }, end: { x: 200, y: 80 }, bend: 0 },
    } satisfies TLCreateShapePartial<TLArrowShape>,
    {
      id: createShapeId("fx-line"),
      type: "line",
      x: 880,
      y: 320,
      props: {
        color: "light-blue",
        spline: "line",
        points: {
          a1: { id: "a1", index: i1!, x: 0, y: 0 },
          a2: { id: "a2", index: i2!, x: 120, y: 90 },
          a3: { id: "a3", index: i3!, x: 240, y: 0 },
        },
      },
    } satisfies TLCreateShapePartial<TLLineShape>,
    { id: createShapeId("fx-note"), type: "note", x: 100, y: 520, props: { richText: toRichText("Sticky note") } } satisfies TLCreateShapePartial<TLNoteShape>,
    {
      id: createShapeId("fx-text"),
      type: "text",
      x: 380,
      y: 560,
      props: { richText: toRichText("Plain text shape"), w: 300, autoSize: false, color: "black" },
    } satisfies TLCreateShapePartial<TLTextShape>,
    { id: frame, type: "frame", x: 700, y: 500, props: { w: 400, h: 260, name: "Frame A" } } satisfies TLCreateShapePartial<TLFrameShape>,
    {
      id: createShapeId("fx-frame-child-1"),
      type: "geo",
      x: 30,
      y: 40,
      parentId: frame,
      props: { geo: "rectangle", w: 120, h: 80, color: "light-blue", fill: "semi" },
    } satisfies TLCreateShapePartial<TLGeoShape>,
    {
      id: createShapeId("fx-frame-child-2"),
      type: "geo",
      x: 220,
      y: 60,
      parentId: frame,
      props: { geo: "ellipse", w: 120, h: 120, color: "light-red", fill: "semi" },
    } satisfies TLCreateShapePartial<TLGeoShape>,
  ]
  const binding: TLBindingCreate<TLArrowBinding> = {
    id: createBindingId("fx-bind"),
    type: "arrow",
    fromId: arrowBent,
    toId: rect,
    props: { terminal: "end", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false },
  }
  editor.run(() => {
    editor.createShapes(shapes)
    editor.createBindings([binding])
  })
}

function install(editor: Editor): BenchApi {
  const setCam = (cam: CameraLike) => editor.setCamera(cam, { immediate: true, force: true })
  const fitCamera = (): CameraLike | null => {
    const b = editor.getCurrentPageBounds()
    if (!b || b.w <= 0 || b.h <= 0) return null
    setCam(fitCameraFor(b, editor.getViewportScreenBounds()))
    const c = editor.getCamera()
    return { x: c.x, y: c.y, z: c.z }
  }

  const api: BenchApi = {
    lib: "tldraw",
    isReady: () => !editor.isDisposed,
    shapeCount: () => editor.getCurrentPageShapeIds().size,
    gpuInfo,
    compressSegments: (segments) => compressLegacySegments(segments as never) as unknown[],
    fitCamera,

    shapeBoxes(): ShapeBox[] {
      const cam = editor.getCamera()
      const out: ShapeBox[] = []
      for (const shape of editor.getCurrentPageShapesSorted()) {
        const b = editor.getShapePageBounds(shape)
        if (!b) continue
        const s = pageBoxToScreen({ x: b.x, y: b.y, w: b.w, h: b.h }, { x: cam.x, y: cam.y, z: cam.z })
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
      editor.clearHistory()
      await settleFrames(2)
    },

    async panZoomRun(frames = 120) {
      const b = editor.getCurrentPageBounds() ?? { x: 0, y: 0, w: 1000, h: 1000 }
      const vp = editor.getViewportScreenBounds()
      const fit = fitCameraFor(b, vp)
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
          const store: Record<string, unknown> = {}
          for (const r of file.records) store[r.id] = r
          editor.loadSnapshot({ document: { schema: file.schema, store } as never })
          return { ok: true as boolean }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      })
      await captureProblems(warnings, async () => {
        fitCamera()
        await settleFrames(3)
      })
      return {
        ok: result.ok,
        ...(result.error ? { error: result.error } : {}),
        records: file.records.length,
        shapes: editor.getCurrentPageShapeIds().size,
        warnings: foldWarnings(warnings),
      }
    },

    async screenshotReady() {
      await document.fonts.ready
      await settleFrames(3)
      await nextFrame()
      return true
    },

    async makeFixture() {
      await api.clear()
      createFixture(editor)
      fitCamera()
      // Let derived props (text measurement, note sizing) settle before snapshotting.
      await settleFrames(5)
      const { document } = getSnapshot(editor.store)
      return { tldrawFileFormatVersion: 1, schema: document.schema, records: Object.values(document.store) }
    },

    async downconvert(json: unknown) {
      const file = parseTldrJson(json)
      const records = file.records.map((r) => {
        if (r.typeName !== "shape") return r
        const props = { ...((r["props"] ?? {}) as Record<string, unknown>) }
        if (props["richText"]) {
          props["text"] = renderPlaintextFromRichText(editor, props["richText"] as never)
          delete props["richText"]
        }
        if (r["type"] === "draw" && Array.isArray(props["segments"])) {
          const scaleX = (props["scaleX"] as number) ?? 1
          const scaleY = (props["scaleY"] as number) ?? 1
          props["segments"] = (props["segments"] as never[]).map((seg) => {
            const points = getPointsFromDrawSegment(seg, scaleX, scaleY).map((p) => ({ x: p.x, y: p.y, z: p.z }))
            const { path: _path, ...rest } = seg as Record<string, unknown>
            return { ...rest, points }
          })
        }
        return { ...r, props }
      })
      return { ...file, records }
    },
  }
  return api
}

/**
 * Built once. The same factory runs on both pages against each library's own
 * primitives, so the gallery's custom row is a like-for-like test of the two
 * extension points rather than of two different shapes.
 */
const galleryCardUtil = makeGalleryCardUtil({ BaseBoxShapeUtil, HTMLContainer } as never) as never
;(globalThis as { __GALLERY_HAS_CUSTOM__?: boolean }).__GALLERY_HAS_CUSTOM__ = true

export default function TldrawPage() {
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Tldraw
        shapeUtils={[galleryCardUtil]}
        hideUi
        colorScheme="light"
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
