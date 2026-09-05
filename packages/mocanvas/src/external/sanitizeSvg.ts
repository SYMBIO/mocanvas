/**
 * Making pasted SVG safe to render.
 *
 * SVG is the one external format that is also a script host: an `<svg>` can
 * carry `<script>`, `onload=` handlers, external references that phone home,
 * and CSS that pulls in more of the same. Anything that arrives from a
 * clipboard or a dropped file goes through here first.
 *
 * The policy is an allowlist, because a denylist of dangerous element names has
 * been wrong every time anyone has tried it:
 *
 * - only known-safe elements and attributes survive;
 * - every `on*` attribute is removed, whatever it is called;
 * - links may only be `http:`, `https:` or `mailto:`;
 * - `<image>` and `<feImage>` may only reference `data:` URIs, so a pasted
 *   graphic cannot beacon out to the page it came from;
 * - `<use>` may only reference a fragment (`#id`) in the same document;
 * - CSS loses `@import`, `expression()` and any external `url()`;
 * - `<foreignObject>` survives, under an HTML allowlist, because that is how
 *   text is rendered — and so does a `<style>` holding `data:` font URLs.
 *
 * This is a floor, not a guarantee. An app with stricter requirements should
 * run a dedicated sanitizer (DOMPurify, say) in its own external content
 * handler; note that DOMPurify's default SVG profile strips `<foreignObject>`
 * and `<style>`, which mocanvas's own SVG export relies on, so it needs
 * configuring to keep them.
 */

const SVG_ELEMENTS = new Set([
  "svg", "g", "defs", "symbol", "use", "title", "desc", "metadata", "style",
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "textPath", "tref",
  "marker", "pattern", "mask", "clipPath", "linearGradient", "radialGradient", "stop",
  "image", "switch", "foreignObject",
  "filter", "feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix",
  "feDiffuseLighting", "feDisplacementMap", "feDistantLight", "feDropShadow", "feFlood", "feFuncA",
  "feFuncB", "feFuncG", "feFuncR", "feGaussianBlur", "feImage", "feMerge", "feMergeNode",
  "feMorphology", "feOffset", "fePointLight", "feSpecularLighting", "feSpotLight", "feTile", "feTurbulence",
  "a",
])

/** Elements a `<foreignObject>` may contain — enough for text rendering, nothing more. */
const HTML_ELEMENTS = new Set(["div", "span", "p", "br", "b", "strong", "i", "em", "u", "s", "code", "pre", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "a"])

/** Attributes that may carry a URL, and therefore need their scheme checked. */
const URL_ATTRIBUTES = new Set(["href", "xlink:href", "src"])

/** Attributes never allowed, whatever element they sit on. */
const BANNED_ATTRIBUTES = new Set(["xlink:script", "content", "http-equiv"])

const SAFE_LINK_SCHEME = /^(?:https?:|mailto:)/i
const FRAGMENT_ONLY = /^#[^\s]*$/

/**
 * Sanitize an SVG document, returning the cleaned markup — or `null` when the
 * input was not SVG at all, or when nothing survived.
 *
 * `null` rather than an empty string on purpose: a caller has to be able to
 * tell "there was nothing to draw" from "here is an empty drawing", and the
 * former should not create a shape.
 */
export function sanitizeSvg(svgText: string): string | null {
  if (typeof DOMParser === "undefined") {
    // Nothing can parse the document, so nothing can vouch for it. Refusing is
    // the only safe answer: returning the input unchanged would hand unchecked
    // markup to whatever renders it.
    return null
  }

  const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml")
  if (parsed.getElementsByTagName("parsererror").length > 0) return null
  const root = parsed.documentElement
  if (!root || root.tagName.toLowerCase() !== "svg") return null

  sanitizeElement(root, false)
  if (root.childNodes.length === 0 && root.attributes.length === 0) return null
  return new XMLSerializer().serializeToString(root)
}

/** Strip everything disallowed from `element` and its descendants, in place. */
function sanitizeElement(element: Element, inForeignObject: boolean): void {
  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase()
    const value = attribute.value

    // Event handlers are the whole attack in one attribute; drop the family.
    if (name.startsWith("on") || BANNED_ATTRIBUTES.has(name)) {
      element.removeAttribute(attribute.name)
      continue
    }

    if (URL_ATTRIBUTES.has(name)) {
      if (!isAllowedUrl(element.tagName, value)) element.removeAttribute(attribute.name)
      continue
    }

    if (name === "style" && hasUnsafeCss(value)) {
      element.setAttribute("style", sanitizeCss(value))
      continue
    }
  }

  for (const child of [...element.childNodes]) {
    if (child.nodeType === 3 /* text */) {
      if (element.tagName.toLowerCase() === "style") {
        child.nodeValue = sanitizeCss(child.nodeValue ?? "")
      }
      continue
    }
    if (child.nodeType !== 1 /* element */) {
      // Comments, CDATA and processing instructions carry nothing we render.
      element.removeChild(child)
      continue
    }
    const childElement = child as Element
    const tag = childElement.tagName
    const nowInForeignObject = inForeignObject || tag.toLowerCase() === "foreignobject"
    const allowed = inForeignObject ? HTML_ELEMENTS.has(tag.toLowerCase()) : SVG_ELEMENTS.has(tag) || SVG_ELEMENTS.has(tag.toLowerCase())
    if (!allowed) {
      element.removeChild(child)
      continue
    }
    sanitizeElement(childElement, nowInForeignObject)
  }
}

/** Whether a URL attribute on `tagName` may keep `value`. */
function isAllowedUrl(tagName: string, value: string): boolean {
  const url = value.trim()
  const tag = tagName.toLowerCase()
  // A `<use>` that can reach outside the document is a way to pull in markup
  // the sanitizer never saw.
  if (tag === "use") return FRAGMENT_ONLY.test(url)
  // A referenced image is fetched by the renderer; only a self-contained one
  // cannot become a request.
  if (tag === "image" || tag === "feimage") return url.startsWith("data:image/")
  if (url.startsWith("#")) return true
  return SAFE_LINK_SCHEME.test(url)
}

const UNSAFE_CSS = /@import|expression\s*\(|url\s*\(\s*(?!['"]?data:)/i

function hasUnsafeCss(css: string): boolean {
  return UNSAFE_CSS.test(css)
}

/**
 * Remove the parts of a stylesheet that can fetch or execute.
 *
 * `url(data:…)` survives, because that is how an exported drawing carries its
 * embedded fonts; every other `url()` is a request the document did not ask for.
 */
function sanitizeCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/url\s*\(\s*(['"]?)(?!data:)[^)]*\)/gi, "none")
}
