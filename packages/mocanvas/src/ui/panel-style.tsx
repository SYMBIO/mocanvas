import { track, useEditor } from "@mocanvas/editor"
import { useRelevantStyles } from "./ui-actions"
import { useBreakpoint, PORTRAIT_BREAKPOINT } from "./ui-breakpoint"
import { TldrawUiPopover, TldrawUiPopoverContent, TldrawUiPopoverTrigger } from "./ui-popover"
import { Icon } from "./icons"
import {
  StylePanelArrowKindPicker,
  StylePanelArrowheadPicker,
  StylePanelColorPicker,
  StylePanelContextProvider,
  StylePanelDashPicker,
  StylePanelFillPicker,
  StylePanelFontPicker,
  StylePanelGeoShapePicker,
  StylePanelLabelAlignPicker,
  StylePanelOpacityPicker,
  StylePanelSection,
  StylePanelSizePicker,
  StylePanelSplinePicker,
  StylePanelTextAlignPicker,
} from "./style-pickers"
import type { TLUiStylePanelProps } from "./ui-components"

/**
 * The style panel, composed from the pickers.
 *
 * Every picker decides for itself whether it applies, so the panel's own job
 * is only the frame and the order. That is what makes replacing the *content*
 * a matter of listing different pickers, rather than reimplementing the
 * "which rows apply?" rule that used to live in the panel.
 */

/** The pickers, in the order the panel shows them. */
export function DefaultStylePanelContent() {
  return (
    <>
      <StylePanelSection label="Shape">
        <StylePanelGeoShapePicker />
        <StylePanelSplinePicker />
        <StylePanelArrowKindPicker />
      </StylePanelSection>
      <StylePanelSection label="Colour">
        <StylePanelColorPicker />
      </StylePanelSection>
      <StylePanelSection label="Stroke">
        <StylePanelFillPicker />
        <StylePanelDashPicker />
        <StylePanelSizePicker />
        <StylePanelArrowheadPicker />
      </StylePanelSection>
      <StylePanelSection label="Text">
        <StylePanelFontPicker />
        <StylePanelTextAlignPicker />
        <StylePanelLabelAlignPicker />
      </StylePanelSection>
      <StylePanelSection label="Shape opacity">
        <StylePanelOpacityPicker />
      </StylePanelSection>
    </>
  )
}

/**
 * Tools that never make a shape, so there is nothing for a style panel to be
 * about. With one of these active and nothing selected, the panel is asking a
 * question the canvas has not been asked.
 */
const NON_CREATING_TOOLS = new Set(["select", "hand", "zoom", "eraser", "laser"])

/**
 * The docked style panel.
 *
 * It appears when there is something to style: a selection, or a tool that is
 * about to create a shape. It used to be on permanently, because the styles
 * a tool *would* apply exist whether or not that tool is the pointer — so
 * picking the arrow, selecting nothing, and just looking at the board still
 * put a full panel of colours and fills in the corner, and it covered the
 * canvas underneath it.
 *
 * Renders nothing at all rather than an empty frame, which reads as broken
 * rather than as inapplicable.
 */
export const DefaultStylePanel = track(function DefaultStylePanel({ isMobile = false, children }: TLUiStylePanelProps) {
  const styles = useRelevantStyles()
  const editor = useEditor()
  const hasSelection = editor.getSelectedShapeIds().length > 0
  if (!hasSelection && NON_CREATING_TOOLS.has(editor.getCurrentToolId())) return null
  if (!styles && !hasSelection) return null
  return (
    <StylePanelContextProvider isMobile={isMobile}>
      <div className="mocanvas-panel mocanvas-stylepanel" role="region" aria-label="Style">
        {children ?? <DefaultStylePanelContent />}
      </div>
    </StylePanelContextProvider>
  )
})

/**
 * The style panel as a popover, for narrow layouts.
 *
 * The trigger is a colour swatch showing the current colour, which is the one
 * style a user is most likely to be reaching for and the only one that can be
 * shown legibly in a single button.
 *
 * It sits in a plate of its own, docked at the right end of the row the common
 * actions sit in — mirroring the zoom bar at the left end of the row below.
 * Without the plate it was a button with no placement *and* no variables, so
 * it rendered at the container's top-left corner at two thirds of its size,
 * under the menu plate: `--mocanvas-ui-btn` is declared on `.mocanvas-panel`,
 * and a `width` that reads an undefined variable is dropped.
 */
export const MobileStylePanel = track(function MobileStylePanel() {
  const editor = useEditor()
  const styles = useRelevantStyles()
  const disabled = editor.getIsReadonly()
  const hasSelection = editor.getSelectedShapeIds().length > 0
  // Both rules are the docked panel's, and they have to stay its rules: a
  // swatch that opens a panel about nothing is the same mistake in less space,
  // and a selection with no styles in common is still a selection with an
  // opacity. Held apart, the narrow layout was the one that lost — a custom
  // shape that declares no styles could be faded on a desktop and not on a
  // phone, where the swatch for it was never drawn.
  if (!hasSelection && NON_CREATING_TOOLS.has(editor.getCurrentToolId())) return null
  if (!styles && !hasSelection) return null
  return (
    <div className="mocanvas-panel mocanvas-style-dock">
    <TldrawUiPopover id="mobile-style-panel" side="above">
      <TldrawUiPopoverTrigger label="Style" className={disabled ? "mocanvas-btn mocanvas-btn--disabled" : "mocanvas-btn"}>
        <Icon name="fill-solid" />
      </TldrawUiPopoverTrigger>
      <TldrawUiPopoverContent label="Style">
        <StylePanelContextProvider isMobile>
          <div className="mocanvas-stylepanel mocanvas-stylepanel--mobile">
            <DefaultStylePanelContent />
          </div>
        </StylePanelContextProvider>
      </TldrawUiPopoverContent>
    </TldrawUiPopover>
    </div>
  )
})

/**
 * The style panel in whichever form the layout calls for.
 *
 * The breakpoint decides, not the caller: a panel that is docked on a phone
 * covers most of the canvas, and one that is a popover on a desktop wastes the
 * space it has.
 */
export function ResponsiveStylePanel() {
  const breakpoint = useBreakpoint()
  return breakpoint < PORTRAIT_BREAKPOINT.TABLET_SM ? <MobileStylePanel /> : <DefaultStylePanel />
}
