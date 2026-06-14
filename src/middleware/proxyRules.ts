import { Middleware, RequestContext, ConnectContext, isConnect } from ".."
import { RuleSetResolver } from "../rule-set"

import Debug from "debug"
const debug = Debug("straightforward:middleware")

// ============================================================
// Types
// ============================================================

export interface UpstreamProxy {
  host: string
  port: number
  auth?: { user: string; pass: string }
}

export interface ProxyRule {
  /** Match pattern: glob ("*.google.com"), geosite:tag ("geosite:gfw"), or geoip:tag ("geoip:cn") */
  match: string
  /** Only match this request type. Omit = both http and connect. */
  type?: "http" | "connect"
  /** Source IP to bind outgoing connection to. "0.0.0.0" = OS default */
  localAddress?: string
  /** Upstream proxy to route through. Omit = direct connect */
  upstream?: UpstreamProxy
  /** DNS server for resolving target hostname (e.g. "8.8.8.8"). Omit = OS default */
  dns?: string
}

export interface ProxyRulesConfig {
  rules: ProxyRule[]
  default?: {
    localAddress?: string
    upstream?: UpstreamProxy
    /** Default DNS server when no per-rule dns is set */
    dns?: string
  }
  /** Rule-set resolver for geosite: prefix matching. */
  ruleSets?: RuleSetResolver
}

export interface RequestAdditionsProxyRules {
  locals: { upstream?: UpstreamProxy; localAddress?: string; dns?: string }
}

// ============================================================
// Glob → Regex conversion (zero-dependency)
// ============================================================

function globToRegex(glob: string): RegExp {
  // Special case: '*' alone matches everything
  if (glob === "*") return /^.+$/i

  let result = ""
  let i = 0
  while (i < glob.length) {
    if (glob[i] === "*" && glob[i + 1] === "*") {
      // ** → matches anything including dots
      result += ".*"
      i += 2
    } else if (glob[i] === "*") {
      // * → matches within a single segment (no dots)
      result += "[^.]*"
      i += 1
    } else if ("[.^${}()|\\]".includes(glob[i])) {
      result += "\\" + glob[i]
      i += 1
    } else {
      result += glob[i]
      i += 1
    }
  }
  return new RegExp("^" + result + "$", "i")
}

// ============================================================
// Rule matching
// ============================================================

function matchRule(
  hostname: string,
  rule: ProxyRule,
  isConnectType: boolean,
  ruleSets?: RuleSetResolver
): boolean {
  // type filter
  if (rule.type === "http" && isConnectType) return false
  if (rule.type === "connect" && !isConnectType) return false

  const match = rule.match

  // ── geosite: prefix → rule-set matching ──
  if (match.startsWith("geosite:") && ruleSets) {
    const tag = match.slice("geosite:".length)
    return ruleSets.match(tag, hostname)
  }

  // ── glob matching (existing behavior) ──
  return (rule as any)._regex.test(hostname)
}

// ============================================================
// proxyRules middleware factory
// ============================================================

/**
 * Unified routing middleware. Resolves each request against a rule table,
 * setting `req.locals.upstream` and `req.locals.localAddress` accordingly.
 *
 * Supports both `onRequest` and `onConnect`.
 */
export const proxyRules = (
  config: ProxyRulesConfig
): Middleware<
  RequestContext<RequestAdditionsProxyRules> | ConnectContext<RequestAdditionsProxyRules>
> => {
  const { rules, default: def, ruleSets } = config

  // Validate rules at construction time
  for (const rule of rules) {
    if (!rule.match) {
      throw new Error("proxyRules: each rule must have a 'match' field")
    }
    // Pre-compile regexes for glob rules (skip geosite: / geoip: rules)
    if (!rule.match.startsWith("geosite:") && !rule.match.startsWith("geoip:")) {
      ;(rule as any)._regex = globToRegex(rule.match)
    }
    // For rule-set rules, store a regex sentinel so matchRule doesn't crash
    if (!(rule as any)._regex) {
      ;(rule as any)._regex = /^$/ // never matches via glob, falls through to rule-set logic
    }
  }

  return async (ctx, next) => {
    const hostname = ctx.req.locals?.urlParts?.host
    if (!hostname) {
      debug("proxyRules: no hostname in request, skipping")
      return next()
    }

    const isConnectType = isConnect(ctx)

    for (const rule of rules) {
      if (matchRule(hostname, rule, isConnectType, ruleSets)) {
        const upstreamStr = rule.upstream
          ? `upstream=${rule.upstream.host}:${rule.upstream.port}`
          : "upstream=none(direct)"
        const bindStr = rule.localAddress ?? def?.localAddress ?? "OS default"
        const dnsStr = (rule.dns ?? def?.dns) ? `dns=${rule.dns ?? def?.dns}` : ""
        debug(`proxyRules: matched "${rule.match}" → host=%s type=%s ${upstreamStr} bind=%s %s`, hostname, isConnectType ? "connect" : "http", bindStr, dnsStr)

        ctx.req.locals.upstream = rule.upstream
        ctx.req.locals.localAddress = rule.localAddress ?? def?.localAddress ?? "0.0.0.0"
        ctx.req.locals.dns = rule.dns ?? def?.dns
        return next()
      }
    }

    // Fallback to defaults
    debug(`proxyRules: no rule matched ${hostname}, using defaults`)
    ctx.req.locals.upstream = def?.upstream
    ctx.req.locals.localAddress = def?.localAddress ?? "0.0.0.0"
    ctx.req.locals.dns = def?.dns
    return next()
  }
}
