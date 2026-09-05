import { useEditor, useValue, type SharedStyleMap } from "@mocanvas/editor"

/**
 * The reactive predicates the chrome branches on.
 *
 * Each one is a thin `useValue` over the editor. They exist as named hooks
 * rather than inline reads so a menu item's enabled/disabled rule is written
 * once — `useCanApplySelectionAction()` is the same question in twelve places,
 * and twelve slightly different inline versions of it is how a menu ends up
 * with one row that greys out on a locked shape and eleven that do not.
 */

/** Whether there is anything to undo. */
export function useCanUndo(): boolean {
  const editor = useEditor()
  return useValue("canUndo", () => editor.getCanUndo(), [editor])
}

/** Whether there is anything to redo. */
export function useCanRedo(): boolean {
  const editor = useEditor()
  return useValue("canRedo", () => editor.getCanRedo(), [editor])
}

/** Whether the editor refuses document edits. */
export function useReadonly(): boolean {
  const editor = useEditor()
  return useValue("isReadonly", () => editor.getIsReadonly(), [editor])
}

/** How many of the selected shapes can actually be changed. */
export function useUnlockedSelectedShapesCount(min = 1): boolean {
  const editor = useEditor()
  return useValue("unlockedSelectedShapes", () => editor.getSelectedShapes().filter((shape) => !shape.isLocked).length >= min, [editor, min])
}

/**
 * Whether an action that edits the selection can run: the editor is writable
 * and at least one selected shape is unlocked.
 *
 * The two halves are checked together because either alone is misleading — a
 * writable editor with a locked selection, or an unlocked selection in a
 * read-only editor, both mean "no".
 */
export function useCanApplySelectionAction(): boolean {
  const readonly = useReadonly()
  const hasUnlocked = useUnlockedSelectedShapesCount(1)
  return !readonly && hasUnlocked
}

/** Whether the current page has any locked shapes to unlock. */
export function useHasLockedShapes(): boolean {
  const editor = useEditor()
  return useValue("hasLockedShapes", () => editor.getCurrentPageShapes().some((shape) => shape.isLocked), [editor])
}

/** Whether the grid is on. */
export function useIsGridMode(): boolean {
  const editor = useEditor()
  return useValue("isGridMode", () => editor.getInstanceState().isGridMode, [editor])
}

/** Whether the editor is in dark mode right now. */
export function useIsDarkMode(): boolean {
  const editor = useEditor()
  return useValue("isDarkMode", () => editor.getColorMode() === "dark", [editor])
}

/**
 * The styles the style panel should offer, and their shared values.
 *
 * With a selection this is what the selected shapes have in common; with
 * nothing selected it is what the active tool is about to create. `null` means
 * there is nothing to show — which a panel renders as nothing at all, rather
 * than as an empty frame.
 */
export function useRelevantStyles(): SharedStyleMap | null {
  const editor = useEditor()
  return useValue(
    "relevantStyles",
    () => {
      const styles = editor.getSharedStyles()
      if (styles.size === 0 && editor.getSelectedShapeIds().length > 0) return null
      return styles.size === 0 ? null : styles
    },
    [editor],
  )
}

/**
 * Whether an action can run right now, and whether it is on.
 *
 * The action list is built once per editor (see `buildDefaultActionItems`), so
 * an item cannot carry its own availability without freezing it. This is where
 * that question is answered instead: reactively, at the point of render, so a
 * menu row greys out the moment the selection stops supporting it.
 *
 * An action with no rule here is always enabled and never checked, which is
 * the right default for an app's own action: mocanvas knows nothing about when
 * it applies, and guessing "disabled" would make a working item look broken.
 */
export function useActionState(actionId: string): { disabled: boolean; checked: boolean } {
  const editor = useEditor()
  return useValue(
    "actionState",
    () => {
      const readonly = editor.getIsReadonly()
      const shapes = editor.getSelectedShapes()
      const unlocked = shapes.filter((shape) => !shape.isLocked).length
      const instance = editor.getInstanceState()
      const user = editor.user

      /** An action that edits the selection. */
      const edits = (min: number) => ({ disabled: readonly || unlocked < min, checked: false })

      switch (actionId) {
        case "undo":
          return { disabled: !editor.getCanUndo(), checked: false }
        case "redo":
          return { disabled: !editor.getCanRedo(), checked: false }
        case "zoom-to-selection":
        case "select-none":
          return { disabled: shapes.length === 0, checked: false }
        case "delete":
        case "duplicate":
        case "toggle-lock":
        case "rotate-cw":
        case "rotate-ccw":
        case "bring-to-front":
        case "bring-forward":
        case "send-backward":
        case "send-to-back":
        case "flip-horizontal":
        case "flip-vertical":
          return edits(1)
        case "group":
        case "align-left":
        case "align-center-horizontal":
        case "align-right":
        case "align-top":
        case "align-center-vertical":
        case "align-bottom":
        case "stretch-horizontal":
        case "stretch-vertical":
          return edits(2)
        case "distribute-horizontal":
        case "distribute-vertical":
        case "stack-horizontal":
        case "stack-vertical":
        case "pack":
          return edits(3)
        case "ungroup":
          return { disabled: readonly || !shapes.some((shape) => shape.type === "group"), checked: false }
        case "unlock-all":
          return { disabled: readonly || !editor.getCurrentPageShapes().some((shape) => shape.isLocked), checked: false }
        case "delete-page":
          return { disabled: readonly || editor.getPages().length < 2, checked: false }
        case "new-page":
        case "duplicate-page":
          return { disabled: readonly, checked: false }
        case "toggle-grid":
          return { disabled: false, checked: instance.isGridMode }
        case "toggle-focus-mode":
          return { disabled: false, checked: instance.isFocusMode }
        case "toggle-debug-mode":
          return { disabled: false, checked: instance.isDebugMode }
        case "toggle-tool-lock":
          return { disabled: readonly, checked: instance.isToolLocked }
        // The preference is "transparent background", the record is
        // "paint a background", so the tick is the negation.
        case "toggle-transparent":
          return { disabled: false, checked: !instance.exportBackground }
        case "toggle-snap-mode":
          return { disabled: false, checked: user.getIsSnapMode() }
        case "toggle-wrap-mode":
          return { disabled: false, checked: user.getIsWrapMode() }
        case "toggle-dynamic-size-mode":
          return { disabled: false, checked: user.getIsDynamicSizeMode() }
        case "toggle-paste-at-cursor":
          return { disabled: false, checked: user.getIsPasteAtCursorMode() }
        case "toggle-edge-scrolling":
          return { disabled: false, checked: user.getEdgeScrollSpeed() !== 0 }
        case "toggle-reduce-motion":
          return { disabled: false, checked: user.getAnimationSpeed() === 0 }
        case "toggle-dark-mode":
          return { disabled: false, checked: editor.getColorMode() === "dark" }
        case "toggle-keyboard-shortcuts":
          return { disabled: false, checked: user.getAreKeyboardShortcutsEnabled() }
        default:
          return { disabled: false, checked: false }
      }
    },
    [editor, actionId],
  )
}
