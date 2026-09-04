#!/usr/bin/env node
// A room relay for @mocanvas/sync: every message received on a socket is
// forwarded verbatim to the other sockets in the same room. The room is the
// URL path, so ws://localhost:5858/my-doc is one room and /other is another.
//
// It keeps no document state. Peers hand each other the document with the
// hello/snapshot exchange, so the relay can be restarted at any time.
//
//   node scripts/relay.mjs            # port 5858
//   PORT=9000 node scripts/relay.mjs
import { WebSocketServer } from "ws"

const port = Number(process.env["PORT"] ?? 5858)
const server = new WebSocketServer({ port })
/** @type {Map<string, Set<import("ws").WebSocket>>} */
const rooms = new Map()

server.on("connection", (socket, request) => {
  const room = new URL(request.url ?? "/", "http://localhost").pathname || "/"
  let peers = rooms.get(room)
  if (!peers) {
    peers = new Set()
    rooms.set(room, peers)
  }
  peers.add(socket)
  log(`+ ${room} (${peers.size} peer${peers.size === 1 ? "" : "s"})`)

  socket.on("message", (data, isBinary) => {
    if (isBinary) return
    const text = data.toString()
    for (const peer of peers) {
      if (peer === socket) continue
      if (peer.readyState !== peer.OPEN) continue
      peer.send(text)
    }
  })

  socket.on("error", () => socket.close())

  socket.on("close", () => {
    peers.delete(socket)
    if (peers.size === 0) rooms.delete(room)
    log(`- ${room} (${peers.size} peer${peers.size === 1 ? "" : "s"})`)
  })
})

server.on("listening", () => log(`relay listening on ws://localhost:${port}/<room>`))

function log(message) {
  process.stdout.write(`[mocanvas-relay] ${message}\n`)
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
