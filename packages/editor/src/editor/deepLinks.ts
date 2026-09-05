/**
 * Links that point at a place on a board.
 *
 * A board URL that only names the document drops everyone at page one; a link
 * to "the diagram we were discussing" has to carry *where*. A deep link is that
 * where, encoded compactly enough to live in a query parameter and to survive
 * being pasted into a chat message.
 *
 * Three kinds, because the three answers to "where" are genuinely different:
 * a set of shapes (follows them if they move), a page (stable, coarse), or a
 * viewport rectangle (exact, but goes stale if the content moves).
 */
import { Box } from "../geometry"
import { isPageId, isShapeId, type PageId, type ShapeId } from "../records/base"

/** A place on a board, in the form a URL can carry. */
export type TLDeepLink =
  | { type: "shapes"; shapeIds: ShapeId[] }
  | { type: "page"; pageId: PageId }
  | { type: "viewport"; bounds: Box; pageId?: PageId }

/** How an editor turns its current state into a link, and back. */
export interface TLDeepLinkOptions {
  /** Query parameter the link is stored in. Defaults to `"d"`. */
  param?: string
  /** What to encode. Defaults to the current selection, else the viewport. */
  getTarget?(): TLDeepLink
  /** Called when a registered listener produces a new link for the URL. */
  onChange?(url: URL): void
  /** Debounce for `onChange`, in milliseconds. Defaults to 500. */
  debounceMs?: number
}

const SHAPE_PREFIX = "s"
const PAGE_PREFIX = "p"
const VIEWPORT_PREFIX = "v"

/**
 * Encode a deep link as a short string.
 *
 * The encoding is a one-character kind tag followed by dot-separated payload,
 * chosen so the result needs no percent-encoding in a query string: ids have
 * their `shape:` / `page:` prefixes stripped, and viewport numbers are rounded
 * to whole page units, which is well below what anyone can see.
 *
 * SEMANTICS-ASSUMED: the exact wire format. The docs pin the *round trip*
 * (`parseDeepLinkString(createDeepLinkString(x))` equals `x`) but not the
 * bytes, and a format nobody else parses is free to be the readable one.
 */
export function createDeepLinkString(deepLink: TLDeepLink): string {
  switch (deepLink.type) {
    case "shapes":
      return `${SHAPE_PREFIX}${deepLink.shapeIds.map((id) => id.slice("shape:".length)).join(".")}`
    case "page":
      return `${PAGE_PREFIX}${deepLink.pageId.slice("page:".length)}`
    case "viewport": {
      const { bounds, pageId } = deepLink
      const numbers = [bounds.x, bounds.y, bounds.w, bounds.h].map((n) => Math.round(n)).join(".")
      return pageId ? `${VIEWPORT_PREFIX}${numbers}.${pageId.slice("page:".length)}` : `${VIEWPORT_PREFIX}${numbers}`
    }
  }
}

/**
 * Decode a string produced by {@link createDeepLinkString}.
 *
 * Throws on anything it does not understand rather than guessing: a link that
 * silently decodes to the wrong place is worse than one that visibly fails, and
 * the caller (a router) is the only code able to decide what to show instead.
 */
export function parseDeepLinkString(str: string): TLDeepLink {
  const body = str.slice(1)
  switch (str[0]) {
    case SHAPE_PREFIX: {
      const shapeIds = body
        .split(".")
        .filter(Boolean)
        .map((part) => `shape:${part}` as ShapeId)
      if (shapeIds.length === 0 || !shapeIds.every(isShapeId)) break
      return { type: "shapes", shapeIds }
    }
    case PAGE_PREFIX: {
      const pageId = `page:${body}` as PageId
      if (!body || !isPageId(pageId)) break
      return { type: "page", pageId }
    }
    case VIEWPORT_PREFIX: {
      const parts = body.split(".")
      const numbers = parts.slice(0, 4).map(Number)
      if (numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n))) break
      const bounds = new Box(numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!)
      const rest = parts.slice(4).join(".")
      const pageId = rest ? (`page:${rest}` as PageId) : undefined
      return pageId ? { type: "viewport", bounds, pageId } : { type: "viewport", bounds }
    }
  }
  throw new Error(`Could not parse deep link: ${JSON.stringify(str)}`)
}
