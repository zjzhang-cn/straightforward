import test from "ava"
import { headers } from "../src/middleware/headers"

// ============================================================
// Headers middleware — onRequest (set)
// ============================================================

test("headers: set request headers", async (t) => {
  const mw = headers({
    set: { "X-Forwarded-For": "${client.ip}", "X-Custom": "hello" },
  })

  const ctx: any = {
    req: {
      headers: { host: "example.com" },
      socket: { remoteAddress: "10.0.0.1" },
      locals: { urlParts: { host: "example.com", port: 80 } },
      method: "GET",
      url: "http://example.com/path",
    },
  }

  await mw(ctx, async () => {})
  t.is(ctx.req.headers["X-Forwarded-For"], "10.0.0.1")
  t.is(ctx.req.headers["X-Custom"], "hello")
})

// ============================================================
// Headers middleware — onRequest (remove)
// ============================================================

test("headers: remove request headers", async (t) => {
  const mw = headers({
    remove: ["User-Agent", "Referer"],
  })

  const ctx: any = {
    req: {
      headers: {
        host: "example.com",
        "User-Agent": "curl/7.0",
        Referer: "http://origin.com",
      },
      socket: { remoteAddress: "10.0.0.1" },
      locals: { urlParts: { host: "example.com", port: 80 } },
      method: "GET",
      url: "http://example.com/path",
    },
  }

  await mw(ctx, async () => {})
  t.is(ctx.req.headers["User-Agent"], undefined)
  t.is(ctx.req.headers["Referer"], undefined)
  t.truthy(ctx.req.headers["host"]) // untouched
})

// ============================================================
// Headers middleware — onResponse (set)
// ============================================================

test("headers: set response headers", async (t) => {
  const mw = headers({
    set: { "X-Proxied-By": "straightforward" },
  })

  const ctx: any = {
    req: {
      headers: {},
      socket: { remoteAddress: "10.0.0.2" },
      locals: { urlParts: { host: "example.com", port: 80 } },
      method: "GET",
      url: "http://example.com/path",
    },
    proxyRes: {
      headers: { "content-type": "text/html", server: "nginx" },
      statusCode: 200,
    },
  }

  await mw(ctx, async () => {})
  t.is(ctx.proxyRes.headers["X-Proxied-By"], "straightforward")
})

// ============================================================
// Headers middleware — onResponse (remove)
// ============================================================

test("headers: remove response headers", async (t) => {
  const mw = headers({
    remove: ["Server", "X-Powered-By"],
  })

  const ctx: any = {
    req: {
      headers: {},
      socket: { remoteAddress: "10.0.0.2" },
      locals: { urlParts: { host: "example.com", port: 80 } },
      method: "GET",
      url: "http://example.com/path",
    },
    proxyRes: {
      headers: { "content-type": "text/html", server: "nginx", "x-powered-by": "PHP" },
      statusCode: 200,
    },
  }

  await mw(ctx, async () => {})
  t.is(ctx.proxyRes.headers["server"], undefined)
  t.is(ctx.proxyRes.headers["x-powered-by"], undefined)
  t.truthy(ctx.proxyRes.headers["content-type"]) // untouched
})

// ============================================================
// Variable interpolation
// ============================================================

test("headers: interpolate ${client.ip}", async (t) => {
  const mw = headers({
    set: { "X-Client": "${client.ip}" },
  })

  const ctx: any = {
    req: {
      headers: {},
      socket: { remoteAddress: "192.168.1.100" },
      locals: { urlParts: { host: "example.com", port: 80 } },
      method: "GET",
      url: "http://example.com/path",
    },
  }

  await mw(ctx, async () => {})
  t.is(ctx.req.headers["X-Client"], "192.168.1.100")
})

test("headers: interpolate ${target.host} and ${target.port}", async (t) => {
  const mw = headers({
    set: { "X-Target": "${target.host}:${target.port}" },
  })

  const ctx: any = {
    req: {
      headers: {},
      socket: { remoteAddress: "10.0.0.1" },
      locals: { urlParts: { host: "api.example.com", port: 443 } },
      method: "POST",
      url: "http://api.example.com/v1/data",
    },
  }

  await mw(ctx, async () => {})
  t.is(ctx.req.headers["X-Target"], "api.example.com:443")
})

test("headers: interpolate ${upstream.host} when upstream set", async (t) => {
  const mw = headers({
    set: { "X-Via": "${upstream.host}:${upstream.port}" },
  })

  const ctx: any = {
    req: {
      headers: {},
      socket: { remoteAddress: "10.0.0.1" },
      locals: {
        urlParts: { host: "example.com", port: 80 },
        upstream: { host: "proxy.internal", port: 3128 },
      },
      method: "GET",
      url: "http://example.com/path",
    },
  }

  await mw(ctx, async () => {})
  t.is(ctx.req.headers["X-Via"], "proxy.internal:3128")
})

test("headers: missing variable resolves to empty string", async (t) => {
  const mw = headers({
    set: { "X-Upstream": "via ${upstream.host}" },
  })

  const ctx: any = {
    req: {
      headers: {},
      socket: { remoteAddress: "10.0.0.1" },
      locals: {
        urlParts: { host: "example.com", port: 80 },
        // no upstream set (direct connect)
      },
      method: "GET",
      url: "http://example.com/path",
    },
  }

  await mw(ctx, async () => {})
  t.is(ctx.req.headers["X-Upstream"], "via ") // ${upstream.host} resolves to ""
})

// ============================================================
// Edge cases
// ============================================================

test("headers: case-insensitive remove", async (t) => {
  const mw = headers({
    remove: ["content-length"],
  })

  const ctx: any = {
    req: {
      headers: { "Content-Length": "1024", host: "example.com" },
      socket: { remoteAddress: "10.0.0.1" },
      locals: { urlParts: { host: "example.com", port: 80 } },
      method: "GET",
      url: "http://example.com/path",
    },
  }

  await mw(ctx, async () => {})
  t.is(ctx.req.headers["Content-Length"], undefined)
})

test("headers: empty opts is noop", async (t) => {
  const mw = headers({})

  const ctx: any = {
    req: {
      headers: { host: "example.com" },
      socket: { remoteAddress: "10.0.0.1" },
      locals: { urlParts: { host: "example.com", port: 80 } },
      method: "GET",
      url: "http://example.com/path",
    },
  }

  await mw(ctx, async () => {})
  t.is(ctx.req.headers["host"], "example.com") // untouched
  t.pass()
})

test("headers: set overwrites existing header", async (t) => {
  const mw = headers({
    set: { "user-agent": "straightforward/4.0" },
  })

  const ctx: any = {
    req: {
      headers: { "User-Agent": "chrome/120", host: "example.com" },
      socket: { remoteAddress: "10.0.0.1" },
      locals: { urlParts: { host: "example.com", port: 80 } },
      method: "GET",
      url: "http://example.com/path",
    },
  }

  await mw(ctx, async () => {})
  t.is(ctx.req.headers["user-agent"], "straightforward/4.0")
})

test("headers: works alongside proxyRules (upstream variable)", async (t) => {
  // Simulate proxyRules middleware ran first and set upstream on locals
  const mw = headers({
    set: { "X-Routed-Via": "${upstream.host}" },
  })

  const ctx: any = {
    req: {
      headers: { host: "google.com" },
      socket: { remoteAddress: "192.168.1.50" },
      locals: {
        urlParts: { host: "google.com", port: 443 },
        upstream: { host: "127.0.0.1", port: 1082 },
        localAddress: "198.18.0.1",
        dns: "8.8.8.8",
      },
      method: "CONNECT",
      url: "google.com:443",
    },
  }

  await mw(ctx, async () => {})
  t.is(ctx.req.headers["X-Routed-Via"], "127.0.0.1")
})

// ============================================================
// Security: hop-by-hop headers are still stripped by core
// (verification that middleware doesn't prevent stripping)
// ============================================================

test("headers: can set proxy-authorization (will be stripped by core later)", async (t) => {
  const mw = headers({
    set: { "Proxy-Authorization": "Basic abc123" },
  })

  const ctx: any = {
    req: {
      headers: { host: "example.com" },
      socket: { remoteAddress: "10.0.0.1" },
      locals: { urlParts: { host: "example.com", port: 80 } },
      method: "GET",
      url: "http://example.com/path",
    },
  }

  await mw(ctx, async () => {})
  // Middleware sets it, but core _proxyRequest will strip it later
  t.is(ctx.req.headers["Proxy-Authorization"], "Basic abc123")
})
