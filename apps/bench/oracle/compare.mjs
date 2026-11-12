/**
 * Comparing two probe answers, and deciding which differences are news.
 *
 * Two jobs, kept apart on purpose:
 *
 *   1. `diff()` says where the answers differ, structurally, with a tolerance
 *      for floats. It has no opinion about whether a difference is acceptable.
 *   2. `classify()` matches each difference against `divergences.json` — the
 *      differences we have looked at and decided to keep. What it does *not*
 *      match is what fails the run.
 *
 * The second half also reports accepted entries that no longer match anything.
 * A list of known divergences nobody prunes stops being a list of known
 * divergences and becomes a list of excuses.
 */

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v)

/** A path step, rendered so it can be pasted back into a divergence entry. */
const step = (path, key) => (path ? `${path}.${key}` : String(key))

/**
 * Structural difference between two probe answers.
 *
 * Numbers compare within `tolerance` — `abs` always, `rel` as well when given,
 * and either one passing is enough, so a tolerance can be stated in whichever
 * terms the quantity is actually stable in.
 */
export function diff(mocanvas, tldraw, { abs = 1e-9, rel = 0 } = {}, path = "", out = []) {
  const close = (a, b) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Object.is(a, b)
    const d = Math.abs(a - b)
    if (d <= abs) return true
    const scale = Math.max(Math.abs(a), Math.abs(b))
    return rel > 0 && scale > 0 && d / scale <= rel
  }

  if (typeof mocanvas === "number" && typeof tldraw === "number") {
    if (!close(mocanvas, tldraw)) {
      out.push({ path, kind: "number", mocanvas, tldraw, delta: mocanvas - tldraw })
    }
    return out
  }

  if (Array.isArray(mocanvas) || Array.isArray(tldraw)) {
    if (!Array.isArray(mocanvas) || !Array.isArray(tldraw)) {
      out.push({ path, kind: "shape", mocanvas, tldraw })
      return out
    }
    if (mocanvas.length !== tldraw.length) {
      out.push({ path, kind: "length", mocanvas: mocanvas.length, tldraw: tldraw.length })
      return out
    }
    for (let i = 0; i < mocanvas.length; i++) diff(mocanvas[i], tldraw[i], { abs, rel }, step(path, i), out)
    return out
  }

  if (isObject(mocanvas) || isObject(tldraw)) {
    if (!isObject(mocanvas) || !isObject(tldraw)) {
      out.push({ path, kind: "shape", mocanvas, tldraw })
      return out
    }
    const keys = [...new Set([...Object.keys(mocanvas), ...Object.keys(tldraw)])].sort()
    for (const k of keys) {
      const inA = Object.hasOwn(mocanvas, k)
      const inB = Object.hasOwn(tldraw, k)
      if (inA && !inB) out.push({ path: step(path, k), kind: "only-mocanvas", mocanvas: mocanvas[k], tldraw: undefined })
      else if (!inA && inB) out.push({ path: step(path, k), kind: "only-tldraw", mocanvas: undefined, tldraw: tldraw[k] })
      else diff(mocanvas[k], tldraw[k], { abs, rel }, step(path, k), out)
    }
    return out
  }

  if (!Object.is(mocanvas, tldraw)) out.push({ path, kind: "value", mocanvas, tldraw })
  return out
}

/**
 * Does `pattern` cover `path`?
 *
 * Exact, or a prefix ending in `.*` — `geo.*` covers `geo.w` and `geo.props.w`
 * but not `geometry`. `*` alone covers every path in the probe, which is how a
 * whole probe is accepted while something larger is being decided.
 */
export function pathMatches(pattern, path) {
  if (pattern === "*") return true
  if (pattern === path) return true
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2)
    return path === prefix || path.startsWith(prefix + ".")
  }
  return false
}

/**
 * Split a probe's differences into accepted and new, and name the accepted
 * entries that matched nothing.
 *
 * Entries are `{ probe, path, reason, status?, since? }`. `reason` is required
 * and is not decoration: an entry without one is indistinguishable from a bug
 * somebody silenced in a hurry.
 *
 * `status` is `"accepted"` (the default — looked at, decided, mocanvas is
 * right to differ) or `"open"` (looked at, not decided). Both keep the run
 * green, because a difference somebody has written down is not what this gate
 * is for; the difference between them is that an open one is printed in full
 * every time, so the list cannot quietly become the plan.
 */
export function classify(probeId, differences, accepted) {
  const mine = accepted.filter((a) => a.probe === probeId)
  const used = new Set()
  const known = []
  const news = []
  for (const d of differences) {
    const hit = mine.find((a) => pathMatches(a.path, d.path))
    if (hit) {
      used.add(hit)
      known.push({ ...d, reason: hit.reason, status: hit.status ?? "accepted", since: hit.since ?? null })
    } else {
      news.push(d)
    }
  }
  return { known, new: news, unused: mine.filter((a) => !used.has(a)) }
}

/** Compact one-line rendering of a value for the report. */
export function show(v) {
  if (v === undefined) return "—"
  if (typeof v === "string") return JSON.stringify(v)
  const s = JSON.stringify(v)
  return s === undefined ? String(v) : s.length > 72 ? s.slice(0, 69) + "..." : s
}
