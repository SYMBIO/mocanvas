import { track, useEditor, useValue, type InstancePresence, type UserId } from "@mocanvas/editor"
import { useState, type ReactNode } from "react"
import { TldrawUiInput } from "./ui-input"
import { TldrawUiPopover, TldrawUiPopoverContent, TldrawUiPopoverTrigger } from "./ui-popover"
import type {
  DefaultPeopleMenuContentProps,
  DefaultPeopleMenuProps,
  TLUiPeopleMenuAvatarProps,
  TLUiPeopleMenuFacePileProps,
  TLUiPeopleMenuItemProps,
} from "./ui-components"

/**
 * Who else is here.
 *
 * The presence *records* are the editor's; this is only their chrome. It
 * renders from `editor.getVisibleCollaboratorsOnCurrentPage()`, which already
 * excludes people whose tab has gone idle — so an abandoned tab does not sit
 * in the face pile forever.
 */

/** The ids of everyone else on this page. */
export function usePeerIds(): UserId[] {
  const editor = useEditor()
  return useValue("peerIds", () => editor.getVisibleCollaboratorsOnCurrentPage().map((peer) => peer.userId), [editor])
}

/** One person's presence record, or `null` when they have left. */
export function usePresence(userId: UserId): InstancePresence | null {
  const editor = useEditor()
  return useValue("presence", () => editor.getVisibleCollaboratorsOnCurrentPage().find((peer) => peer.userId === userId) ?? null, [editor, userId])
}

/** Everyone else on this page. */
export function usePeers(): InstancePresence[] {
  const editor = useEditor()
  return useValue("peers", () => editor.getVisibleCollaboratorsOnCurrentPage(), [editor])
}

/**
 * Whether to show collaboration chrome at all.
 *
 * False when nobody else is here: a "people" button on a document nobody else
 * has ever opened is chrome that never does anything.
 */
export function useShowCollaborationUi(): boolean {
  return usePeers().length > 0
}

/**
 * A coarse status for the collaboration chrome.
 *
 * mocanvas's editor has no transport of its own — sync is a separate package —
 * so this reports what the editor can actually see: whether there is anyone
 * else present. A host with a real connection passes its own indicator into
 * the `SharePanel` slot.
 */
export function useCollaborationStatus(): "offline" | "online" {
  return useShowCollaborationUi() ? "online" : "offline"
}

/** Initials for an avatar: at most two, from the first and last word. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "?"
  const first = words[0]![0] ?? ""
  const last = words.length > 1 ? (words[words.length - 1]![0] ?? "") : ""
  return (first + last).toUpperCase()
}

/** One person's avatar: their colour, and their initials. */
export function DefaultPeopleMenuAvatar({ color, name, size = 24 }: TLUiPeopleMenuAvatarProps) {
  return (
    <span
      className="mocanvas-avatar"
      title={name}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        color: "#fff",
        fontSize: Math.round(size * 0.42),
        fontWeight: 600,
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}

/**
 * The overlapping avatars on the people menu's trigger.
 *
 * `aria-hidden`, with the count announced by the trigger's own label: reading
 * out five initials is not how anyone wants to be told who is in the room.
 */
export function DefaultPeopleMenuFacePile({ users, max = 3 }: TLUiPeopleMenuFacePileProps) {
  const shown = users.slice(0, max)
  const extra = users.length - shown.length
  return (
    <span className="mocanvas-face-pile" style={{ display: "inline-flex" }} aria-hidden="true">
      {shown.map((user, i) => (
        <span key={user.userId} style={{ marginLeft: i === 0 ? 0 : -8 }}>
          <DefaultPeopleMenuAvatar color={user.color} name={user.name} size={22} />
        </span>
      ))}
      {extra > 0 ? <span className="mocanvas-face-pile-more">+{extra}</span> : null}
    </span>
  )
}

/** One row in the collaborator list; clicking it follows that person's camera. */
export function DefaultPeopleMenuItem({ color, name, isFollowing, onFollow }: TLUiPeopleMenuItemProps) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={isFollowing ?? false} className="mocanvas-menu-item" onClick={() => onFollow?.()}>
      <DefaultPeopleMenuAvatar color={color} name={name} size={20} />
      <span className="mocanvas-menu-item-label">{name}</span>
      {isFollowing ? <span className="mocanvas-menu-item-note">Following</span> : null}
    </button>
  )
}

/** The collaborator list, plus the local person's own name and colour. */
export const DefaultPeopleMenuContent = track(function DefaultPeopleMenuContent({ children }: DefaultPeopleMenuContentProps) {
  const editor = useEditor()
  const peers = usePeers()
  const followingId = editor.getFollowingUserId()
  return (
    <>
      <DefaultUserPresenceEditor />
      <div className="mocanvas-people-list" role="menu" aria-label="People">
        {peers.map((peer) => (
          <DefaultPeopleMenuItem
            key={peer.userId}
            userId={peer.userId}
            color={peer.color}
            name={peer.userName}
            isFollowing={followingId === peer.userId}
            onFollow={() => (followingId === peer.userId ? editor.stopFollowingUser() : editor.startFollowingUser(peer.userId))}
          />
        ))}
      </div>
      {children}
    </>
  )
})

/** The people menu. Renders nothing when nobody else is here. */
export const DefaultPeopleMenu = track(function DefaultPeopleMenu({ children }: DefaultPeopleMenuProps) {
  const peers = usePeers()
  if (peers.length === 0) return null
  const users = peers.map((peer) => ({ userId: peer.userId as string, color: peer.color, name: peer.userName }))
  return (
    <TldrawUiPopover id="people-menu" side="below">
      <TldrawUiPopoverTrigger className="mocanvas-btn mocanvas-btn--wide">
        <DefaultPeopleMenuFacePile users={users} />
        <span className="sr-only">{`${peers.length} other ${peers.length === 1 ? "person" : "people"} here`}</span>
      </TldrawUiPopoverTrigger>
      <TldrawUiPopoverContent label="People">
        <DefaultPeopleMenuContent>{children}</DefaultPeopleMenuContent>
      </TldrawUiPopoverContent>
    </TldrawUiPopover>
  )
})

/** The local person's name and cursor colour. */
export const DefaultUserPresenceEditor = track(function DefaultUserPresenceEditor() {
  const editor = useEditor()
  const name = editor.user.getName()
  const color = editor.user.getColor()
  return (
    <div className="mocanvas-presence-editor">
      <label className="mocanvas-presence-color">
        <span className="sr-only">Your colour</span>
        <input type="color" value={color} onChange={(event) => editor.user.setColor(event.target.value)} />
      </label>
      <TldrawUiInput value={name} label="Your name" placeholder="Your name" onComplete={(next) => editor.user.setName(next)} />
    </div>
  )
})

/**
 * The banner shown while the camera is following someone.
 *
 * Also the way out of it: a user who cannot see how to stop following is
 * trapped, since their own panning is being overridden.
 */
export const DefaultFollowingIndicator = track(function DefaultFollowingIndicator() {
  const editor = useEditor()
  const followingId = editor.getFollowingUserId()
  if (!followingId) return null
  const peer = editor.getVisibleCollaboratorsOnCurrentPage().find((p) => p.userId === followingId)
  return (
    <div className="mocanvas-following-indicator" role="status" style={{ borderColor: peer?.color }}>
      <span>Following {peer?.userName ?? "someone"}</span>
      <button type="button" className="mocanvas-btn" onClick={() => editor.stopFollowingUser()}>
        Stop
      </button>
    </div>
  )
})

/**
 * The top-right panel: who is here.
 *
 * The people menu is the whole of it, and that renders nothing when nobody
 * else is here — but the plate around it did not, so a single-player editor
 * had a 10px rounded blob in its top-right corner: a border, a background and
 * eight pixels of padding around no content at all. Nobody could say what it
 * was, which is the point. The plate now goes when its contents do.
 */
export const DefaultSharePanel = track(function DefaultSharePanel() {
  if (usePeers().length === 0) return null
  return (
    <div className="mocanvas-panel mocanvas-share-panel">
      <DefaultPeopleMenu />
    </div>
  )
})

/**
 * The cursor-chat entry field.
 *
 * A local-only overlay: it publishes nothing on its own, and calls
 * `onSubmit` so a host with a transport can send the message. That keeps
 * cursor chat available as chrome without mocanvas pretending to have a
 * message channel.
 */
export function CursorChatItem({ onSubmit }: { onSubmit?(text: string): void }): ReactNode {
  const [text, setText] = useState("")
  return (
    <div className="mocanvas-cursor-chat">
      <TldrawUiInput
        value={text}
        label="Cursor chat"
        placeholder="Say something"
        onValueChange={setText}
        onComplete={(value) => {
          if (value.trim()) onSubmit?.(value.trim())
          setText("")
        }}
      />
    </div>
  )
}
