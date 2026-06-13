#!/usr/bin/env node
// @ts-nocheck
/**
 * Stress test — measures RPS, memory stability, and error rate.
 *
 * Usage:
 *   node --expose-gc -r esbuild-register test/stress.ts
 */

const http = require("http")
const https = require("https")
const { Straightforward } = require("../dist/index.js")

const DURATION_SEC = 60
const MAX_IN_FLIGHT = 64
const TARGET_URL = "http://httpbin.org/get"
const TARGET_HTTPS = "https://httpbin.org/get"
const PROXY_PORT = 19080

// ===== Shared reusable agents =====
const ProxyAgent = require("proxy-agent")
const { HttpsProxyAgent } = require("hpagent")
const httpAgent = new ProxyAgent(`http://127.0.0.1:${PROXY_PORT}`)
const httpsAgent = new HttpsProxyAgent({
  proxy: `http://127.0.0.1:${PROXY_PORT}`,
  keepAlive: true,
  maxSockets: 256,
  maxFreeSockets: 256,
})

// ===== Reporting =====
let lastReq = 0
let lastConn = 0
let lastTime = Date.now()

function snap(stats: { onRequest: number; onConnect: number }) {
  const mem = process.memoryUsage()
  const dt = ((Date.now() - lastTime) / 1000).toFixed(1)
  const rps =
    lastTime > 0
      ? ((stats.onRequest + stats.onConnect - lastReq - lastConn) / parseFloat(dt)).toFixed(0)
      : "0"
  console.log(
    [
      "[GC-SNAP]",
      `Heap: ${(mem.heapUsed / 1e6).toFixed(1)}/${(mem.heapTotal / 1e6).toFixed(1)}MB`,
      `RSS: ${(mem.rss / 1e6).toFixed(1)}MB`,
      `Ext: ${(mem.external / 1e6).toFixed(1)}MB`,
      `req: ${stats.onRequest}`,
      `conn: ${stats.onConnect}`,
      `RPS: ${rps}`,
    ].join("  ")
  )
  lastReq = stats.onRequest
  lastConn = stats.onConnect
  lastTime = Date.now()
}

// ===== Single request =====
/**
 * @param {boolean} isHttps
 * @param {{ ok: number, fail: number }} results
 */
function fire(isHttps, results) {
  const client = isHttps ? https : http
  const agent = isHttps ? httpsAgent : httpAgent
  const u = new URL(isHttps ? TARGET_HTTPS : TARGET_URL)

  return new Promise((resolve) => {
    const req = client.request(
      {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: "GET",
        agent,
        timeout: 15000,
      },
      (res) => {
        res.on("data", () => {})
        res.on("end", () => {
          results.ok++
          resolve(undefined)
        })
        res.on("error", () => {
          results.fail++
          resolve(undefined)
        })
      }
    )
    req.on("error", () => {
      results.fail++
      resolve(undefined)
    })
    req.on("timeout", () => {
      req.destroy()
      results.fail++
      resolve(undefined)
    })
    req.end()
  })
}

// ===== Main =====
async function main() {
  console.log("=== Straightforward Stress Test ===")
  console.log(`Duration: ${DURATION_SEC}s  Max in-flight: ${MAX_IN_FLIGHT}`)
  console.log()

  const sf = new Straightforward()
  await sf.listen(PROXY_PORT, "127.0.0.1")

  const timer = setInterval(() => {
    if (typeof global.gc === "function") global.gc()
    snap(sf.stats)
  }, 5000)

  const start = Date.now()
  const deadline = start + DURATION_SEC * 1000

  const results = { ok: 0, fail: 0 }
  let inflight = 0
  let done = false

  function pump() {
    while (!done && inflight < MAX_IN_FLIGHT) {
      inflight++
      fire(Math.random() > 0.5, results).then(() => {
        inflight--
      })
    }
    if (Date.now() < deadline) {
      setImmediate(pump)
    } else {
      done = true
    }
  }

  pump()

  // Wait until all in-flight drain
  while (inflight > 0) {
    await new Promise((r) => setTimeout(r, 50))
  }

  clearInterval(timer)

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  // Final GC
  if (typeof global.gc === "function") {
    global.gc()
    await new Promise((r) => setTimeout(r, 2000))
    global.gc()
  }

  console.log()
  console.log("=== Summary ===")
  console.log(`Elapsed:     ${elapsed}s`)
  console.log(`Requests:    ${results.ok + results.fail} (${results.ok} OK / ${results.fail} FAIL)`)
  console.log(`RPS avg:     ${((results.ok + results.fail) / parseFloat(elapsed)).toFixed(0)}`)
  console.log(`RPS OK:      ${(results.ok / parseFloat(elapsed)).toFixed(0)}`)
  console.log(`HTTP/CONNECT: ${sf.stats.onRequest} / ${sf.stats.onConnect}`)
  snap(sf.stats)

  httpAgent.destroy()
  httpsAgent.destroy()
  sf.close()
}

main().catch((err) => {
  console.error("Stress test crashed:", err)
  process.exit(1)
})
