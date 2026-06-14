import { Middleware, RequestContext, ResponseContext } from ".."

import Debug from "debug"
const debug = Debug("straightforward:middleware")

// ============================================================
// Types
// ============================================================

export interface HeadersOptions {
  /** Headers to set or overwrite. Values support ${variable} interpolation. */
  set?: Record<string, string>
  /** Header names to remove (case-insensitive). */
  remove?: string[]
}

// ============================================================
// Variable interpolation
// ============================================================

/**
 * Build the variable table for interpolation.
 * Missing variables resolve to empty string rather than throwing.
 */
function buildVars(
  ctx: RequestContext | ResponseContext
): Record<string, string> {
  const req = ctx.req
  const vars: Record<string, string> = {}

  // Always available
  vars["client.ip"] = req.socket.remoteAddress || ""
  vars["target.host"] = req.locals?.urlParts?.host || ""
  vars["target.port"] = String(req.locals?.urlParts?.port || "")
  vars["req.method"] = req.method || ""
  vars["req.url"] = req.url || ""
  vars["upstream.host"] = req.locals?.upstream?.host || ""
  vars["upstream.port"] = String(req.locals?.upstream?.port || "")

  // Response-only
  if ("proxyRes" in ctx) {
    vars["proxy.status"] = String(ctx.proxyRes.statusCode || "")
  }

  return vars
}

/** Replace ${varName} placeholders with values from the vars table. */
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
    return name in vars ? vars[name] : ""
  })
}

// ============================================================
// Header manipulation
// ============================================================

/**
 * Remove headers by name (case-insensitive).
 */
function removeHeaders(
  headers: Record<string, string | string[] | undefined>,
  names: string[]
): void {
  for (const name of names) {
    const lower = name.toLowerCase()
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lower) {
        delete headers[key]
        debug("headers: removed %s", key)
      }
    }
  }
}

/**
 * Set headers with variable interpolation.
 */
function setHeaders(
  headers: Record<string, string | string[] | undefined>,
  entries: Record<string, string>,
  vars: Record<string, string>
): void {
  for (const [name, value] of Object.entries(entries)) {
    const resolved = interpolate(value, vars)
    headers[name] = resolved
    debug("headers: set %s = %s", name, resolved)
  }
}

// ============================================================
// Middleware factory
// ============================================================

/**
 * Request/response header rewrite middleware.
 *
 * Supports `${variable}` interpolation for dynamic header values.
 * Works on both `onRequest` (modify headers before forwarding to upstream)
 * and `onResponse` (modify headers before returning to client).
 *
 * Note: hop-by-hop headers set via this middleware are still stripped by
 * the core proxy handler before forwarding.
 *
 * @example
 * // Request headers
 * sf.onRequest.use(middleware.headers({
 *   set: { "X-Forwarded-For": "${client.ip}" },
 *   remove: ["User-Agent"],
 * }))
 *
 * // Response headers
 * sf.onResponse.use(middleware.headers({
 *   set: { "X-Proxied-By": "straightforward" },
 *   remove: ["Server", "X-Powered-By"],
 * }))
 */
export const headers = (
  opts: HeadersOptions
): Middleware<RequestContext | ResponseContext> => {
  const hasSet = opts.set && Object.keys(opts.set).length > 0
  const hasRemove = opts.remove && opts.remove.length > 0

  // No-op fast path
  if (!hasSet && !hasRemove) {
    return async (_ctx, next) => next()
  }

  return async (ctx, next) => {
    let targetHeaders: Record<string, string | string[] | undefined>

    if ("proxyRes" in ctx) {
      // onResponse: modify upstream response headers
      targetHeaders = ctx.proxyRes.headers as Record<
        string,
        string | string[] | undefined
      >
    } else {
      // onRequest: modify client request headers
      targetHeaders = ctx.req.headers as Record<
        string,
        string | string[] | undefined
      >
    }

    const vars = buildVars(ctx)

    if (hasRemove) {
      removeHeaders(targetHeaders, opts.remove!)
    }
    if (hasSet) {
      setHeaders(targetHeaders, opts.set!, vars)
    }

    return next()
  }
}
