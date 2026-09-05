/**
 * Importing Excalidraw clipboard content.
 *
 * Purely local: an Excalidraw copy puts a JSON document on the clipboard, and
 * this reads it. No request is made to excalidraw.com or anywhere else — the
 * whole drawing is in the paste.
 *
 * The mapping is deliberately lossy and says so. Excalidraw's model and this
 * one agree on rectangles, ellipses, diamonds, lines, arrows, freehand strokes
 * and text; they disagree on almost everything below that (Excalidraw's
 * roughness seed, its bound-element graph, its frames). Shapes that cannot be
 * represented are skipped rather than approximated, because a wrong shape in
 * the middle of a pasted diagram is worse than a missing one.
 */

import { createShapeId, type Editor, type ShapeId, type VecLike } from "@mocanvas/editor"
import { toRichText } from "../text/rich-text"

/** The fields of an Excalidraw element this importer reads. */
interface ExcalidrawElement {
  type?: string
  x?: number
  y?: number
  width?: number
  height?: number
  angle?: number
  text?: string
  fontSize?: number
  strokeColor?: string
  backgroundColor?: string
  fillStyle?: string
  strokeStyle?: string
  strokeWidth?: number
  isDeleted?: boolean
  points?: [number, number][]
  roundness?: unknown
}

/** The clipboard document Excalidraw writes. */
interface ExcalidrawClipboard {
  type?: string
  elements?: ExcalidrawElement[]
}

/** Excalidraw's stroke colours, mapped to the nearest canvas colour token. */
const COLOR_BY_HEX: Readonly<Record<string, string>> = {
  "#1e1e1e": "black",
  "#000000": "black",
  "#e03131": "red",
  "#2f9e44": "green",
  "#1971c2": "blue",
  "#f08c00": "orange",
  "#9c36b5": "violet",
  "#868e96": "grey",
}

function colorFor(hex: string | undefined): string {
  if (!hex) return "black"
  return COLOR_BY_HEX[hex.toLowerCase()] ?? "black"
}

function dashFor(style: string | undefined): string {
  if (style === "dashed") return "dashed"
  if (style === "dotted") return "dotted"
  return "draw"
}

function sizeFor(strokeWidth: number | undefined): string {
  if (strokeWidth === undefined) return "m"
  if (strokeWidth <= 1) return "s"
  if (strokeWidth <= 2) return "m"
  if (strokeWidth <= 4) return "l"
  return "xl"
}

const GEO_BY_EXCALIDRAW_TYPE: Readonly<Record<string, string>> = {
  rectangle: "rectangle",
  ellipse: "ellipse",
  diamond: "diamond",
}

/**
 * Whether `content` looks like an Excalidraw clipboard payload.
 *
 * Checked by its declared `type` rather than by sniffing for fields, so a
 * document that merely happens to have an `elements` array is not mistaken for
 * one.
 */
export function isExcalidrawClipboardContent(content: unknown): boolean {
  if (typeof content !== "object" || content === null) return false
  const type = (content as { type?: unknown }).type
  return typeof type === "string" && type.startsWith("excalidraw")
}

/**
 * Put Excalidraw clipboard content onto the current page, centred on `point`.
 *
 * The elements' own coordinates are preserved relative to one another, so a
 * pasted diagram keeps its layout; the whole group is then translated so its
 * centre lands where the paste happened.
 */
export async function putExcalidrawContent(editor: Editor, excalidrawClipboardContent: unknown, point?: VecLike): Promise<void> {
  const clipboard = excalidrawClipboardContent as ExcalidrawClipboard | null
  const elements = (clipboard?.elements ?? []).filter((element) => !element.isDeleted)
  if (elements.length === 0) return

  // The bounding box of everything, so the paste can be centred as one piece.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const element of elements) {
    const x = element.x ?? 0
    const y = element.y ?? 0
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + (element.width ?? 0))
    maxY = Math.max(maxY, y + (element.height ?? 0))
  }
  const target = point ?? editor.getViewportPageCenter()
  const dx = target.x - (minX + maxX) / 2
  const dy = target.y - (minY + maxY) / 2

  const created: ShapeId[] = []
  const shapes: object[] = []

  for (const element of elements) {
    const x = (element.x ?? 0) + dx
    const y = (element.y ?? 0) + dy
    const rotation = element.angle ?? 0
    const common = { color: colorFor(element.strokeColor), dash: dashFor(element.strokeStyle), size: sizeFor(element.strokeWidth) }

    const geo = GEO_BY_EXCALIDRAW_TYPE[element.type ?? ""]
    if (geo && editor.hasShapeUtil("geo")) {
      const id = createShapeId()
      created.push(id)
      shapes.push({
        id,
        type: "geo",
        x,
        y,
        rotation,
        props: {
          ...common,
          geo,
          w: Math.max(1, element.width ?? 1),
          h: Math.max(1, element.height ?? 1),
          fill: element.backgroundColor && element.backgroundColor !== "transparent" ? "solid" : "none",
        },
      })
      continue
    }

    if (element.type === "text" && editor.hasShapeUtil("text")) {
      const id = createShapeId()
      created.push(id)
      shapes.push({
        id,
        type: "text",
        x,
        y,
        rotation,
        props: { ...common, richText: toRichText(element.text ?? ""), autoSize: true },
      })
      continue
    }

    if ((element.type === "line" || element.type === "arrow" || element.type === "draw" || element.type === "freedraw") && Array.isArray(element.points)) {
      const points = element.points
      const first = points[0]
      const last = points[points.length - 1]
      if (!first || !last) continue

      if (element.type === "arrow" && editor.hasShapeUtil("arrow")) {
        const id = createShapeId()
        created.push(id)
        shapes.push({
          id,
          type: "arrow",
          x,
          y,
          rotation,
          props: { ...common, start: { x: first[0], y: first[1] }, end: { x: last[0], y: last[1] } },
        })
        continue
      }

      if (editor.hasShapeUtil("line")) {
        const id = createShapeId()
        created.push(id)
        shapes.push({
          id,
          type: "line",
          x,
          y,
          rotation,
          props: { ...common, points: Object.fromEntries(points.map((p, i) => [`a${i + 1}`, { id: `a${i + 1}`, index: `a${i + 1}`, x: p[0], y: p[1] }])) },
        })
      }
      continue
    }
    // Anything else — an image, a frame, an embedded scene — is skipped.
  }

  if (shapes.length === 0) return
  editor.markHistoryStoppingPoint("paste excalidraw")
  editor.run(() => {
    editor.createShapes(shapes as never)
    editor.setSelectedShapes(created)
  })
}

/**
 * The default handler for Excalidraw content arriving on the clipboard.
 *
 * A thin wrapper over {@link putExcalidrawContent} that ignores content which
 * is not actually Excalidraw's, so it is safe to register unconditionally.
 */
export async function defaultHandleExternalExcalidrawContent(
  editor: Editor,
  info: { content: unknown; point?: VecLike },
): Promise<void> {
  if (!isExcalidrawClipboardContent(info.content)) return
  await putExcalidrawContent(editor, info.content, info.point)
}
