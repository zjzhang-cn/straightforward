/**
 * Per-rule DNS resolver factory.
 *
 * Creates a Node.js `lookup` function that resolves hostnames against a
 * specific DNS server using `dns.promises.Resolver` (per-instance server
 * configuration — does NOT affect the global process DNS settings).
 *
 * Supports DNS over HTTPS (DoH) when the server URL starts with `https://`.
 *
 * Resolver instances are cached per DNS server address for efficiency.
 *
 * Zero external dependencies — uses only Node.js built-in `dns` and `https` modules.
 */

import { promises as dnsPromises, LookupFunction } from "dns"
import * as net from "net"
import * as https from "https"

import Debug from "debug"
const debug = Debug("straightforward:dns")

// ============================================================
// Resolver cache (for traditional UDP DNS)
// ============================================================

const resolverCache = new Map<string, dnsPromises.Resolver>()
const MAX_CACHE_SIZE = 20
const insertionOrder: string[] = []

function getResolver(dnsServer: string): dnsPromises.Resolver {
  let resolver = resolverCache.get(dnsServer)
  if (!resolver) {
    // Create new resolver first, then evict if cache is full
    resolver = new dnsPromises.Resolver()
    resolver.setServers([dnsServer])

    if (insertionOrder.length >= MAX_CACHE_SIZE) {
      const oldest = insertionOrder.shift()!
      resolverCache.delete(oldest)
      debug(`DNS resolver cache evicted "${oldest}" (full)`)
    }

    resolverCache.set(dnsServer, resolver)
    insertionOrder.push(dnsServer)
    debug(
      `DNS resolver created for %s (cache: %d/%d)`,
      dnsServer,
      resolverCache.size,
      MAX_CACHE_SIZE
    )
  }
  return resolver
}

// ============================================================
// DNS over HTTPS (DoH) — zero-dependency DNS wire format
// ============================================================

/**
 * Check if a DNS server string is a DoH URL.
 */
function isDoHUrl(server: string): boolean {
  return server.startsWith("https://")
}

/**
 * Encode a DNS query in wire format (RFC 1035).
 *
 * Header (12 bytes):
 *   ID (2) + Flags (2) + QDCOUNT (2) + ANCOUNT (2) + NSCOUNT (2) + ARCOUNT (2)
 *
 * Question:
 *   QNAME (length-prefixed labels + 0 terminator) + QTYPE (2) + QCLASS (2)
 */
function encodeDNSQuery(hostname: string, qtype: number): Buffer {
  const labels = hostname.split(".")
  const qnameSize = labels.reduce((acc, l) => acc + 1 + l.length, 0) + 1

  const buf = Buffer.alloc(12 + qnameSize + 4)
  let offset = 0

  // Header
  buf.writeUInt16BE(Math.floor(Math.random() * 65536), offset); offset += 2 // ID
  buf.writeUInt16BE(0x0100, offset); offset += 2 // Flags: standard query, RD=1
  buf.writeUInt16BE(1, offset); offset += 2       // QDCOUNT = 1
  buf.writeUInt16BE(0, offset); offset += 2       // ANCOUNT = 0
  buf.writeUInt16BE(0, offset); offset += 2       // NSCOUNT = 0
  buf.writeUInt16BE(0, offset); offset += 2       // ARCOUNT = 0

  // QNAME
  for (const label of labels) {
    buf.writeUInt8(label.length, offset); offset += 1
    buf.write(label, offset); offset += label.length
  }
  buf.writeUInt8(0, offset); offset += 1 // terminator

  // QTYPE + QCLASS
  buf.writeUInt16BE(qtype, offset); offset += 2 // A(1) or AAAA(28)
  buf.writeUInt16BE(1, offset); offset += 2      // IN class

  return buf
}

/**
 * Parse DNS response wire format and extract IP addresses from answer section.
 */
function parseDNSResponse(buf: Buffer): string[] {
  const ancount = buf.readUInt16BE(6)
  const addresses: string[] = []

  // Skip header (12 bytes) + question section
  let offset = 12
  while (offset < buf.length && buf[offset] !== 0) {
    offset += buf[offset] + 1
  }
  offset += 1  // 0 terminator
  offset += 4  // QTYPE + QCLASS

  // Parse answer section
  for (let i = 0; i < ancount && offset + 10 <= buf.length; i++) {
    const nameLen = (buf[offset] & 0xc0) === 0xc0 ? 2 : (buf[offset] + 1)
    offset += nameLen
    if (offset + 10 > buf.length) break

    const type = buf.readUInt16BE(offset); offset += 2
    offset += 2  // CLASS
    offset += 4  // TTL
    const rdlength = buf.readUInt16BE(offset); offset += 2

    if (offset + rdlength > buf.length) break

    if (type === 1 && rdlength === 4) {
      addresses.push(`${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`)
    } else if (type === 28 && rdlength === 16) {
      const parts: string[] = []
      for (let j = 0; j < 8; j++) {
        parts.push(buf.readUInt16BE(offset + j * 2).toString(16))
      }
      addresses.push(parts.join(":"))
    }
    offset += rdlength
  }

  return addresses
}

/**
 * Resolve a hostname via DNS over HTTPS (RFC 8484 POST mode).
 */
async function resolveViaDoH(dohUrl: string, hostname: string, family: number): Promise<string> {
  const url = new URL(dohUrl)
  const qtype = family === 6 ? 28 : 1
  const query = encodeDNSQuery(hostname, qtype)

  return new Promise<string>((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      port: Number(url.port) || 443,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/dns-message",
        "Content-Length": query.length,
      },
      timeout: 10_000,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (chunk: Buffer) => chunks.push(chunk))
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`DoH request failed: ${res.statusCode} for ${hostname}`))
          return
        }
        const response = Buffer.concat(chunks)
        const addresses = parseDNSResponse(response)
        if (addresses.length === 0) {
          reject(new Error(`ENOTFOUND ${hostname}`))
        } else {
          resolve(addresses[0])
        }
      })
    })
    req.on("error", reject)
    req.on("timeout", () => {
      req.destroy(new Error(`DoH request timeout for ${hostname}`))
    })
    req.write(query)
    req.end()
  })
}

// ============================================================
// Public API
// ============================================================

/**
 * Create a Node.js `lookup` function that resolves hostnames against a
 * specific DNS server or DoH URL.
 *
 * @param dnsServer  IPv4/IPv6 address (e.g. "8.8.8.8") or DoH URL (e.g. "https://doh.pub/dns-query")
 * @returns A function that can be passed as the `lookup` option to
 *          `http.request()` or `net.connect()`
 */
export function createLookupFunction(dnsServer: string): LookupFunction {
  const isDoH = isDoHUrl(dnsServer)

  if (isDoH) {
    debug(`DoH lookup function created for %s`, dnsServer)
    return (hostname: string, options: any, callback: any) => {
      const family = options && options.family === 6 ? 6 : 4
      resolveViaDoH(dnsServer, hostname, family)
        .then((address) => {
          callback(null, address, net.isIP(address) === 6 ? 6 : 4)
        })
        .catch((err) => {
          debug(`DoH lookup failed: %s via %s — %s`, hostname, dnsServer, err.message)
          callback(err, "", 0)
        })
    }
  }

  const resolver = getResolver(dnsServer)

  return (hostname, options, callback) => {
    let promise: Promise<any>

    if (options.family === 6) {
      promise = resolver.resolve6(hostname)
    } else if (options.family === 4) {
      promise = resolver.resolve4(hostname)
    } else {
      promise = resolver.resolve4(hostname)
    }

    promise
      .then((addresses) => {
        if (Array.isArray(addresses) && addresses.length > 0) {
          const first = addresses[0] as string
          const family = net.isIP(first) === 6 ? 6 : 4
          callback(null, first, family)
        } else {
          callback(new Error(`ENOTFOUND ${hostname}`), "", 0)
        }
      })
      .catch((err) => {
        debug(
          `DNS lookup failed: %s via %s — %s`,
          hostname,
          dnsServer,
          err.message
        )
        callback(err, "", 0)
      })
  }
}
