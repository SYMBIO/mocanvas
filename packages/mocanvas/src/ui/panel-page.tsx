import { track, useEditor, useGlobalMenuIsOpen, type PageId } from "@mocanvas/editor"
import { useState } from "react"
import {
  TldrawUiDropdownMenuContent,
  TldrawUiDropdownMenuRoot,
  TldrawUiDropdownMenuSub,
  TldrawUiDropdownMenuSubContent,
  TldrawUiDropdownMenuSubTrigger,
  TldrawUiDropdownMenuTrigger,
} from "./ui-dropdown-menu"
import { TldrawUiIcon } from "./ui-icon"
import { TldrawUiInput } from "./ui-input"
import { TldrawUiMenuContextProvider, TldrawUiMenuGroup, TldrawUiMenuItem } from "./ui-menu"

/**
 * The page picker.
 *
 * A menu rather than a tab bar: a document with twenty pages has to stay
 * usable, and a row of twenty tabs does not. The current page's name doubles
 * as the trigger, so the panel costs one button's worth of chrome.
 *
 * ## Why the per-page actions are behind their own trigger
 * They used to be three rows printed beside every page name, which made a
 * five-page document a twenty-row menu in which nothing said which "Delete"
 * belonged to which page. One trigger per row, opening a menu that names the
 * page it acts on, is the same three actions without the ambiguity — and it
 * leaves the row itself as what it should be: the thing you click to switch
 * page.
 */

export interface PageItemInputProps {
  id: PageId
  name: string
  /** Focus and select the field as soon as it mounts. */
  isCurrentPage?: boolean
  onCancel?(): void
}

/**
 * The rename field on a page row.
 *
 * Commits on Enter or blur and reverts on Escape, both through
 * {@link TldrawUiInput} — renaming a page is one undo entry, not one per
 * keystroke.
 */
export function PageItemInput({ id, name, onCancel }: PageItemInputProps) {
  const editor = useEditor()
  return (
    <TldrawUiInput
      value={name}
      label={`Rename ${name}`}
      autoFocus
      autoSelect
      className="mocanvas-page-rename"
      onComplete={(next) => {
        const trimmed = next.trim()
        if (trimmed && trimmed !== name) {
          editor.markHistoryStoppingPoint("rename page")
          editor.renamePage(id, trimmed)
        }
        onCancel?.()
      }}
      onCancel={() => onCancel?.()}
    />
  )
}

export interface PageItemSubmenuProps {
  id: PageId
  index: number
  /** How many pages there are, so the last one cannot be deleted. */
  total: number
  /** The page's name, so the menu can say which page it acts on. */
  name?: string
  onRename?(): void
}

/**
 * The per-page actions: rename, duplicate, delete.
 *
 * Its open state is controlled here rather than left to the submenu, because
 * "Rename" has to close *this* menu and leave the page list open behind it —
 * the rename field it reveals lives in that list. An item that closed the
 * whole menu would put the field out of sight, which is the bug this shape
 * exists to prevent.
 */
export function PageItemSubmenu({ id, total, name, onRename }: PageItemSubmenuProps) {
  const editor = useEditor()
  const [open, setOpen] = useState(false)
  const label = name ? `Actions for ${name}` : "Page actions"
  return (
    <TldrawUiDropdownMenuSub id={`page-actions-${id}`} open={open} onOpenChange={setOpen}>
      <TldrawUiDropdownMenuSubTrigger label={label} className="mocanvas-page-row-actions">
        <span className="sr-only">{label}</span>
      </TldrawUiDropdownMenuSubTrigger>
      <TldrawUiDropdownMenuSubContent label={label}>
        <TldrawUiMenuGroup id={`page-actions-group-${id}`}>
          <TldrawUiMenuItem
            id={`rename-page-${id}`}
            label="Rename"
            noClose
            onSelect={() => {
              setOpen(false)
              onRename?.()
            }}
          />
          <TldrawUiMenuItem
            id={`duplicate-page-${id}`}
            label="Duplicate"
            noClose
            onSelect={() => {
              setOpen(false)
              editor.markHistoryStoppingPoint("duplicate page")
              editor.duplicatePage(id)
            }}
          />
          <TldrawUiMenuItem
            id={`delete-page-${id}`}
            label="Delete"
            noClose
            disabled={total < 2}
            onSelect={() => {
              setOpen(false)
              editor.markHistoryStoppingPoint("delete page")
              editor.deletePage(id)
            }}
          />
        </TldrawUiMenuGroup>
      </TldrawUiDropdownMenuSubContent>
    </TldrawUiDropdownMenuSub>
  )
}

/**
 * The page menu.
 *
 * Each row is a `menuitemradio`: exactly one page is current, which is what a
 * radio means, and it is what makes a screen reader say "3 of 5" rather than
 * reading five identical buttons.
 */
export const DefaultPageMenu = track(function DefaultPageMenu() {
  const editor = useEditor()
  const [isOpen, setIsOpen] = useGlobalMenuIsOpen("page-menu")
  const [renaming, setRenaming] = useState<PageId | null>(null)
  const pages = editor.getPages()
  const currentId = editor.getCurrentPageId()
  const current = pages.find((page) => page.id === currentId)

  return (
    <TldrawUiDropdownMenuRoot
      id="page-menu"
      open={isOpen}
      onOpenChange={(next) => {
        // A rename left half-finished when the menu closes should not be
        // waiting to reappear the next time it opens.
        if (!next) setRenaming(null)
        setIsOpen(next)
      }}
    >
      <TldrawUiDropdownMenuTrigger label={`Page: ${current?.name ?? "Untitled"}`} className="mocanvas-btn--wide">
        {current?.name ?? "Untitled"}
      </TldrawUiDropdownMenuTrigger>
      <TldrawUiDropdownMenuContent label="Pages" side="below">
        <TldrawUiMenuContextProvider type="menu" sourceId="menu">
          <div className="mocanvas-page-list" role="radiogroup" aria-label="Pages">
            {pages.map((page) => (
              <div key={page.id} className="mocanvas-page-row">
                {renaming === page.id ? (
                  <PageItemInput id={page.id} name={page.name} onCancel={() => setRenaming(null)} />
                ) : (
                  <>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={page.id === currentId}
                      className="mocanvas-menu-item mocanvas-page-row-name"
                      data-item={`page-${page.id}`}
                      onDoubleClick={() => setRenaming(page.id)}
                      onClick={() => {
                        editor.setCurrentPage(page.id)
                        setIsOpen(false)
                      }}
                    >
                      {page.name}
                    </button>
                    <PageItemSubmenu id={page.id} index={pages.indexOf(page)} total={pages.length} name={page.name} onRename={() => setRenaming(page.id)} />
                  </>
                )}
              </div>
            ))}
          </div>
          <TldrawUiMenuGroup id="page-menu-actions">
            <TldrawUiMenuItem
              id="new-page"
              label="New page"
              icon="duplicate"
              noClose
              onSelect={() => {
                const before = new Set(pages.map((page) => page.id))
                editor.markHistoryStoppingPoint("new page")
                editor.createPage({ name: `Page ${pages.length + 1}` })
                // Straight into the rename field: a page called "Page 4" is
                // almost never what it is going to be called.
                const created = editor.getPages().find((page) => !before.has(page.id))
                if (created) setRenaming(created.id)
              }}
            />
          </TldrawUiMenuGroup>
        </TldrawUiMenuContextProvider>
      </TldrawUiDropdownMenuContent>
    </TldrawUiDropdownMenuRoot>
  )
})

/** Read for its side effect on the type checker only. */
export type TLUiPageMenuIcon = typeof TldrawUiIcon
