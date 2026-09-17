import { track, useEditor } from "@mocanvas/editor"
import { useCanApplySelectionAction, useHasLockedShapes, useReadonly } from "./ui-actions"
import { useDialogs } from "./ui-dialogs"
import {
  TldrawUiMenuActionCheckboxItem,
  TldrawUiMenuActionItem,
  TldrawUiMenuCheckboxItem,
  TldrawUiMenuGroup,
  TldrawUiMenuItem,
  TldrawUiMenuSubmenu,
} from "./ui-menu"
import { canPrint, copyAs, cutSelectionToClipboard, copySelectionToClipboard, exportAs, pasteFromClipboard, printSelection } from "./ui-clipboard"
import { useAvailableTranslationLocales } from "./ui-translation"
import { useReduceMotion } from "./ui-a11y"

/**
 * The concrete menu items, and the groups and submenus that arrange them.
 *
 * Almost all of them are one line: a {@link TldrawUiMenuActionItem} naming an
 * entry in the action list. That indirection is the point — the item decides
 * *where* something appears, the action decides *what* it does and whether it
 * is available, and an app's `overrides.actions` therefore reaches every menu
 * at once. An item whose action has been removed renders nothing.
 *
 * The handful that are not one-liners are the ones with no single action
 * behind them: the clipboard (which is async), the submenus that enumerate
 * pages or languages, and the toggles that read a preference directly.
 */

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/** Cut the selection. */
export function CutMenuItem() {
  const editor = useEditor()
  const enabled = useCanApplySelectionAction()
  return <TldrawUiMenuItem id="cut" label="Cut" icon="cut" kbd="mod+x" disabled={!enabled} onSelect={() => void cutSelectionToClipboard(editor)} />
}

/** Copy the selection. */
export function CopyMenuItem() {
  const editor = useEditor()
  const enabled = useCanApplySelectionAction()
  return <TldrawUiMenuItem id="copy" label="Copy" icon="duplicate" kbd="mod+c" disabled={!enabled} onSelect={() => void copySelectionToClipboard(editor)} />
}

/** Paste at the viewport centre, or at the pointer when that mode is on. */
export function PasteMenuItem() {
  const editor = useEditor()
  const readonly = useReadonly()
  return <TldrawUiMenuItem id="paste" label="Paste" icon="paste" kbd="mod+v" disabled={readonly} onSelect={() => void pasteFromClipboard(editor)} />
}

/** Cut / copy / paste, as one group. */
export function ClipboardMenuGroup() {
  return (
    <TldrawUiMenuGroup id="clipboard">
      <CutMenuItem />
      <CopyMenuItem />
      <PasteMenuItem />
      <DuplicateMenuItem />
      <DeleteMenuItem />
    </TldrawUiMenuGroup>
  )
}

const COPY_FORMATS = ["svg", "png", "json"] as const

/** "Copy as" — the rendered formats, plus mocanvas's own content JSON. */
export function CopyAsMenuGroup() {
  const editor = useEditor()
  const enabled = useCanApplySelectionAction()
  return (
    <TldrawUiMenuSubmenu id="copy-as" label="Copy as" disabled={!enabled}>
      <TldrawUiMenuGroup id="copy-as-group">
        {COPY_FORMATS.map((format) => (
          <TldrawUiMenuItem key={format} id={`copy-as-${format}`} label={format.toUpperCase()} onSelect={() => void copyAs(editor, format)} />
        ))}
      </TldrawUiMenuGroup>
    </TldrawUiMenuSubmenu>
  )
}

const EXPORT_FORMATS = ["svg", "png", "jpeg", "webp"] as const

/** "Export as" — writes a file through the browser's downloader. */
export function ExportAsMenuGroup() {
  const editor = useEditor()
  return (
    <TldrawUiMenuSubmenu id="export-as" label="Export as">
      <TldrawUiMenuGroup id="export-as-group">
        {EXPORT_FORMATS.map((format) => (
          <TldrawUiMenuItem key={format} id={`export-as-${format}`} label={format.toUpperCase()} onSelect={() => void exportAs(editor, format)} />
        ))}
      </TldrawUiMenuGroup>
      <TldrawUiMenuGroup id="export-as-bg">
        <ToggleTransparentBgMenuItem />
      </TldrawUiMenuGroup>
    </TldrawUiMenuSubmenu>
  )
}

/** Export the whole document as a `.mocanvas` file. */
export function ExportFileContentSubMenu() {
  const editor = useEditor()
  return (
    <TldrawUiMenuSubmenu id="file" label="File">
      <TldrawUiMenuGroup id="file-group">
        <TldrawUiMenuItem
          id="save-file-copy"
          label="Save a copy"
          onSelect={() => {
            void import("../file").then(({ serializeMocanvasFile }) => {
              const blob = new Blob([serializeMocanvasFile(editor)], { type: "application/json" })
              void import("../export").then(({ downloadBlob }) => downloadBlob(blob, `${editor.getCurrentPage()?.name ?? "drawing"}.mocanvas`))
            })
          }}
        />
        <PrintItem />
      </TldrawUiMenuGroup>
    </TldrawUiMenuSubmenu>
  )
}

/**
 * Print the drawing — the selection if there is one, otherwise the page.
 *
 * Disabled on an empty page, because there is nothing to put on the paper and
 * a print dialog showing a blank sheet is worse than a greyed-out row.
 */
export const PrintItem = track(function PrintItem() {
  const editor = useEditor()
  const enabled = canPrint(editor)
  return <TldrawUiMenuItem id="print" label="Print" disabled={!enabled} onSelect={() => void printSelection(editor)} />
})

/** Copy-as and export-as, as one group. */
export function ConversionsMenuGroup() {
  return (
    <TldrawUiMenuGroup id="conversions">
      <CopyAsMenuGroup />
      <ExportAsMenuGroup />
    </TldrawUiMenuGroup>
  )
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Delete the selection. */
export function DeleteMenuItem() {
  return <TldrawUiMenuActionItem actionId="delete" />
}

/** Duplicate the selection. */
export function DuplicateMenuItem() {
  return <TldrawUiMenuActionItem actionId="duplicate" />
}

/** Group the selection. */
export function GroupMenuItem() {
  return <TldrawUiMenuActionItem actionId="group" />
}

/** Ungroup the selection. */
export function UngroupMenuItem() {
  return <TldrawUiMenuActionItem actionId="ungroup" />
}

/**
 * Group, or ungroup — whichever applies.
 *
 * One row rather than two, because in a menu the inapplicable one of the pair
 * is always greyed out, and a permanently-dead row is worse than a row whose
 * label changes.
 */
export const GroupOrUngroupMenuItem = track(function GroupOrUngroupMenuItem() {
  const editor = useEditor()
  const isGroup = editor.getSelectedShapes().some((shape) => shape.type === "group")
  return isGroup ? <UngroupMenuItem /> : <GroupMenuItem />
})

/** Select everything on the page. */
export function SelectAllMenuItem() {
  return <TldrawUiMenuActionItem actionId="select-all" />
}

/** Rotate the selection a quarter turn clockwise. */
export function RotateCWMenuItem() {
  return <TldrawUiMenuActionItem actionId="rotate-cw" />
}

/** Lock or unlock the selection. */
export function ToggleLockMenuItem() {
  return <TldrawUiMenuActionItem actionId="toggle-lock" />
}

/** Unlock every locked shape on the page. */
export function UnlockAllMenuItem() {
  const hasLocked = useHasLockedShapes()
  if (!hasLocked) return null
  return <TldrawUiMenuActionItem actionId="unlock-all" />
}

/** Lock, and unlock-all, as one group. */
export function LockGroup() {
  return (
    <TldrawUiMenuGroup id="lock">
      <ToggleLockMenuItem />
      <UnlockAllMenuItem />
    </TldrawUiMenuGroup>
  )
}

// ---------------------------------------------------------------------------
// Arrange
// ---------------------------------------------------------------------------

/** The six alignment items. */
export function AlignMenuItems() {
  return (
    <TldrawUiMenuGroup id="align">
      <TldrawUiMenuActionItem actionId="align-left" />
      <TldrawUiMenuActionItem actionId="align-center-horizontal" />
      <TldrawUiMenuActionItem actionId="align-right" />
      <TldrawUiMenuActionItem actionId="align-top" />
      <TldrawUiMenuActionItem actionId="align-center-vertical" />
      <TldrawUiMenuActionItem actionId="align-bottom" />
    </TldrawUiMenuGroup>
  )
}

/** The two distribute items. */
export function DistributeMenuItems() {
  return (
    <TldrawUiMenuGroup id="distribute">
      <TldrawUiMenuActionItem actionId="distribute-horizontal" />
      <TldrawUiMenuActionItem actionId="distribute-vertical" />
    </TldrawUiMenuGroup>
  )
}

/** The two stack items. */
export function StackMenuItems() {
  return (
    <TldrawUiMenuGroup id="stack">
      <TldrawUiMenuActionItem actionId="stack-horizontal" />
      <TldrawUiMenuActionItem actionId="stack-vertical" />
    </TldrawUiMenuGroup>
  )
}

/** The four reorder items. */
export function ReorderMenuItems() {
  return (
    <TldrawUiMenuGroup id="reorder">
      <TldrawUiMenuActionItem actionId="bring-to-front" />
      <TldrawUiMenuActionItem actionId="bring-forward" />
      <TldrawUiMenuActionItem actionId="send-backward" />
      <TldrawUiMenuActionItem actionId="send-to-back" />
    </TldrawUiMenuGroup>
  )
}

/** Reordering, as a submenu. */
export function ReorderMenuSubmenu() {
  return (
    <TldrawUiMenuSubmenu id="reorder" label="Reorder">
      <ReorderMenuItems />
    </TldrawUiMenuSubmenu>
  )
}

/** Align, distribute, stack, stretch and flip, as one submenu. */
export function ArrangeMenuSubmenu() {
  return (
    <TldrawUiMenuSubmenu id="arrange" label="Arrange">
      <AlignMenuItems />
      <DistributeMenuItems />
      <StackMenuItems />
      <TldrawUiMenuGroup id="stretch">
        <TldrawUiMenuActionItem actionId="stretch-horizontal" />
        <TldrawUiMenuActionItem actionId="stretch-vertical" />
      </TldrawUiMenuGroup>
      <TldrawUiMenuGroup id="flip">
        <TldrawUiMenuActionItem actionId="flip-horizontal" />
        <TldrawUiMenuActionItem actionId="flip-vertical" />
        <TldrawUiMenuActionItem actionId="pack" />
      </TldrawUiMenuGroup>
    </TldrawUiMenuSubmenu>
  )
}

// ---------------------------------------------------------------------------
// Shape-specific
// ---------------------------------------------------------------------------

/** Edit the selected shape's link. Only for a shape that carries a url. */
export const EditLinkMenuItem = track(function EditLinkMenuItem() {
  const editor = useEditor()
  const shape = editor.getOnlySelectedShape()
  if (!shape || typeof (shape.props as { url?: unknown }).url !== "string") return null
  const id = shape.id
  return <TldrawUiMenuItem id="edit-link" label="Edit link" onSelect={() => editor.setEditingShape(id)} />
})

/**
 * Turn a bookmark into an embed.
 *
 * Renders nothing unless an embed shape util is registered — mocanvas ships
 * the mechanism, not a provider list, so an app decides what is embeddable.
 */
export const ConvertToEmbedMenuItem = track(function ConvertToEmbedMenuItem() {
  const editor = useEditor()
  const shape = editor.getOnlySelectedShape()
  if (!shape || shape.type !== "bookmark" || !editor.hasShapeUtil("embed")) return null
  return (
    <TldrawUiMenuItem
      id="convert-to-embed"
      label="Convert to embed"
      onSelect={() => {
        const url = (shape.props as { url?: string }).url
        if (!url) return
        editor.markHistoryStoppingPoint("convert to embed")
        void import("../external/urlContent").then(({ createEmbedShape }) => {
          editor.deleteShapes([shape.id])
          createEmbedShape(editor, url, { x: shape.x, y: shape.y })
        })
      }}
    />
  )
})

/** Turn an embed into a bookmark. */
export const ConvertToBookmarkMenuItem = track(function ConvertToBookmarkMenuItem() {
  const editor = useEditor()
  const shape = editor.getOnlySelectedShape()
  if (!shape || shape.type !== "embed" || !editor.hasShapeUtil("bookmark")) return null
  return (
    <TldrawUiMenuItem
      id="convert-to-bookmark"
      label="Convert to bookmark"
      onSelect={() => {
        const url = (shape.props as { url?: string }).url
        if (!url) return
        editor.markHistoryStoppingPoint("convert to bookmark")
        void import("../external/urlContent").then(({ createBookmarkShape }) => {
          editor.deleteShapes([shape.id])
          createBookmarkShape(editor, url, undefined, { x: shape.x, y: shape.y })
        })
      }}
    />
  )
})

/** Shrink a frame to fit what is inside it. */
export const FitFrameToContentMenuItem = track(function FitFrameToContentMenuItem() {
  const editor = useEditor()
  const shape = editor.getOnlySelectedShape()
  if (!shape || !editor.isShapeFrameLike(shape)) return null
  const children = editor.getSortedChildIdsForParent(shape.id)
  if (children.length === 0) return null
  return (
    <TldrawUiMenuItem
      id="fit-frame-to-content"
      label="Fit to content"
      onSelect={() => {
        const bounds = editor.getShapesPageBounds(children)
        if (!bounds) return
        editor.markHistoryStoppingPoint("fit frame to content")
        editor.updateShape({ id: shape.id, type: shape.type, x: bounds.minX, y: bounds.minY, props: { w: bounds.width, h: bounds.height } } as never)
      }}
    />
  )
})

/** Delete a frame but keep its children. */
export const RemoveFrameMenuItem = track(function RemoveFrameMenuItem() {
  const editor = useEditor()
  const shape = editor.getOnlySelectedShape()
  if (!shape || !editor.isShapeFrameLike(shape)) return null
  return (
    <TldrawUiMenuItem
      id="remove-frame"
      label="Remove frame"
      onSelect={() => {
        const children = editor.getSortedChildIdsForParent(shape.id)
        editor.markHistoryStoppingPoint("remove frame")
        if (children.length > 0) editor.reparentShapes(children, shape.parentId)
        editor.deleteShapes([shape.id])
      }}
    />
  )
})

/** Let a text shape size itself to its content again. */
export const ToggleAutoSizeMenuItem = track(function ToggleAutoSizeMenuItem() {
  const editor = useEditor()
  const shape = editor.getOnlySelectedShape()
  if (!shape || shape.type !== "text" || (shape.props as { autoSize?: boolean }).autoSize !== false) return null
  return (
    <TldrawUiMenuItem
      id="toggle-auto-size"
      label="Auto size"
      onSelect={() => {
        editor.markHistoryStoppingPoint("auto size")
        editor.updateShape({ id: shape.id, type: shape.type, props: { autoSize: true } } as never)
      }}
    />
  )
})

/** Move the selection to another page. */
export const MoveToPageMenu = track(function MoveToPageMenu() {
  const editor = useEditor()
  const pages = editor.getPages()
  const currentId = editor.getCurrentPageId()
  const enabled = editor.getSelectedShapeIds().length > 0
  if (pages.length < 2 || !enabled) return null
  return (
    <TldrawUiMenuSubmenu id="move-to-page" label="Move to page">
      <TldrawUiMenuGroup id="move-to-page-group">
        {pages
          .filter((page) => page.id !== currentId)
          .map((page) => (
            <TldrawUiMenuItem
              key={page.id}
              id={`move-to-page-${page.id}`}
              label={page.name}
              onSelect={() => {
                editor.markHistoryStoppingPoint("move to page")
                editor.moveShapesToPage(editor.getSelectedShapeIds(), page.id)
              }}
            />
          ))}
      </TldrawUiMenuGroup>
    </TldrawUiMenuSubmenu>
  )
})

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

/** Reset the camera to 100%. */
export function ZoomTo100MenuItem() {
  return <TldrawUiMenuActionItem actionId="reset-zoom" />
}

/** Fit the whole page in the viewport. */
export function ZoomToFitMenuItem() {
  return <TldrawUiMenuActionItem actionId="zoom-to-fit" />
}

/** Fit the selection in the viewport. */
export function ZoomToSelectionMenuItem() {
  return <TldrawUiMenuActionItem actionId="zoom-to-selection" />
}

/**
 * Zoom to fit, or rotate — whichever the pointer device suggests.
 *
 * SEMANTICS-ASSUMED: mocanvas has no rotate-the-canvas feature, so this shows
 * the zoom half unconditionally. It exists under its documented name so a menu
 * composed of these items does not have a hole in it, and so the rotate half
 * can be filled in later without any caller changing.
 */
export function ZoomOrRotateMenuItem() {
  return <ZoomToFitMenuItem />
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/** Show the grid. */
export function ToggleGridItem() {
  return <TldrawUiMenuActionCheckboxItem actionId="toggle-grid" />
}

/** Snap to other shapes while dragging. */
export function ToggleSnapModeItem() {
  return <TldrawUiMenuActionCheckboxItem actionId="toggle-snap-mode" />
}

/** Keep the current tool after drawing a shape. */
export function ToggleToolLockItem() {
  return <TldrawUiMenuActionCheckboxItem actionId="toggle-tool-lock" />
}

/** Hide the chrome. */
export function ToggleFocusModeItem() {
  return <TldrawUiMenuActionCheckboxItem actionId="toggle-focus-mode" />
}

/** Show the frame-statistics chip and the debug menu. */
export function ToggleDebugModeItem() {
  return <TldrawUiMenuActionCheckboxItem actionId="toggle-debug-mode" />
}

/** Wrap long text instead of growing the shape. */
export function ToggleWrapModeItem() {
  return <TldrawUiMenuActionCheckboxItem actionId="toggle-wrap-mode" />
}

/** Scale new shapes so they look the same size at any zoom. */
export function ToggleDynamicSizeModeItem() {
  return <TldrawUiMenuActionCheckboxItem actionId="toggle-dynamic-size-mode" />
}

/** Paste at the pointer rather than at the viewport centre. */
export function TogglePasteAtCursorItem() {
  return <TldrawUiMenuActionCheckboxItem actionId="toggle-paste-at-cursor" />
}

/** Scroll the camera when dragging past the viewport edge. */
export function ToggleEdgeScrollingItem() {
  return <TldrawUiMenuActionCheckboxItem actionId="toggle-edge-scrolling" />
}

/** Keyboard shortcuts on or off. */
export function ToggleKeyboardShortcutsItem() {
  return <TldrawUiMenuActionCheckboxItem actionId="toggle-keyboard-shortcuts" />
}

/** Export with a transparent background. */
export function ToggleTransparentBgMenuItem() {
  return <TldrawUiMenuActionCheckboxItem actionId="toggle-transparent" />
}

/**
 * Turn off animation: the chrome's transitions and the camera's easing.
 *
 * Starts ticked for a user whose operating system asks for reduced motion —
 * they should not have to ask twice — but the tick tracks the editor's own
 * preference from the first press onwards, so the box always answers a click.
 * See {@link useReduceMotion}.
 */
export function ToggleReduceMotionItem() {
  const editor = useEditor()
  const reduced = useReduceMotion()
  return (
    <TldrawUiMenuCheckboxItem
      id="toggle-reduce-motion"
      label="Reduce motion"
      checked={reduced}
      onSelect={() => editor.user.updateUserPreferences({ animationSpeed: reduced ? 1 : 0 })}
    />
  )
}

/**
 * Invert the scroll direction of zooming.
 *
 * SEMANTICS-ASSUMED: mocanvas's camera options carry no invert flag, so this
 * toggles `wheelBehavior` between the two documented values, which is the
 * closest thing the option set has to the same effect.
 */
export const ToggleInvertZoomItem = track(function ToggleInvertZoomItem() {
  const editor = useEditor()
  const options = editor.getCameraOptions()
  const inverted = options.wheelBehavior === "zoom"
  return (
    <TldrawUiMenuCheckboxItem
      id="toggle-invert-zoom"
      label="Invert zoom direction"
      checked={inverted}
      onSelect={() => editor.setCameraOptions({ ...options, wheelBehavior: inverted ? "pan" : "zoom" })}
    />
  )
})

/**
 * Announce more than the minimum to a screen reader.
 *
 * SEMANTICS-ASSUMED: the name specifies no behaviour, so this settles on the
 * one an editor can honour — how much the selection announcer says. Off, it
 * names the selection; on, it also reads back position and size, which a
 * keyboard user otherwise cannot get at. Read it with
 * `editor.user.getIsEnhancedA11yMode()`; `useSelectedShapesAnnouncer` is what
 * consumes it today.
 *
 * `useEnhancedA11yMode` is deliberately NOT exported alongside it. An earlier
 * version of this file had one backed by a module-level boolean — so each
 * caller got its own copy of the state, and nothing read any of them. The
 * preference is the single source of truth, and tldraw's reference documents
 * only the menu item.
 */
export const ToggleEnhancedA11yModeItem = track(function ToggleEnhancedA11yModeItem() {
  const editor = useEditor()
  const enabled = editor.user.getIsEnhancedA11yMode()
  return (
    <TldrawUiMenuCheckboxItem
      id="toggle-enhanced-a11y"
      label="Enhanced accessibility"
      checked={enabled}
      onSelect={() => editor.user.updateUserPreferences({ isEnhancedA11yMode: !enabled })}
    />
  )
})

/**
 * The preferences, behind one row of the main menu.
 *
 * They used to be eleven toggles listed flat in the main menu, which made the
 * menu twice as long as the things people open it for — a menu whose first
 * screen is "Always snap / Tool lock / Wrap text / Paste at cursor" buries
 * Edit, View and Export under settings nobody changes twice.
 *
 * The three that group into a subject of their own get a submenu each rather
 * than a longer list: `AccessibilityMenu` and `InputModeMenu` were both written
 * and exported and had never been rendered anywhere. Language stays outside,
 * because it is not a preference about the canvas — it is the language the
 * menu itself is in, and looking for it inside a menu you cannot read is the
 * one case where nesting costs something real.
 */
export function PreferencesGroup() {
  return (
    <TldrawUiMenuGroup id="preferences">
      <TldrawUiMenuSubmenu id="preferences-submenu" label="Preferences">
        <TldrawUiMenuGroup id="preferences-toggles">
          <ToggleSnapModeItem />
          <ToggleToolLockItem />
          <ToggleGridItem />
          <ToggleWrapModeItem />
          <ToggleFocusModeItem />
          <ToggleEdgeScrollingItem />
          <ToggleDynamicSizeModeItem />
          <TogglePasteAtCursorItem />
          <ToggleDebugModeItem />
        </TldrawUiMenuGroup>
        <TldrawUiMenuGroup id="preferences-subjects">
          <AccessibilityMenu />
          <InputModeMenu />
          <ColorSchemeMenu />
        </TldrawUiMenuGroup>
      </TldrawUiMenuSubmenu>
      <LanguageMenu />
    </TldrawUiMenuGroup>
  )
}

/**
 * Light, dark, or follow the system.
 *
 * Writes through {@link Editor.setColorMode} as well as to the user's
 * preferences. The theme manager is what the canvas and the CSS custom
 * properties actually paint from; writing only the preference left the tick
 * moving and the screen unchanged, which is what made this menu look dead.
 */
export const ColorSchemeMenu = track(function ColorSchemeMenu() {
  const editor = useEditor()
  const current = editor.theme.getColorScheme()
  return (
    <TldrawUiMenuSubmenu id="color-scheme" label="Theme">
      <TldrawUiMenuGroup id="color-scheme-group">
        {(["light", "dark", "system"] as const).map((scheme) => (
          <TldrawUiMenuCheckboxItem
            key={scheme}
            id={`color-scheme-${scheme}`}
            label={scheme[0]!.toUpperCase() + scheme.slice(1)}
            checked={current === scheme}
            onSelect={() => {
              editor.setColorMode(scheme)
              editor.user.updateUserPreferences({ colorScheme: scheme })
            }}
          />
        ))}
      </TldrawUiMenuGroup>
    </TldrawUiMenuSubmenu>
  )
})

/**
 * Pick the UI locale — when there is more than one to pick from.
 *
 * mocanvas ships no message catalogues: its own labels are English display
 * text, and `overrides.translations` is where an app's dictionaries come
 * from. So the list is the host's locales, not the twenty-five entries of
 * {@link LANGUAGES} — offering a language for which no strings exist is a
 * promise the library cannot keep, and a user who picks one and sees nothing
 * change learns that the menu lies. With no dictionaries, or only one, this
 * renders nothing at all.
 */
export const LanguageMenu = track(function LanguageMenu() {
  const editor = useEditor()
  const languages = useAvailableTranslationLocales()
  const current = editor.user.getLocale()
  if (languages.length < 2) return null
  return (
    <TldrawUiMenuSubmenu id="language" label="Language">
      <TldrawUiMenuGroup id="language-group">
        {languages.map((language) => (
          <TldrawUiMenuCheckboxItem
            key={language.locale}
            id={`language-${language.locale}`}
            label={language.label}
            checked={current === language.locale}
            onSelect={() => editor.user.updateUserPreferences({ locale: language.locale })}
          />
        ))}
      </TldrawUiMenuGroup>
    </TldrawUiMenuSubmenu>
  )
})

/**
 * Which pointer devices draw.
 *
 * SEMANTICS-ASSUMED: mocanvas tracks one input mode — pen mode, on the
 * instance record — so this offers that as a two-state choice rather than the
 * larger set a stylus-first product would have.
 */
export const InputModeMenu = track(function InputModeMenu() {
  const editor = useEditor()
  const isPen = editor.getInstanceState().isPenMode
  return (
    <TldrawUiMenuSubmenu id="input-mode" label="Input">
      <TldrawUiMenuGroup id="input-mode-group">
        <TldrawUiMenuCheckboxItem id="input-mode-mouse" label="Mouse and touch" checked={!isPen} onSelect={() => editor.updateInstanceState({ isPenMode: false })} />
        <TldrawUiMenuCheckboxItem id="input-mode-pen" label="Pen only" checked={isPen} onSelect={() => editor.updateInstanceState({ isPenMode: true })} />
      </TldrawUiMenuGroup>
    </TldrawUiMenuSubmenu>
  )
})

/** The accessibility preferences. */
export function AccessibilityMenu() {
  return (
    <TldrawUiMenuSubmenu id="accessibility" label="Accessibility">
      <TldrawUiMenuGroup id="accessibility-group">
        <ToggleEnhancedA11yModeItem />
        <ToggleReduceMotionItem />
        <ToggleKeyboardShortcutsItem />
      </TldrawUiMenuGroup>
    </TldrawUiMenuSubmenu>
  )
}

// ---------------------------------------------------------------------------
// Submenus and groups
// ---------------------------------------------------------------------------

/** Undo and redo, as one group. */
export function UndoRedoGroup() {
  return (
    <TldrawUiMenuGroup id="undo-redo">
      <TldrawUiMenuActionItem actionId="undo" />
      <TldrawUiMenuActionItem actionId="redo" />
    </TldrawUiMenuGroup>
  )
}

/** The edit submenu's items, without the submenu frame. */
export function EditMenuSubmenu() {
  return (
    <TldrawUiMenuSubmenu id="edit" label="Edit">
      <UndoRedoGroup />
      <ClipboardMenuGroup />
      <ConversionsMenuGroup />
      <TldrawUiMenuGroup id="edit-select">
        <SelectAllMenuItem />
        <GroupOrUngroupMenuItem />
      </TldrawUiMenuGroup>
      <LockGroup />
    </TldrawUiMenuSubmenu>
  )
}

/** Alias of {@link EditMenuSubmenu}, under its other documented name. */
export const EditSubmenu = EditMenuSubmenu

/** The view submenu: zoom and grid. */
export function ViewSubmenu() {
  return (
    <TldrawUiMenuSubmenu id="view" label="View">
      <TldrawUiMenuGroup id="view-zoom">
        <TldrawUiMenuActionItem actionId="zoom-in" />
        <TldrawUiMenuActionItem actionId="zoom-out" />
        <ZoomTo100MenuItem />
        <ZoomToFitMenuItem />
        <ZoomToSelectionMenuItem />
      </TldrawUiMenuGroup>
      <TldrawUiMenuGroup id="view-modes">
        <ToggleGridItem />
        <ToggleFocusModeItem />
      </TldrawUiMenuGroup>
    </TldrawUiMenuSubmenu>
  )
}

/** Open the keyboard shortcuts dialog. */
export function KeyboardShortcutsMenuItem() {
  const { addDialog } = useDialogs()
  return (
    <TldrawUiMenuItem
      id="keyboard-shortcuts"
      label="Keyboard shortcuts"
      onSelect={() => {
        void import("./panel-shortcuts").then(({ KeyboardShortcutsDialogContents }) => {
          addDialog({ component: KeyboardShortcutsDialogContents })
        })
      }}
    />
  )
}

/** The odds and ends at the bottom of the main menu. */
export function ExtrasGroup() {
  return (
    <TldrawUiMenuGroup id="extras">
      <PrintItem />
      <KeyboardShortcutsMenuItem />
    </TldrawUiMenuGroup>
  )
}

/** The bottom group of the context menu. */
export function MiscMenuGroup() {
  return (
    <TldrawUiMenuGroup id="misc">
      <MoveToPageMenu />
      <EditLinkMenuItem />
      <ConvertToEmbedMenuItem />
      <ConvertToBookmarkMenuItem />
      <FitFrameToContentMenuItem />
      <RemoveFrameMenuItem />
      <ToggleAutoSizeMenuItem />
    </TldrawUiMenuGroup>
  )
}
