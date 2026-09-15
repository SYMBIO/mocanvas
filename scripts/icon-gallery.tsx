/**
 * Renders every icon in the default set to one HTML page.
 *
 * The grid rules in `icons.tsx` are only partly checkable from the markup —
 * a test can tell you the ink stays inside the box, not that an icon reads
 * heavier than its neighbour or that two drawings are confusable. This is the
 * "gallery pass" that header refers to: run it and look.
 *
 *   pnpm icons:gallery [out.html]
 */
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Icon, ICONS, ICON_ALIASES, type DrawnIconName } from "../packages/mocanvas/src/ui/icons"

const drawn = (Object.keys(ICONS) as DrawnIconName[]).sort()
const aliasesOf = (name: DrawnIconName) =>
  Object.entries(ICON_ALIASES)
    .filter(([, target]) => target === name)
    .map(([alias]) => alias)

const cells = drawn
  .map((name) => {
    const also = aliasesOf(name)
    return `<figure><div class="ink">${renderToStaticMarkup(<Icon name={name} size={24} />)}</div><figcaption>${name}${
      also.length ? `<em>${also.join(", ")}</em>` : ""
    }</figcaption></figure>`
  })
  .join("")

const html = `<!doctype html><meta charset="utf-8"><title>mocanvas icons</title><style>
:root { color-scheme: light dark }
body { font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 28px; background: #fbfbfa; color: #1a1a19 }
h1 { font-size: 17px; margin: 0 0 4px }
p.sub { margin: 0 0 22px; opacity: .6 }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(116px, 1fr)); gap: 10px }
figure { margin: 0; padding: 12px 8px 9px; border: 1px solid #e6e6e2; border-radius: 9px; background: #fff; text-align: center }
.ink { display: flex; align-items: center; justify-content: center; height: 34px }
figcaption { margin-top: 7px; font-size: 10.5px; opacity: .72; word-break: break-word; line-height: 1.3 }
figcaption em { display: block; font-style: normal; opacity: .5; font-size: 9.5px; margin-top: 2px }
@media (prefers-color-scheme: dark) {
  body { background: #17171a; color: #e8e8e6 }
  figure { background: #212126; border-color: #33333a }
}
</style>
<h1>mocanvas icon set — ${drawn.length} drawings, ${Object.keys(ICON_ALIASES).length} aliases</h1>
<p class="sub">Phosphor (MIT) for generic chrome · our own drawings for canvas styles and arrowheads · geo generated from the canvas geometry</p>
<div class="grid">${cells}</div>`

const out = resolve(process.argv[2] ?? "icon-gallery.html")
writeFileSync(out, html)
console.log(`${drawn.length} drawings, ${Object.keys(ICON_ALIASES).length} aliases → ${out}`)
