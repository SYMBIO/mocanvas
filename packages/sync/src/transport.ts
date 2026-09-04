import type { UnknownRecord } from "@mocanvas/store"
import { decodeMessage, encodeMessage, type SyncMessage } from "./protocol"

/**
 * A duplex channel that carries `SyncMessage`s between peers in one room.
 *
 * The transport owns serialization and reconnection; the client above it only
 * sees decoded messages. `onOpen` fires every time the channel becomes usable
 * (including after a reconnect), `onClose` every time it stops being usable.
 * A transport with neither is treated as open from the moment it is connected.
 */
export interface Transport<R extends UnknownRecord = UnknownRecord> {
  send(message: SyncMessage<R>): void
  onMessage(callback: (message: SyncMessage<R>) => void): () => void
  onOpen?(callback: () => void): () => void
  onClose?(callback: () => void): () => void
  close(): void
}

/** @internal A tiny callback set with an unsubscribe function. */
export function createEmitter(): {
  add(cb: () => void): () => void
  emit(): void
  clear(): void
} {
  const callbacks = new Set<() => void>()
  return {
    add(cb) {
      callbacks.add(cb)
      return () => {
        callbacks.delete(cb)
      }
    },
    emit() {
      for (const cb of Array.from(callbacks)) cb()
    },
    clear() {
      callbacks.clear()
    },
  }
}

/* -------------------------------------------------------------------------- */
/* BroadcastChannel                                                           */
/* -------------------------------------------------------------------------- */

export interface BroadcastChannelTransportOptions {
  /** Channel name prefix, so two apps on one origin do not collide. */
  prefix?: string
}

/**
 * Same-origin tabs of one browser. There is no server, so every peer is
 * equally authoritative and the channel is open as soon as it is created.
 */
export function createBroadcastChannelTransport<R extends UnknownRecord = UnknownRecord>(
  roomId: string,
  options: BroadcastChannelTransportOptions = {},
): Transport<R> {
  const name = `${options.prefix ?? "mocanvas-sync"}:${roomId}`
  const channel = new BroadcastChannel(name)
  const listeners = new Set<(message: SyncMessage<R>) => void>()
  let closed = false

  channel.onmessage = (event: MessageEvent) => {
    const message = decodeMessage<R>(event.data)
    if (!message) return
    for (const listener of Array.from(listeners)) listener(message)
  }

  return {
    send(message) {
      if (closed) return
      channel.postMessage(encodeMessage(message))
    },
    onMessage(callback) {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
    onOpen(callback) {
      // Already usable; hand control back to the caller before firing so that
      // `connect()` has finished wiring itself up.
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled && !closed) callback()
      })
      return () => {
        cancelled = true
      }
    },
    close() {
      closed = true
      listeners.clear()
      channel.onmessage = null
      channel.close()
    },
  }
}

/* -------------------------------------------------------------------------- */
/* WebSocket                                                                  */
/* -------------------------------------------------------------------------- */

export interface WebSocketTransportOptions {
  /** Reconnect with exponential backoff after an unexpected close. Default `true`. */
  reconnect?: boolean
  /** First backoff delay in ms. Default 500. */
  minDelayMs?: number
  /** Backoff ceiling in ms. Default 15000. */
  maxDelayMs?: number
  /** Injectable for tests and for Node (`ws`). Defaults to `globalThis.WebSocket`. */
  WebSocketImpl?: typeof WebSocket
}

/**
 * A WebSocket to a relay (see `scripts/relay.mjs`). Messages sent while the
 * socket is down are dropped rather than queued: the next `hello`/`snapshot`
 * exchange re-establishes the document anyway, and presence is re-sent on a
 * heartbeat.
 */
export function createWebSocketTransport<R extends UnknownRecord = UnknownRecord>(
  url: string,
  options: WebSocketTransportOptions = {},
): Transport<R> {
  const reconnect = options.reconnect ?? true
  const minDelay = options.minDelayMs ?? 500
  const maxDelay = options.maxDelayMs ?? 15_000
  const Impl = options.WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket
  if (!Impl) throw new Error("No WebSocket implementation available; pass options.WebSocketImpl")

  const listeners = new Set<(message: SyncMessage<R>) => void>()
  const open = createEmitter()
  const close = createEmitter()

  let socket: WebSocket | null = null
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const connect = () => {
    if (disposed) return
    const ws = new Impl(url)
    socket = ws
    ws.onopen = () => {
      attempt = 0
      open.emit()
    }
    ws.onmessage = (event: MessageEvent) => {
      const message = decodeMessage<R>(event.data)
      if (!message) return
      for (const listener of Array.from(listeners)) listener(message)
    }
    ws.onerror = () => {
      // `onclose` always follows; the retry is scheduled there.
    }
    ws.onclose = () => {
      if (socket === ws) socket = null
      close.emit()
      if (!disposed && reconnect) schedule()
    }
  }

  const schedule = () => {
    if (timer !== null) return
    // Exponential backoff with full jitter, so a relay restart does not get a
    // thundering herd from every open tab.
    const ceiling = Math.min(maxDelay, minDelay * 2 ** attempt)
    attempt++
    const delay = Math.random() * ceiling
    timer = setTimeout(() => {
      timer = null
      connect()
    }, delay)
  }

  connect()

  return {
    send(message) {
      if (!socket || socket.readyState !== 1 /* OPEN */) return
      socket.send(encodeMessage(message))
    },
    onMessage(callback) {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
    onOpen(callback) {
      const remove = open.add(callback)
      if (socket && socket.readyState === 1) queueMicrotask(callback)
      return remove
    },
    onClose(callback) {
      return close.add(callback)
    },
    close() {
      disposed = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      listeners.clear()
      open.clear()
      close.clear()
      const ws = socket
      socket = null
      if (ws) {
        ws.onopen = null
        ws.onmessage = null
        ws.onerror = null
        ws.onclose = null
        if (ws.readyState === 0 || ws.readyState === 1) ws.close()
      }
    },
  }
}

/* -------------------------------------------------------------------------- */
/* in-memory                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Two transports wired to each other, going through the same JSON encode and
 * decode as the real ones. Delivery is asynchronous (a microtask) so that a
 * peer never observes a message inside its own `send()` call stack.
 */
export function createMemoryTransportPair<R extends UnknownRecord = UnknownRecord>(): [Transport<R>, Transport<R>] {
  const hub = createMemoryHub<R>()
  return [hub.join(), hub.join()]
}

export interface MemoryHub<R extends UnknownRecord = UnknownRecord> {
  /** Add another peer to the room. */
  join(): Transport<R>
}

/** A room every joined transport broadcasts into (itself excluded). */
export function createMemoryHub<R extends UnknownRecord = UnknownRecord>(): MemoryHub<R> {
  const peers = new Set<{ deliver(data: string): void }>()
  return {
    join(): Transport<R> {
      const listeners = new Set<(message: SyncMessage<R>) => void>()
      let closed = false
      const peer = {
        deliver(data: string) {
          if (closed) return
          const message = decodeMessage<R>(data)
          if (!message) return
          for (const listener of Array.from(listeners)) listener(message)
        },
      }
      peers.add(peer)
      return {
        send(message) {
          if (closed) return
          const data = encodeMessage(message)
          for (const other of Array.from(peers)) {
            if (other === peer) continue
            queueMicrotask(() => other.deliver(data))
          }
        },
        onMessage(callback) {
          listeners.add(callback)
          return () => {
            listeners.delete(callback)
          }
        },
        onOpen(callback) {
          let cancelled = false
          queueMicrotask(() => {
            if (!cancelled && !closed) callback()
          })
          return () => {
            cancelled = true
          }
        },
        close() {
          closed = true
          listeners.clear()
          peers.delete(peer)
        },
      }
    },
  }
}
