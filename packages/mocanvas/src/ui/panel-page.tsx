import { track, useEditor, useGlobalMenuIsOpen, type PageId } from "@mocanvas/editor"
import { useState } from "react"
import { TldrawUiDropdownMenuContent, TldrawUiDropdownMenuRoot, TldrawUiDropdownMenuTrigger } from "./ui-dropdown-menu"
import { TldrawUiIcon } from "./ui-icon"
import { TldrawUiInput } from "./ui-input"
import { TldrawUiMenuContextProvider, TldrawUiMenuGroup, TldrawUiMenuItem } from "./ui-menu"

/**
 * The page picker.
 *
 * A menu rather than a tab bar: a document with twenty pages has to stay
 * usable, and a row of twenty tabs does not. The current page's name doubles
 * as the trigger, so the panel costs one button's worth of chrome.
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
      label="Page name"
      autoFocus
      autoSelect
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
  onRename?(): void
}

/** The per-page actions: rename, duplicate, delete. */
export function PageItemSubmenu({ id, total, onRename }: PageItemSubmenuProps) {
  const editor = useEditor()
  return (
    <TldrawUiMenuGroup id={`page-actions-${id}`}>
      <TldrawUiMenuItem id={`rename-page-${id}`} label="Rename" onSelect={() => onRename?.()} />
      <TldrawUiMenuItem id={`duplicate-page-${id}`} label="Duplicate" onSelect={() => editor.duplicatePage(id)} />
      <TldrawUiMenuItem id={`delete-page-${id}`} label="Delete" disabled={total < 2} onSelect={() => editor.deletePage(id)} />
    </TldrawUiMenuGroup>
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
    <TldrawUiDropdownMenuRoot id="page-menu" open={isOpen} onOpenChange={setIsOpen}>
      <TldrawUiDropdownMenuTrigger label={`Page: ${current?.name ?? "Untitled"}`} className="mocanvas-btn--wide">
        {current?.name ?? "Untitled"}
      </TldrawUiDropdownMenuTrigger>
      <TldrawUiDropdownMenuContent label="Pages" side="below">
        <TldrawUiMenuContextProvider type="menu" sourceId="menu">
          <div className="mocanvas-page-list" role="radiogroup" aria-label="Pages">
            {pages.map((page, index) =>
              renaming === page.id ? (
                <PageItemInput key={page.id} id={page.id} name={page.name} onCancel={() => setRenaming(null)} />
              ) : (
                <div key={page.id} className="mocanvas-page-row">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={page.id === currentId}
                    className="mocanvas-menu-item"
                    onDoubleClick={() => setRenaming(page.id)}
                    onClick={() => {
                      editor.setCurrentPage(page.id)
                      setIsOpen(false)
                    }}
                  >
                    {page.name}
                  </button>
                  <PageItemSubmenu id={page.id} index={index} total={pages.length} onRename={() => setRenaming(page.id)} />
                </div>
              ),
            )}
          </div>
          <TldrawUiMenuGroup id="page-menu-actions">
            <TldrawUiMenuItem
              id="new-page"
              label="New page"
              icon="duplicate"
              onSelect={() => {
                editor.markHistoryStoppingPoint("new page")
                editor.createPage({ name: `Page ${pages.length + 1}` })
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
