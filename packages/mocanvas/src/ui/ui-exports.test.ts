/**
 * The UI layer's export surface.
 *
 * The package barrel re-exports several directories with `export *`, and ES
 * modules resolve a name exported by two of them to *nothing* rather than to
 * an error. A name added here that happened to collide with one in
 * `@mocanvas/editor` would therefore vanish from the published package while
 * every type check still passed. This test is what catches that: it imports
 * through the package's own barrel and asserts the names arrive.
 */
import { describe, expect, it } from "vitest"
import * as pkg from "../index"

/** One name per module in the UI layer, plus everything easy to collide. */
const EXPECTED = [
  // primitives
  "TldrawUiButton",
  "TldrawUiButtonIcon",
  "TldrawUiButtonLabel",
  "TldrawUiButtonCheck",
  "TldrawUiIcon",
  "TldrawUiInput",
  "TldrawUiKbd",
  "TldrawUiSlider",
  "TldrawUiGrid",
  "TldrawUiRow",
  "TldrawUiColumn",
  "TldrawUiPopover",
  "TldrawUiPopoverTrigger",
  "TldrawUiPopoverContent",
  "TldrawUiSelect",
  "TldrawUiSelectTrigger",
  "TldrawUiSelectContent",
  "TldrawUiSelectItem",
  "TldrawUiSelectValue",
  "TldrawUiToolbar",
  "TldrawUiToolbarButton",
  "TldrawUiToolbarToggleGroup",
  "TldrawUiToolbarToggleItem",
  "TldrawUiDropdownMenuRoot",
  "TldrawUiDropdownMenuTrigger",
  "TldrawUiDropdownMenuContent",
  "TldrawUiDropdownMenuItem",
  "TldrawUiDropdownMenuCheckboxItem",
  "TldrawUiDropdownMenuGroup",
  "TldrawUiDropdownMenuIndicator",
  "TldrawUiDropdownMenuSub",
  "TldrawUiDropdownMenuSubTrigger",
  "TldrawUiDropdownMenuSubContent",
  "TldrawUiDialogHeader",
  "TldrawUiDialogTitle",
  "TldrawUiDialogBody",
  "TldrawUiDialogFooter",
  "TldrawUiDialogCloseButton",
  "TldrawUiTooltip",
  "TldrawUiTooltipProvider",
  "TldrawUiContextualToolbar",
  "TldrawUiOrientationProvider",
  // providers and their hooks
  "TldrawUiContextProvider",
  "TldrawUiComponentsProvider",
  "TldrawUiEventsProvider",
  "TldrawUiDialogsProvider",
  "TldrawUiToastsProvider",
  "TldrawUiTranslationProvider",
  "TldrawUiA11yProvider",
  "BreakPointProvider",
  "StylePanelContextProvider",
  "useTldrawUiComponents",
  "useDialogs",
  "useToasts",
  "useTranslation",
  "useAvailableTranslationLocales",
  "useUiEvents",
  "useA11y",
  "useReduceMotion",
  "ReduceMotionAttribute",
  "useBreakpoint",
  "useStylePanelContext",
  "useDefaultHelpers",
  "useTldrawUiOrientation",
  // menu system
  "TldrawUiMenuItem",
  "TldrawUiMenuGroup",
  "TldrawUiMenuSubmenu",
  "TldrawUiMenuCheckboxItem",
  "TldrawUiMenuActionItem",
  "TldrawUiMenuActionCheckboxItem",
  "TldrawUiMenuToolItem",
  "TldrawUiMenuContextProvider",
  // menu items
  "CutMenuItem",
  "CopyMenuItem",
  "PasteMenuItem",
  "DeleteMenuItem",
  "DuplicateMenuItem",
  "ArrangeMenuSubmenu",
  "ReorderMenuSubmenu",
  "EditSubmenu",
  "ViewSubmenu",
  "ExtrasGroup",
  "PreferencesGroup",
  "LanguageMenu",
  "ColorSchemeMenu",
  "AccessibilityMenu",
  // panels
  "TldrawUi",
  "DefaultMainMenu",
  "DefaultMainMenuContent",
  "DefaultContextMenu",
  "DefaultContextMenuContent",
  "DefaultActionsMenu",
  "DefaultQuickActions",
  "DefaultZoomMenu",
  "DefaultHelpMenu",
  "DefaultHelperButtons",
  "DefaultKeyboardShortcutsDialog",
  "DefaultStylePanel",
  "MobileStylePanel",
  "DefaultPageMenu",
  "DefaultNavigationPanel",
  "DefaultMinimap",
  "DefaultMenuPanel",
  "DefaultDebugMenu",
  "DefaultToasts",
  "DefaultDialogs",
  "OverflowingToolbar",
  "DefaultToolbarContent",
  "DefaultSharePanel",
  "DefaultPeopleMenu",
  "DefaultRichTextToolbar",
  "DefaultA11yAnnouncer",
  "DefaultImageToolbar",
  "DefaultVideoToolbar",
  "TldrawImage",
  // style pickers
  "StylePanelButtonPicker",
  "StylePanelDropdownPicker",
  "StylePanelDoubleDropdownPicker",
  "StylePanelColorPicker",
  "StylePanelOpacityPicker",
  "StylePanelSection",
  "StylePanelSubheading",
  "getColorStyleItems",
  "getFontStyleItems",
  "useRelevantStyles",
  // hooks
  "useCanUndo",
  "useCanRedo",
  "useReadonly",
  "useCanApplySelectionAction",
  "useUnlockedSelectedShapesCount",
  "useLocalStorageState",
  "useMenuIsOpen",
  "hideAllTooltips",
  "usePeerIds",
  "usePresence",
  "useShowCollaborationUi",
  "useImageOrVideoAsset",
  // toolbar items
  "SelectToolbarItem",
  "DrawToolbarItem",
  "RectangleToolbarItem",
  "ToggleToolLockedButton",
  // values
  "KEYBOARD_SHORTCUTS",
  "canPrint",
  "printSelection",
  "LANGUAGES",
  "RTL_LANGUAGES",
  "PORTRAIT_BREAKPOINT",
  "ASPECT_RATIO_OPTIONS",
  "ASPECT_RATIO_TO_VALUE",
  "containBoxSize",
  "getAssetInfo",
] as const

describe("the UI layer's public surface", () => {
  it("reaches the package barrel intact", () => {
    const missing = EXPECTED.filter((name) => (pkg as Record<string, unknown>)[name] === undefined)
    expect(missing).toEqual([])
  })

  it("does not shadow the editor's own UI exports", () => {
    // These come from `@mocanvas/editor`. If the UI layer ever exported a name
    // of its own here, both would silently disappear from the barrel.
    for (const name of ["useTools", "useActions", "useIsToolSelected", "useEditorComponents", "useGlobalMenuIsOpen"]) {
      expect((pkg as Record<string, unknown>)[name], name).toBeTypeOf("function")
    }
  })
})
