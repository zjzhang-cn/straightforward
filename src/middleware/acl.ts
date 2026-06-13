#!/usr/bin/env node
// @ts-check
/**
 * ACL middleware — IP-based access control for Straightforward proxy.
 *
 * Supports allow/deny lists with IPv4/IPv6 exact match and CIDR subnet
 * matching. Works on both `onRequest` and `onConnect`.
 *
 * Usage:
 *   sf.onRequest.use(middleware.acl({ allow: ["10.0.0.0/8", "127.0.0.1"] }))
 *   sf.onConnect.use(middleware.acl({ deny: ["192.168.1.0/24"] }))
 */

import net from "net"
import {
  Middleware,
  RequestContext,
  ConnectContext,
  isRequest,
  isConnect,
} from ".."

import Debug from "debug"
const debug = Debug("straightforward:middleware")

// ============================================================
// Types
// ============================================================

export interface AclOptions {
  /** IPs or CIDRs to allow. If set, only matching IPs pass through. */
  allow?: string[]
  /** IPs or CIDRs to deny. Checked after allow list. */
  deny?: string[]
  /** HTTP status code for rejection. Default: 403 */
  statusCode?: number
  /** Rejection message body. Default: "Access denied" */
  message?: string
}

// ============================================================
// ACL middleware factory
// ============================================================

export const acl = (
  opts: AclOptions
): Middleware<RequestContext | ConnectContext> => {
  const statusCode = opts.statusCode || 403
  const message = opts.message || "Access denied"

  return async (ctx, next) => {
    const clientIP = ctx.req.socket.remoteAddress
    if (!clientIP) {
      debug(`acl: unable to determine client IP, denying`)
      return sendDeny(ctx, statusCode, `${message}: unable to determine client IP`)
    }

    // ── allow list ──
    if (opts.allow && opts.allow.length > 0) {
      const allowed = opts.allow.some((rule) => ipMatches(clientIP, rule))
      if (!allowed) {
        debug(`acl: ${clientIP} not in allow list → ${statusCode}`)
        return sendDeny(ctx, statusCode, `${message}: your IP ${clientIP} is not allowed`)
      }
      debug(`acl: ${clientIP} matched allow list → pass`)
    }

    // ── deny list ──
    if (opts.deny && opts.deny.length > 0) {
      const denied = opts.deny.some((rule) => ipMatches(clientIP, rule))
      if (denied) {
        debug(`acl: ${clientIP} matched deny list → ${statusCode}`)
        return sendDeny(ctx, statusCode, `${message}: your IP ${clientIP} is denied`)
      }
    }

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
    })
    ctx.res.end(message)
  } else if (isConnect(ctx)) {
    ctx.clientSocket.end(
      `HTTP/1.1 ${statusCode} Forbidden\r\n` +
        "Content-Type: text/plain\r\n" +
        `Content-Length: ${Buffer.byteLength(message)}\r\n` +
        "Connection: close\r\n" +
        "\r\n" +
        message
    )
  }
}

/**
 * Check whether a client IP matches an allow/deny rule.
 * Supports exact IP matching and CIDR subnet matching (IPv4 + IPv6).
 */
function ipMatches(clientIP: string, rule: string): boolean {
  // Exact match (no slash)
  if (!rule.includes("/")) {
    return clientIP === rule
  }

  // CIDR match
  const [network, bitsStr] = rule.split("/")
  const prefixLen = parseInt(bitsStr, 10)

  const v4 = net.isIPv4(clientIP) && net.isIPv4(network)
  const v6 = net.isIPv6(clientIP) && net.isIPv6(network)

  if (v4) return ipv4CidrMatch(clientIP, network, prefixLen)
  if (v6) return ipv6CidrMatch(clientIP, network, prefixLen)

  return false
}

function ipv4CidrMatch(ip: string, network: string, prefixLen: number): boolean {
  const ipNum = ipv4ToNumber(ip)
  const netNum = ipv4ToNumber(network)
  const mask = prefixLen === 0 ? 0 : (~((1 << (32 - prefixLen)) - 1)) >>> 0
  return (ipNum & mask) === (netNum & mask)
}

function ipv4ToNumber(ip: string): number {
  const parts = ip.split(".")
  return (
    ((parseInt(parts[0], 10) << 24) >>> 0) +
    (parseInt(parts[1], 10) << 16) +
    (parseInt(parts[2], 10) << 8) +
    parseInt(parts[3], 10)
  )
}

function ipv6CidrMatch(ip: string, network: string, prefixLen: number): boolean {
  const ipNum = ipv6ToBigInt(ip)
  const netNum = ipv6ToBigInt(network)
  const mask = prefixLen === 0
    ? 0n
    : ~((1n << BigInt(128 - prefixLen)) - 1n)
  return (ipNum & mask) === (netNum & mask)
}

function ipv6ToBigInt(ip: string): bigint {
  // Normalize shorthand IPv6 to full form
  const parts = expandIPv6(ip).split(":")
  let result = 0n
  for (const part of parts) {
    result = (result << 16n) + BigInt("0x" + (part || "0"))
  }
  return result
}

function expandIPv6(ip: string): string {
  // Expand :: shorthand
  if (ip.includes("::")) {
    const sides = ip.split("::")
    const left = sides[0] ? sides[0].split(":").filter(Boolean) : []
    const right = sides[1] ? sides[1].split(":").filter(Boolean) : []
    const missing = 8 - left.length - right.length
    const middle = new Array(missing).fill("0000")
    const full = [...left, ...middle, ...right]
    return full.join(":")
  }
  return ip
}
