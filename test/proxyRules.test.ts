import anyTest, { TestFn } from "ava"
import { Straightforward, middleware } from "../src"

const test = anyTest as TestFn<{}>
test.beforeEach(() => {})

// ============================================================
// Unit tests for globToRegex (via proxyRules behavior)
// These test the matching logic in isolation without network.
// ============================================================

function createContext(hostname: string, isConnect: boolean) {
  const ctx: any = {
    req: {
      locals: {
        urlParts: { host: hostname },
        isConnect,
      },
      method: isConnect ? "CONNECT" : "GET",
    },
    res: {
      writeHead: () => {},
      end: () => {},
    },
    ...(isConnect ? {} : { clientSocket: undefined }),
  }
  return ctx
}

test("glob * matches any hostname", async (t) => {
  const mw = middleware.proxyRules({ rules: [{ match: "*", localAddress: "10.0.0.1" }] })

  const ctx = createContext("example.com", false)
  await mw(ctx, async () => {
    t.is(ctx.req.locals.localAddress, "10.0.0.1")
  })

  const ctx2 = createContext("anything.else.sub.example.com", true)
  await mw(ctx2, async () => {
    t.is(ctx2.req.locals.localAddress, "10.0.0.1")
  })
})

test("glob *.example.com matches subdomains but not apex", async (t) => {
  const mw = middleware.proxyRules({
    rules: [{ match: "*.example.com", localAddress: "10.0.0.1" }],
    default: { localAddress: "0.0.0.0" },
  })

  const sub = createContext("sub.example.com", false)
  await mw(sub, async () => {
    t.is(sub.req.locals.localAddress, "10.0.0.1", "subdomain should match *.example.com")
  })

  const apex = createContext("example.com", false)
  await mw(apex, async () => {
    t.is(apex.req.locals.localAddress, "0.0.0.0", "apex should NOT match *.example.com, falling back to default")
  })
})

test("glob ** crosses dots", async (t) => {
  const mw = middleware.proxyRules({
    rules: [{ match: "**.corp", localAddress: "10.0.0.1" }],
    default: { localAddress: "0.0.0.0" },
  })

  // **.corp should match everything under the .corp domain, including sub.sub.corp
  const ctx = createContext("a.b.corp", false)
  await mw(ctx, async () => {
    t.is(ctx.req.locals.localAddress, "10.0.0.1")
  })
})

test("first matching rule wins", async (t) => {
  const mw = middleware.proxyRules({
    rules: [
      { match: "example.com", localAddress: "10.0.0.1" },
      { match: "*", localAddress: "10.0.0.2" },
    ],
  })

  const ctx = createContext("example.com", false)
  await mw(ctx, async () => {
    t.is(ctx.req.locals.localAddress, "10.0.0.1", "first rule should win for example.com")
  })

  const google = createContext("google.com", false)
  await mw(google, async () => {
    t.is(google.req.locals.localAddress, "10.0.0.2", "second rule should catch google.com")
  })
})

test("type filter: http only matches onRequest, connect only matches onConnect", async (t) => {
  const mw = middleware.proxyRules({
    rules: [
      { match: "*", type: "http", localAddress: "10.0.1.1" },
      { match: "*", type: "connect", localAddress: "10.0.2.2" },
      { match: "*", localAddress: "10.0.3.3" },
    ],
  })

  // HTTP context
  const httpCtx = createContext("example.com", false)
  await mw(httpCtx, async () => {
    t.is(httpCtx.req.locals.localAddress, "10.0.1.1", "HTTP should match type=http rule")
  })

  // CONNECT context
  const connectCtx: any = {
    req: {
      locals: { urlParts: { host: "example.com" }, isConnect: true },
      method: "CONNECT",
    },
    clientSocket: {},
  }
  await mw(connectCtx, async () => {
    t.is(connectCtx.req.locals.localAddress, "10.0.2.2", "CONNECT should match type=connect rule")
  })

  // Context with no type filter should match the third rule if first two skip
  // But they DO match due to type=connect matching CONNECT. Let's test with no matching type.
  const mw2 = middleware.proxyRules({
    rules: [
      { match: "*", type: "connect", localAddress: "10.0.5.1" },
    ],
    default: { localAddress: "10.0.9.9" },
  })

  const httpCtx2 = createContext("example.com", false)
  await mw2(httpCtx2, async () => {
    t.is(httpCtx2.req.locals.localAddress, "10.0.9.9", "HTTP with type=connect rule should fallback to default")
  })
})

test("default values applied when no rule matches", async (t) => {
  const mw = middleware.proxyRules({
    rules: [{ match: "*.google.com", upstream: { host: "gproxy", port: 8080 } }],
    default: { localAddress: "192.168.1.1" },
  })

  const ctx = createContext("example.com", false)
  await mw(ctx, async () => {
    t.is(ctx.req.locals.localAddress, "192.168.1.1", "default localAddress should apply")
    t.is(ctx.req.locals.upstream, undefined, "default upstream (undefined) should apply")
  })
})

test("upstream is propagated to req.locals", async (t) => {
  const upstream = { host: "my-proxy", port: 3128, auth: { user: "u", pass: "p" } }
  const mw = middleware.proxyRules({
    rules: [{ match: "*", upstream, localAddress: "10.0.0.1" }],
  })

  const ctx = createContext("example.com", false)
  await mw(ctx, async () => {
    t.deepEqual(ctx.req.locals.upstream, upstream)
    t.is(ctx.req.locals.localAddress, "10.0.0.1")
  })
})

test("direct connect: upstream omitted → req.locals.upstream is undefined", async (t) => {
  const mw = middleware.proxyRules({
    rules: [{ match: "*", localAddress: "10.0.0.1" }],
  })

  const ctx = createContext("example.com", false)
  await mw(ctx, async () => {
    t.is(ctx.req.locals.upstream, undefined, "upstream should be undefined for direct connect")
    t.is(ctx.req.locals.localAddress, "10.0.0.1")
  })
})

test("no hostname → fall through without modifying locals", async (t) => {
  const mw = middleware.proxyRules({
    rules: [{ match: "*", localAddress: "10.0.0.1" }],
  })

  const ctx: any = {
    req: {
      locals: { urlParts: { host: "" } },
    },
    res: {},
  }

  await mw(ctx, async () => {
    t.is(ctx.req.locals.localAddress, undefined, "should not set localAddress without hostname")
  })
})

test("empty rules → applies defaults", async (t) => {
  const mw = middleware.proxyRules({
    rules: [],
    default: { localAddress: "10.0.0.1", upstream: { host: "fallback", port: 3128 } },
  })

  const ctx = createContext("example.com", false)
  await mw(ctx, async () => {
    t.is(ctx.req.locals.localAddress, "10.0.0.1")
    t.is(ctx.req.locals.upstream?.host, "fallback")
    t.is(ctx.req.locals.upstream?.port, 3128)
  })
})

test("missing match field throws", (t) => {
  t.throws(() => {
    middleware.proxyRules({ rules: [{} as any] })
  }, { message: "proxyRules: each rule must have a 'match' field" })
})

// ============================================================
// geosite: prefix matching (requires ruleSets)
// ============================================================

test("geosite: prefix dispatches to ruleSets.match", async (t) => {
  const mockRuleSets = {
    match(_tag: string, hostname: string): boolean {
      // Only google.com/youtube.com/facebook.com are in the "gfw" set
      const gfwDomains = ["google.com", "youtube.com", "facebook.com"]
      return gfwDomains.some(d => hostname === d || hostname.endsWith("." + d))
    },
    has(_tag: string): boolean {
      return true
    },
    tags(): string[] {
      return ["gfw"]
    },
  }

  const mw = middleware.proxyRules({
    rules: [
      { match: "geosite:gfw", localAddress: "10.0.1.1" },
      { match: "*", localAddress: "10.0.0.1" },
    ],
    ruleSets: mockRuleSets,
  })

  // google.com is in gfw → should match first rule
  const ctx1 = createContext("google.com", false)
  await mw(ctx1, async () => {
    t.is(ctx1.req.locals.localAddress, "10.0.1.1", "geosite:gfw should match via resolver")
  })

  // baidu.com is NOT in gfw → should match second rule
  const ctx2 = createContext("baidu.com", false)
  await mw(ctx2, async () => {
    t.is(ctx2.req.locals.localAddress, "10.0.0.1", "baidu.com should fall through to glob rule")
  })
})

test("geosite: mixed with glob rules, first-match-wins", async (t) => {
  const mockRuleSets = {
    match(_tag: string, hostname: string): boolean {
      // google.com/youtube.com/facebook.com are in gfw
      const gfwDomains = ["google.com", "youtube.com", "facebook.com"]
      return gfwDomains.some(d => hostname === d || hostname.endsWith("." + d))
    },
    has(): boolean { return true },
    tags(): string[] { return ["gfw"] },
  }

  const mw = middleware.proxyRules({
    rules: [
      { match: "news.example.com", localAddress: "10.0.0.2" },
      { match: "geosite:gfw", localAddress: "10.0.0.3" },
      { match: "*", localAddress: "10.0.0.4" },
    ],
    ruleSets: mockRuleSets,
  })

  // news.example.com should match the glob rule first
  const ctx1 = createContext("news.example.com", false)
  await mw(ctx1, async () => {
    t.is(ctx1.req.locals.localAddress, "10.0.0.2", "glob rule should win if it appears first")
  })

  // google.com is in gfw → should match geosite:gfw
  const ctx2 = createContext("google.com", false)
  await mw(ctx2, async () => {
    t.is(ctx2.req.locals.localAddress, "10.0.0.3", "geosite:gfw should match google.com")
  })

  // fallback
  const ctx3 = createContext("other.com", false)
  await mw(ctx3, async () => {
    t.is(ctx3.req.locals.localAddress, "10.0.0.4", "fallback to catch-all")
  })
})

test("geosite: without ruleSets → treated as literal hostname match", async (t) => {
  // Without ruleSets, "geosite:gfw" is treated as a literal glob pattern.
  // The globToRegex for "geosite:gfw" won't match any real hostname because
  // it's literally looking for the string "geosite:gfw" as a hostname.
  const mw = middleware.proxyRules({
    rules: [
      { match: "geosite:gfw", localAddress: "10.0.0.1" },
      { match: "*", localAddress: "10.0.0.2" },
    ],
    // no ruleSets
  })

  const ctx = createContext("google.com", false)
  await mw(ctx, async () => {
    t.is(ctx.req.locals.localAddress, "10.0.0.2", "geosite:gfw without resolver falls through to next rule")
  })
})

test("geosite: unknown tag → returns false, falls through", async (t) => {
  const mockRuleSets = {
    match(): boolean { return false },
    has(): boolean { return false },
    tags(): string[] { return [] },
  }

  const mw = middleware.proxyRules({
    rules: [
      { match: "geosite:unknown-tag", localAddress: "10.0.0.1" },
      { match: "*", localAddress: "10.0.0.2" },
    ],
    ruleSets: mockRuleSets,
  })

  const ctx = createContext("google.com", false)
  await mw(ctx, async () => {
    t.is(ctx.req.locals.localAddress, "10.0.0.2", "unknown geosite tag falls through to wildcard")
  })
})

test("geosite: type filter still applies", async (t) => {
  const mockRuleSets = {
    match(): boolean { return true }, // always matches
    has(): boolean { return true },
    tags(): string[] { return ["test"] },
  }

  const mw = middleware.proxyRules({
    rules: [
      { match: "geosite:test", type: "connect", localAddress: "10.0.1.1" },
      { match: "*", localAddress: "10.0.0.1" },
    ],
    ruleSets: mockRuleSets,
  })

  // HTTP context — geosite:test with type=connect should NOT match
  const httpCtx = createContext("example.com", false)
  await mw(httpCtx, async () => {
    t.is(httpCtx.req.locals.localAddress, "10.0.0.1", "HTTP should skip type=connect geosite rule")
  })

  // CONNECT context — geosite:test with type=connect should match
  const connectCtx: any = {
    req: {
      locals: { urlParts: { host: "example.com" }, isConnect: true },
      method: "CONNECT",
    },
    clientSocket: {},
  }
  await mw(connectCtx, async () => {
    t.is(connectCtx.req.locals.localAddress, "10.0.1.1", "CONNECT should match type=connect geosite rule")
  })
})
