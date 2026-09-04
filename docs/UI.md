# The default UI

`<Mocanvas />` ships a small, opinionated interface: a toolbar, a zoom bar, a
style panel, an optional statistics chip, and the chrome the editor draws on the
canvas itself. All of it is optional and all of it is themeable from CSS.

Source lives in `packages/mocanvas/src/ui/`:

| File | What it holds |
| --- | --- |
| `DefaultUi.tsx` | The toolbar, the zoom bar, the stats chip, and the `DefaultUi` wrapper |
| `StylePanel.tsx` | The style panel and `getStylePanelSections`, the rule for which rows appear |
| `icons.tsx` | The whole icon set, plus the geo icons generated from canvas geometry |
| `overlays.tsx` | The shared tooltip and popover layers, and `placeNear` |
| `ui.css` | Every design token and every rule |
| `useKeyboardShortcuts.ts` | The default key bindings |

## Design tokens

Tokens are declared on `.mocanvas` (the editor container), on `.mocanvas-panel`,
and on `.mocanvas-layer` (the floating tooltip and popover, which sit outside the
panels in the DOM). Override any of them on `.mocanvas`, on a wrapper, or on a
single panel.

### Surfaces and colour

| Token | Light | Dark | Used for |
| --- | --- | --- | --- |
| `--mocanvas-ui-panel` | `#ffffff` | `#1b1d22` | Panel, popover and picker background |
| `--mocanvas-ui-panel-border` | `#d6d9e0` | `#3c404a` | Panel hairline, dividers, group separators |
| `--mocanvas-ui-control` | `rgba(16,24,40,.06)` | `rgba(255,255,255,.08)` | Recessed background of a segmented button |
| `--mocanvas-ui-text` | `#16181d` | `#eceef3` | Icon and label colour |
| `--mocanvas-ui-muted` | `#5c6070` | `#a4a9b4` | Row labels, stats text |
| `--mocanvas-ui-accent` | `#2563eb` | `#6ea8fe` | Selected control, focus ring |
| `--mocanvas-ui-accent-fg` | `#ffffff` | `#0e1116` | Icon on an accent fill |
| `--mocanvas-ui-accent-soft` | 12% accent | 18% accent | Hover on a segmented button, open disclosure |
| `--mocanvas-ui-hover` | 6% ink | 9% white | Hover on a bare button |
| `--mocanvas-ui-active` | 13% ink | 18% white | Pointer-down on a bare button |
| `--mocanvas-ui-shadow` | — | — | Panel elevation |
| `--mocanvas-ui-tip-bg` / `-fg` / `-muted` | — | — | Tooltip pill, its label, its shortcut |

Every text-on-background pair is at or above 4.5:1 in both palettes. Measured on
the shipped values, the tightest are `accent` on a segmented control (4.58 light,
5.54 dark) and `muted` on the panel (6.25 light, 7.16 dark). Disabled controls
render at 35% opacity, which WCAG exempts.

### Metrics

| Token | Value | Meaning |
| --- | --- | --- |
| `--mocanvas-ui-btn` | `40px` | Every hit target — buttons, swatches, popover cells |
| `--mocanvas-ui-icon` | `20px` | Icon size inside a button |
| `--mocanvas-ui-gap` | `2px` | Gap between adjacent controls |
| `--mocanvas-ui-pad` | `4px` | Padding of a bar |
| `--mocanvas-ui-pad-lg` | `10px` | Padding of the style panel, gap between its groups |
| `--mocanvas-ui-inset` | `12px` | Distance from a panel to the viewport edge |
| `--mocanvas-ui-radius` / `-sm` | `12px` / `8px` | Panel radius / control radius |
| `--mocanvas-ui-dock` | `300px` | Width the bottom-left and bottom-right docks reserve beside the centred toolbar |
| `--mocanvas-ui-bottom-dock` | `62px` (`124px` under 1290px) | Height the bottom edge occupies; the style panel stops above it |
| `--mocanvas-ui-font` / `-mono` | system stacks | Panel type / stats chip |

`--mocanvas-ui-dock` is the mechanism that keeps the three bottom panels apart:
the toolbar is centred on the viewport but may not grow into the reservation, so
it wraps rather than collide. Shrink it if your zoom bar is narrower than the
default one.

### Canvas chrome

These are read by the editor's indicator layer (`Canvas.tsx`), not by the panels,
so they apply even with `hideUi`. They are deliberately **not** redefined for the
dark UI: the canvas keeps its own background, which does not follow
`prefers-color-scheme`.

| Token | Value | Used for |
| --- | --- | --- |
| `--mocanvas-selection` | `#2f6fe4` | Selection and hover outlines, handle strokes, brush border |
| `--mocanvas-selection-fg` | `#ffffff` | Fill behind a solid handle |
| `--mocanvas-brush-fill` | 12% selection | Brush rectangle interior |
| `--mocanvas-snap` | `#cf3fe0` | Snap lines and their end markers |

The two stroke colours clear 3:1 against a light canvas (`#f9fafb`: 4.45 and
3.69) and against a dark one (`#1b1d22`: 3.63 and 4.37). If you render a dark
canvas, swap `--mocanvas-selection-fg` for a dark value so handles stay filled
with the canvas colour rather than white.

Handles are drawn at 9px (corners), 6px (shape handles) and 5.5px (rotate) in
screen space, with a 1.5px stroke. Their hit radius is a separate editor
constant, `HANDLE_HIT_RADIUS` in `packages/editor/src/editor/selectionHandles.ts`.

## Icon grid rules

Icons are original artwork on a 24×24 viewBox, painted with `currentColor`.

- **Grid.** 24×24. Ink, stroke included, stays inside it.
- **Weight.** Stroke 1.75, round caps and joins. Only texture marks deviate and
  say so at the call site: the fill hatching (1.25), the dotted rule (2.6 with a
  zero-length dash, so the caps draw the dots), the mono rails (1.4).
- **Centring.** Ink is optically centred on (12, 12), within half a grid unit.
  The only exceptions are semantic: `valign-top` and `valign-bottom` sit high and
  low on purpose.
- **Extent.** The longest ink dimension lands between 16 and 18.25 units — about
  17.75 for a full-bleed form — so no icon reads heavier than its neighbour. The
  `size-*` ramp is exempt: its whole job is to differ in size.
- **Distinctness.** No two icons may draw the same artwork; `icons.test.tsx`
  enforces this. It is why the handwriting font is a script `a` rather than a
  fourth capital A, and why `oval` gets a wider box than `ellipse`.
- **Geo icons** are generated from `getGeoGeometry`, the same code the canvas
  draws with, so a toolbar button always matches the shape it creates. Each kind
  is fitted into the box `getGeoIconBox(kind)` returns: square at `GEO_BOX` (16)
  by default, and flatter or narrower for kinds whose name implies a proportion
  (`rectangle`, `oval`, the four arrows). The longest side is always `GEO_BOX`.

Render one with `<Icon name="select" size={20} />`. `size` sets the SVG's
attributes; buttons additionally take their icon size from `--mocanvas-ui-icon`,
so inline marks like the "mixed" badge keep the size they ask for.

## Overriding the UI

### Turn it off

```tsx
<Mocanvas hideUi />
```

This drops the toolbar, zoom bar, style panel and stats chip. `ui.css` still
loads, so the canvas chrome tokens above keep working. Default keyboard
shortcuts are wired by `<Mocanvas />` itself and are unaffected; call
`useKeyboardShortcuts(editor)` yourself if you build on `<Canvas />` directly.

### Replace the canvas chrome

```tsx
<Mocanvas components={{ Indicators: MyIndicators, Brush: MyBrush, Background: MyGrid }} />
```

`components` is forwarded to `<Canvas />`. `Indicators` draws selection and hover
outlines and handles, `Brush` the marquee, `Background` a layer behind the canvas.
Each receives `{ editor }` and renders into the SVG overlay (`Background` into a
plain DOM layer). Omit one to keep the default.

### Rebuild the panels

Compose your own from the exported parts:

```tsx
import { Mocanvas, Toolbar, ZoomBar, StylePanel, UiTooltip, Icon } from "mocanvas"

<Mocanvas hideUi>
  <Toolbar />
  <MyOwnInspector />
  <UiTooltip />
</Mocanvas>
```

`Toolbar`, `ZoomBar`, `StylePanel`, `DebugStats`, `Popover`, `UiTooltip`, `Icon`
and `TOOLBAR_GROUPS` are all exported. Children of `<Mocanvas>` render above the
canvas inside the editor container, so the tokens apply to them too.

### Restyle it

```css
.mocanvas {
  --mocanvas-ui-accent: #12b886;
  --mocanvas-ui-radius: 6px;
  --mocanvas-ui-btn: 44px;
  --mocanvas-selection: #12b886;
}
```

## The panels

### Toolbar — bottom centre

Tools in four groups separated by dividers: select and hand; draw and eraser; the
five common geo kinds plus a disclosure for the other fifteen; text, note, and
whichever of arrow, line and frame the app registered. Entries whose tool is not
registered disappear, so a cut-down `tools` prop yields a cut-down bar. The
active tool is `aria-pressed`; a geo button is pressed only when its own kind is
active. The disclosure opens a 5-column popover of the remaining kinds and is
itself marked pressed when one of them is active. The bar is centred on the
viewport, wraps to more rows rather than growing into the docks, and moves to a
row of its own below 1290px.

### Zoom bar — bottom left

Zoom out, the current percentage (a button that resets to 100%), zoom in, zoom to
fit, then a divider and undo/redo. Undo and redo are `disabled` when there is
nothing to undo or redo, at 35% opacity and without a tooltip.

### Style panel — top right

Appears when the selection carries at least one style, or when a drawing tool is
active with nothing selected. Rows are grouped, and separated by a hairline:

1. **Shape** — the geo kind, as one button showing the current shape that opens a
   20-cell popover.
2. **Colour** — the stroke colour, and the label colour when the selection can
   carry one; twelve swatches each, six to a row.
3. **Stroke and fill** — Fill, Dash and Size, four choices each.
4. **Text** — Font, then horizontal and vertical alignment sharing one row.
5. **Opacity** — a slider; only with a selection, since it edits shapes rather
   than a style.

Which rows appear is decided by `getStylePanelSections(editor)`, which reads
`editor.getSharedStyles()` for a selection and
`editor.getStylePropsForType(toolId)` otherwise. A selection of two lines
therefore shows Colour, Dash and Size and nothing else. A row whose selected
shapes disagree shows a dashed "mixed" badge beside its label. The panel scrolls
when it is taller than the space above the bottom dock, with a fade and a shadow
at whichever edge has more content behind it. Below 560px it spans the width and
is capped at 42% of the height.

### Statistics chip — bottom right

Shape counts, drawn versus culled, and milliseconds per frame. Toggled with
`⌥D`, or with the `showStats` prop. It moves above the zoom bar below 560px.

### Tooltip and popover

Both are single, `position: fixed`, viewport-clamped layers (`overlays.tsx`).
A tooltip labels any element with `data-tooltip`, adding `data-shortcut` in a
muted weight; it appears after a 500ms rest, immediately on keyboard focus, sits
above its control so it never covers it, and flips below when there is no room.
`placeNear` does the arithmetic and is unit-tested. Popovers dismiss on outside
pointer-down and on Escape, which also returns focus to the button.

## States

| State | Bare button | Segmented button | Swatch |
| --- | --- | --- | --- |
| Rest | transparent | `--mocanvas-ui-control` | transparent |
| Hover | `--mocanvas-ui-hover` | `--mocanvas-ui-accent-soft` | `--mocanvas-ui-hover` |
| Pointer down | `--mocanvas-ui-active`, scaled 0.94 | as hover, scaled 0.94 | scaled 0.92 |
| Selected | accent fill, accent-fg icon | accent fill, accent-fg icon | double ring in accent |
| Selected + hover | accent fill plus an inset ring | same | same |
| Focus (keyboard) | 2px accent outline, 2px offset | same | same |
| Disabled | 35% opacity, no tooltip, default cursor | — | — |

The focus ring is offset by 2px so a ring of panel colour separates it from an
accent-filled button; without that gap, focus would be invisible on the active
tool. `prefers-reduced-motion` removes every transition.

## Pointer targets

Selection handles use a 24x24 px pointer target (`HANDLE_HIT_RADIUS = 12` in
`packages/editor/src/editor/selectionHandles.ts`), which is the WCAG 2.2
minimum. Two rules keep that from swallowing small shapes:

- Edge handles (top, right, bottom, left) only appear once that edge is at
  least `4 * HANDLE_HIT_RADIUS` long on screen; below that the two corners
  already cover the whole edge.
- On a selection smaller than six handles across, `getHandleHitRadius` scales
  the target down (never below 4 px) so the shape's interior stays draggable.

Both measure the *screen-space* edge lengths of the transformed corners, so a
rotated selection behaves the same as an upright one.
