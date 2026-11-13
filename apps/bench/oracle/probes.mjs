/**
 * The oracle catalogue: questions asked of both libraries, answered in JSON.
 *
 * ## Why this exists
 *
 * Nine of the releases cut on 2026-11-12 fixed divergences from tldraw, and
 * every one of them was found by a consumer running the two side by side, not
 * by this repository's own tests. Our tests check mocanvas against what
 * mocanvas's author believed tldraw does; they cannot check that belief. This
 * file asks tldraw instead.
 *
 * A probe is one function run against both editors with the same arguments,
 * returning a JSON value. `scripts/oracle.mjs` runs them, compares, and fails
 * on any difference that `divergences.json` does not already account for.
 *
 * ## The clean-room line
 *
 * `apps/bench` is the one place allowed to depend on tldraw and drive it
 * through its public API (docs/CLEAN_ROOM.md, "The one exception"). A probe may
 * *call* tldraw and read what comes back. It may not read tldraw's source to
 * work out what the answer should be, and nothing it returns is copied into the
 * library: a divergence is a question for a human, who then writes mocanvas's
 * own answer from first principles.
 *
 * ## Writing one
 *
 * `run` is serialised to source and evaluated in the page, so it is a closure
 * over nothing: everything it needs arrives as `(editor, h, kit)`.
 *
 *   - `editor` — the live editor, whichever library the page is running.
 *   - `h`      — the helpers below (`helpersSource`), identical on both pages.
 *   - `kit`    — `window.oracleKit`, each page's own exports (`toRichText`,
 *                `createShapeId`, `getIndices`), so a probe can build a record
 *                in the spelling that library wants.
 *
 * Return plain JSON. Round anything that is a float with `h.round` — a probe
 * that reports 17 digits of a sub-pixel is a probe that fails on a Tuesday.
 *
 * A gesture probe adds `steps`: viewport-space mouse and keyboard actions the
 * driver performs between `setup` and `run`. The camera is identity for these,
 * so page coordinates and viewport coordinates are the same number.
 */

/**
 * Helpers installed on both pages before any probe runs.
 *
 * Source rather than an import, because this is evaluated inside the browser
 * against whichever library that page loaded.
 */
export const helpersSource = `({
  /** Round to \`p\` decimals; passes non-numbers through so it is safe to map with. */
  round(n, p = 4) {
    if (typeof n !== "number" || !Number.isFinite(n)) return n
    const f = 10 ** p
    return Math.round(n * f) / f
  },

  /** \`round\` over a whole structure. */
  deep(v, p = 4) {
    if (Array.isArray(v)) return v.map((x) => this.deep(x, p))
    if (v && typeof v === "object") {
      const out = {}
      for (const k of Object.keys(v).sort()) out[k] = this.deep(v[k], p)
      return out
    }
    return this.round(v, p)
  },

  /** Empty page, identity camera, select tool. Run before every probe. */
  reset(editor) {
    editor.selectAll()
    editor.deleteShapes(editor.getSelectedShapeIds())
    editor.setCurrentTool("select")
    editor.setCamera({ x: 0, y: 0, z: 1 }, { animation: { duration: 0 }, force: true })
  },

  /**
   * Create a shape and return its id.
   *
   * By difference rather than by passing an id in, so the probe does not have
   * to mint one: \`createShapeId\` is in the kit, but a probe that never names
   * an id cannot accidentally compare two different libraries' id formats.
   */
  create(editor, partial) {
    const before = new Set(editor.getCurrentPageShapeIds())
    editor.createShape(partial)
    for (const id of editor.getCurrentPageShapeIds()) if (!before.has(id)) return id
    return null
  },

  /**
   * Run \`fn\` and return the ids it added to the page.
   *
   * The two libraries do not agree on what an operation *returns* —
   * \`duplicateShapes\` hands back the new ids in one and \`this\` in the other —
   * so a probe that wants to know what appeared asks the page, not the call.
   */
  made(editor, fn) {
    const before = new Set(editor.getCurrentPageShapeIds())
    fn()
    return [...editor.getCurrentPageShapeIds()].filter((id) => !before.has(id))
  },

  /**
   * A shape's size as the page sees it.
   *
   * Page bounds rather than \`props.w\` / \`props.h\`: a text shape has no stored
   * height in either library, and the two disagree about whether a measured
   * width is written back into \`props\`. Bounds are the number a layout reads.
   */
  size(editor, id, p = 3) {
    const b = this.box(editor, id, p)
    return b ? { w: b.w, h: b.h } : null
  },

  /** Page bounds as a plain box, rounded. */
  box(editor, id, p = 3) {
    const b = editor.getShapePageBounds(id)
    return b ? { x: this.round(b.x, p), y: this.round(b.y, p), w: this.round(b.w, p), h: this.round(b.h, p) } : null
  },

  /** A shape's own frame: position, rotation and the named props. */
  shape(editor, id, keys, p = 3) {
    const s = editor.getShape(id)
    if (!s) return null
    const out = { x: this.round(s.x, p), y: this.round(s.y, p), rotation: this.round(s.rotation, 6) }
    for (const k of keys) out[k] = this.deep(s.props[k], p)
    return out
  },

  /** A label in whichever spelling this library wants. */
  label(kit, text) {
    return kit && typeof kit.toRichText === "function" ? { richText: kit.toRichText(text) } : { text }
  },
})`

/** The sentence used wherever a probe needs a run of text long enough to wrap. */
const LOREM = "The quick brown fox jumps over the lazy dog, and then it does so again"

/**
 * Probes, in the order they run.
 *
 * Defaults come first and mutate nothing, so they report the state a freshly
 * mounted editor is actually in rather than the state the probe before left.
 */
export const probes = [
  // -------------------------------------------------------------------------
  // What a freshly mounted editor believes
  // -------------------------------------------------------------------------
  {
    id: "instance-defaults",
    title: "Instance state a fresh editor mounts with",
    about: "4.16.0 turned grid mode off here. It had been on since 4.5.0, and from 4.13.0 that silently changed what a drag does.",
    pure: true,
    run: (editor, h) => {
      const s = editor.getInstanceState()
      return h.deep({
        isGridMode: s.isGridMode,
        isFocusMode: s.isFocusMode,
        isDebugMode: s.isDebugMode,
        isToolLocked: s.isToolLocked,
        isReadonly: s.isReadonly,
        exportBackground: s.exportBackground,
        isPenMode: s.isPenMode,
      })
    },
  },
  {
    id: "user-preference-defaults",
    title: "User preferences a fresh editor mounts with",
    about: "4.13.0: the accelerator asks for snapping, and `isSnapMode` turns that around. The default decides which way a plain drag behaves.",
    pure: true,
    run: (editor, h) => {
      const p = editor.user.getUserPreferences()
      return h.deep({
        isSnapMode: p.isSnapMode ?? null,
        isDynamicSizeMode: p.isDynamicSizeMode ?? null,
        isWrapMode: p.isWrapMode ?? null,
        animationSpeed: p.animationSpeed ?? null,
        edgeScrollSpeed: p.edgeScrollSpeed ?? null,
        isPasteAtCursorMode: p.isPasteAtCursorMode ?? null,
      })
    },
  },
  {
    id: "document-defaults",
    title: "Document settings and page count",
    pure: true,
    run: (editor, h) => {
      const d = editor.getDocumentSettings()
      return h.deep({ gridSize: d.gridSize, pages: editor.getPages().length, meta: d.meta ?? null })
    },
  },
  {
    id: "shape-default-props",
    title: "`getDefaultProps()` for every built-in shape",
    about: "4.4.0 shipped these as a table. A table is exactly the kind of thing that drifts without anyone noticing.",
    pure: true,
    run: (editor, h) => {
      const out = {}
      for (const type of ["geo", "text", "note", "arrow", "line", "draw", "frame", "highlight", "image", "video", "bookmark", "embed", "group"]) {
        try {
          const util = editor.getShapeUtil(type)
          const props = util.getDefaultProps()
          // A rich-text default is a document tree; compare its plain text, so
          // two different-but-equivalent empty documents do not read as a
          // divergence while a different default string still does.
          const flat = {}
          for (const k of Object.keys(props).sort()) {
            const v = props[k]
            if (v && typeof v === "object" && v.type === "doc") {
              flat[k] = { richTextPlain: JSON.stringify(v).length > 0 ? "<doc>" : "" }
            } else if (k === "points" && v && typeof v === "object" && !Array.isArray(v)) {
              // A line's handles are keyed by their index key, and index keys
              // are jittered: the same default produces `a25kM` one run and
              // `a20dn` the next. Compare the handles in index order instead,
              // or this probe disagrees with itself.
              flat[k] = Object.values(v)
                .sort((a, b) => String(a.index).localeCompare(String(b.index)))
                .map((pt) => ({ x: h.round(pt.x, 3), y: h.round(pt.y, 3) }))
            } else {
              flat[k] = h.deep(v)
            }
          }
          out[type] = flat
        } catch (e) {
          out[type] = { __error: String(e && e.message ? e.message : e) }
        }
      }
      return out
    },
  },

  // -------------------------------------------------------------------------
  // Sizes: what a shape is when nobody says
  // -------------------------------------------------------------------------
  {
    id: "geo-created-size",
    title: "A geo shape created with no size",
    about: "4.4.2: one placed by a click was half the size it should be.",
    run: (editor, h) => {
      const out = {}
      for (const geo of ["rectangle", "ellipse", "triangle", "diamond", "hexagon", "star", "cloud"]) {
        h.reset(editor)
        const id = h.create(editor, { type: "geo", x: 0, y: 0, props: { geo } })
        out[geo] = id ? h.shape(editor, id, ["w", "h"]) : null
      }
      return out
    },
  },
  {
    id: "text-empty-width",
    title: "An empty text shape's width",
    about: "4.12.1: 20, for real this time.",
    run: (editor, h, kit) => {
      h.reset(editor)
      const id = h.create(editor, { type: "text", x: 0, y: 0, props: { ...h.label(kit, "") } })
      return { shape: id ? h.shape(editor, id, ["w"]) : null, bounds: id ? h.box(editor, id) : null }
    },
  },

  // -------------------------------------------------------------------------
  // Text: the part that depends on which typefaces are on the machine
  // -------------------------------------------------------------------------
  {
    id: "text-shape-size-by-font",
    title: "An auto-sized text shape, per font and size",
    about:
      "End to end: the font stack the library ships, its line height and its measurement, in the two numbers a consumer's layout actually reads.",
    tolerance: { abs: 0.05 },
    run: (editor, h, kit) => {
      const out = {}
      for (const font of ["draw", "sans", "serif", "mono"]) {
        for (const size of ["s", "m", "l", "xl"]) {
          h.reset(editor)
          const id = h.create(editor, {
            type: "text",
            x: 0,
            y: 0,
            props: { font, size, ...h.label(kit, "Hamburgefonstiv") },
          })
          out[font + "/" + size] = id ? h.size(editor, id, 2) : null
        }
      }
      return out
    },
  },
  {
    id: "text-shape-props-after-create",
    title: "What a text shape stores in `props` once it has measured itself",
    about:
      "Separate from the size it reports, because the two libraries disagree about whether an auto-sized shape writes its measured width back into `props.w`. A consumer reading `props.w` gets one answer or the other.",
    tolerance: { abs: 0.05 },
    run: (editor, h, kit) => {
      h.reset(editor)
      const id = h.create(editor, { type: "text", x: 0, y: 0, props: { font: "sans", size: "m", ...h.label(kit, "Hamburgefonstiv") } })
      const s = editor.getShape(id)
      return { propsW: h.round(s.props.w, 2), hasPropsH: Object.hasOwn(s.props, "h"), autoSize: s.props.autoSize ?? null, bounds: h.size(editor, id, 2) }
    },
  },
  {
    id: "text-shape-line-height",
    title: "Height of a text shape at one, two and three lines",
    about:
      "The implied line height, read off the differences rather than from a constant: h(3) - h(2) is one line box whatever the padding around it.",
    tolerance: { abs: 0.05 },
    run: (editor, h, kit) => {
      const out = {}
      for (const font of ["draw", "sans", "serif", "mono"]) {
        for (const size of ["s", "m", "l", "xl"]) {
          const hs = []
          for (const lines of [1, 2, 3]) {
            h.reset(editor)
            const text = Array.from({ length: lines }, (_, i) => "Line " + (i + 1)).join("\n")
            const id = h.create(editor, { type: "text", x: 0, y: 0, props: { font, size, ...h.label(kit, text) } })
            const box = id ? h.size(editor, id, 3) : null
            hs.push(box ? box.h : null)
          }
          out[font + "/" + size] = {
            h1: hs[0],
            h2: hs[1],
            h3: hs[2],
            lineBox: hs[2] != null && hs[1] != null ? h.round(hs[2] - hs[1], 3) : null,
          }
        }
      }
      return out
    },
  },
  {
    id: "measure-text-shared-font",
    title: "`textMeasure.measureText` with the same family on both sides",
    about:
      "Arial and an explicit line height, so neither library's own stack nor its own constant is in the answer: what is left is the wrapping and the box arithmetic.",
    tolerance: { abs: 0.05 },
    run: (editor, h) => {
      const out = {}
      const cases = [
        { text: "Hamburgefonstiv", maxWidth: null },
        { text: LOREM, maxWidth: 200 },
        { text: LOREM, maxWidth: 90 },
        { text: "supercalifragilisticexpialidocious", maxWidth: 60 },
        { text: "one\ntwo\nthree", maxWidth: null },
        { text: "trailing spaces   ", maxWidth: null },
      ]
      for (const c of cases) {
        for (const lineHeight of [1, 1.3, 1.35]) {
          const key = JSON.stringify(c.text).slice(0, 24) + "|" + c.maxWidth + "|" + lineHeight
          try {
            const m = editor.textMeasure.measureText(c.text, {
              fontFamily: "Arial",
              fontSize: 24,
              lineHeight,
              maxWidth: c.maxWidth,
              padding: 0,
            })
            out[key] = { w: h.round(m.w, 2), h: h.round(m.h, 2), lineCount: m.lineCount }
          } catch (e) {
            out[key] = { __error: String(e && e.message ? e.message : e) }
          }
        }
      }
      return out
    },
  },
  {
    id: "note-grow",
    title: "A sticky note grown by its text",
    about: "4.8.0 made `growY` unscaled. It is the number a consumer's layout reads back.",
    tolerance: { abs: 0.05 },
    run: (editor, h, kit) => {
      const out = {}
      for (const size of ["s", "m", "l", "xl"]) {
        h.reset(editor)
        const id = h.create(editor, { type: "note", x: 0, y: 0, props: { size, ...h.label(kit, LOREM + " " + LOREM) } })
        out[size] = { shape: id ? h.shape(editor, id, ["growY", "size"]) : null, bounds: id ? h.box(editor, id) : null }
      }
      return out
    },
  },
  {
    id: "geo-label-grow",
    title: "A geo shape grown by its label",
    tolerance: { abs: 0.05 },
    run: (editor, h, kit) => {
      const out = {}
      for (const size of ["s", "m", "l", "xl"]) {
        h.reset(editor)
        const id = h.create(editor, {
          type: "geo",
          x: 0,
          y: 0,
          props: { geo: "rectangle", w: 120, h: 60, size, ...h.label(kit, LOREM) },
        })
        out[size] = { shape: id ? h.shape(editor, id, ["w", "h", "growY"]) : null, bounds: id ? h.box(editor, id) : null }
      }
      return out
    },
  },

  // -------------------------------------------------------------------------
  // Operations
  // -------------------------------------------------------------------------
  {
    id: "fractional-indices",
    title: "`getIndices(n)`",
    about: "4.3.0: n + 1 keys, starting at a1.",
    pure: true,
    run: (editor, h, kit) => {
      if (!kit || typeof kit.getIndices !== "function") return { __error: "getIndices not exported by this page's kit" }
      // The keys themselves are opaque and both libraries jitter them, so two
      // correct implementations never produce the same strings. What a caller
      // can rely on is the count, the starting key and the ordering.
      const describe = (n) => {
        const keys = kit.getIndices(n)
        return {
          count: keys.length,
          firstStartsWithA1: String(keys[0] ?? "").startsWith("a1"),
          strictlyAscending: keys.every((k, i) => i === 0 || k > keys[i - 1]),
          allDistinct: new Set(keys).size === keys.length,
        }
      }
      return { n0: describe(0), n1: describe(1), n5: describe(5) }
    },
  },
  {
    id: "rotate-wrap",
    title: "`rotateShapesBy` past a full turn",
    about: "4.4.1: the stored angle wraps.",
    run: (editor, h) => {
      const out = {}
      for (const turns of [0.25, 1, 1.5, 3, -0.25]) {
        h.reset(editor)
        const id = h.create(editor, { type: "geo", x: 0, y: 0, props: { geo: "rectangle", w: 100, h: 100 } })
        editor.rotateShapesBy([id], turns * Math.PI * 2)
        out[String(turns) + "turn"] = { rotation: h.round(editor.getShape(id).rotation, 6), bounds: h.box(editor, id) }
      }
      return out
    },
  },
  {
    id: "duplicate-selection",
    title: "What is selected after `duplicateShapes`",
    about: "4.12.3: the copies.",
    run: (editor, h) => {
      h.reset(editor)
      const a = h.create(editor, { type: "geo", x: 0, y: 0, props: { geo: "rectangle", w: 100, h: 100 } })
      editor.select(a)
      const copies = h.made(editor, () => editor.duplicateShapes([a]))
      const selected = editor.getSelectedShapeIds()
      return {
        copiesMade: copies.length,
        selectedCount: selected.length,
        selectedIsTheCopy: copies.length === 1 ? selected.length === 1 && selected[0] === copies[0] : null,
        shapesOnPage: editor.getCurrentPageShapeIds().size,
        copyBounds: copies[0] ? h.box(editor, copies[0]) : null,
      }
    },
  },
  {
    id: "hit-test-margin",
    title: "`getShapeAtPoint` on filled and unfilled shapes",
    about:
      "4.4.0 made a filled shape clickable in the middle; 4.12.0 made an explicit margin page units rather than screen px. Both are this call's answer.",
    run: (editor, h) => {
      const out = {}
      for (const fill of ["none", "semi", "solid"]) {
        h.reset(editor)
        h.create(editor, { type: "geo", x: 100, y: 100, props: { geo: "rectangle", w: 200, h: 200, fill } })
        const ask = (x, y, opts) => {
          const s = editor.getShapeAtPoint({ x, y }, opts)
          return s ? s.type : null
        }
        out[fill] = {
          middle: ask(200, 200, {}),
          middleHitInside: ask(200, 200, { hitInside: true }),
          onEdge: ask(100, 200, {}),
          justOutside: ask(96, 200, {}),
          outsideMargin8: ask(96, 200, { margin: 8 }),
          outsideMargin0: ask(96, 200, { margin: 0 }),
          farOutside: ask(60, 200, { margin: 8 }),
        }
      }
      return out
    },
  },
  {
    id: "resize-shape",
    title: "`resizeShape` with a scale and an origin",
    run: (editor, h) => {
      h.reset(editor)
      const id = h.create(editor, { type: "geo", x: 100, y: 100, props: { geo: "rectangle", w: 200, h: 100 } })
      editor.resizeShape(id, { x: 1.5, y: 0.5 }, { scaleOrigin: { x: 100, y: 100 } })
      const afterOrigin = { shape: h.shape(editor, id, ["w", "h"]), bounds: h.box(editor, id) }
      editor.resizeShape(id, { x: 2, y: 2 })
      return { afterOrigin, afterCentre: { shape: h.shape(editor, id, ["w", "h"]), bounds: h.box(editor, id) } }
    },
  },
  {
    id: "flip-shapes",
    title: "`flipShapes` over a pair",
    run: (editor, h) => {
      h.reset(editor)
      const a = h.create(editor, { type: "geo", x: 0, y: 0, props: { geo: "rectangle", w: 100, h: 50 } })
      const b = h.create(editor, { type: "geo", x: 200, y: 100, props: { geo: "triangle", w: 60, h: 120 } })
      editor.flipShapes([a, b], "horizontal")
      const horizontal = { a: h.box(editor, a), b: h.box(editor, b) }
      editor.flipShapes([a, b], "vertical")
      return { horizontal, vertical: { a: h.box(editor, a), b: h.box(editor, b) } }
    },
  },
  {
    id: "align-and-distribute",
    title: "`alignShapes` and `distributeShapes`",
    run: (editor, h) => {
      const build = () => {
        h.reset(editor)
        return [
          h.create(editor, { type: "geo", x: 0, y: 0, props: { geo: "rectangle", w: 100, h: 50 } }),
          h.create(editor, { type: "geo", x: 130, y: 70, props: { geo: "rectangle", w: 60, h: 90 } }),
          h.create(editor, { type: "geo", x: 400, y: 20, props: { geo: "rectangle", w: 40, h: 40 } }),
        ]
      }
      const out = {}
      for (const op of ["left", "right", "top", "bottom", "center-horizontal", "center-vertical"]) {
        const ids = build()
        try {
          editor.alignShapes(ids, op)
          out["align:" + op] = ids.map((id) => h.box(editor, id))
        } catch (e) {
          out["align:" + op] = { __error: String(e && e.message ? e.message : e) }
        }
      }
      for (const op of ["horizontal", "vertical"]) {
        const ids = build()
        try {
          editor.distributeShapes(ids, op)
          out["distribute:" + op] = ids.map((id) => h.box(editor, id))
        } catch (e) {
          out["distribute:" + op] = { __error: String(e && e.message ? e.message : e) }
        }
      }
      return out
    },
  },
  {
    id: "group-bounds",
    title: "Grouping and ungrouping a pair",
    run: (editor, h) => {
      h.reset(editor)
      const a = h.create(editor, { type: "geo", x: 0, y: 0, props: { geo: "rectangle", w: 100, h: 50 } })
      const b = h.create(editor, { type: "geo", x: 200, y: 100, props: { geo: "ellipse", w: 60, h: 90 } })
      const [gid = null] = h.made(editor, () => editor.groupShapes([a, b]))
      const grouped = {
        groupBounds: gid ? h.box(editor, gid) : null,
        childrenParented: editor.getShape(a).parentId === gid && editor.getShape(b).parentId === gid,
        selected: editor.getSelectedShapeIds().length,
      }
      if (gid) editor.ungroupShapes([gid])
      return { grouped, afterUngroup: { a: h.box(editor, a), b: h.box(editor, b), shapes: editor.getCurrentPageShapeIds().size } }
    },
  },
  {
    id: "zoom-to-fit",
    title: "`zoomToFit`, by default and at stated insets",
    about:
      "Split in two on purpose: with the inset stated, this is the fit arithmetic; with it left out, it is only the default, and a difference in one is a different bug from a difference in the other.",
    tolerance: { abs: 0.0005 },
    run: (editor, h) => {
      const scene = () => {
        h.reset(editor)
        h.create(editor, { type: "geo", x: 0, y: 0, props: { geo: "rectangle", w: 400, h: 300 } })
        h.create(editor, { type: "geo", x: 700, y: 500, props: { geo: "ellipse", w: 200, h: 200 } })
      }
      const camera = () => {
        const c = editor.getCamera()
        return { x: h.round(c.x, 3), y: h.round(c.y, 3), z: h.round(c.z, 5) }
      }
      const out = { viewport: h.deep(editor.getViewportScreenBounds(), 1) }
      scene()
      editor.zoomToFit({ animation: { duration: 0 } })
      out.defaultInset = camera()
      for (const inset of [0, 64, 128, 256]) {
        scene()
        editor.zoomToFit({ animation: { duration: 0 }, inset })
        out["inset" + inset] = camera()
      }
      return out
    },
  },
  {
    id: "arrow-bound-geometry",
    title: "An arrow bound between two shapes",
    run: (editor, h, kit) => {
      h.reset(editor)
      const a = h.create(editor, { type: "geo", x: 0, y: 0, props: { geo: "rectangle", w: 100, h: 100 } })
      const b = h.create(editor, { type: "geo", x: 400, y: 200, props: { geo: "rectangle", w: 100, h: 100 } })
      const arrow = h.create(editor, { type: "arrow", x: 0, y: 0, props: { start: { x: 50, y: 50 }, end: { x: 450, y: 250 } } })
      try {
        editor.createBindings([
          { type: "arrow", fromId: arrow, toId: a, props: { terminal: "start", isPrecise: false, isExact: false, normalizedAnchor: { x: 0.5, y: 0.5 } } },
          { type: "arrow", fromId: arrow, toId: b, props: { terminal: "end", isPrecise: false, isExact: false, normalizedAnchor: { x: 0.5, y: 0.5 } } },
        ])
      } catch (e) {
        return { __error: "createBindings: " + String(e && e.message ? e.message : e) }
      }
      editor.updateShape({ id: a, type: "geo", x: 20 })
      return {
        arrowBounds: h.box(editor, arrow),
        bindings: editor.getBindingsFromShape(arrow, "arrow").length,
        geometryVerts: (() => {
          const g = editor.getShapeGeometry(editor.getShape(arrow))
          const pts = g && g.vertices ? g.vertices : []
          return pts.slice(0, 2).map((p) => ({ x: h.round(p.x, 2), y: h.round(p.y, 2) }))
        })(),
      }
    },
  },
  {
    id: "tldr-fixture-bounds",
    title: "Every shape of `compare.tldr`, by page bounds",
    about:
      "The fixture carries its own ids, so the two libraries' answers line up shape for shape: this is the whole file's geometry in one probe.",
    tolerance: { abs: 0.05 },
    run: async (editor, h) => {
      h.reset(editor)
      const doc = await fetch("/compare.tldr").then((r) => r.json())
      const res = await window.bench.loadTldr(doc)
      if (!res || !res.ok) return { __error: "loadTldr: " + String(res && res.error) }
      const out = { shapes: {} }
      const ids = [...editor.getCurrentPageShapeIds()].sort()
      for (const id of ids) {
        const s = editor.getShape(id)
        out.shapes[id] = { type: s.type, bounds: h.box(editor, id, 2) }
      }
      out.count = ids.length
      return out
    },
  },

  // -------------------------------------------------------------------------
  // Gestures: what the pointer actually does
  // -------------------------------------------------------------------------
  {
    id: "gesture-press-interior-unfilled",
    title: "Pressing in the middle of an *unfilled* rectangle",
    about:
      "4.4.0 made a filled shape clickable in the middle. The question this asks is the other half: whether an unfilled one is too. `getShapeAtPoint` agrees on both sides here — it is the tool's own hit test that does not, so only a real press can see it.",
    setup: (editor, h) => {
      h.reset(editor)
      h.create(editor, { type: "geo", x: 100, y: 100, props: { geo: "rectangle", w: 200, h: 200, fill: "none" } })
      return null
    },
    steps: [
      { mouse: "move", x: 200, y: 200 },
      { mouse: "down" },
      { mouse: "up" },
    ],
    run: (editor, h) => ({ selected: editor.getSelectedShapeIds().length }),
  },
  {
    id: "gesture-press-interior-filled",
    title: "Pressing in the middle of a filled rectangle",
    setup: (editor, h) => {
      h.reset(editor)
      h.create(editor, { type: "geo", x: 100, y: 100, props: { geo: "rectangle", w: 200, h: 200, fill: "solid" } })
      return null
    },
    steps: [
      { mouse: "move", x: 200, y: 200 },
      { mouse: "down" },
      { mouse: "up" },
    ],
    run: (editor, h) => ({ selected: editor.getSelectedShapeIds().length }),
  },
  {
    id: "gesture-drag-plain",
    title: "Dragging a shape with no modifier held",
    about:
      "4.13.0 found two divergences here at once — whether a plain drag snaps to other shapes, and whether grid mode steps it. Both only show up through the pointer.",
    setup: (editor, h) => {
      h.reset(editor)
      h.create(editor, { type: "geo", x: 100, y: 100, props: { geo: "rectangle", w: 100, h: 100, fill: "solid" } })
      h.create(editor, { type: "geo", x: 500, y: 123, props: { geo: "rectangle", w: 100, h: 100, fill: "solid" } })
      return null
    },
    steps: [
      { mouse: "move", x: 150, y: 150 },
      { mouse: "down" },
      { mouse: "move", x: 170, y: 160, steps: 4 },
      { mouse: "move", x: 187, y: 173, steps: 4 },
      { mouse: "up" },
    ],
    run: (editor, h) => {
      const ids = [...editor.getCurrentPageShapeIds()].map((id) => editor.getShape(id)).sort((p, q) => p.x - q.x)
      return { moved: { x: h.round(ids[0].x, 3), y: h.round(ids[0].y, 3) }, other: { x: h.round(ids[1].x, 3), y: h.round(ids[1].y, 3) } }
    },
  },
  {
    id: "gesture-drag-accelerator",
    title: "Dragging with the accelerator held",
    about:
      "The same drag with the platform accelerator held (cmd on macOS, ctrl elsewhere). 4.13.0: the accelerator asks for snapping rather than refusing it.",
    setup: (editor, h) => {
      h.reset(editor)
      h.create(editor, { type: "geo", x: 100, y: 100, props: { geo: "rectangle", w: 100, h: 100, fill: "solid" } })
      h.create(editor, { type: "geo", x: 500, y: 123, props: { geo: "rectangle", w: 100, h: 100, fill: "solid" } })
      return null
    },
    steps: [
      { mouse: "move", x: 150, y: 150 },
      { mouse: "down" },
      { key: "down", value: "$accel" },
      { mouse: "move", x: 170, y: 160, steps: 4 },
      { mouse: "move", x: 187, y: 173, steps: 4 },
      { mouse: "up" },
      { key: "up", value: "$accel" },
    ],
    run: (editor, h) => {
      const ids = [...editor.getCurrentPageShapeIds()].map((id) => editor.getShape(id)).sort((p, q) => p.x - q.x)
      return { moved: { x: h.round(ids[0].x, 3), y: h.round(ids[0].y, 3) }, other: { x: h.round(ids[1].x, 3), y: h.round(ids[1].y, 3) } }
    },
  },
  {
    id: "gesture-resize-corner",
    title: "Dragging a selection's bottom-right handle",
    about: "4.13.0: in grid mode the dragged edge lands on the grid and the opposite one stays put.",
    setup: (editor, h) => {
      h.reset(editor)
      const id = h.create(editor, { type: "geo", x: 100, y: 100, props: { geo: "rectangle", w: 150, h: 100, fill: "solid" } })
      editor.select(id)
      return null
    },
    steps: [
      { mouse: "move", x: 250, y: 200 },
      { mouse: "down" },
      { mouse: "move", x: 280, y: 220, steps: 4 },
      { mouse: "move", x: 301.2, y: 238.4, steps: 4 },
      { mouse: "up" },
    ],
    run: (editor, h) => {
      const id = [...editor.getCurrentPageShapeIds()][0]
      return { shape: h.shape(editor, id, ["w", "h"]), bounds: h.box(editor, id) }
    },
  },
  {
    id: "gesture-click-create-geo",
    title: "Placing a rectangle with one click",
    about: "4.4.2: one placed by a click was half the size it should be.",
    setup: (editor, h) => {
      h.reset(editor)
      editor.setCurrentTool("geo")
      return null
    },
    steps: [
      { mouse: "move", x: 400, y: 300 },
      { mouse: "down" },
      { mouse: "up" },
    ],
    run: (editor, h) => {
      const ids = [...editor.getCurrentPageShapeIds()]
      if (!ids.length) return { created: 0 }
      return { created: ids.length, shape: h.shape(editor, ids[0], ["w", "h", "geo"]), bounds: h.box(editor, ids[0]) }
    },
  },
]
