import anyTest, { TestFn } from "ava"
import net from "net"
import { Straightforward, middleware } from "../src"
import got from "got-cjs"
import { makeProxyAgents, timeout } from "./utils"

const test = anyTest as TestFn<{ port: number }>

let basePort = 13000
test.beforeEach((t) => {
  t.context.port = basePort += 1
})

// ============================================================
// Unit: exact IP matching via middleware context
// ============================================================

function createRequestContext(clientIP: string) {
  return {
    req: {
      socket: { remoteAddress: clientIP },
      locals: {} as any,
    } as any,
    res: {
      writeHead: () => {},
      end: () => {},
      writableEnded: false,
    } as any,
  }
}

function createConnectContext(clientIP: string) {
  let ended = false
  let endData = ""
  return {
    req: {
      socket: { remoteAddress: clientIP },
      locals: {} as any,
    } as any,
    clientSocket: {
      end: (data?: string) => {
        ended = true
        if (data) endData += data
      },
      _ended: () => ended,
      _endData: () => endData,
    } as any,
  }
}

test("acl: exact IP match allow → passes", async (t) => {
  const mw = middleware.acl({ allow: ["10.0.0.5"] })
  const ctx = createRequestContext("10.0.0.5")
  let nextCalled = false
  await mw(ctx as any, async () => { nextCalled = true })
  t.true(nextCalled, "matching IP should call next()")
})

test("acl: exact IP not in allow → denied", async (t) => {
  const mw = middleware.acl({ allow: ["10.0.0.5"] })
  const ctx = createRequestContext("10.0.0.6")
  let nextCalled = false
  await mw(ctx as any, async () => { nextCalled = true })
  t.false(nextCalled, "non-matching IP should NOT call next()")
})

test("acl: exact IP in deny → denied", async (t) => {
  const mw = middleware.acl({ deny: ["10.0.0.99"] })
  const ctx = createRequestContext("10.0.0.99")
  let nextCalled = false
  await mw(ctx as any, async () => { nextCalled = true })
  t.false(nextCalled, "blocked IP should NOT call next()")
})

test("acl: deny-only mode passes unmatched IPs", async (t) => {
  const mw = middleware.acl({ deny: ["10.0.0.99"] })
  const ctx = createRequestContext("10.0.0.5")
  let nextCalled = false
  await mw(ctx as any, async () => { nextCalled = true })
  t.true(nextCalled, "non-blocked IP should pass in deny-only mode")
})

test("acl: both lists empty → passes", async (t) => {
  const mw = middleware.acl({})
  const ctx = createRequestContext("1.2.3.4")
  let nextCalled = false
  await mw(ctx as any, async () => { nextCalled = true })
  t.true(nextCalled)
})

// ============================================================
// CIDR matching
// ============================================================

test("acl: CIDR allow /8 matches subnet", async (t) => {
  const mw = middleware.acl({ allow: ["10.0.0.0/8"] })
  const ctx1 = createRequestContext("10.1.2.3")
  let nextCalled = false
  await mw(ctx1 as any, async () => { nextCalled = true })
  t.true(nextCalled, "10.1.2.3 should match 10.0.0.0/8")

  const ctx2 = createRequestContext("11.0.0.1")
  nextCalled = false
  await mw(ctx2 as any, async () => { nextCalled = true })
  t.false(nextCalled, "11.0.0.1 should NOT match 10.0.0.0/8")
})

test("acl: CIDR /24 matches exact subnet", async (t) => {
  const mw = middleware.acl({ allow: ["192.168.1.0/24"] })

  const ctx1 = createRequestContext("192.168.1.100")
  let nextCalled = false
  await mw(ctx1 as any, async () => { nextCalled = true })
  t.true(nextCalled, "192.168.1.100 should match 192.168.1.0/24")

  const ctx2 = createRequestContext("192.168.2.1")
  nextCalled = false
  await mw(ctx2 as any, async () => { nextCalled = true })
  t.false(nextCalled, "192.168.2.1 should NOT match 192.168.1.0/24")
})

test("acl: CIDR /32 equals exact match", async (t) => {
  const mw = middleware.acl({ allow: ["10.0.0.5/32"] })
  const ctx1 = createRequestContext("10.0.0.5")
  let nextCalled = false
  await mw(ctx1 as any, async () => { nextCalled = true })
  t.true(nextCalled)

  const ctx2 = createRequestContext("10.0.0.6")
  nextCalled = false
  await mw(ctx2 as any, async () => { nextCalled = true })
  t.false(nextCalled)
})

test("acl: CIDR /0 matches everything", async (t) => {
  const mw = middleware.acl({ allow: ["0.0.0.0/0"] })
  const ctx = createRequestContext("255.255.255.255")
  let nextCalled = false
  await mw(ctx as any, async () => { nextCalled = true })
  t.true(nextCalled)
})

// ============================================================
// Priority: allow > deny
// ============================================================

test("acl: allow overrides deny when IP is in both", async (t) => {
  const mw = middleware.acl({
    allow: ["10.0.0.0/8"],
    deny: ["10.0.0.5"],
  })
  const ctx = createRequestContext("10.0.0.5")
  let nextCalled = false
  await mw(ctx as any, async () => { nextCalled = true })
  t.true(nextCalled, "allow should override deny for the same IP")
})

// ============================================================
// CONNECT: clientSocket.end() is called instead of res.end()
// ============================================================

test("acl: denies CONNECT via clientSocket.end with 403", async (t) => {
  const mw = middleware.acl({ deny: ["10.0.0.99"] })
  const ctx = createConnectContext("10.0.0.99")
  let nextCalled = false
  await mw(ctx as any, async () => { nextCalled = true })
  t.false(nextCalled)
  t.true((ctx.clientSocket as any)._ended(), "clientSocket should be ended")
  const data = (ctx.clientSocket as any)._endData()
  t.true(data.includes("403"), "should return 403 status")
})

test("acl: passes CONNECT for allowed IP", async (t) => {
  const mw = middleware.acl({ allow: ["10.0.0.5"] })
  const ctx = createConnectContext("10.0.0.5")
  let nextCalled = false
  await mw(ctx as any, async () => { nextCalled = true })
  t.true(nextCalled)
})

// ============================================================
// Custom status code and message
// ============================================================

test("acl: custom status code and message in response", async (t) => {
  const mw = middleware.acl({
    deny: ["10.0.0.99"],
    statusCode: 429,
    message: "Too many requests from this IP",
  })

  const ctx = createConnectContext("10.0.0.99")
  let nextCalled = false
  await mw(ctx as any, async () => { nextCalled = true })
  t.false(nextCalled)

  const data = (ctx.clientSocket as any)._endData()
  t.true(data.includes("429"), "should return custom status code")
  t.true(data.includes("Too many requests"), "should include custom message")
})

// ============================================================
// IPv6 matching
// ============================================================

test("acl: IPv6 exact match", async (t) => {
  const mw = middleware.acl({ allow: ["::1"] })
  const ctx = createRequestContext("::1")
  let nextCalled = false
  await mw(ctx as any, async () => { nextCalled = true })
  t.true(nextCalled, "::1 should match ::1")
})

test("acl: IPv6 deny exact match", async (t) => {
  const mw = middleware.acl({ deny: ["fe80::1"] })
  const ctx = createRequestContext("fe80::1")
  let nextCalled = false
  await mw(ctx as any, async () => { nextCalled = true })
  t.false(nextCalled, "fe80::1 should be denied")
})

test("acl: IPv6 CIDR /64 matches subnet", async (t) => {
  const mw = middleware.acl({ allow: ["fe80::/10"] })
  // fe80::1 is in fe80::/10
  const ctx = createRequestContext("fe80::1")
  let nextCalled = false
  await mw(ctx as any, async () => { nextCalled = true })
  t.true(nextCalled, "fe80::1 should match fe80::/10")
})

test("acl: IPv6 CIDR /128 equals exact match", async (t) => {
  const mw = middleware.acl({ allow: ["::1/128"] })
  const ctx = createRequestContext("::1")
  let nextCalled = false
  await mw(ctx as any, async () => { nextCalled = true })
  t.true(nextCalled, "::1 should match ::1/128")
})

// ============================================================
// No remoteAddress
// ============================================================

test("acl: denies when remoteAddress is undefined", async (t) => {
  const ctx = createRequestContext(undefined as any)
  ctx.req.socket.remoteAddress = undefined

  const mw = middleware.acl({ allow: ["10.0.0.0/8"] })
  let nextCalled = false
  await mw(ctx as any, async () => { nextCalled = true })
  t.false(nextCalled, "should deny when client IP is unknown")
})
