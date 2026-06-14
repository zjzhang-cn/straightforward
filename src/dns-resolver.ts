/**
 * Per-rule DNS resolver factory.
 *
 * Creates a Node.js `lookup` function that resolves hostnames against a
 * specific DNS server using `dns.promises.Resolver` (per-instance server
 * configuration — does NOT affect the global process DNS settings).
 *
 * Resolver instances are cached per DNS server address for efficiency.
 *
 * Zero external dependencies — uses only Node.js built-in `dns` module.
 */

import { promises as dnsPromises, LookupFunction } from "dns"
import * as net from "net"

import Debug from "debug"
const debug = Debug("straightforward:dns")

// ============================================================
// Resolver cache
// ============================================================

const resolverCache = new Map<string, dnsPromises.Resolver>()
const MAX_CACHE_SIZE = 20
const insertionOrder: string[] = []

function getResolver(dnsServer: string): dnsPromises.Resolver {
  let resolver = resolverCache.get(dnsServer)
  if (!resolver) {
    // Evict oldest if at capacity (FIFO)
    if (insertionOrder.length >= MAX_CACHE_SIZE) {
      const oldest = insertionOrder.shift()!
      resolverCache.delete(oldest)
      debug(`DNS resolver cache evicted "${oldest}" (full)`)
    }
    resolver = new dnsPromises.Resolver()
    resolver.setServers([dnsServer])
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
// Public API
// ============================================================

/**
 * Create a Node.js `lookup` function that resolves hostnames against a
 * specific DNS server.
 *
 * @param dnsServer  IPv4 or IPv6 address of the DNS server (e.g. "8.8.8.8")
 * @returns A function that can be passed as the `lookup` option to
 *          `http.request()` or `net.connect()`
 */
export function createLookupFunction(dnsServer: string): LookupFunction {
  const resolver = getResolver(dnsServer)

  return (hostname, options, callback) => {
    let promise: Promise<any>

    if (options.family === 6) {
      promise = resolver.resolve6(hostname)
    } else if (options.family === 4) {
      promise = resolver.resolve4(hostname)
    } else {
      // options.all or no family specified — default to resolve4
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
