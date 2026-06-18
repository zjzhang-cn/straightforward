/**
 * SOCKS5 connection handshake (RFC 1928).
 *
 * Provides a single function `socks5Connect()` that performs a full SOCKS5
 * handshake over an existing TCP connection: Greeting → Auth → CONNECT.
 *
 * Zero external dependencies — uses only Node.js built-in `net` module.
 */

import net from "net"

// ============================================================
// Types
// ============================================================

export interface Socks5Target {
  host: string
  port: number
}

export interface Socks5Auth {
  user: string
  pass: string
}

export interface Socks5ConnectOpts {
  /** TCP socket already connected to the SOCKS5 proxy */
  socket: net.Socket
  /** Target host and port to CONNECT to */
  target: Socks5Target
  /** Optional username/password for SOCKS5 auth */
  auth?: Socks5Auth
  /** Connection timeout in ms */
  timeout?: number
}

// ============================================================
// Constants
// ============================================================

const SOCKS_VERSION = 0x05
const CMD_CONNECT = 0x01
const ATYP_IPV4 = 0x01
const ATYP_DOMAIN = 0x03
const ATYP_IPV6 = 0x04

const AUTH_NO_AUTH = 0x00
const AUTH_USER_PASS = 0x02
const AUTH_NO_ACCEPTABLE = 0xff

const REP_SUCCESS = 0x00

// User/password auth sub-negotiation
const AUTH_VERSION = 0x01

// ============================================================
// SOCKS5 Handshake
// ============================================================

/**
 * Perform SOCKS5 handshake over an already-connected socket.
 *
 * Steps:
 *   1. Send Greeting (ver=5, methods)
 *   2. Receive Server Choice
 *   3. Send CONNECT request (CMD=1, ATYP, DST.ADDR, DST.PORT)
 *   4. Receive CONNECT reply
 *
 * @returns The same socket, now tunnel-ready
 */
export function socks5Connect(opts: Socks5ConnectOpts): Promise<net.Socket> {
  const { socket, target, auth, timeout } = opts

  return new Promise<net.Socket>((resolve, reject) => {
    let step: "greeting" | "auth" | "connect" | "done" = "greeting"
    let buffer = Buffer.alloc(0)

    const timer = timeout
      ? setTimeout(() => {
          cleanup()
          reject(new Error(`SOCKS5 handshake timeout after ${timeout}ms`))
        }, timeout)
      : undefined

    const cleanup = () => {
      socket.removeListener("data", onData)
      socket.removeListener("error", onError)
      socket.removeListener("close", onClose)
      if (timer) clearTimeout(timer)
    }

    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }

    const onClose = () => {
      cleanup()
      reject(new Error("SOCKS5 socket closed during handshake"))
    }

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])

      if (step === "greeting" && buffer.length >= 2) {
        const serverVersion = buffer[0]
        const chosenMethod = buffer[1]

        if (serverVersion !== SOCKS_VERSION) {
          cleanup()
          reject(new Error(`SOCKS5: invalid server version ${serverVersion}`))
          return
        }

        if (chosenMethod === AUTH_NO_ACCEPTABLE) {
          cleanup()
          reject(new Error("SOCKS5: no acceptable authentication method"))
          return
        }

        // If server requires user/pass auth
        if (chosenMethod === AUTH_USER_PASS && auth && auth.user && auth.pass) {
          step = "auth"
          buffer = Buffer.alloc(0)

          const userBuf = Buffer.from(auth.user, "utf-8")
          const passBuf = Buffer.from(auth.pass, "utf-8")
          const authReq = Buffer.alloc(3 + userBuf.length + passBuf.length)
          authReq[0] = AUTH_VERSION
          authReq[1] = userBuf.length
          userBuf.copy(authReq, 2)
          authReq[2 + userBuf.length] = passBuf.length
          passBuf.copy(authReq, 3 + userBuf.length)
          socket.write(authReq)
          return
        }

        // Server accepted no-auth (or we have no credentials to send)
        step = "connect"
        buffer = Buffer.alloc(0)
        sendConnect()
        return
      }

      if (step === "auth" && buffer.length >= 2) {
        const authVer = buffer[0]
        const authStatus = buffer[1]
        if (authVer !== AUTH_VERSION || authStatus !== REP_SUCCESS) {
          cleanup()
          reject(new Error(`SOCKS5: authentication failed (status=${authStatus})`))
          return
        }
        step = "connect"
        buffer = Buffer.alloc(0)
        sendConnect()
        return
      }

      if (step === "connect" && buffer.length >= 10) {
        const rep = buffer[1]
        if (rep !== REP_SUCCESS) {
          cleanup()
          reject(new Error(`SOCKS5: CONNECT rejected (rep=${rep})`))
          return
        }
        step = "done"
        cleanup()
        resolve(socket)
      }
    }

    function sendConnect() {
      // SOCKS5 CONNECT request format:
      // VER(1) + CMD(1) + RSV(1) + ATYP(1) + DST.ADDR(var) + DST.PORT(2)
      const targetBuf = encodeTarget(target)
      // targetBuf = [ATYP(1), ...addr_bytes]
      const addrLen = targetBuf.length - 1 // address bytes without ATYP
      const request = Buffer.alloc(4 + addrLen + 2) // header(4) + addr(var) + port(2)
      request[0] = SOCKS_VERSION
      request[1] = CMD_CONNECT
      request[2] = 0x00 // RSV
      request[3] = targetBuf[0] // ATYP
      targetBuf.copy(request, 4, 1) // DST.ADDR bytes
      request.writeUInt16BE(target.port, 4 + addrLen) // DST.PORT at end
      socket.write(request)
    }

    // Send greeting immediately
    const methods: number[] =
      auth && auth.user && auth.pass
        ? [AUTH_NO_AUTH, AUTH_USER_PASS]
        : [AUTH_NO_AUTH]

    const greeting = Buffer.alloc(3 + methods.length)
    greeting[0] = SOCKS_VERSION
    greeting[1] = methods.length
    for (let i = 0; i < methods.length; i++) {
      greeting[2 + i] = methods[i]
    }
    socket.write(greeting)

    socket.on("data", onData)
    socket.on("error", onError)
    socket.on("close", onClose)
  })
}

/**
 * Encode target host into SOCKS5 address format.
 * Returns: [ATYP (1 byte), ...encoded address bytes]
 *
 * PORT (2 bytes) is appended by the caller.
 */
function encodeTarget(target: Socks5Target): Buffer {
  // Try IPv4
  const ipv4Match = target.host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4Match) {
    // Validate each octet is within 0-255 range
    const octets = ipv4Match.slice(1, 5).map((s) => parseInt(s, 10))
    if (octets.some((o) => o > 255)) {
      // Invalid IP format, fall through to domain handling
      return encodeAsDomain(target.host)
    }
    const buf = Buffer.alloc(5) // ATYP(1) + addr(4)
    buf[0] = ATYP_IPV4
    buf[1] = octets[0]
    buf[2] = octets[1]
    buf[3] = octets[2]
    buf[4] = octets[3]
    return buf
  }

  // Try IPv6
  if (net.isIPv6(target.host)) {
    const buf = Buffer.alloc(17) // ATYP(1) + addr(16)
    buf[0] = ATYP_IPV6
    const parts = target.host.split(":")
    for (let i = 0; i < 8 && i < parts.length; i++) {
      // Validate hex conversion
      const val = parseInt(parts[i] || "0", 16)
      if (isNaN(val)) {
        // Invalid hex segment, fall through to domain handling
        return encodeAsDomain(target.host)
      }
      buf.writeUInt16BE(val, 1 + i * 2)
    }
    return buf
  }

  return encodeAsDomain(target.host)
}

function encodeAsDomain(host: string): Buffer {
  const hostBuf = Buffer.from(host, "utf-8")
  const buf = Buffer.alloc(2 + hostBuf.length) // ATYP(1) + len(1) + domain
  buf[0] = ATYP_DOMAIN
  buf[1] = hostBuf.length
  hostBuf.copy(buf, 2)
  return buf
}
