import type { TLFontFace } from "../theme"
import type { UnknownShape } from "../records/base"
import type { Editor } from "./Editor"

/**
 * A realm that can construct font faces. `FontFace` is a global rather than a
 * member of `Window` in the DOM typings, so the editor's own window has to be
 * narrowed to it by hand to stay iframe-correct.
 */
interface FontFaceRealm {
  FontFace?: new (family: string, source: string, descriptors?: FontFaceDescriptors) => FontFace
}

/** A `ShapeUtil` that knows which typefaces its shapes need. */
interface FontAwareShapeUtil {
  getFontFaces?(shape: UnknownShape): readonly TLFontFace[]
}

/** How far a request got. `error` is remembered so a broken url is tried once. */
export type TLFontLoadState = "loading" | "ready" | "error"

/**
 * Loads the typefaces the canvas actually needs, and only those.
 *
 * Shapes declare their faces through their `ShapeUtil`; the manager loads a
 * face the first time something asks for it, remembers the outcome, and never
 * requests the same face twice. Text measured before its face arrives would be
 * measured against a fallback, so anything that depends on final metrics waits
 * on {@link loadRequiredFontsForCurrentPage} first.
 *
 * Loading happens in the editor's own document (see `getContainerDocument`), so
 * a canvas inside an iframe registers its faces in the realm that paints it.
 * Where there is no DOM (server rendering, node tests) every request resolves
 * immediately and the face is recorded as ready: nothing is painted there, and
 * callers should not have to branch on the environment.
 */
export class FontManager {
  private readonly states = new Map<string, TLFontLoadState>()
  private readonly inFlight = new Map<string, Promise<void>>()
  private disposed = false

  constructor(private readonly editor: Editor) {}

  /** Ask for one face. Resolves when it is usable, or when it failed. */
  async requestFont(face: TLFontFace): Promise<void> {
    const key = fontKey(face)
    const state = this.states.get(key)
    if (state === "ready" || state === "error") return
    const existing = this.inFlight.get(key)
    if (existing) return existing

    const load = this.load(key, face)
    this.inFlight.set(key, load)
    try {
      await load
    } finally {
      this.inFlight.delete(key)
    }
  }

  /** Ask for several faces at once. Resolves when all of them have settled. */
  async requestFonts(faces: readonly TLFontFace[]): Promise<void> {
    await Promise.all(faces.map((face) => this.requestFont(face)))
  }

  /** Whether a face is loaded and safe to measure against. */
  isFontLoaded(face: TLFontFace): boolean {
    return this.states.get(fontKey(face)) === "ready"
  }

  /** What happened to a face, or `undefined` if it was never requested. */
  getFontState(face: TLFontFace): TLFontLoadState | undefined {
    return this.states.get(fontKey(face))
  }

  /** The faces one shape needs, as declared by its `ShapeUtil`. */
  getShapeFontFaces(shape: UnknownShape): readonly TLFontFace[] {
    const util = this.editor.getShapeUtil(shape) as unknown as FontAwareShapeUtil
    return util.getFontFaces?.(shape) ?? []
  }

  /** Every face needed by something on the page right now, deduplicated. */
  getRequiredFontsForCurrentPage(): TLFontFace[] {
    const seen = new Set<string>()
    const faces: TLFontFace[] = []
    for (const shape of this.editor.getCurrentPageShapes()) {
      for (const face of this.getShapeFontFaces(shape)) {
        const key = fontKey(face)
        if (seen.has(key)) continue
        seen.add(key)
        faces.push(face)
      }
    }
    return faces
  }

  /**
   * Load everything the current page needs and resolve once it is all in.
   * Await this before any measurement whose result is written back into a
   * shape, otherwise the first paint sizes text against a fallback face.
   *
   * `limit` is an escape hatch for pathological pages: a page needing more
   * distinct faces than that is left alone rather than issuing hundreds of
   * requests.
   */
  async loadRequiredFontsForCurrentPage(limit = Number.POSITIVE_INFINITY): Promise<void> {
    const faces = this.getRequiredFontsForCurrentPage()
    if (faces.length > limit) return
    await this.requestFonts(faces)
  }

  private async load(key: string, face: TLFontFace): Promise<void> {
    this.states.set(key, "loading")
    const doc = this.editor.getContainerDocument()
    const win = this.editor.getContainerWindow()
    const realm = (win ?? globalThis) as unknown as FontFaceRealm

    // No DOM and no font loading API: there is nothing to fetch, and treating
    // that as an error would make every server-side or node caller handle a
    // failure that never mattered.
    if (!doc?.fonts || !realm.FontFace) {
      this.states.set(key, "ready")
      return
    }

    try {
      const loaded = new realm.FontFace(face.family, toCssSrc(face.src), descriptorsFor(face))
      await loaded.load()
      if (this.disposed) return
      doc.fonts.add(loaded)
      this.states.set(key, "ready")
    } catch {
      // A face that will not load is not worth retrying on every keystroke; the
      // shape renders in its fallback family instead.
      this.states.set(key, "error")
    }
  }

  /** Forget every recorded state. In-flight loads are abandoned, not cancelled. */
  dispose(): void {
    this.disposed = true
    this.states.clear()
    this.inFlight.clear()
  }
}

/** The optional half of a `TLFontFace`, as `new FontFace()` wants it. */
function descriptorsFor(face: TLFontFace): FontFaceDescriptors {
  const descriptors: FontFaceDescriptors = {}
  if (face.weight !== undefined) descriptors.weight = face.weight
  if (face.style !== undefined) descriptors.style = face.style
  if (face.stretch !== undefined) descriptors.stretch = face.stretch
  if (face.unicodeRange !== undefined) descriptors.unicodeRange = face.unicodeRange
  if (face.display !== undefined) descriptors.display = face.display
  return descriptors
}

/**
 * Identity of a face for deduplication: two faces are the same request when
 * every descriptor matches. Deliberately not object identity — the same face
 * is routinely rebuilt from a table on each call.
 */
export function fontKey(face: TLFontFace): string {
  return [
    face.family,
    toCssSrc(face.src),
    face.weight ?? "",
    face.style ?? "",
    face.stretch ?? "",
    face.unicodeRange ?? "",
  ].join("\u0000")
}

/**
 * A face's source as CSS wants it.
 *
 * A `TLFontFaceSource` keeps the URL and the format apart so neither has to be
 * escaped into a descriptor by hand; `FontFace` only takes the descriptor, so
 * this is where the two are joined. A source given as a string is already a
 * descriptor and is passed through — that is how `local("Georgia")` and
 * multi-source faces stay expressible.
 */
export function toCssSrc(src: TLFontFace["src"]): string {
  if (typeof src === "string") return src
  const url = `url("${src.url.replace(/"/g, '\\"')}")`
  return src.format ? `${url} format("${src.format}")` : url
}
