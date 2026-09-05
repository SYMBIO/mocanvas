/**
 * Whether the camera is moving, and a zoom level that does not change every
 * frame.
 *
 * Both exist for the same reason: work that is expensive to redo — re-rasterising
 * text at a new resolution, re-laying-out a minimap, fetching a higher-resolution
 * image — must not be triggered by every frame of a pinch. A component asks
 * {@link CameraStateTracker.getCameraState} to skip that work while the camera
 * is in flight, and reads {@link CameraStateTracker.getDebouncedZoomLevel}
 * instead of the live zoom so it only reacts once the movement settles.
 *
 * The tracker is driven by the editor, which calls {@link notifyCameraMoved}
 * whenever it writes a camera. It owns no listeners of its own.
 */
import { atom, type Atom } from "@mocanvas/state"
import { EditorManager } from "./EditorManager"
import type { Editor } from "./Editor"

/** `"idle"` when the camera has settled, `"moving"` while it is in flight. */
export type TLCameraState = "idle" | "moving"

export class CameraStateTracker extends EditorManager {
  private readonly _state: Atom<TLCameraState> = atom("editor.cameraState", "idle" as TLCameraState)
  private readonly _debouncedZoom: Atom<number>
  private settleHandle: number | undefined

  constructor(editor: Editor) {
    super(editor)
    this._debouncedZoom = atom("editor.debouncedZoom", editor.getCamera().z)
    this.register(() => this.cancelSettle())
  }

  /** Reactive: reading this inside a signal re-runs it when the camera stops. */
  getCameraState(): TLCameraState {
    return this._state.get()
  }

  /**
   * The zoom level as of the last time the camera settled, or as of the last
   * change bigger than `debouncedZoomOctaves`.
   *
   * The threshold is what makes this useful during a *slow* movement: a pinch
   * that crosses a whole zoom step should update the things that depend on
   * zoom even before the user lets go, while jitter around a single value
   * should not.
   */
  getDebouncedZoomLevel(): number {
    return this._debouncedZoom.get()
  }

  /**
   * Tell the tracker the camera just moved. Restarts the settle timer, so the
   * state stays `"moving"` for as long as moves keep arriving.
   */
  notifyCameraMoved(zoom: number): void {
    if (this.getIsDisposed()) return
    if (this._state.get() !== "moving") this._state.set("moving")

    const previous = this._debouncedZoom.get()
    const threshold = this.editor.options.debouncedZoomOctaves
    if (previous > 0 && Math.abs(Math.log2(zoom / previous)) >= threshold) this._debouncedZoom.set(zoom)

    this.cancelSettle()
    this.settleHandle = this.editor.timers.setTimeout(() => {
      this.settleHandle = undefined
      this._state.set("idle")
      this._debouncedZoom.set(this.editor.getCamera().z)
    }, this.editor.options.cameraMovingTimeoutMs)
  }

  private cancelSettle(): void {
    if (this.settleHandle === undefined) return
    this.editor.timers.clearTimeout(this.settleHandle)
    this.settleHandle = undefined
  }
}
