/**
 * Regenerates `packages/mocanvas/src/ui/icons-phosphor.tsx`.
 *
 * The default UI's generic artwork comes from Phosphor Icons (MIT), drawn at
 * "regular" weight. We inline the path data rather than depend on
 * `@phosphor-icons/react`, because mocanvas ships as an SDK: a runtime
 * dependency would land in every consumer's bundle for the sake of ~130
 * glyphs, and a React-component dependency would pin consumers to our React
 * range. Inlining costs a build step and buys a dependency-free package.
 *
 * Only the `regular` weight is extracted. Phosphor draws it as a *filled*
 * outline on a 256 grid, not as a stroke, which is why `icons.tsx` paints
 * these in a scaled `fill="currentColor"` group instead of the stroked one the
 * hand-drawn icons use.
 *
 * Usage:
 *   node scripts/generate-phosphor-icons.mjs <path-to-@phosphor-icons/react>
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"

/**
 * mocanvas icon name → Phosphor icon, as its `dist/defs` basename.
 *
 * Names on the left are the ones the UI and an app's overrides ask for; where
 * tldraw spells the same idea differently, the other spelling is an alias in
 * `icons.tsx` rather than a second entry here, so no two names resolve to the
 * same artwork.
 */
const MAP = {
  // Tools
  select: "Cursor",
  hand: "Hand",
  draw: "Pencil",
  eraser: "Eraser",
  highlight: "Highlighter",
  laser: "Broadcast",
  text: "TextT",
  note: "Note",
  frame: "Selection",
  arrow: "ArrowUpRight",
  line: "LineSegment",
  image: "Image",
  screenshot: "Camera",

  // View
  "zoom-in": "MagnifyingGlassPlus",
  "zoom-out": "MagnifyingGlassMinus",
  "zoom-fit": "CornersOut",
  "reset-zoom": "MagnifyingGlass",
  corners: "FrameCorners",

  // History
  undo: "ArrowUUpLeft",
  redo: "ArrowUUpRight",
  "rotate-cw": "ArrowClockwise",
  "rotate-ccw": "ArrowCounterClockwise",

  // Object actions
  lock: "Lock",
  unlock: "LockOpen",
  duplicate: "Copy",
  // Cut used to borrow `trash`, which is what Delete is marked with — two
  // different destinations, one drawing.
  cut: "Scissors",
  trash: "Trash",
  group: "SelectionPlus",
  ungroup: "SelectionSlash",
  "bring-forward": "ArrowUp",
  "bring-to-front": "ArrowLineUp",
  "send-backward": "ArrowDown",
  "send-to-back": "ArrowLineDown",
  edit: "PencilSimple",
  crop: "Crop",
  pack: "SquaresFour",

  // Align, distribute, stack, stretch
  "align-top": "AlignTop",
  "align-bottom": "AlignBottom",
  "align-left": "AlignLeft",
  "align-right": "AlignRight",
  "align-center-horizontal": "AlignCenterHorizontal",
  "align-center-vertical": "AlignCenterVertical",
  "distribute-horizontal": "ArrowsHorizontal",
  "distribute-vertical": "ArrowsVertical",
  "stack-horizontal": "Columns",
  "stack-vertical": "Rows",
  "stretch-horizontal": "ArrowsOutLineHorizontal",
  "stretch-vertical": "ArrowsOutLineVertical",

  // Text formatting
  bold: "TextB",
  italic: "TextItalic",
  underline: "TextUnderline",
  strike: "TextStrikethrough",
  code: "Code",
  heading: "TextHOne",
  list: "ListNumbers",
  bulletList: "ListBullets",
  leading: "Paragraph",

  // Chrome
  menu: "List",
  "dots-horizontal": "DotsThree",
  "dots-vertical": "DotsThreeVertical",
  "drag-handle-dots": "DotsSixVertical",
  "chevron-down": "CaretDown",
  "chevron-up": "CaretUp",
  "chevron-left": "CaretLeft",
  "chevron-right": "CaretRight",
  "chevrons-ne": "ArrowsOutSimple",
  "chevrons-sw": "ArrowsInSimple",
  check: "Check",
  "check-circle": "CheckCircle",
  close: "X",
  "cross-circle": "XCircle",
  plus: "Plus",
  minus: "Minus",
  dot: "DotOutline",
  alt: "Option",

  // Status and help
  "info-circle": "Info",
  "warning-triangle": "Warning",
  "help-circle": "Question",
  "question-mark": "QuestionMark",
  broken: "ImageBroken",
  disconnected: "PlugsConnected",
  "status-offline": "CloudSlash",

  // Links, sharing, clipboard
  link: "Link",
  "external-link": "ArrowSquareOut",
  "clipboard-copy": "Clipboard",
  "clipboard-copied": "ClipboardText",
  download: "DownloadSimple",
  "share-1": "ShareNetwork",
  bookmark: "BookmarkSimple",
  comment: "ChatCircle",
  color: "Palette",
  manual: "BookOpen",

  // Collaboration
  follow: "UserFocus",
  following: "UsersThree",

  // Toggles
  "toggle-off": "ToggleLeft",
  "toggle-on": "ToggleRight",

  // Brands
  github: "GithubLogo",
  twitter: "TwitterLogo",
  discord: "DiscordLogo",

  // Arrow kinds
  "arrow-arc": "ArrowArcRight",
  "arrow-elbow": "ArrowElbowRight",
  "arrow-cycle": "ArrowsClockwise",
  "spline-cubic": "Path",
  "spline-line": "Polygon",
}

const pkg = process.argv[2] ?? resolve(process.cwd(), "node_modules/@phosphor-icons/react")
const defs = join(pkg, "dist/defs")
if (!existsSync(defs)) {
  console.error(`No Phosphor defs at ${defs}\nUsage: node scripts/generate-phosphor-icons.mjs <path-to-@phosphor-icons/react>`)
  process.exit(1)
}

const version = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).version

/** The `d` of every `<path>` in an icon's `regular` weight, in document order. */
function regularPaths(def) {
  const file = join(defs, `${def}.es.js`)
  if (!existsSync(file)) throw new Error(`Phosphor has no icon named ${def}`)
  const src = readFileSync(file, "utf8")
  const start = src.indexOf('"regular"')
  if (start === -1) throw new Error(`${def} has no regular weight`)
  // Weights are entries in one Map, each `[ "name", <element> ]`; the next
  // `[\n    "` opens the following entry and so ends this one.
  const rest = src.slice(start)
  const end = rest.search(/\n  \],\n  \[/)
  const body = end === -1 ? rest : rest.slice(0, end)
  const ds = [...body.matchAll(/\bd:\s*"([^"]+)"/g)].map((m) => m[1])
  if (ds.length === 0) throw new Error(`${def} regular weight has no path data`)
  return ds
}

const entries = Object.entries(MAP).sort(([a], [b]) => a.localeCompare(b))
const seen = new Map()
const lines = []
for (const [name, def] of entries) {
  const twin = seen.get(def)
  if (twin) throw new Error(`${name} and ${twin} both map to Phosphor's ${def}`)
  seen.set(def, name)
  const ds = regularPaths(def)
  lines.push(`  ${JSON.stringify(name)}: [${ds.map((d) => `\n    ${JSON.stringify(d)},`).join("")}\n  ],`)
}

const out = `/**
 * Phosphor artwork for the default UI, inlined.
 *
 * GENERATED by \`scripts/generate-phosphor-icons.mjs\` from
 * \`@phosphor-icons/react@${version}\` at the \`regular\` weight — do not edit by
 * hand; change the map in the script and re-run it.
 *
 * Phosphor Icons is MIT licensed, © Phosphor Icons. See \`NOTICE\` at the repo
 * root for the notice we redistribute with it.
 *
 * Each value is the \`d\` of one or more paths on Phosphor's 256×256 grid,
 * drawn as a *filled* outline. \`icons.tsx\` scales and paints them; nothing
 * else should read this map directly.
 */

/** Side of the grid Phosphor draws on. */
export const PHOSPHOR_GRID = 256

/**
 * Phosphor path data, keyed by the mocanvas icon name it provides.
 *
 * \`as const\` rather than an annotation on purpose: the keys have to stay
 * literal, because \`IconName\` is derived from them and a \`Record<string, _>\`
 * would widen every icon name in the public API to \`string\`.
 */
export const PHOSPHOR_PATHS = {
${lines.join("\n")}
} as const satisfies Record<string, readonly string[]>
`

const dest = resolve(process.cwd(), "packages/mocanvas/src/ui/icons-phosphor.ts")
writeFileSync(dest, out)
console.log(`Wrote ${entries.length} icons from @phosphor-icons/react@${version} to ${dest}`)
