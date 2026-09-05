import { useActions, useEditor, useIsToolSelected, useTools, type TLUiEventSource } from "@mocanvas/editor"
import { createContext, useContext, type ReactNode } from "react"
import { TldrawUiButtonCheck } from "./ui-button"
import {
  TldrawUiDropdownMenuCheckboxItem,
  TldrawUiDropdownMenuGroup,
  TldrawUiDropdownMenuItem,
  TldrawUiDropdownMenuSub,
  TldrawUiDropdownMenuSubContent,
  TldrawUiDropdownMenuSubTrigger,
} from "./ui-dropdown-menu"
import { TldrawUiIcon } from "./ui-icon"
import { TldrawUiKbd } from "./ui-kbd"
import { useActionState } from "./ui-actions"
import { useUiEvents } from "./ui-events"
import { useTranslation } from "./ui-translation"

/**
 * The menu system: one set of item components that render differently
 * depending on where they are.
 *
 * This is the whole point of it. The same `CutMenuItem` appears in the main
 * menu (a row with a label and a shortcut), in the context menu (the same),
 * in the actions menu (an icon-only button in a grid) and in the shortcuts
 * dialog (a label and a key, with no click behaviour at all). Writing four
 * components for each of seventy items is not an option, so the item asks the
 * context what shape to take.
 */

/** Where a menu item is being rendered. */
export type TLUiMenuContextType =
  /** A vertical list of rows: the main menu, the help menu. */
  | "menu"
  /** The right-click menu. Same shape as `menu`; kept apart so items can differ. */
  | "context-menu"
  /** A grid of icon-only buttons: the actions menu. */
  | "small-icons"
  /** A row of icon buttons: the quick actions. */
  | "icons"
  /** Read-only rows in the keyboard shortcuts dialog. */
  | "keyboard-shortcuts"
  /** The helper buttons above the toolbar. */
  | "helper-buttons"
  /** The tool bar. */
  | "toolbar"
  /** A panel's own layout, e.g. the style panel. */
  | "panel"

const MenuContext = createContext<{ type: TLUiMenuContextType; sourceId: TLUiEventSource }>({ type: "menu", sourceId: "menu" })

export interface TLUiMenuContextProviderProps {
  type: TLUiMenuContextType
  /** Reported to `onSelect` and to the UI event handler. */
  sourceId?: TLUiEventSource
  children?: ReactNode
}

/** Tells the items inside it what shape to take. */
export function TldrawUiMenuContextProvider({ type, sourceId, children }: TLUiMenuContextProviderProps) {
  const resolved: TLUiEventSource = sourceId ?? (type === "context-menu" ? "context-menu" : type === "toolbar" ? "toolbar" : "menu")
  return <MenuContext.Provider value={{ type, sourceId: resolved }}>{children}</MenuContext.Provider>
}

/** The menu context an item is in. */
export function useTldrawUiMenuContext() {
  return useContext(MenuContext)
}

export interface TLUiMenuItemProps {
  id: string
  label?: string
  icon?: string
  kbd?: string
  title?: string
  disabled?: boolean
  /** Marks this item as the active one in a set. */
  isSelected?: boolean
  /** Keep the menu open after selecting. */
  noClose?: boolean
  /** Rendered instead of the label; for an item that needs custom content. */
  children?: ReactNode
  onSelect?(source: TLUiEventSource): void
}

/**
 * One menu item, in whatever shape its context calls for.
 *
 * `label` is display text, already localized: an id with no dictionary entry
 * resolves to itself, so passing a literal is safe.
 */
export function TldrawUiMenuItem({ id, label, icon, kbd, title, disabled, isSelected, noClose, children, onSelect }: TLUiMenuItemProps) {
  const { type, sourceId } = useTldrawUiMenuContext()
  const msg = useTranslation()
  const trackEvent = useUiEvents()
  const text = label === undefined ? undefined : msg(label)

  const select = () => {
    onSelect?.(sourceId)
    trackEvent(id, { source: sourceId })
  }

  switch (type) {
    case "keyboard-shortcuts":
      return (
        <div className="mocanvas-shortcut-row" data-item={id}>
          <span className="mocanvas-shortcut-label">{text ?? id}</span>
          {kbd ? <TldrawUiKbd>{kbd}</TldrawUiKbd> : null}
        </div>
      )
    case "small-icons":
    case "icons":
    case "helper-buttons":
    case "toolbar":
      return (
        <button
          type="button"
          className="mocanvas-btn"
          data-item={id}
          disabled={disabled}
          aria-label={text ?? id}
          data-tooltip={title ?? text ?? id}
          {...(kbd ? { "aria-keyshortcuts": kbd, "data-shortcut": kbd } : {})}
          {...(isSelected === undefined ? {} : { "aria-pressed": isSelected })}
          onClick={select}
        >
          {icon ? <TldrawUiIcon icon={icon} label={text ?? id} /> : (children ?? <span>{text ?? id}</span>)}
        </button>
      )
    default:
      return (
        <TldrawUiDropdownMenuItem closeOnSelect={!noClose} {...(disabled ? { disabled } : {})} onSelect={select}>
          {icon ? <TldrawUiIcon icon={icon} /> : null}
          <span className="mocanvas-menu-item-label">{children ?? text ?? id}</span>
          {kbd ? <TldrawUiKbd>{kbd}</TldrawUiKbd> : null}
        </TldrawUiDropdownMenuItem>
      )
  }
}

export interface TLUiMenuGroupProps {
  id: string
  label?: string
  className?: string
  children?: ReactNode
}

/**
 * A run of related items, with a rule between it and the next.
 *
 * Renders nothing when it has no children, so a group whose items all decided
 * not to render does not leave a stray divider behind.
 */
export function TldrawUiMenuGroup({ id, label, className, children }: TLUiMenuGroupProps) {
  const { type } = useTldrawUiMenuContext()
  const msg = useTranslation()
  if (type === "small-icons" || type === "icons" || type === "toolbar" || type === "helper-buttons") {
    return (
      <div className="mocanvas-menu-icon-group" data-group={id} role="group" {...(label ? { "aria-label": msg(label) } : {})}>
        {children}
      </div>
    )
  }
  return (
    <TldrawUiDropdownMenuGroup className={["mocanvas-menu-group", className].filter(Boolean).join(" ")} {...(label ? { label: msg(label) } : {})}>
      {children}
    </TldrawUiDropdownMenuGroup>
  )
}

export interface TLUiMenuSubmenuProps {
  id: string
  label?: string
  disabled?: boolean
  size?: "tiny" | "small" | "medium" | "wide"
  children?: ReactNode
}

/**
 * A nested menu.
 *
 * Flattens into a plain group in the icon-only contexts: a grid of buttons has
 * nowhere to hang a submenu off, and hiding items behind one that cannot open
 * would lose them.
 */
export function TldrawUiMenuSubmenu({ id, label, disabled, children }: TLUiMenuSubmenuProps) {
  const { type } = useTldrawUiMenuContext()
  const msg = useTranslation()
  const text = label ? msg(label) : id
  if (type === "small-icons" || type === "icons" || type === "toolbar" || type === "helper-buttons" || type === "keyboard-shortcuts") {
    return (
      <div className="mocanvas-menu-icon-group" data-group={id} role="group" aria-label={text}>
        {children}
      </div>
    )
  }
  return (
    <TldrawUiDropdownMenuSub id={id}>
      <TldrawUiDropdownMenuSubTrigger label={text} {...(disabled ? { disabled } : {})} />
      <TldrawUiDropdownMenuSubContent label={text}>{children}</TldrawUiDropdownMenuSubContent>
    </TldrawUiDropdownMenuSub>
  )
}

export interface TLUiMenuCheckboxItemProps {
  id: string
  label?: string
  icon?: string
  kbd?: string
  title?: string
  checked?: boolean
  disabled?: boolean
  /** Close the menu after toggling. Off by default: toggles come in runs. */
  toggle?: boolean
  onSelect?(source: TLUiEventSource): void
}

/** A menu item that toggles. */
export function TldrawUiMenuCheckboxItem({ id, label, icon, kbd, title, checked = false, disabled, onSelect }: TLUiMenuCheckboxItemProps) {
  const { type, sourceId } = useTldrawUiMenuContext()
  const msg = useTranslation()
  const trackEvent = useUiEvents()
  const text = label ? msg(label) : id

  const select = () => {
    onSelect?.(sourceId)
    trackEvent(id, { source: sourceId })
  }

  if (type === "keyboard-shortcuts") {
    return (
      <div className="mocanvas-shortcut-row" data-item={id}>
        <span className="mocanvas-shortcut-label">{text}</span>
        {kbd ? <TldrawUiKbd>{kbd}</TldrawUiKbd> : null}
      </div>
    )
  }
  if (type === "small-icons" || type === "icons" || type === "toolbar" || type === "helper-buttons") {
    return (
      <button
        type="button"
        className="mocanvas-btn"
        data-item={id}
        role="checkbox"
        aria-checked={checked}
        aria-label={text}
        data-tooltip={title ?? text}
        disabled={disabled}
        onClick={select}
      >
        {icon ? <TldrawUiIcon icon={icon} label={text} /> : <span>{text}</span>}
      </button>
    )
  }
  return (
    <TldrawUiDropdownMenuCheckboxItem checked={checked} {...(disabled ? { disabled } : {})} {...(title ? { title } : {})} onSelect={select}>
      {icon ? <TldrawUiIcon icon={icon} /> : null}
      <span className="mocanvas-menu-item-label">{text}</span>
      {kbd ? <TldrawUiKbd>{kbd}</TldrawUiKbd> : null}
    </TldrawUiDropdownMenuCheckboxItem>
  )
}

export interface TLUiMenuActionItemProps {
  /** The id of an entry in the action list. */
  actionId: string
  /** Override the item's own label. */
  label?: string
  /** Override the item's own icon. */
  icon?: string
  disabled?: boolean
  noClose?: boolean
}

/**
 * A menu item driven by the action list.
 *
 * Renders nothing when the action is not registered — the normal state on a
 * trimmed or read-only editor. That is why the concrete items below are all
 * written this way: removing an action through `overrides.actions` removes it
 * from every menu at once, rather than leaving buttons that throw.
 */
export function TldrawUiMenuActionItem({ actionId, label, icon, disabled, noClose }: TLUiMenuActionItemProps) {
  const actions = useActions()
  const state = useActionState(actionId)
  const action = actions[actionId]
  if (!action) return null
  return (
    <TldrawUiMenuItem
      id={action.id}
      label={label ?? action.label}
      {...(icon ?? action.icon ? { icon: icon ?? (action.icon as string) } : {})}
      {...(action.kbd ? { kbd: action.kbd } : {})}
      {...((disabled ?? action.disabled ?? state.disabled) ? { disabled: true } : {})}
      {...(noClose ? { noClose } : {})}
      onSelect={(source) => action.onSelect(source)}
    />
  )
}

export interface TLUiMenuActionCheckboxItemProps extends TLUiMenuActionItemProps {
  checked?: boolean
}

/** A checkbox menu item driven by the action list. */
export function TldrawUiMenuActionCheckboxItem({ actionId, label, icon, checked, disabled }: TLUiMenuActionCheckboxItemProps) {
  const actions = useActions()
  const state = useActionState(actionId)
  const action = actions[actionId]
  if (!action) return null
  const isChecked = checked ?? (typeof action.meta?.["checked"] === "boolean" ? (action.meta["checked"] as boolean) : state.checked)
  return (
    <TldrawUiMenuCheckboxItem
      id={action.id}
      label={label ?? action.label}
      {...(icon ?? action.icon ? { icon: icon ?? (action.icon as string) } : {})}
      {...(action.kbd ? { kbd: action.kbd } : {})}
      checked={isChecked}
      {...((disabled ?? action.disabled ?? state.disabled) ? { disabled: true } : {})}
      onSelect={(source) => action.onSelect(source)}
    />
  )
}

export interface TLUiMenuToolItemProps {
  /** The id of an entry in the tool list. */
  toolId: string
  label?: string
  icon?: string
  disabled?: boolean
}

/**
 * A menu item driven by the tool list, showing whether its tool is active.
 *
 * Renders nothing when the tool is not registered, for the same reason
 * {@link TldrawUiMenuActionItem} does.
 */
export function TldrawUiMenuToolItem({ toolId, label, icon, disabled }: TLUiMenuToolItemProps) {
  const tools = useTools()
  const tool = tools[toolId]
  const isSelected = useIsToolSelected(tool)
  if (!tool) return null
  return (
    <TldrawUiMenuItem
      id={tool.id}
      label={label ?? tool.label}
      icon={icon ?? tool.icon}
      {...(tool.kbd ? { kbd: tool.kbd } : {})}
      {...(disabled ?? tool.disabled ? { disabled: true } : {})}
      isSelected={isSelected}
      onSelect={(source) => tool.onSelect(source)}
    />
  )
}

/** Read for its side effect on the type checker only; keeps `useEditor` imported. */
export type TLUiMenuEditorHook = typeof useEditor
