import test from "ava"
import { EventEmitter } from "events"
import { connectionLimit } from "../src/middleware/connectionLimit"

// ============================================================
// Helper: create a mock request context
// ============================================================

function mockReqCtx(ip: string, headers?: Record<string, string>): any {
  const req = Object.assign(new EventEmitter(), {
    headers: headers || { host: "example.com" },
    socket: { remoteAddress: ip },
    locals: { urlParts: { host: "example.com", port: 80 } },
    method: "GET",
    url: "http://example.com/path",
  })
  return {
    req,
    res: {
      writeHead: (_code: number, _headers?: any) => {},
      end: (_body?: string) => {},
    },
  }
}

function mockConnectCtx(ip: string): any {
  const req = Object.assign(new EventEmitter(), {
    headers: { host: "example.com:443" },
    socket: { remoteAddress: ip },
    locals: { urlParts: { host: "example.com", port: 443 } },
    method: "CONNECT",
    url: "example.com:443",
  })
  return {
    req,
    clientSocket: {
      end: (_data?: string) => {},
    },
    head: Buffer.alloc(0),
  }
}

// ============================================================
// Basic limit tests
// ============================================================

test("connectionLimit: allows request under limit", async (t) => {
  const mw = connectionLimit({ maxConnectionsPerIP: 2 })
  const ctx = mockReqCtx("10.0.0.1")

  let called = false
  await mw(ctx, async () => { called = true })
  t.true(called, "next() should be called")
})

test("connectionLimit: blocks request over limit", async (t) => {
  const mw = connectionLimit({ maxConnectionsPerIP: 1 })
  const ip = "10.0.0.2"

  // First request passes
  const ctx1 = mockReqCtx(ip)
  let next1 = false
  await mw(ctx1, async () => { next1 = true })
  t.true(next1)

  // Second request blocked (slot not yet released)
  let blocked = false
  const ctx2 = mockReqCtx(ip)
  ctx2.res.end = (_body?: string) => { blocked = true }
  await mw(ctx2, async () => { t.fail("next() should not be called for blocked request") })
  t.true(blocked, "request should be blocked")
})

// ============================================================
// Slot release
// ============================================================

test("connectionLimit: releases slot on req close", async (t) => {
  const mw = connectionLimit({ maxConnectionsPerIP: 1 })
  const ip = "10.0.0.3"

  // First request passes
  const ctx1 = mockReqCtx(ip)
  let next1 = false
  await mw(ctx1, async () => { next1 = true })
  t.true(next1)

  // Release slot
  ctx1.req.emit("close")

  // Second request should now pass
  const ctx2 = mockReqCtx(ip)
  let next2 = false
  await mw(ctx2, async () => { next2 = true })
  t.true(next2, "slot should be released after close")
})

test("connectionLimit: releases slot on CONNECT close", async (t) => {
  const mw = connectionLimit({ maxConnectionsPerIP: 1 })
  const ip = "10.0.0.4"

  const ctx1 = mockConnectCtx(ip)
  let next1 = false
  await mw(ctx1, async () => { next1 = true })
  t.true(next1)

  // Release slot
  ctx1.req.emit("close")

  // Second connect should pass
  const ctx2 = mockConnectCtx(ip)
  let next2 = false
  await mw(ctx2, async () => { next2 = true })
  t.true(next2)
})

// ============================================================
// Whitelist
// ============================================================

test("connectionLimit: whitelist bypass (default: 127.0.0.1)", async (t) => {
  // Default whitelist includes 127.0.0.1
  const mw = connectionLimit({ maxConnectionsPerIP: 0 })

  const ctx = mockReqCtx("127.0.0.1")
  let called = false
  await mw(ctx, async () => { called = true })
  t.true(called, "whitelisted IP should bypass")
})

test("connectionLimit: whitelist bypass (default: ::1)", async (t) => {
  const mw = connectionLimit({ maxConnectionsPerIP: 0 })

  const ctx = mockReqCtx("::1")
  let called = false
  await mw(ctx, async () => { called = true })
  t.true(called, "whitelisted IPv6 localhost should bypass")
})

test("connectionLimit: custom whitelist", async (t) => {
  const mw = connectionLimit({
    maxConnectionsPerIP: 0,
    whitelist: ["10.0.0.99"],
  })

  const ctx = mockReqCtx("10.0.0.99")
  let called = false
  await mw(ctx, async () => { called = true })
  t.true(called, "custom whitelisted IP should bypass")
})

test("connectionLimit: non-whitelisted IP blocked", async (t) => {
  const mw = connectionLimit({
    maxConnectionsPerIP: 0,
    whitelist: ["10.0.0.99"],
  })

  let blocked = false
  const ctx = mockReqCtx("10.0.0.100")
  ctx.res.end = (_body?: string) => { blocked = true }
  await mw(ctx, async () => {})
  t.true(blocked)
})

// ============================================================
// Per-IP isolation
// ============================================================

test("connectionLimit: different IPs independent", async (t) => {
  const mw = connectionLimit({ maxConnectionsPerIP: 1 })

  const ctxA = mockReqCtx("10.0.0.1")
  let nextA = false
  await mw(ctxA, async () => { nextA = true })
  t.true(nextA)

  const ctxB = mockReqCtx("10.0.0.2")
  let nextB = false
  await mw(ctxB, async () => { nextB = true })
  t.true(nextB, "different IP should have its own counter")
})

test("connectionLimit: same IP counted together", async (t) => {
  const mw = connectionLimit({ maxConnectionsPerIP: 1 })
  const ip = "192.168.1.50"

  const ctx1 = mockReqCtx(ip)
  let next1 = false
  await mw(ctx1, async () => { next1 = true })
  t.true(next1)

  let blocked = false
  const ctx2 = mockReqCtx(ip)
  ctx2.res.end = (_body?: string) => { blocked = true }
  await mw(ctx2, async () => {})
  t.true(blocked)
})

// ============================================================
// Defaults
// ============================================================

test("connectionLimit: default maxConnectionsPerIP = 50", async (t) => {
  const mw = connectionLimit()
  // 51 requests should pass (default max is 50)
  const ip = "10.0.0.5"
  for (let i = 0; i < 50; i++) {
    const ctx = mockReqCtx(ip)
    let called = false
    await mw(ctx, async () => { called = true })
    t.true(called, `request ${i + 1} should pass`)
  }
  // 51st blocked
  let blocked = false
  const ctx51 = mockReqCtx(ip)
  ctx51.res.end = (_body?: string) => { blocked = true }
  await mw(ctx51, async () => {})
  t.true(blocked, "51st request should be blocked")
})

test("connectionLimit: custom status code and message", async (t) => {
  let capturedCode: number = 0
  let capturedHeaders: any = null

  const mw = connectionLimit({
    maxConnectionsPerIP: 1,
    statusCode: 503,
    message: "Service Unavailable",
  })

  const ip = "10.0.0.6"
  const ctx1 = mockReqCtx(ip)
  await mw(ctx1, async () => {})

  const ctx2 = mockReqCtx(ip)
  ctx2.res.writeHead = (code: number, headers?: any) => {
    capturedCode = code
    capturedHeaders = headers
  }
  await mw(ctx2, async () => {})

  t.is(capturedCode, 503)
  t.is(capturedHeaders?.["Content-Type"], "text/plain; charset=utf-8")
})

// ============================================================
// Unknown IP
// ============================================================

test("connectionLimit: handles unknown IP", async (t) => {
  const mw = connectionLimit({ maxConnectionsPerIP: 1 })

  const ctx = mockReqCtx("10.0.0.7")
  // Simulate no remote address
  ctx.req.socket.remoteAddress = undefined as any

  let called = false
  await mw(ctx, async () => { called = true })
  t.true(called, "unknown IP should be allowed")
})
