/**
 * A gallery of every element the two libraries offer, laid out in labelled rows.
 *
 * Deliberately separate from `compare.tldr`. That fixture is what `scripts/bench.mjs`
 * diffs pixel for pixel, so its contents are a measurement baseline and growing it
 * would invalidate every parity number on record. This one exists to be *looked* at,
 * and it can grow freely.
 *
 * It is built by calling the editor rather than by shipping a `.tldr`, and the same
 * code runs against both libraries — which is the point: anything that comes out
 * different came from the renderer, not from two different documents. Only the
 * shape-creation API both expose is used here.
 */

type AnyEditor = {
  createShape(shape: Record<string, unknown>): unknown
  createShapes(shapes: Record<string, unknown>[]): unknown
  createAssets?(assets: Record<string, unknown>[]): unknown
  selectAll(): unknown
  deleteShapes(ids: unknown): unknown
  getSelectedShapeIds(): unknown
  getCurrentPageShapes(): { id: string; type: string }[]
  groupShapes?(ids: unknown[]): unknown
  zoomToFit(opts?: unknown): unknown
}

export const GEO_KINDS = [
  "rectangle", "ellipse", "triangle", "diamond", "pentagon", "hexagon", "octagon", "star",
  "rhombus", "rhombus-2", "oval", "trapezoid", "arrow-right", "arrow-left", "arrow-up",
  "arrow-down", "x-box", "check-box", "cloud", "heart",
] as const
export const COLORS = [
  "black", "grey", "light-violet", "violet", "blue", "light-blue", "yellow", "orange",
  "green", "light-green", "light-red", "red", "white",
] as const
export const FILLS = ["none", "semi", "solid", "pattern"] as const
export const DASHES = ["draw", "solid", "dashed", "dotted"] as const
export const SIZES = ["s", "m", "l", "xl"] as const
export const FONTS = ["draw", "sans", "serif", "mono"] as const
export const ARROWHEADS = ["none", "arrow", "triangle", "square", "dot", "diamond", "inverted", "bar", "pipe"] as const

/**
 * A swatch for the image row, drawn here rather than pasted in as base64.
 *
 * It was a base64 literal, and the literal was corrupt: its IDAT chunk carried
 * the wrong CRC. Image decoders do not check that — `drawImage` and
 * `naturalWidth` were perfectly happy — but WebGL refuses such a file, so
 * `texImage2D` answered GL_INVALID_VALUE, the texture was never allocated, and
 * the shape sampled an empty one and came out solid black with nothing said.
 * A picture the browser will draw is not necessarily a picture the GPU will
 * take, and a hand-typed one cannot be proofread. So it is generated, which
 * cannot be mistyped, and a gradient with an alpha ramp makes it obvious at a
 * glance whether transparency survived the trip.
 */
function makeSwatch(): string {
  const c = document.createElement("canvas")
  c.width = 64
  c.height = 64
  const ctx = c.getContext("2d")
  if (!ctx) return ""
  const g = ctx.createLinearGradient(0, 0, 64, 64)
  g.addColorStop(0, "rgba(220, 38, 38, 1)")
  g.addColorStop(1, "rgba(37, 99, 235, 0)")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return c.toDataURL("image/png")
}

/** Clear space under a row, on top of whatever height that row declares. */
const ROW_GAP = 90
const LABEL_DY = -46

/** Rich text in the shape shared by both libraries: a ProseMirror-ish doc. */
function richText(text: string): Record<string, unknown> {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
}

/** One row's heading, so the gallery reads as a list rather than a heap. */
function heading(x: number, y: number, text: string): Record<string, unknown> {
  return {
    type: "text",
    x,
    y: y + LABEL_DY,
    props: { richText: richText(text), color: "grey", size: "s", font: "sans", autoSize: true },
  }
}

/**
 * Build the gallery on `editor`, replacing whatever is there.
 *
 * `onError` is called with the row that failed rather than throwing: a shape family
 * one library does not have yet should cost that row, not the whole page.
 */
export function buildGallery(
  editor: AnyEditor,
  onError: (row: string, err: unknown) => void = () => {},
  compressSegments: (segments: unknown[]) => unknown[] = (s) => s,
): void {
  editor.selectAll()
  editor.deleteShapes(editor.getSelectedShapeIds())

  // Rows are not all the same height, so each says how tall it is rather than
  // every row paying for the tallest — and rows that overlap their neighbour are
  // exactly what makes a gallery unreadable.
  let y = 0
  const row = (name: string, height: number, build: (y: number) => Record<string, unknown>[]) => {
    try {
      editor.createShapes([heading(0, y, name), ...build(y)])
    } catch (err) {
      onError(name, err)
    }
    y += height + ROW_GAP
  }

  row("geo — every kind", 120, (y0) =>
    GEO_KINDS.map((geo, i) => ({
      type: "geo",
      x: i * 150,
      y: y0,
      props: { geo, w: 120, h: 120, color: "blue", fill: "semi", dash: "draw" },
    })),
  )

  row("fill × dash", 90, (y0) =>
    FILLS.flatMap((fill, r) =>
      DASHES.map((dash, c) => ({
        type: "geo",
        x: (r * DASHES.length + c) * 150,
        y: y0,
        props: { geo: "rectangle", w: 120, h: 90, color: "violet", fill, dash },
      })),
    ),
  )

  row("size s / m / l / xl", 160, (y0) =>
    SIZES.map((size, i) => ({
      type: "geo",
      x: i * 200,
      y: y0,
      props: { geo: "ellipse", w: 160, h: 160, color: "green", fill: "none", dash: "draw", size },
    })),
  )

  row("colours", 100, (y0) =>
    COLORS.map((color, i) => ({
      type: "geo",
      x: i * 120,
      y: y0,
      props: { geo: "rectangle", w: 100, h: 100, color, fill: "solid", dash: "draw" },
    })),
  )

  row("arrowheads", 120, (y0) =>
    ARROWHEADS.map((head, i) => ({
      type: "arrow",
      x: i * 190,
      y: y0 + 60,
      props: { color: "black", start: { x: 0, y: 0 }, end: { x: 150, y: 0 }, bend: 0, arrowheadEnd: head, arrowheadStart: "none" },
    })),
  )

  row("arrows — bend, elbow, labels", 180, (y0) => [
    { type: "arrow", x: 0, y: y0 + 60, props: { color: "orange", start: { x: 0, y: 0 }, end: { x: 220, y: 0 }, bend: 60, arrowheadEnd: "arrow" } },
    { type: "arrow", x: 300, y: y0 + 60, props: { color: "orange", start: { x: 0, y: 0 }, end: { x: 220, y: 0 }, bend: -60, arrowheadEnd: "triangle" } },
    { type: "arrow", x: 620, y: y0, props: { color: "blue", start: { x: 0, y: 0 }, end: { x: 200, y: 120 }, kind: "elbow", arrowheadEnd: "arrow" } },
    { type: "arrow", x: 900, y: y0 + 60, props: { color: "green", start: { x: 0, y: 0 }, end: { x: 240, y: 0 }, bend: 0, arrowheadEnd: "arrow", richText: richText("labelled") } },
  ])

  row("line — straight and cubic", 130, (y0) => {
    const pts = (spline: string) => ({
      type: "line",
      x: spline === "line" ? 0 : 420,
      y: y0,
      props: {
        color: "light-blue",
        spline,
        points: {
          a1: { id: "a1", index: "a1", x: 0, y: 80 },
          a2: { id: "a2", index: "a2", x: 100, y: 0 },
          a3: { id: "a3", index: "a3", x: 200, y: 120 },
          a4: { id: "a4", index: "a4", x: 320, y: 20 },
        },
      },
    })
    return [pts("line"), pts("cubic")]
  })

  row("draw and highlight", 130, (y0) => {
    const wave = (amp: number) =>
      Array.from({ length: 48 }, (_, k) => {
        const t = k / 47
        return { x: t * 320, y: 60 + amp * Math.sin(t * Math.PI * 3), z: 0.5 }
      })
    // tldraw 5 wants the encoded `path` form; mocanvas takes either. Each page
    // hands in its own encoder so this stays one body of code.
    const seg = (amp: number) => compressSegments([{ type: "free", points: wave(amp) }])
    return [
      { type: "draw", x: 0, y: y0, props: { color: "black", segments: seg(40), isComplete: true } },
      { type: "draw", x: 400, y: y0, props: { color: "red", size: "xl", segments: seg(25), isComplete: true } },
      { type: "highlight", x: 800, y: y0, props: { color: "yellow", segments: seg(15), isComplete: true } },
    ]
  })

  row("text — fonts and alignment", 60, (y0) =>
    FONTS.map((font, i) => ({
      type: "text",
      x: i * 260,
      y: y0,
      props: { richText: richText(`font: ${font}`), font, color: "black", w: 240, autoSize: false },
    })),
  )

  row("note — every size", 220, (y0) =>
    SIZES.map((size, i) => ({
      type: "note",
      x: i * 240,
      y: y0,
      props: { richText: richText(`note ${size}`), size, color: "yellow" },
    })),
  )

  row("opacity and rotation", 190, (y0) => [
    ...[1, 0.75, 0.5, 0.25].map((opacity, i) => ({
      type: "geo",
      x: i * 150,
      y: y0,
      opacity,
      props: { geo: "rectangle", w: 120, h: 120, color: "red", fill: "solid", dash: "draw" },
    })),
    ...[0, 0.2, 0.4, 0.6].map((rotation, i) => ({
      type: "geo",
      x: 700 + i * 160,
      y: y0,
      rotation,
      props: { geo: "rectangle", w: 120, h: 120, color: "blue", fill: "semi", dash: "draw" },
    })),
  ])

  // Assets first: an image or video shape without its asset renders as a placeholder.
  try {
    editor.createAssets?.([
      {
        id: "asset:gallery-swatch",
        type: "image",
        typeName: "asset",
        props: { name: "swatch.png", src: makeSwatch(), w: 64, h: 64, mimeType: "image/png", isAnimated: false },
        meta: {},
      },
    ])
  } catch (err) {
    onError("assets", err)
  }

  row("image, bookmark, embed", 190, (y0) => [
    { type: "image", x: 0, y: y0, props: { w: 180, h: 140, assetId: "asset:gallery-swatch" } },
    { type: "bookmark", x: 240, y: y0, props: { w: 300, h: 160, url: "https://example.com", assetId: null } },
    { type: "embed", x: 600, y: y0, props: { w: 320, h: 180, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } },
  ])

  row("frame with children, and a group", 230, (y0) => [
    { id: "shape:gallery-frame", type: "frame", x: 0, y: y0, props: { w: 380, h: 220, name: "Frame" } },
    { id: "shape:gallery-frame-a", type: "geo", x: 30, y: 40, parentId: "shape:gallery-frame", props: { geo: "rectangle", w: 120, h: 80, color: "light-blue", fill: "semi" } },
    { id: "shape:gallery-frame-b", type: "geo", x: 200, y: 50, parentId: "shape:gallery-frame", props: { geo: "ellipse", w: 120, h: 120, color: "light-red", fill: "semi" } },
    { id: "shape:gallery-group-a", type: "geo", x: 480, y: y0, props: { geo: "star", w: 130, h: 130, color: "yellow", fill: "semi" } },
    { id: "shape:gallery-group-b", type: "geo", x: 640, y: y0 + 40, props: { geo: "hexagon", w: 130, h: 130, color: "violet", fill: "semi" } },
  ])
  try {
    editor.groupShapes?.(["shape:gallery-group-a", "shape:gallery-group-b"])
  } catch (err) {
    onError("group", err)
  }

  // The custom shape is registered per page (the imports differ), so it is only
  // created where its util was installed — the row is simply absent otherwise.
  if ((globalThis as { __GALLERY_HAS_CUSTOM__?: boolean }).__GALLERY_HAS_CUSTOM__) {
    row("custom shape (HTML)", 170, (y0) => [
      { type: "gallery-card", x: 0, y: y0, props: { w: 300, h: 160, title: "Custom HTML", body: "Rendered by a ShapeUtil the app registered, not a built-in." } },
      { type: "gallery-card", x: 360, y: y0, props: { w: 300, h: 160, title: "Same in both", body: "Registered identically on the mocanvas and tldraw pages." } },
    ])
  }

  // Not yet: a note or a text shape only gets its real size once its text has
  // been measured, so fitting now fits bounds that are about to grow — which is
  // why a cold load came up on a blank stretch of canvas and needed a second fit
  // by hand. Wait for the page to settle, then frame what is actually there.
  void settleThenFit(editor)
}

/**
 * Fit once the page has stopped changing size.
 *
 * `screenshotReady` is the bench's own "fonts loaded, first paint done" promise,
 * which is the signal worth waiting for — but only up to a point: on a page that
 * has just built a hundred shapes it does not always settle, and waiting on it
 * unconditionally meant the fit never ran at all and the gallery opened at the
 * default camera. So it is raced against a deadline, and the frame pair after
 * covers the layout pass that text measurement triggers.
 */
async function settleThenFit(editor: AnyEditor): Promise<void> {
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)))
  const bench = (globalThis as { bench?: { screenshotReady?(): Promise<unknown> } }).bench
  const ready = bench?.screenshotReady
  if (ready) {
    const deadline = new Promise((r) => setTimeout(r, SETTLE_DEADLINE_MS))
    await Promise.race([Promise.resolve(ready.call(bench)).catch(() => null), deadline])
  }
  await frame()
  await frame()
  editor.zoomToFit({ animation: { duration: 0 } })
}

/** How long the fit waits for the page to say it is ready before going anyway. */
const SETTLE_DEADLINE_MS = 700
