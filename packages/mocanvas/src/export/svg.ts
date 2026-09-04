/**
 * Export shapes to a standalone SVG document string.
 */
import { Box, type Editor, type ShapeId, type UnknownShape } from "@mocanvas/editor"
import { shapeToBackgroundSvg, shapeToSvg, type SvgExportContext } from "./shape-svg"
import { attrs, matrixAttr, svgNum } from "./svg-utils"

export interface SvgExportOptions {
  /** Page units added around the shapes' bounds. Default 32. */
  padding?: number
  /** Paint a full-size background rectangle. Default false. */
  background?: boolean
  /** Multiplier applied to the output `width`/`height`. Default 1. */
  scale?: number
  /** Use the dark background colour. Default false. */
  darkMode?: boolean
}

export interface SvgExportResult {
  svg: string
  /** Output size in CSS pixels (bounds × scale). */
  width: number
  height: number
}

export const SVG_EXPORT_DEFAULT_PADDING = 32
export const SVG_LIGHT_BACKGROUND = "#f9fafb"
export const SVG_DARK_BACKGROUND = "#101011"

/**
 * The shapes an export covers: the given ids (or the selection, or the whole
 * page when nothing is selected) together with all of their descendants, in
 * page draw order.
 */
export function getExportShapes(editor: Editor, ids?: readonly ShapeId[]): UnknownShape[] {
  const sorted = editor.getCurrentPageShapesSorted()
  let roots: readonly ShapeId[] | undefined = ids
  if (!roots) {
    const selected = editor.getSelectedShapeIds()
    if (selected.length === 0) return sorted
    roots = selected
  }
  const included = new Set<ShapeId>()
  const visit = (id: ShapeId): void => {
    if (included.has(id)) return
    included.add(id)
    for (const child of editor.getSortedChildIdsForParent(id)) visit(child)
  }
  for (const id of roots) if (editor.getShape(id)) visit(id)
  return sorted.filter((s) => included.has(s.id))
}

/** Common page bounds of the shapes, or `undefined` when there are none. */
export function getExportBounds(editor: Editor, shapes: readonly UnknownShape[]): Box | undefined {
  const boxes: Box[] = []
  for (const shape of shapes) {
    const b = editor.getShapePageBounds(shape)
    if (b) boxes.push(b)
  }
  return boxes.length === 0 ? undefined : Box.Common(boxes)
}

let clipCounter = 0

/**
 * Serialize shapes to an SVG string. Returns `undefined` when there is
 * nothing to export.
 */
export function getSvgString(editor: Editor, ids?: readonly ShapeId[], opts: SvgExportOptions = {}): SvgExportResult | undefined {
  const padding = opts.padding ?? SVG_EXPORT_DEFAULT_PADDING
  const scale = opts.scale ?? 1
  const darkMode = opts.darkMode ?? false

  const shapes = getExportShapes(editor, ids)
  if (shapes.length === 0) return undefined
  const bounds = getExportBounds(editor, shapes)
  if (!bounds) return undefined

  const view = Box.Expand(bounds, padding)
  const width = Math.max(1, Math.ceil(view.w * scale))
  const height = Math.max(1, Math.ceil(view.h * scale))
  const background = darkMode ? SVG_DARK_BACKGROUND : SVG_LIGHT_BACKGROUND
  const ctx: SvgExportContext = { darkMode, background }

  const included = new Set(shapes.map((s) => s.id))
  const defs: string[] = []
  // `ShapeUtil.toBackgroundSvg` output, collected separately and emitted before
  // every shape so a backdrop stays behind the whole drawing rather than only
  // behind its own shape. It is not clipped by an ancestor frame.
  const backdrop: string[] = []
  const body: string[] = []
  const prefix = `mc${(clipCounter++).toString(36)}`

  const emit = (shape: UnknownShape): void => {
    const transform = editor.getShapePageTransform(shape)
    const g = attrs({
      transform: matrixAttr(transform),
      opacity: shape.opacity < 1 ? shape.opacity : undefined,
      "data-shape-type": shape.type,
    })
    const behind = shapeToBackgroundSvg(editor, shape, ctx)
    if (behind !== undefined) backdrop.push(`<g ${g} data-shape-background="true">${behind}</g>`)
    const inner = shapeToSvg(editor, shape, ctx)
    body.push(`<g ${g}>${inner}</g>`)

    const children = editor.getSortedChildIdsForParent(shape.id).filter((id) => included.has(id))
    if (children.length === 0) return
    if (shape.type === "frame") {
      const b = editor.getShapeGeometry(shape).bounds
      const clipId = `${prefix}-clip-${defs.length}`
      defs.push(
        `<clipPath id="${clipId}"><rect ${attrs({ transform: matrixAttr(transform), x: b.x, y: b.y, width: b.w, height: b.h })}/></clipPath>`,
      )
      body.push(`<g clip-path="url(#${clipId})">`)
      for (const id of children) {
        const child = editor.getShape(id)
        if (child) emit(child)
      }
      body.push(`</g>`)
      return
    }
    for (const id of children) {
      const child = editor.getShape(id)
      if (child) emit(child)
    }
  }

  for (const shape of shapes) {
    // Descendants are emitted by their ancestors; only roots start here.
    const parentIncluded = included.has(shape.parentId as ShapeId)
    if (!parentIncluded) emit(shape)
  }

  const viewBox = `${svgNum(view.x)} ${svgNum(view.y)} ${svgNum(view.w)} ${svgNum(view.h)}`
  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">`)
  if (defs.length > 0) parts.push(`<defs>${defs.join("")}</defs>`)
  if (opts.background) {
    parts.push(`<rect ${attrs({ x: view.x, y: view.y, width: view.w, height: view.h, fill: background })}/>`)
  }
  parts.push(...backdrop)
  parts.push(...body)
  parts.push(`</svg>`)
  return { svg: parts.join(""), width, height }
}
