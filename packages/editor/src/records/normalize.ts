/**
 * Normalization for records read out of a `.tldr` file.
 *
 * Files written by different generations of the format spell the same
 * information in different ways: a shape's label may arrive as a plain string
 * or as a rich-text document, and a freehand stroke's points may arrive as an
 * array or as one packed binary blob. Nothing downstream should have to know
 * that, so the load path runs every record through here first and the shape
 * utils only ever see the props they declare.
 *
 * Everything in this module is pure and total: it never throws, and whatever it
 * cannot make sense of is reported as a warning string instead.
 */

import type { UnknownRecord } from "@mocanvas/store"
import type { ShapeUtil } from "../shapes/ShapeUtil"
import type { UnknownShape } from "./base"

type Props = Record<string, unknown>

function isPlainObject(value: unknown): value is Props {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/* ---- rich text --------------------------------------------------------- */

/**
 * Flatten a rich-text document to the plain string mocanvas stores in
 * `props.text`.
 *
 * The document is a tree of `{ type, content?, text? }` nodes. `text` nodes
 * contribute their string, `hardBreak` nodes a newline, top-level paragraphs
 * are joined by newlines, and any other node is recursed into so unknown marks
 * or wrappers still yield their text. `unknownNodeTypes`, when passed, collects
 * the node types that were not understood.
 */
export function richTextToPlainText(doc: unknown, unknownNodeTypes?: Set<string>): string {
  if (typeof doc === "string") return doc
  if (!isPlainObject(doc)) return ""
  const blocks = Array.isArray(doc["content"]) ? (doc["content"] as unknown[]) : []
  if (blocks.length === 0) return nodeToText(doc, unknownNodeTypes)
  return blocks.map((block) => nodeToText(block, unknownNodeTypes)).join("\n")
}

const TEXTLESS_NODE_TYPES = new Set(["doc", "paragraph", "text", "hardBreak", "heading", "listItem", "bulletList", "orderedList"])

function nodeToText(node: unknown, unknownNodeTypes?: Set<string>): string {
  if (typeof node === "string") return node
  if (!isPlainObject(node)) return ""
  const type = typeof node["type"] === "string" ? (node["type"] as string) : ""
  if (type === "text") return typeof node["text"] === "string" ? (node["text"] as string) : ""
  if (type === "hardBreak") return "\n"
  if (type && !TEXTLESS_NODE_TYPES.has(type)) unknownNodeTypes?.add(type)
  const content = node["content"]
  if (!Array.isArray(content)) return ""
  // Blocks nested inside a block (a list's items, say) still read as separate lines.
  const separator = type === "paragraph" || type === "heading" ? "" : "\n"
  return (content as unknown[]).map((child) => nodeToText(child, unknownNodeTypes)).join(separator)
}

/* ---- freehand segment paths -------------------------------------------- */

/** A point of a freehand stroke: position plus pen pressure. */
export interface DecodedDrawPoint {
  x: number
  y: number
  z: number
}

const PATH_HEADER_BYTES = 12
const PATH_DELTA_BYTES = 6

/**
 * Decode a packed freehand segment path into its points, or `null` when the
 * blob is not in the layout we understand.
 *
 * Layout, as observed in the files themselves: base64 of a little-endian
 * buffer holding the first point as three `float32` (x, y, pressure) followed
 * by one `float16` triple per further point, each a delta from the previous
 * point.
 */
export function decodeDrawSegmentPath(path: string): DecodedDrawPoint[] | null {
  const bytes = base64ToBytes(path)
  if (!bytes) return null
  if (bytes.byteLength < PATH_HEADER_BYTES) return null
  if ((bytes.byteLength - PATH_HEADER_BYTES) % PATH_DELTA_BYTES !== 0) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let x = view.getFloat32(0, true)
  let y = view.getFloat32(4, true)
  let z = view.getFloat32(8, true)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  const points: DecodedDrawPoint[] = [{ x, y, z }]
  for (let at = PATH_HEADER_BYTES; at < bytes.byteLength; at += PATH_DELTA_BYTES) {
    const dx = getFloat16(view, at)
    const dy = getFloat16(view, at + 2)
    const dz = getFloat16(view, at + 4)
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return null
    x += dx
    y += dy
    z += dz
    points.push({ x, y, z })
  }
  return points
}

function base64ToBytes(value: string): Uint8Array | null {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null
  try {
    if (typeof atob === "function") {
      const binary = atob(value)
      const out = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
      return out
    }
    const buffer = (globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } }).Buffer
    return buffer ? new Uint8Array(buffer.from(value, "base64")) : null
  } catch {
    return null
  }
}

/** Read a little-endian IEEE half-precision float. `DataView` has no `getFloat16`. */
function getFloat16(view: DataView, offset: number): number {
  const bits = view.getUint16(offset, true)
  const sign = bits & 0x8000 ? -1 : 1
  const exponent = (bits >> 10) & 0x1f
  const fraction = bits & 0x3ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction ? Number.NaN : sign * Infinity
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

/* ---- record normalization ---------------------------------------------- */

export interface NormalizeOptions {
  /** The registered shape utils, keyed by shape type. Used for default props. */
  shapeUtils: Readonly<Record<string, Pick<ShapeUtil, "getDefaultProps">>>
}

export interface NormalizeResult {
  records: UnknownRecord[]
  warnings: string[]
}

/** Shape types whose `segments` carry packed freehand paths. */
const FREEHAND_TYPES = new Set(["draw", "highlight"])

function isShapeRecord(record: UnknownRecord): record is UnknownRecord & UnknownShape {
  return record.typeName === "shape" && typeof (record as { type?: unknown }).type === "string"
}

/**
 * Rewrite loaded records so the shape utils see the props they declare.
 *
 * Per shape: `props.richText` becomes `props.text` (the rich-text document is
 * dropped, not kept alongside), packed freehand `segments[].path` becomes
 * `segments[].points`, and any prop the util declares a default for but the
 * file omits is filled in from that default. Props the util does not declare
 * are left untouched so a round trip preserves them, and shapes of a type with
 * no registered util are passed through unchanged.
 *
 * Records are only copied when something actually changes.
 */
export function normalizeLoadedRecords(records: readonly UnknownRecord[], options: NormalizeOptions): NormalizeResult {
  const warnings: string[] = []
  const out: UnknownRecord[] = []
  const unknownTypes = new Set<string>()

  for (const record of records) {
    if (!isShapeRecord(record)) {
      out.push(record)
      continue
    }
    const util = options.shapeUtils[record.type]
    if (!util) {
      if (!unknownTypes.has(record.type)) {
        unknownTypes.add(record.type)
        warnings.push(`shape type "${record.type}" has no registered util; its shapes are kept but not rendered`)
      }
      out.push(record)
      continue
    }

    const source = isPlainObject(record.props) ? record.props : {}
    let props: Props | null = isPlainObject(record.props) ? null : { ...source }

    // Rich text label -> plain text.
    if ("richText" in source) {
      const unknownNodes = new Set<string>()
      const text = richTextToPlainText(source["richText"], unknownNodes)
      for (const node of unknownNodes) {
        warnings.push(`${record.id}: unsupported rich text node "${node}"; its text was kept, its formatting dropped`)
      }
      props ??= { ...source }
      delete props["richText"]
      if (typeof props["text"] !== "string") props["text"] = text
    }

    // Packed freehand paths -> point arrays.
    if (FREEHAND_TYPES.has(record.type) && Array.isArray(source["segments"])) {
      const decoded = decodeSegments(source["segments"] as unknown[], record.id, warnings)
      if (decoded) {
        props ??= { ...source }
        props["segments"] = decoded
      }
    }

    // Fill in props the util declares but the file omits.
    const defaults = safeDefaultProps(util, record.type, warnings)
    const missing: string[] = []
    for (const key of Object.keys(defaults)) {
      const from = props ?? source
      if (!(key in from) || from[key] === undefined) missing.push(key)
    }
    if (missing.length > 0) {
      props ??= { ...source }
      for (const key of missing) props[key] = defaults[key]
      warnings.push(`${record.id}: missing prop${missing.length > 1 ? "s" : ""} ${missing.join(", ")} filled in from defaults`)
    }

    out.push(props ? ({ ...record, props } as UnknownRecord) : record)
  }

  return { records: out, warnings }
}

function safeDefaultProps(util: Pick<ShapeUtil, "getDefaultProps">, type: string, warnings: string[]): Props {
  try {
    const defaults = util.getDefaultProps() as unknown
    return isPlainObject(defaults) ? defaults : {}
  } catch (error) {
    warnings.push(`shape type "${type}": getDefaultProps() failed (${String(error)}); missing props were not filled in`)
    return {}
  }
}

/**
 * Replace packed `path` blobs with decoded `points`. Returns `null` when no
 * segment needed rewriting. Segments that cannot be decoded are dropped.
 */
function decodeSegments(segments: readonly unknown[], id: string, warnings: string[]): unknown[] | null {
  let changed = false
  const out: unknown[] = []
  for (const segment of segments) {
    if (!isPlainObject(segment) || Array.isArray(segment["points"]) || typeof segment["path"] !== "string") {
      out.push(segment)
      continue
    }
    changed = true
    const points = decodeDrawSegmentPath(segment["path"] as string)
    if (!points) {
      warnings.push(`${id}: freehand segment uses an unrecognized path encoding; the segment was dropped`)
      continue
    }
    const next: Props = { ...segment, points }
    delete next["path"]
    out.push(next)
  }
  return changed ? out : null
}
