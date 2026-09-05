import { track, useEditor, useValue, type Asset, type AssetId, type UnknownShape } from "@mocanvas/editor"
import { useEffect, useState } from "react"
import { Icon } from "./icons"
import { TldrawUiContextualToolbar } from "./ui-contextual-toolbar"
import { TldrawUiToolbarButton, TldrawUiToolbarToggleGroup, TldrawUiToolbarToggleItem } from "./ui-toolbar"
import type { TLUiImageToolbarProps, TLUiVideoToolbarProps } from "./ui-components"

/**
 * The bars that appear over a selected image or video.
 *
 * They are contextual because the operations are: cropping and aspect ratio
 * only mean anything for the shape under the pointer, and putting them in the
 * style panel would leave the user reading the far corner of the screen while
 * dragging a crop handle in the near one.
 */

export interface BoxWidthHeight {
  w: number
  h: number
}

/**
 * Fit `box` inside `container` without changing its aspect ratio.
 *
 * The rule every image import needs: a 4000px photo dropped on the canvas must
 * arrive at a workable size, and must not arrive squashed.
 */
export function containBoxSize(box: BoxWidthHeight, container: BoxWidthHeight): BoxWidthHeight {
  if (box.w <= container.w && box.h <= container.h) return box
  const scale = Math.min(container.w / box.w, container.h / box.h)
  return { w: box.w * scale, h: box.h * scale }
}

/** One entry in the aspect-ratio picker. */
export interface AspectRatioOption {
  value: string
  label: string
}

/** The aspect ratios the image bar offers. */
export const ASPECT_RATIO_OPTIONS: readonly AspectRatioOption[] = [
  { value: "original", label: "Original" },
  { value: "square", label: "Square" },
  { value: "circle", label: "Circle" },
  { value: "landscape", label: "Landscape" },
  { value: "portrait", label: "Portrait" },
  { value: "wide", label: "Wide" },
]

/** One aspect-ratio option's value. */
export type ASPECT_RATIO_OPTION = AspectRatioOption["value"]

/** The width-over-height each named ratio means. `null` keeps the asset's own. */
export const ASPECT_RATIO_TO_VALUE: Readonly<Record<string, number | null>> = {
  original: null,
  square: 1,
  circle: 1,
  landscape: 4 / 3,
  portrait: 3 / 4,
  wide: 16 / 9,
}

export interface UseImageOrVideoAssetOptions {
  /** The asset to resolve. */
  assetId: AssetId | null
  /** The shape's on-screen width, used to pick a resolution variant. */
  width?: number
  /** Resolve at a higher resolution than the shape's own size. */
  shouldResolveToOriginal?: boolean
}

/**
 * Resolve an image or video asset to a URL that can be put in a `src`.
 *
 * Asynchronous because `editor.resolveAssetUrl` may have to ask an asset store
 * — the seam a host uses to sign a URL or to serve a downscaled variant. The
 * hook reports `isPlaceholder` until the answer arrives, so a shape can draw a
 * grey box rather than a broken image.
 */
export function useImageOrVideoAsset({ assetId, width, shouldResolveToOriginal }: UseImageOrVideoAssetOptions): {
  asset: Asset | null
  url: string | null
  isPlaceholder: boolean
} {
  const editor = useEditor()
  const asset = useValue("asset", () => (assetId ? (editor.getAssets().find((a) => a.id === assetId) ?? null) : null), [editor, assetId])
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!assetId) {
      setUrl(null)
      return
    }
    // SEMANTICS-ASSUMED: mocanvas's asset registry resolves one URL per asset
    // rather than a resolution ladder, so `width` and `shouldResolveToOriginal`
    // are accepted (an app writes them, and a variant-serving asset store will
    // want them) but do not yet change the answer.
    void width
    void shouldResolveToOriginal
    const resolved = editor.resolveAssetUrl(assetId)
    void Promise.resolve(resolved).then((next) => {
      if (!cancelled) setUrl(next ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [editor, assetId, width, shouldResolveToOriginal])

  return { asset, url, isPlaceholder: url === null }
}

/** The size and mime type of an asset, for a shape that is placing it. */
export function getAssetInfo(asset: Asset | null | undefined): { w: number; h: number; mimeType: string | null; isAnimated: boolean } | null {
  if (!asset) return null
  const props = asset.props as { w?: number; h?: number; mimeType?: string | null; isAnimated?: boolean }
  return {
    w: props.w ?? 0,
    h: props.h ?? 0,
    mimeType: props.mimeType ?? null,
    isAnimated: props.isAnimated ?? false,
  }
}

export interface DefaultImageToolbarContentProps {
  shape: UnknownShape
  /** Called when the user picks a named aspect ratio. */
  onAspectRatio?(value: string): void
}

/** The image bar's buttons: aspect ratio, and replace. */
export function DefaultImageToolbarContent({ shape, onAspectRatio }: DefaultImageToolbarContentProps) {
  const editor = useEditor()
  const [ratio, setRatio] = useState<string>("original")
  return (
    <>
      <TldrawUiToolbarToggleGroup
        label="Aspect ratio"
        type="single"
        value={ratio}
        onValueChange={(value) => {
          setRatio(value)
          onAspectRatio?.(value)
          const target = ASPECT_RATIO_TO_VALUE[value]
          if (!target) return
          const bounds = editor.getShapePageBounds(shape.id)
          if (!bounds) return
          editor.markHistoryStoppingPoint("aspect ratio")
          editor.updateShape({ id: shape.id, type: shape.type, props: { w: bounds.width, h: bounds.width / target } } as never)
        }}
      >
        {ASPECT_RATIO_OPTIONS.map((option) => (
          <TldrawUiToolbarToggleItem key={option.value} value={option.value} title={option.label}>
            {option.label}
          </TldrawUiToolbarToggleItem>
        ))}
      </TldrawUiToolbarToggleGroup>
      <TldrawUiToolbarButton type="icon" title="Replace media" onClick={() => editor.setCroppingShape(null)}>
        <Icon name="image" />
      </TldrawUiToolbarButton>
    </>
  )
}

/** The bar over a selected image. */
export const DefaultImageToolbar = track(function DefaultImageToolbar({ children }: TLUiImageToolbarProps) {
  const editor = useEditor()
  const shape = editor.getOnlySelectedShape()
  if (!shape || shape.type !== "image" || editor.getEditingShapeId()) return null
  const bounds = editor.getShapePageBounds(shape.id)
  if (!bounds) return null
  return (
    <TldrawUiContextualToolbar label="Image" getSelectionBounds={() => ({ x: bounds.minX, y: bounds.minY, w: bounds.width, h: bounds.height })}>
      {children ?? <DefaultImageToolbarContent shape={shape} />}
    </TldrawUiContextualToolbar>
  )
})

export interface DefaultVideoToolbarContentProps {
  shape: UnknownShape
}

/** The video bar's buttons: play/pause and loop, written onto the shape. */
export function DefaultVideoToolbarContent({ shape }: DefaultVideoToolbarContentProps) {
  const editor = useEditor()
  const props = shape.props as { playing?: boolean; autoplay?: boolean }
  return (
    <>
      <TldrawUiToolbarButton
        type="icon"
        title={props.playing ? "Pause" : "Play"}
        onClick={() => editor.updateShape({ id: shape.id, type: shape.type, props: { playing: !props.playing } } as never)}
      >
        {props.playing ? "❚❚" : "▶"}
      </TldrawUiToolbarButton>
      <TldrawUiToolbarButton
        type="icon"
        isActive={props.autoplay ?? false}
        title="Autoplay"
        onClick={() => editor.updateShape({ id: shape.id, type: shape.type, props: { autoplay: !props.autoplay } } as never)}
      >
        ↻
      </TldrawUiToolbarButton>
    </>
  )
}

/** The bar over a selected video. */
export const DefaultVideoToolbar = track(function DefaultVideoToolbar({ children }: TLUiVideoToolbarProps) {
  const editor = useEditor()
  const shape = editor.getOnlySelectedShape()
  if (!shape || shape.type !== "video" || editor.getEditingShapeId()) return null
  const bounds = editor.getShapePageBounds(shape.id)
  if (!bounds) return null
  return (
    <TldrawUiContextualToolbar label="Video" getSelectionBounds={() => ({ x: bounds.minX, y: bounds.minY, w: bounds.width, h: bounds.height })}>
      {children ?? <DefaultVideoToolbarContent shape={shape} />}
    </TldrawUiContextualToolbar>
  )
})
