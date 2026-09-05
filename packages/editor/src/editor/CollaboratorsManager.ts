/**
 * Who else is here, and which of them to draw.
 *
 * Presence records are written by every participant on a heartbeat, so the
 * store's answer to "who is in this room" is really "who has ever written a
 * presence record and not had it removed". That is not the same as "who is
 * here now": a browser that was closed without a clean disconnect leaves its
 * record behind, and a tab left open in the background keeps writing one while
 * nobody is looking at it.
 *
 * This manager applies the two timeouts that turn one into the other:
 *
 *   `collaboratorIdleTimeoutMs`     — no longer *doing* anything. Still drawn,
 *                                     usually dimmed.
 *   `collaboratorInactiveTimeoutMs` — no longer *there*. Not drawn at all.
 *
 * Reach it as `editor.collaborators`.
 */
import type { InstancePresence } from "../records/presence"
import type { UserId } from "../user/userRecord"
import { EditorManager } from "./EditorManager"

export class CollaboratorsManager extends EditorManager {
  /**
   * Everybody else with a presence record, however stale — the raw list, for a
   * caller doing its own filtering.
   */
  getCollaborators(): InstancePresence[] {
    return this.editor.getCollaborators()
  }

  /** Everybody else looking at the page we are on, however stale. */
  getCollaboratorsOnCurrentPage(): InstancePresence[] {
    return this.editor.getCollaboratorsOnCurrentPage()
  }

  /**
   * Everybody who counts as present: their record was refreshed within
   * `collaboratorInactiveTimeoutMs`. This is the list a people-menu shows.
   */
  getVisibleCollaborators(): InstancePresence[] {
    const cutoff = Date.now() - this.editor.options.collaboratorInactiveTimeoutMs
    return this.getCollaborators().filter((presence) => presence.lastActivityTimestamp > cutoff)
  }

  /** {@link getVisibleCollaborators}, narrowed to this page — the cursors to draw. */
  getVisibleCollaboratorsOnCurrentPage(): InstancePresence[] {
    const pageId = this.editor.getCurrentPageId()
    return this.getVisibleCollaborators().filter((presence) => presence.currentPageId === pageId)
  }

  /**
   * Whether a collaborator is idle: present, but not doing anything.
   *
   * Idle is a *display* state — a dimmed cursor, a greyed avatar — never a
   * reason to stop showing somebody, which is why it is separate from the
   * inactive cut-off.
   */
  isCollaboratorIdle(presence: InstancePresence): boolean {
    return presence.lastActivityTimestamp <= Date.now() - this.editor.options.collaboratorIdleTimeoutMs
  }

  /** The presence records belonging to one person, across all their tabs. */
  getPresencesForUser(userId: UserId): InstancePresence[] {
    return this.getCollaborators().filter((presence) => presence.userId === userId)
  }
}
