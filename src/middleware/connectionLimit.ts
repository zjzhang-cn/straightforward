import { Middleware, RequestContext, ConnectContext, isRequest, isConnect } from ".."

import Debug from "debug"
const debug = Debug("straightforward:middleware")

// ============================================================
// Types
// ============================================================

export interface ConnectionLimitOptions {
  /** Maximum concurrent connections per IP. Default: 50 */
  maxConnectionsPerIP?: number
  /** HTTP status code for rejection. Default: 429 */
  statusCode?: number
  /** Rejection message body. Default: "Too Many Requests" */
  message?: string
  /** IPs exempt from rate limiting (e.g. localhost). Default: ["127.0.0.1", "::1"] */
  whitelist?: string[]
}

// ============================================================
// ConnectionLimit middleware factory
// ============================================================

export const connectionLimit = (
  opts: ConnectionLimitOptions = {}
): Middleware<RequestContext | ConnectContext> => {
  const max = opts.maxConnectionsPerIP ?? 50
  const statusCode = opts.statusCode ?? 429
  const message = opts.message ?? "Too Many Requests"
  const whitelist = new Set(opts.whitelist ?? ["127.0.0.1", "::1"])
  const connections = new Map<string, number>()

  return async (ctx, next) => {
    const ip = ctx.req.socket.remoteAddress || "unknown"

    // Whitelist bypass
    if (whitelist.has(ip)) {
      return next()
    }

    const current = connections.get(ip) || 0
    if (current >= max) {
      debug(
        "connectionLimit: %s exceeded limit (%d/%d) → %d",
        ip,
        current,
        max,
        statusCode
      )
      return sendDeny(ctx, statusCode, message)
    }

    connections.set(ip, current + 1)
    debug("connectionLimit: %s → %d/%d", ip, current + 1, max)

    // Release slot when the request/connection finishes
    ctx.req.on("close", () => {
      const c = connections.get(ip)
      if (c === undefined) return
      if (c <= 1) {
        connections.delete(ip)
        debug("connectionLimit: %s → released (last)", ip)
      } else {
        connections.set(ip, c - 1)
        debug("connectionLimit: %s → %d/%d", ip, c - 1, max)
      }
    })

    return next()
  }
}

// ============================================================
// Helpers
// ============================================================

function sendDeny(
  ctx: RequestContext | ConnectContext,
  statusCode: number,
  message: string
) {
  if (isRequest(ctx)) {
    ctx.res.writeHead(statusCode, {
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": "5",
    })
    ctx.res.end(message)
  } else if (isConnect(ctx)) {
    ctx.clientSocket.end(
      `HTTP/1.1 ${statusCode} Too Many Requests\r\n` +
        "Content-Type: text/plain\r\n" +
        "Connection: close\r\n" +
        `Content-Length: ${Buffer.byteLength(message)}\r\n` +
        "\r\n" +
        message
    )
  }
}
