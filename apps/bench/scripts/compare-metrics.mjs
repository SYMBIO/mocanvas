/**
 * Region-aware metrics for the mocanvas/tldraw rendering comparison.
 *
 * The whole-image pixel diff cannot fairly score a hand-drawn stroke style.
 * Both libraries wobble the default `dash: "draw"` outline, but with different
 * randomness, so two strokes that both look right miss each other by about a
 * stroke width and every one of those pixels is counted as a disagreement.
 * (Measured: making mocanvas draw exact geometry *improved* the whole-image
 * numbers while making the render look wrong.)
 *
 * So this module measures the two things a pixel comparison can be honest
 * about:
 *
 *   1. `interiorIoU` — agreement over shape interiors, eroded far enough in
 *      from the outline that no stroke pixel is counted. Exact geometry on both
 *      sides: fills, positions and sizes, with the stroke randomness cut out.
 *   2. `strokeBand` — how far mocanvas's stroke sits from the reference's,
 *      as a distance rather than an overlap: for stroke pixels of a given
 *      colour, the distance to the nearest stroke pixel of that colour in the
 *      other render, in both directions, as a median and 95th percentile.
 *      A hand-drawn pair that looks right lands within about a stroke width.
 *
 * Node + `pngjs` only, no new dependencies. Everything here is O(W·H) per
 * colour class: exact Euclidean distance transforms (Felzenszwalb–Huttenlocher)
 * rather than nearest-neighbour searches.
 */
import { PNG } from "pngjs"
import { readFile } from "node:fs/promises"

const INF = 1e20

// ---------------------------------------------------------------------------
// image helpers
// ---------------------------------------------------------------------------

async function readPng(path) {
  const png = PNG.sync.read(await readFile(path))
  return { width: png.width, height: png.height, data: png.data }
}

const rgbAt = (img, i) => [img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]]

/** Chebyshev distance between two RGB triples — the same "any channel" rule the pixel diff uses. */
const chan = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))

/** The page background, taken from a corner both renders leave untouched. */
function backgroundColor(img) {
  return rgbAt(img, 0)
}

/** Pixels that are not the page background — "this render painted something here". */
function paintedMask(img, bg, tol = 6) {
  const n = img.width * img.height
  const mask = new Uint8Array(n)
  for (let i = 0; i < n; i++) mask[i] = chan(rgbAt(img, i), bg) > tol ? 1 : 0
  return mask
}

// ---------------------------------------------------------------------------
// exact Euclidean distance transform (Felzenszwalb & Huttenlocher 2012)
// ---------------------------------------------------------------------------

/** 1-D squared EDT of `f` (length n) into `d`, using the standard lower-envelope scan. */
function edt1d(f, d, v, z, n) {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const dx = q - v[k]
    d[q] = dx * dx + f[v[k]]
  }
}

/**
 * Squared Euclidean distance from every pixel to the nearest pixel where
 * `mask` is 1. Exact, O(W·H). Returns a Float64Array of squared distances.
 */
export function distanceTransform(mask, w, h) {
  const d = new Float64Array(w * h)
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF
  const size = Math.max(w, h)
  const f = new Float64Array(size)
  const dd = new Float64Array(size)
  const v = new Int32Array(size)
  const z = new Float64Array(size + 1)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = d[y * w + x]
    edt1d(f, dd, v, z, h)
    for (let y = 0; y < h; y++) d[y * w + x] = dd[y]
  }
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) f[x] = d[row + x]
    edt1d(f, dd, v, z, w)
    for (let x = 0; x < w; x++) d[row + x] = dd[x]
  }
  return d
}

// ---------------------------------------------------------------------------
// 1. interior IoU
// ---------------------------------------------------------------------------

/**
 * The filled silhouette of whatever this render drew inside `rect`, as a mask
 * over the whole image.
 *
 * Painted pixels are dilated by one pixel so a single antialiased gap in an
 * outline cannot leak, then everything reachable from the rect's border
 * without crossing paint is flood-filled as "outside". What is left — paint,
 * plus everything the paint encloses — is the silhouette. This is how a shape
 * whose fill is the paper colour (`fill: "semi"`, and tldraw's `solid` tint,
 * which are within a few units of the page background) still gets an interior.
 */
function silhouette(painted, w, h, rect) {
  const { x0, y0, x1, y1 } = rect
  const bw = x1 - x0
  const bh = y1 - y0
  // dilate by 1 (8-connected) within the rect
  const solid = new Uint8Array(bw * bh)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!painted[y * w + x]) continue
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < y0 || yy >= y1) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < x0 || xx >= x1) continue
          solid[(yy - y0) * bw + (xx - x0)] = 1
        }
      }
    }
  }
  // flood fill "outside" from the rect border
  const outside = new Uint8Array(bw * bh)
  const stack = []
  const push = (lx, ly) => {
    const j = ly * bw + lx
    if (outside[j] || solid[j]) return
    outside[j] = 1
    stack.push(j)
  }
  for (let lx = 0; lx < bw; lx++) {
    push(lx, 0)
    push(lx, bh - 1)
  }
  for (let ly = 0; ly < bh; ly++) {
    push(0, ly)
    push(bw - 1, ly)
  }
  while (stack.length) {
    const j = stack.pop()
    const lx = j % bw
    const ly = (j / bw) | 0
    if (lx > 0) push(lx - 1, ly)
    if (lx < bw - 1) push(lx + 1, ly)
    if (ly > 0) push(lx, ly - 1)
    if (ly < bh - 1) push(lx, ly + 1)
  }
  const out = new Uint8Array(w * h)
  for (let ly = 0; ly < bh; ly++) {
    for (let lx = 0; lx < bw; lx++) {
      if (!outside[ly * bw + lx]) out[(ly + y0) * w + (lx + x0)] = 1
    }
  }
  return out
}

/** Everything in `mask` at least `radius` px away from anything outside it. */
function erode(mask, w, h, radius) {
  const inv = new Uint8Array(w * h)
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1
  const d = distanceTransform(inv, w, h)
  const r2 = radius * radius
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = d[i] > r2 ? 1 : 0
  return out
}

function clampRect(box, w, h, pad) {
  return {
    x0: Math.max(0, Math.floor(box.x) - pad),
    y0: Math.max(0, Math.floor(box.y) - pad),
    x1: Math.min(w, Math.ceil(box.x + box.w) + pad),
    y1: Math.min(h, Math.ceil(box.y + box.h) + pad),
  }
}

/**
 * Per-shape interior agreement.
 *
 * `erosion` is how far in from the silhouette edge the interior starts; it has
 * to clear the widest stroke either library draws, including the hand-drawn
 * overshoot. Shapes whose interior erodes to less than `minInterior` pixels on
 * either side (open shapes — arrows, lines, freehand — and anything too small
 * at this zoom) report `null` rather than a meaningless number.
 */
/** Shape types with a closed outline, and therefore an interior to measure. */
const CLOSED_TYPES = new Set(["geo", "note", "frame"])

export function interiorMetrics(a, b, boxes, { erosion = 6, pad = 12, minInterior = 1000, minAreaFraction = 0.08, tol = 24 } = {}) {
  const { width: w, height: h } = a
  const bgA = backgroundColor(a)
  const bgB = backgroundColor(b)
  const paintedA = paintedMask(a, bgA)
  const paintedB = paintedMask(b, bgB)

  const unionA = new Uint8Array(w * h)
  const unionB = new Uint8Array(w * h)
  const perShape = []

  for (const box of boxes) {
    if (!CLOSED_TYPES.has(box.type)) {
      // An arrow, a line or a freehand stroke encloses nothing. Its box does
      // overlap shapes that do, so measuring "its interior" would silently be
      // measuring theirs.
      perShape.push({ ...box, interior: null, reason: "open shape — no interior" })
      continue
    }
    const rect = clampRect(box, w, h, pad)
    if (rect.x1 - rect.x0 < 4 || rect.y1 - rect.y0 < 4) {
      perShape.push({ ...box, interior: null, reason: "region too small" })
      continue
    }
    const intA = erode(silhouette(paintedA, w, h, rect), w, h, erosion)
    const intB = erode(silhouette(paintedB, w, h, rect), w, h, erosion)
    let inter = 0
    let union = 0
    let agree = 0
    let onlyA = 0
    let onlyB = 0
    for (let y = rect.y0; y < rect.y1; y++) {
      for (let x = rect.x0; x < rect.x1; x++) {
        const i = y * w + x
        const ia = intA[i]
        const ib = intB[i]
        if (!ia && !ib) continue
        union++
        if (ia && ib) {
          inter++
          if (chan(rgbAt(a, i), rgbAt(b, i)) <= tol) agree++
        } else if (ia) onlyA++
        else onlyB++
        if (ia) unionA[i] = 1
        if (ib) unionB[i] = 1
      }
    }
    const smallest = Math.min(inter + onlyA, inter + onlyB)
    const area = (rect.x1 - rect.x0) * (rect.y1 - rect.y0)
    if (smallest < minInterior || smallest < area * minAreaFraction) {
      // Open shapes (arrows, lines, freehand) enclose nothing; glyph counters
      // in a text shape enclose a few hundred pixels of nothing useful.
      perShape.push({ ...box, interior: null, reason: "no closed interior to measure" })
      continue
    }
    perShape.push({
      ...box,
      interior: {
        pixelsMocanvas: inter + onlyA,
        pixelsTldraw: inter + onlyB,
        iouPercent: (inter / union) * 100,
        colourAgreementPercent: inter ? (agree / inter) * 100 : 0,
      },
    })
  }

  // Fixture-wide figure: one union over every shape's interior, so the boxes
  // that overlap (the frame and its children, the bent arrow and the shapes it
  // crosses) are not counted twice.
  let inter = 0
  let union = 0
  let agree = 0
  for (let i = 0; i < w * h; i++) {
    const ia = unionA[i]
    const ib = unionB[i]
    if (!ia && !ib) continue
    union++
    if (ia && ib) {
      inter++
      if (chan(rgbAt(a, i), rgbAt(b, i)) <= tol) agree++
    }
  }
  return {
    erosion,
    pad,
    minInterior,
    minAreaFraction,
    tolerance: tol,
    perShape,
    overall: {
      pixelsMocanvas: unionA.reduce((s, v) => s + v, 0),
      pixelsTldraw: unionB.reduce((s, v) => s + v, 0),
      iouPercent: union ? (inter / union) * 100 : 0,
      colourAgreementPercent: inter ? (agree / inter) * 100 : 0,
    },
  }
}

// ---------------------------------------------------------------------------
// 2. stroke band distance
// ---------------------------------------------------------------------------

/**
 * The stroke colours actually present in the reference render.
 *
 * A colour qualifies when it covers enough pixels to matter, is not a pale
 * fill (either dark or strongly saturated), and — the test that does the real
 * work — is *thin*: at least 90% of its pixels are within `maxHalfWidth` of a
 * pixel of some other colour. That keeps outlines and glyphs and drops flat
 * areas like the note's body, which is saturated enough to pass the colour
 * test but is a fill, not a stroke.
 */
function strokeColors(img, { minPixels = 400, maxHalfWidth = 4, maxColors = 12, tol = 36 } = {}) {
  const n = img.width * img.height
  const counts = new Map()
  for (let i = 0; i < n; i++) {
    const [r, g, bl] = rgbAt(img, i)
    const lum = 0.299 * r + 0.587 * g + 0.114 * bl
    const sat = Math.max(r, g, bl) - Math.min(r, g, bl)
    if (lum > 200 && sat < 60) continue
    const key = (r << 16) | (g << 8) | bl
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const candidates = [...counts]
    .filter(([, c]) => c >= minPixels)
    .sort((p, q) => q[1] - p[1])
    .slice(0, maxColors * 3)
    .map(([key]) => [(key >> 16) & 255, (key >> 8) & 255, key & 255])

  const kept = []
  for (const c of candidates) {
    // Classes are `tol`-wide, so two candidates within `tol` of each other are
    // the same stroke seen twice (tldraw's black text is #1d1d1d and #000000
    // depending on the shape). Keep the more common one only.
    if (kept.some((k) => chan(k.rgb, c) <= tol)) continue
    const mask = colorMask(img, c, tol)
    let count = 0
    for (let i = 0; i < n; i++) count += mask[i]
    if (count < minPixels) continue
    // half-width = distance from a mask pixel to the nearest non-mask pixel
    const inv = new Uint8Array(n)
    for (let i = 0; i < n; i++) inv[i] = mask[i] ? 0 : 1
    const d = distanceTransform(inv, img.width, img.height)
    const halves = []
    for (let i = 0; i < n; i++) if (mask[i]) halves.push(Math.sqrt(d[i]))
    halves.sort((p, q) => p - q)
    const p90 = halves[Math.min(halves.length - 1, Math.floor(halves.length * 0.9))]
    if (p90 > maxHalfWidth) continue
    kept.push({ rgb: c, hex: hex(c), pixels: count, halfWidthP90: p90 })
    if (kept.length >= maxColors) break
  }
  return kept
}

const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`

/**
 * Pixels within `tol` of `rgb` on every channel.
 *
 * `tol` has to be wide enough that two antialiased samples of the *same*
 * hairline count as the same colour — the frame's 1 px border resolves to
 * `#818181` in one render and `#939394` in the other, 34 apart, and splitting
 * those into two classes makes each look like a stroke with no partner. It
 * also has to stay narrower than the gaps between palette hues (the closest
 * pair in this fixture is blue/light-blue, 60 apart). Checked across 32–44:
 * everything from 36 up merges the greys, and above 38 the note's drop shadow
 * starts merging into the grey class too.
 */
function colorMask(img, rgb, tol = 36) {
  const n = img.width * img.height
  const mask = new Uint8Array(n)
  for (let i = 0; i < n; i++) mask[i] = chan(rgbAt(img, i), rgb) <= tol ? 1 : 0
  return mask
}

function quantiles(values) {
  if (!values.length) return null
  const xs = Float64Array.from(values).sort()
  const at = (p) => xs[Math.min(xs.length - 1, Math.max(0, Math.round((xs.length - 1) * p)))]
  return { samples: xs.length, medianPx: at(0.5), p95Px: at(0.95), maxPx: xs[xs.length - 1] }
}

/**
 * tldraw paints a "Get a license for production" badge into the bottom-right
 * corner of the viewport. It is not a rendering difference — mocanvas has no
 * such badge — but it sits inside the frame's box, so without excluding it the
 * frame's band distance would be a measurement of the badge. Found rather than
 * hard-coded: the bounding box of everything the reference painted in the
 * bottom-right corner, and only honoured when the other render painted nothing
 * at all inside it.
 */
function watermarkRect(a, b) {
  const { width: w, height: h } = b
  const bg = backgroundColor(b)
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = h - 40; y < h; y++) {
    for (let x = w - 110; x < w; x++) {
      if (chan(rgbAt(b, y * w + x), bg) <= 6) continue
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return null
  const rect = { x0: Math.max(0, x0 - 3), y0: Math.max(0, y0 - 3), x1: Math.min(w, x1 + 4), y1: Math.min(h, y1 + 4) }
  const bgA = backgroundColor(a)
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) if (chan(rgbAt(a, y * w + x), bgA) > 6) return null
  }
  return { ...rect, note: "tldraw watermark badge; mocanvas paints nothing here" }
}

/**
 * How far each render's stroke sits from the other's, per shape region and
 * fixture-wide.
 *
 * For every stroke colour in the reference render, an exact distance transform
 * gives the distance from any pixel to the nearest stroke pixel of that colour
 * in each image. Sampling those at the *other* image's stroke pixels — in both
 * directions, so a stroke that is merely shorter cannot score well — gives a
 * symmetric band distance in pixels. Sampling is capped at `maxSamples` per
 * shape per direction, on a fixed stride, so the cost does not depend on how
 * much either library painted.
 */
export function strokeBandMetrics(a, b, boxes, { pad = 12, maxSamples = 3000, minRegionPixels = 150, colorTol = 36 } = {}) {
  const { width: w, height: h } = a
  const excluded = watermarkRect(a, b)
  const colors = strokeColors(b, { tol: colorTol })
  const layers = colors.map((c) => {
    const maskA = colorMask(a, c.rgb, colorTol)
    const maskB = colorMask(b, c.rgb, colorTol)
    let pixelsA = 0
    let pixelsB = 0
    for (let i = 0; i < w * h; i++) {
      pixelsA += maskA[i]
      pixelsB += maskB[i]
    }
    return { ...c, maskA, maskB, pixelsA, pixelsB, dA: distanceTransform(maskA, w, h), dB: distanceTransform(maskB, w, h) }
  })

  const inExcluded = (x, y) => excluded && x >= excluded.x0 && x < excluded.x1 && y >= excluded.y0 && y < excluded.y1

  /**
   * Sample `mask` inside `rect` on a stride and read `dist` there. Colour
   * classes with only a handful of pixels in a region are the antialiased
   * skirt of a *neighbouring* colour rather than a stroke of their own, and
   * their nearest match can be anywhere on the canvas — so they are skipped
   * rather than allowed to set the region's 95th percentile.
   */
  function sample(mask, dist, rect, out) {
    let total = 0
    for (let y = rect.y0; y < rect.y1; y++) {
      for (let x = rect.x0; x < rect.x1; x++) if (mask[y * w + x] && !inExcluded(x, y)) total++
    }
    if (total < minRegionPixels) return 0
    const stride = Math.max(1, Math.ceil(total / maxSamples))
    let seen = 0
    for (let y = rect.y0; y < rect.y1; y++) {
      for (let x = rect.x0; x < rect.x1; x++) {
        const i = y * w + x
        if (!mask[i] || inExcluded(x, y)) continue
        if (seen++ % stride) continue
        out.push(Math.sqrt(dist[i]))
      }
    }
    return total
  }

  const perShape = []
  const allForward = []
  const allReverse = []
  for (const box of boxes) {
    const rect = clampRect(box, w, h, pad)
    const forward = [] // reference stroke pixel → nearest mocanvas stroke pixel
    const reverse = [] // mocanvas stroke pixel → nearest reference stroke pixel
    let refPixels = 0
    for (const l of layers) {
      refPixels += sample(l.maskB, l.dA, rect, forward)
      sample(l.maskA, l.dB, rect, reverse)
    }
    if (refPixels < 200 || !forward.length || !reverse.length) {
      perShape.push({ ...box, band: null, reason: "too little stroke in this region" })
      continue
    }
    allForward.push(...forward)
    allReverse.push(...reverse)
    perShape.push({
      ...box,
      band: {
        referenceStrokePixels: refPixels,
        forward: quantiles(forward),
        reverse: quantiles(reverse),
        symmetric: quantiles([...forward, ...reverse]),
      },
    })
  }

  return {
    excluded,
    minRegionPixels,
    colors: colors.map((c) => ({ hex: c.hex, pixels: c.pixels, halfWidthP90: c.halfWidthP90 })),
    strokeWidthEstimatePx: colors.length ? 2 * median(colors.map((c) => c.halfWidthP90)) : null,
    perShape,
    overall: {
      forward: quantiles(allForward),
      reverse: quantiles(allReverse),
      symmetric: quantiles([...allForward, ...allReverse]),
    },
  }
}

function median(xs) {
  const s = [...xs].sort((p, q) => p - q)
  return s.length % 2 ? s[s.length >> 1] : (s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2
}

// ---------------------------------------------------------------------------

/**
 * Run both region metrics over a pair of screenshots.
 * `boxes` are screen-space shape boxes from `window.bench.shapeBoxes()`.
 */
export async function regionMetrics({ mocanvasPath, tldrawPath, boxes }) {
  const a = await readPng(mocanvasPath)
  const b = await readPng(tldrawPath)
  if (a.width !== b.width || a.height !== b.height) {
    return { error: `size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}` }
  }
  const interior = interiorMetrics(a, b, boxes)
  const stroke = strokeBandMetrics(a, b, boxes)
  return { interior, stroke }
}
