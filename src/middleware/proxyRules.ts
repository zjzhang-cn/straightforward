import { Middleware, RequestContext, ConnectContext, isConnect } from ".."

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
  /** Glob pattern matching the target hostname */
  match: string
  /** Only match this request type. Omit = both http and connect. */
  type?: "http" | "connect"
  /** Source IP to bind outgoing connection to. "0.0.0.0" = OS default */
  localAddress?: string
  /** Upstream proxy to route through. Omit = direct connect */
  upstream?: UpstreamProxy
}

export interface ProxyRulesConfig {
  rules: ProxyRule[]
  default?: {
    localAddress?: string
    upstream?: UpstreamProxy
  }
}

export interface RequestAdditionsProxyRules {
  locals: { upstream?: UpstreamProxy; localAddress?: string }
}

// ============================================================
// Glob → Regex conversion (zero-dependency)
// ============================================================

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex specials
    .replace(/\\\*/g, "[^.]*") // * → matches within a segment
    .replace(/\\\*\\\*/g, ".*") // ** → crosses dots
  return new RegExp("^" + escaped + "$", "i")
}

// ============================================================
// Rule matching
// ============================================================

function matchRule(
  hostname: string,
  rule: ProxyRule,
  isConnectType: boolean
): boolean {
  // type filter
  if (rule.type === "http" && isConnectType) return false
  if (rule.type === "connect" && !isConnectType) return false

  // glob match
  return globToRegex(rule.match).test(hostname)
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
  const { rules, default: def } = config

  // Validate rules at construction time
  for (const rule of rules) {
    if (!rule.match) {
      throw new Error("proxyRules: each rule must have a 'match' field")
    }
    // Pre-compile regexes for performance
    ;(rule as any)._regex = globToRegex(rule.match)
  }

  return async (ctx, next) => {
    const hostname = ctx.req.locals?.urlParts?.host
    if (!hostname) {
      debug("proxyRules: no hostname in request, skipping")
      return next()
    }

    const isConnectType = isConnect(ctx)

    for (const rule of rules) {
      if (matchRule(hostname, rule, isConnectType)) {
        debug(`proxyRules: matched "${rule.match}" → host=${hostname} type=${isConnectType ? "connect" : "http"}`)

        ctx.req.locals.upstream = rule.upstream
        ctx.req.locals.localAddress = rule.localAddress ?? def?.localAddress ?? "0.0.0.0"
        return next()
      }
    }

    // Fallback to defaults
    debug(`proxyRules: no rule matched ${hostname}, using defaults`)
    ctx.req.locals.upstream = def?.upstream
    ctx.req.locals.localAddress = def?.localAddress ?? "0.0.0.0"
    return next()
  }
}
