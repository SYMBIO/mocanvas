/**
 * The five overlays that draw other people.
 *
 * Everything here is derived from presence records, never from the document:
 * a collaborator's cursor, brush, scribbles and selection are things they are
 * *doing*, and none of them survive a reload or belong in a `.tldr` file.
 *
 * They share one base, {@link CollaboratorOverlayUtil}, for a reason that is
 * easy to get wrong when the five are written separately: "who is visible" is a
 * single rule — present within the inactive timeout, and on this page — and
 * five copies of it drift. `editor.collaborators` owns that rule; these utils
 * only decide what to paint for each person it hands back.
 *
 * Colour never comes from the theme here. It comes from the presence record,
 * because the whole job of a collaborator colour is to be the same colour for
 * the same person on every screen in the room.
 */
import {
  OverlayUtil,
  type Editor,
  type Geometry2d,
  type InstancePresence,
  type Scribble,
} from "@mocanvas/editor"
import { drawLabelChip, hairline, isolate, traceRoundedRect, traceTaperedStroke, withCamera } from "./paint"
import type {
  TLCollaboratorBrushOverlay,
  TLCollaboratorCursorOverlay,
  TLCollaboratorHintOverlay,
  TLCollaboratorScribbleOverlay,
  TLCollaboratorShapeIndicatorOverlay,
} from "./types"

/**
 * Shared configuration for the collaborator painters.
 *
 * These exist so a subclass that redraws a cursor can read the label's
 * measurements instead of hard-coding them next to a `super.render` it does not
 * control. `zIndex` is not here because it is a static on the util itself —
 * `class Mine extends CollaboratorCursorOverlayUtil { static override zIndex = 1100 }`.
 */
export interface CollaboratorOverlayUtilOptions {
  /** Opacity applied to everything drawn for an idle collaborator. */
  idleOpacity: number
  /** Point size of the name and chat chips. */
  fontSize: number
  /** Widest a name chip may draw before its text is clipped with an ellipsis. */
  nameMaxWidth: number
  /** The same, for a chat message, which is usually allowed more room. */
  chatMaxWidth: number
}

/** The dials every collaborator overlay has. */
export const DEFAULT_COLLABORATOR_OVERLAY_OPTIONS: CollaboratorOverlayUtilOptions = {
  idleOpacity: 0.5,
  fontSize: 12,
  nameMaxWidth: 120,
  chatMaxWidth: 200,
}

/** The chip font, from the options, as a CSS `font` string. */
function chipFont(fontSize: number): string {
  return `${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`
}

/**
 * The half every collaborator painter shares: who to draw, and how faded.
 *
 * Not exported as part of the SDK surface — an app subclasses one of the five
 * concrete utils, which is the granularity anybody actually wants.
 */
abstract class CollaboratorOverlayUtil<
  O extends CollaboratorOverlayUtilOptions = CollaboratorOverlayUtilOptions,
> extends OverlayUtil<Editor, O> {
  /** Everybody present and on this page. Never the local user. */
  protected getPeople(): InstancePresence[] {
    return this.editor.collaborators.getVisibleCollaboratorsOnCurrentPage()
  }

  /** The fields every collaborator overlay record carries. */
  protected baseRecord(presence: InstancePresence): {
    presenceId: string
    userName: string
    color: string
    isIdle: boolean
  } {
    return {
      presenceId: presence.id,
      userName: presence.userName,
      color: presence.color,
      isIdle: this.editor.collaborators.isCollaboratorIdle(presence),
    }
  }

  /** Nothing another person is doing is clickable by us. */
  override getGeometry(): Geometry2d | undefined {
    return undefined
  }
}

/**
 * Other people's pointers, with their names beside them.
 *
 * Drawn in screen space and at a fixed size: a cursor that shrank with the zoom
 * would become invisible on a zoomed-out board, which is exactly when knowing
 * where somebody is matters most.
 */
export class CollaboratorCursorOverlayUtil extends CollaboratorOverlayUtil {
  static override type = "collaboratorCursor"
  static override zIndex = 60
  static override options: CollaboratorOverlayUtilOptions = DEFAULT_COLLABORATOR_OVERLAY_OPTIONS

  override isActive(): boolean {
    return this.getOverlays().length > 0
  }

  override getOverlays(): TLCollaboratorCursorOverlay[] {
    const out: TLCollaboratorCursorOverlay[] = []
    for (const presence of this.getPeople()) {
      // `null` is a collaborator with no pointer at all — an agent, or somebody
      // whose pointer has left the canvas. Not the same as a pointer at (0, 0).
      if (!presence.cursor) continue
      out.push({
        id: presence.id,
        type: "collaboratorCursor",
        ...this.baseRecord(presence),
        point: { x: presence.cursor.x, y: presence.cursor.y },
        rotation: presence.cursor.rotation,
        chatMessage: presence.chatMessage,
      })
    }
    return out
  }

  override render(ctx: CanvasRenderingContext2D, given?: TLCollaboratorCursorOverlay[]): void {
    const overlays = given ?? this.getOverlays()
    if (overlays.length === 0) return
    const editor = this.editor
    const { idleOpacity, fontSize, nameMaxWidth, chatMaxWidth } = this.options
    isolate(ctx, (c) => {
      for (const overlay of overlays) {
        const at = editor.pageToViewport(overlay.point)
        c.globalAlpha = overlay.isIdle ? idleOpacity : 1
        c.save()
        c.translate(at.x, at.y)
        if (overlay.rotation) c.rotate(overlay.rotation)
        // The classic arrow pointer, traced once at its natural size. Kept as
        // an explicit path rather than a glyph so it looks the same on every
        // platform — a collaborator cursor that changed shape per OS would read
        // as a different kind of object.
        c.beginPath()
        c.moveTo(0, 0)
        c.lineTo(0, 14)
        c.lineTo(3.6, 10.9)
        c.lineTo(6.1, 15.9)
        c.lineTo(8.5, 14.7)
        c.lineTo(6, 9.8)
        c.lineTo(10.4, 9.4)
        c.closePath()
        c.fillStyle = overlay.color
        c.strokeStyle = "rgba(0, 0, 0, 0.25)"
        c.lineWidth = 1
        c.fill()
        c.stroke()
        c.restore()

        const isChat = !!overlay.chatMessage
        const label = overlay.chatMessage || overlay.userName
        if (label) {
          drawLabelChip(c, label, at.x + 12, at.y + 16, {
            background: overlay.color,
            // White reads on all eight presence colours, which are chosen to be
            // dark enough for exactly this.
            color: "#ffffff",
            font: chipFont(fontSize),
            paddingX: 6,
            paddingY: 3,
            radius: 4,
            // Without a cap a long name drew a chip as wide as the name, which
            // on a zoomed-out board covered the drawing it was labelling.
            maxWidth: isChat ? chatMaxWidth : nameMaxWidth,
          })
        }
      }
      c.globalAlpha = 1
    })
  }
}

/** Another person's selection brush, in their colour. */
export class CollaboratorBrushOverlayUtil extends CollaboratorOverlayUtil {
  static override type = "collaboratorBrush"
  static override zIndex = 10
  static override options: CollaboratorOverlayUtilOptions = DEFAULT_COLLABORATOR_OVERLAY_OPTIONS

  override isActive(): boolean {
    return this.getOverlays().length > 0
  }

  override getOverlays(): TLCollaboratorBrushOverlay[] {
    const out: TLCollaboratorBrushOverlay[] = []
    for (const presence of this.getPeople()) {
      if (!presence.brush) continue
      out.push({
        id: presence.id,
        type: "collaboratorBrush",
        ...this.baseRecord(presence),
        bounds: presence.brush,
      })
    }
    return out
  }

  override render(ctx: CanvasRenderingContext2D): void {
    const overlays = this.getOverlays()
    if (overlays.length === 0) return
    const camera = this.editor.getCamera()
    const zoom = camera.z || 1
    const idleOpacity = this.options.idleOpacity
    withCamera(ctx, camera, (c) => {
      c.lineWidth = hairline(1.5, zoom)
      for (const overlay of overlays) {
        const { x, y, w, h } = overlay.bounds
        c.strokeStyle = overlay.color
        traceRoundedRect(c, x, y, w, h, hairline(2, zoom))
        // The brush interior is drawn at low alpha in their colour rather than
        // with a separate fill token: the point of the tint is to say *whose*
        // brush it is, and a theme fill would say the same thing for everyone.
        c.globalAlpha = (overlay.isIdle ? idleOpacity : 1) * 0.12
        c.fillStyle = overlay.color
        c.fill()
        c.globalAlpha = overlay.isIdle ? idleOpacity : 1
        c.stroke()
      }
      c.globalAlpha = 1
    })
  }
}

/** Another person's live scribbles — their laser, their eraser trail. */
export class CollaboratorScribbleOverlayUtil extends CollaboratorOverlayUtil {
  static override type = "collaboratorScribble"
  static override zIndex = 30
  static override options: CollaboratorOverlayUtilOptions = DEFAULT_COLLABORATOR_OVERLAY_OPTIONS

  override isActive(): boolean {
    return this.getOverlays().length > 0
  }

  override getOverlays(): TLCollaboratorScribbleOverlay[] {
    const out: TLCollaboratorScribbleOverlay[] = []
    for (const presence of this.getPeople()) {
      for (const scribble of presence.scribbles) {
        out.push({
          id: `${presence.id}:${scribble.id}`,
          type: "collaboratorScribble",
          ...this.baseRecord(presence),
          scribble,
        })
      }
    }
    return out
  }

  override render(ctx: CanvasRenderingContext2D): void {
    const overlays = this.getOverlays()
    if (overlays.length === 0) return
    const camera = this.editor.getCamera()
    const idleOpacity = this.options.idleOpacity
    withCamera(ctx, camera, (c) => {
      for (const overlay of overlays) {
        const scribble: Scribble = overlay.scribble
        if (scribble.points.length < 2) continue
        // Their colour, not the scribble's: a laser is a presence signal, and
        // two people's lasers have to be tellable apart.
        c.fillStyle = overlay.color
        c.globalAlpha = scribble.opacity * (overlay.isIdle ? idleOpacity : 1)
        traceTaperedStroke(c, scribble.points, scribble.size, scribble.taper)
        c.fill()
      }
      c.globalAlpha = 1
    })
  }
}

/** Outlines round the shapes another person has selected. */
export class CollaboratorShapeIndicatorOverlayUtil extends CollaboratorOverlayUtil {
  static override type = "collaboratorShapeIndicator"
  static override zIndex = 0
  static override options: CollaboratorOverlayUtilOptions = DEFAULT_COLLABORATOR_OVERLAY_OPTIONS

  override isActive(): boolean {
    return this.getOverlays().length > 0
  }

  override getOverlays(): TLCollaboratorShapeIndicatorOverlay[] {
    const editor = this.editor
    const out: TLCollaboratorShapeIndicatorOverlay[] = []
    for (const presence of this.getPeople()) {
      for (const shapeId of presence.selectedShapeIds) {
        const shape = editor.getShape(shapeId)
        if (!shape) continue
        const bounds = editor.getShapeGeometryBounds(shape)
        if (!bounds) continue
        const m = editor.getShapePageTransform(shape)
        out.push({
          id: `${presence.id}:${shapeId}`,
          type: "collaboratorShapeIndicator",
          ...this.baseRecord(presence),
          shapeId,
          transform: { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f },
          bounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
        })
      }
    }
    return out
  }

  override render(ctx: CanvasRenderingContext2D): void {
    const overlays = this.getOverlays()
    if (overlays.length === 0) return
    const camera = this.editor.getCamera()
    const zoom = camera.z || 1
    const idleOpacity = this.options.idleOpacity
    withCamera(ctx, camera, (c) => {
      for (const overlay of overlays) {
        c.save()
        const m = overlay.transform
        c.transform(m.a, m.b, m.c, m.d, m.e, m.f)
        c.strokeStyle = overlay.color
        c.globalAlpha = overlay.isIdle ? idleOpacity : 1
        c.lineWidth = hairline(1.5, zoom)
        const { x, y, w, h } = overlay.bounds
        c.strokeRect(x, y, w, h)
        c.restore()
      }
    })
  }
}

/**
 * The marker on the viewport edge that says a collaborator is off screen, and
 * which way they are.
 *
 * Without it, somebody who scrolls away simply disappears and there is no way
 * to find them again short of guessing. The marker is clamped to the edge of
 * the viewport and rotated to point at where they actually are.
 */
export class CollaboratorHintOverlayUtil extends CollaboratorOverlayUtil {
  static override type = "collaboratorHint"
  static override zIndex = 70
  static override options: CollaboratorOverlayUtilOptions = DEFAULT_COLLABORATOR_OVERLAY_OPTIONS

  /**
   * SEMANTICS-ASSUMED: the inset. The marker sits 12 CSS pixels inside the
   * viewport edge — far enough in that it is not clipped by the canvas border,
   * close enough that it reads as "over there", not "here".
   */
  static readonly EDGE_INSET = 12

  override isActive(): boolean {
    return this.getOverlays().length > 0
  }

  override getOverlays(): TLCollaboratorHintOverlay[] {
    const editor = this.editor
    const viewport = editor.getViewportScreenBounds()
    const inset = CollaboratorHintOverlayUtil.EDGE_INSET
    const out: TLCollaboratorHintOverlay[] = []
    for (const presence of this.getPeople()) {
      if (!presence.cursor) continue
      const at = editor.pageToViewport(presence.cursor)
      const onScreen = at.x >= 0 && at.y >= 0 && at.x <= viewport.w && at.y <= viewport.h
      // A cursor already on screen is drawn by the cursor overlay; drawing an
      // edge marker for it as well would double every visible collaborator.
      if (onScreen) continue
      const cx = viewport.w / 2
      const cy = viewport.h / 2
      const point = {
        x: Math.min(Math.max(at.x, inset), Math.max(inset, viewport.w - inset)),
        y: Math.min(Math.max(at.y, inset), Math.max(inset, viewport.h - inset)),
      }
      out.push({
        id: presence.id,
        type: "collaboratorHint",
        ...this.baseRecord(presence),
        point,
        rotation: Math.atan2(at.y - cy, at.x - cx),
      })
    }
    return out
  }

  override render(ctx: CanvasRenderingContext2D): void {
    const overlays = this.getOverlays()
    if (overlays.length === 0) return
    const idleOpacity = this.options.idleOpacity
    isolate(ctx, (c) => {
      for (const overlay of overlays) {
        c.save()
        c.translate(overlay.point.x, overlay.point.y)
        c.rotate(overlay.rotation)
        c.globalAlpha = overlay.isIdle ? idleOpacity : 1
        c.fillStyle = overlay.color
        // A triangle pointing along +x, so the rotation above aims it at them.
        c.beginPath()
        c.moveTo(7, 0)
        c.lineTo(-5, -5)
        c.lineTo(-5, 5)
        c.closePath()
        c.fill()
        c.restore()
      }
      c.globalAlpha = 1
    })
  }
}
