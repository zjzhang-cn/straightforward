import http from "http"
import net from "net"
import cluster from "cluster"
import { EventEmitter } from "events"
import internal from "stream"

import { MiddlewareDispatcher } from "./MiddlewareDispatcher"

import { auth } from "./middleware/auth"
import { echo } from "./middleware/echo"

import { createLookupFunction } from "./dns-resolver"

import os from "os"
const numCPUs = os.cpus().length

import Debug from "debug"
const debug = Debug("straightforward")

export interface StraightforwardOptions {
  /** @deprecated Use connectTimeout + readTimeout instead. Mapped to both for backward compatibility. Default: 60s */
  requestTimeout: number
  /** TCP connection establishment timeout (ms). Default: 10s */
  connectTimeout?: number
  /** Socket idle read timeout (ms). Resets on each data event. Default: 30s */
  readTimeout?: number
  /** Global source IP to bind for all outbound connections (multi-NIC servers). Overridden by per-rule localAddress from proxyRules. */
  localAddress?: string
  /** Global default DNS server for all outbound connections. Overridden by per-rule dns from proxyRules. */
  dns?: string
}

export type Request = http.IncomingMessage & RequestAdditions

export interface RequestLocals {
  isConnect: boolean
  urlParts: { host: string; port: number; path: string }
  upstream?: { host: string; port: number; auth?: { user: string; pass: string } }
  localAddress?: string
  /** DNS server from proxy rule. When undefined, OS default resolution is used. */
  dns?: string
}

export interface RequestAdditions {
  locals: RequestLocals
}

export type Response = http.ServerResponse<http.IncomingMessage> & {
  req: http.IncomingMessage
}

export type ProxyResponse = http.IncomingMessage

export type RequestContext<
  Locals extends { locals: Record<string, any> } = { locals: {} }
> = {
  req: Request & Locals
  res: Response
}

export type ResponseContext<
  Locals extends { locals: Record<string, any> } = { locals: {} }
> = {
  req: Request
  res: Response
  proxyRes: ProxyResponse
}

export type ConnectContext<
  Locals extends { locals: Record<string, any> } = { locals: {} }
> = {
  req: Request & Locals
  clientSocket: internal.Duplex
  head: Buffer
}

/** Typeguard to check if a context belongs to a http request (rather than a connect request) */
export function isRequest(ctx: any): ctx is RequestContext {
  return ctx.res !== undefined
}

/** Typeguard to check if a context belongs to a connect request (rather than a http request) */
export function isConnect(ctx: any): ctx is ConnectContext {
  return ctx.clientSocket !== undefined
}

export class Straightforward extends EventEmitter {
  public server: http.Server = http.createServer()
  public instanceId = Math.random()
  public opts: StraightforwardOptions

  public onRequest = new MiddlewareDispatcher<RequestContext<any>>()
  public onResponse = new MiddlewareDispatcher<ResponseContext<any>>()
  public onConnect = new MiddlewareDispatcher<ConnectContext<any>>()

  public stats = {
    onRequest: 0,
    onConnect: 0,
  }

  /** Reusable agent with keep-alive to avoid per-request TCP/TLS handshakes */
  #httpAgent: http.Agent

  constructor(opts: Partial<StraightforwardOptions> = {}) {
    super()
    this.opts = {
      requestTimeout: opts.requestTimeout || 60 * 1000, // 60s
    }

    // Fine-grained timeout defaults. connectTimeout / readTimeout take priority
    // over the legacy requestTimeout. If neither is set, fall back to requestTimeout
    // for backward compatibility.
    this.#connectTimeout =
      opts.connectTimeout ?? opts.requestTimeout ?? 10_000
    this.#readTimeout =
      opts.readTimeout ?? opts.requestTimeout ?? 30_000

    // When localAddress is set on the instance, all outbound connections
    // (both direct and via upstream) bind to this source IP.
    if (opts.localAddress) {
      this.#globalLocalAddress = opts.localAddress
    }

    // When dns is set on the instance, all outbound connections
    // (both direct and via upstream) resolve via this DNS server.
    if (opts.dns) {
      this.#globalDns = opts.dns
    }

    this.#httpAgent = new http.Agent({
      keepAlive: true,
      maxSockets: 50,
      maxFreeSockets: 10,
      keepAliveMsecs: 30000,
    })

    this.server.on("request", this._onRequest.bind(this))
    this.server.on("connect", this._onConnect.bind(this))
    this.server.on("error", this._onServerError.bind(this))
    this.server.on("clientError", this._onRequestError.bind(this))
    this.server.on("upgrade", this._onUpgrade.bind(this))

    debug("constructor: \t %o", {
      instanceId: this.instanceId,
      ...opts,
      pid: process.pid,
    })
  }

  public async cluster(port: number, count: number = numCPUs, host?: string) {
    if (cluster.isWorker) {
      return this.listen(port, host)
    }
    for (let i = 0; i < count; i++) {
      cluster.fork()
    }
  }

  public async listen(port: number = 8081, host: string = "0.0.0.0") {
    return new Promise((resolve) =>
      this.server.listen(port, host, () => {
        debug("listen: \t %o", { port, host, pid: process.pid })
        this.emit("listen", port, process.pid, this.server, host)
        resolve(this)
      })
    )
  }

  public close() {
    debug("close")
    try {
      this.server.close()
    } catch (err) {
      debug("close err", err)
    }
    this.#httpAgent.destroy()
    for (const agent of this.#upstreamAgents.values()) {
      agent.destroy()
    }
    this.#upstreamAgents.clear()
    this.emit("close")
  }

  private async _onRequest(req: Request, res: Response) {
    debug("onRequest: \t %s %s", req.method, req.url)
    if (!this._populateUrlParts(req)) {
      res.writeHead(400)
      return res.end("Invalid request")
    }
    this.stats.onRequest++
    await this.onRequest.dispatch({ req, res })

    if (!req.destroyed && !res.writableEnded) {
      this._proxyRequest(req, res)
    } else {
      debug("onRequest - ended: \t %s %s", req.method, req.url)
    }
  }

  /** Hop-by-hop headers that must not be forwarded */
  static #HOP_BY_HOP = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ])

  private _proxyRequest(req: Request, res: Response) {
    const upstream = req.locals.upstream
    const localAddr = req.locals.localAddress ?? this.#globalLocalAddress
    const dnsServer = req.locals.dns ?? this.#globalDns
    const lookup = dnsServer ? createLookupFunction(dnsServer) : undefined

    // Debug: print connection route
    if (upstream) {
      debug("proxyRequest: %s %s → upstream %s:%s (bind=%s, dns=%s)", req.method, req.url, upstream.host, upstream.port, localAddr || "OS default", dnsServer || "OS default")
    } else {
      debug("proxyRequest: %s %s → direct to %s:%s (bind=%s, dns=%s)", req.method, req.url, req.locals.urlParts.host, req.locals.urlParts.port, localAddr || "OS default", dnsServer || "OS default")
    }

    // Strip hop-by-hop headers before forwarding
    const headers: Record<string, string | string[] | undefined> = { ...req.headers }
    for (const key of Object.keys(headers)) {
      if (Straightforward.#HOP_BY_HOP.has(key.toLowerCase())) {
        delete headers[key]
      }
    }

    if (upstream) {
      return this._proxyRequestViaUpstream(req, res, upstream, localAddr, headers)
    }

    // Connect timeout: manually track since http.request doesn't expose it
    const connectTimer = setTimeout(() => {
      debug("proxyReq: connect timeout (%dms)", this.#connectTimeout)
      proxyReq.destroy(new Error("Connect timeout"))
    }, this.#connectTimeout)

    // https://nodejs.org/api/http.html#http_http_request_options_callback
    const proxyReq = http.request({
      method: req.method,
      headers,
      agent: this.#httpAgent,
      ...(localAddr && localAddr !== "0.0.0.0" ? { localAddress: localAddr } : {}),
      ...(lookup ? { lookup } : {}),
      ...req.locals.urlParts,
    })

    req.on("destroyed", () => {
      debug("proxyReq - destroyed: \t %s %s", req.method, req.url)
      proxyReq.destroy()
    })

    proxyReq.on("error", (err) => {
      debug("proxyReq - error: \t %s %s", req.method, req.url, err)
      req.destroy(err)
    })

    proxyReq.on("response", (proxyRes) => this._onResponse(req, res, proxyRes))

    proxyReq.on("socket", (socket) => {
      clearTimeout(connectTimer)
      socket.setTimeout(this.#readTimeout, () => {
        debug("proxyReq: read timeout (%dms)", this.#readTimeout)
        proxyReq.destroy()
      })
      if (req.destroyed) {
        return proxyReq.destroy()
      }
      req.pipe(proxyReq).on("error", (e) => {
        debug("req.pipe(proxyReq) has error: " + e.message)
      })
    })
  }

  /** Proxy HTTP request through an upstream forward proxy */
  private _proxyRequestViaUpstream(
    req: Request,
    res: Response,
    upstream: { host: string; port: number; auth?: { user: string; pass: string } },
    localAddr: string | undefined,
    headers: Record<string, string | string[] | undefined>
  ) {
    // Connect to the upstream proxy then issue the request through it.
    // Use an agent keyed per-upstream so sockets are reused.
    const agentKey = `${upstream.host}:${upstream.port}`
    let agent = this.#upstreamAgents.get(agentKey)
    if (!agent) {
      agent = new http.Agent({
        keepAlive: true,
        maxSockets: 50,
        maxFreeSockets: 10,
        keepAliveMsecs: 30000,
      })
      this.#upstreamAgents.set(agentKey, agent)
    }

    if (upstream.auth) {
      headers["proxy-authorization"] =
        "Basic " +
        Buffer.from(`${upstream.auth.user}:${upstream.auth.pass}`).toString("base64")
    }

    const dnsServer = req.locals.dns ?? this.#globalDns
    const lookup = dnsServer ? createLookupFunction(dnsServer) : undefined

    const connectTimer = setTimeout(() => {
      debug("proxyReqUpstream: connect timeout (%dms)", this.#connectTimeout)
      proxyReq.destroy(new Error("Connect timeout"))
    }, this.#connectTimeout)

    const proxyReq = http.request({
      method: req.method,
      host: upstream.host,
      port: upstream.port,
      path: req.url,
      headers,
      agent,
      ...(localAddr && localAddr !== "0.0.0.0" ? { localAddress: localAddr } : {}),
      ...(lookup ? { lookup } : {}),
      setHost: false, // preserve original Host header
    })

    req.on("destroyed", () => {
      debug("proxyReqUpstream - destroyed: \t %s %s", req.method, req.url)
      proxyReq.destroy()
    })

    proxyReq.on("error", (err) => {
      debug("proxyReqUpstream - error: \t %s %s", req.method, req.url, err)
      req.destroy(err)
    })

    proxyReq.on("response", (proxyRes) => this._onResponse(req, res, proxyRes))

    proxyReq.on("socket", (socket) => {
      clearTimeout(connectTimer)
      socket.setTimeout(this.#readTimeout, () => {
        debug("proxyReqUpstream: read timeout (%dms)", this.#readTimeout)
        proxyReq.destroy()
      })
      if (req.destroyed) {
        return proxyReq.destroy()
      }
      req.pipe(proxyReq).on("error", (e) => {
        debug("req.pipe(proxyReqUpstream) has error: " + e.message)
      })
    })
  }

  /** Per-upstream agent cache for connection reuse */
  #upstreamAgents: Map<string, http.Agent> = new Map()

  /** Source IP to bind for all outbound connections when no per-rule override */
  #globalLocalAddress: string | undefined

  /** DNS server to use for all outbound connections when no per-rule override */
  #globalDns: string | undefined

  /** TCP connection establishment timeout (ms) */
  #connectTimeout: number

  /** Socket idle read timeout (ms) */
  #readTimeout: number

  private async _onResponse(
    req: Request,
    res: Response,
    proxyRes: ProxyResponse
  ) {
    debug("onResponse: \t %s %s", req.method, req.url)
    proxyRes.on("error", (err) => debug("proxyRes: onError: %o", err))

    await this.onResponse.dispatch({ req, res, proxyRes })

    if (!res.headersSent) {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers)
    }
    if (!res.writableEnded) {
      proxyRes.pipe(res).on("error", (e) => {
        debug("proxyRes.pipe(res) has error: " + e.message)
      })
    }
  }

  private async _onConnect(
    req: Request,
    clientSocket: internal.Duplex,
    head: Buffer
  ) {
    debug("onConnect: \t %s %s", req.method, req.url)
    if (!this._populateUrlParts(req)) {
      clientSocket.end(
        "HTTP/1.1 400 Bad Request\r\n" +
          "Content-Type: text/plain\r\n" +
          "\r\n" +
          "Invalid request"
      )
      return
    }
    this.stats.onConnect++
    await this.onConnect.dispatch({ req, clientSocket, head })
    if (!req.destroyed && clientSocket.writable) {
      this._proxyConnect(req, clientSocket, head)
    }
  }

  private _proxyConnect(
    req: Request,
    clientSocket: internal.Duplex,
    head: Buffer
  ) {
    const upstream = req.locals.upstream
    // Per-rule localAddress takes priority over global; fallback to instance-level
    const localAddr = req.locals.localAddress ?? this.#globalLocalAddress
    const dnsServer = req.locals.dns ?? this.#globalDns
    const lookup = dnsServer ? createLookupFunction(dnsServer) : undefined

    // Debug: print connection route
    if (upstream) {
      debug("proxyConnect: %s %s → upstream %s:%s (bind=%s, dns=%s)", req.method, req.url, upstream.host, upstream.port, localAddr || "OS default", dnsServer || "OS default")
    } else {
      const target = req.locals.urlParts
      debug("proxyConnect: %s %s → direct to %s:%s (bind=%s, dns=%s)", req.method, req.url, target.host, target.port, localAddr || "OS default", dnsServer || "OS default")
    }

    if (upstream) {
      return this._proxyConnectViaUpstream(
        req,
        clientSocket,
        head,
        upstream,
        localAddr
      )
    }

    const connectOpts: net.NetConnectOpts = {
      host: req.locals.urlParts.host,
      port: req.locals.urlParts.port,
    }
    if (localAddr && localAddr !== "0.0.0.0") {
      connectOpts.localAddress = localAddr
    }
    if (lookup) {
      connectOpts.lookup = lookup
    }

    const connectTimer = setTimeout(() => {
      debug("proxyConnect: connect timeout (%dms)", this.#connectTimeout)
      serverSocket.destroy(new Error("Connect timeout"))
    }, this.#connectTimeout)

    const serverSocket = net.connect(connectOpts, () => {
        clearTimeout(connectTimer)
        ;(serverSocket as net.Socket).setNoDelay(true)
        ;(clientSocket as net.Socket).setNoDelay(true)

        ;(serverSocket as net.Socket).setTimeout(this.#readTimeout, () => {
          debug("proxyConnect: read timeout (%dms)", this.#readTimeout)
          serverSocket.destroy()
        })

        clientSocket.write(
          "HTTP/1.1 200 Connection Established\r\n" +
            "Proxy-agent: straightforward\r\n" +
            "\r\n"
        )

        serverSocket.write(head)
        if (!req.destroyed && clientSocket.writable) {
          serverSocket.pipe(clientSocket).on("error", (e) => {
            debug("serverSocket.pipe(clientSocket) has error: " + e.message)
          })
          clientSocket.pipe(serverSocket).on("error", (e) => {
            debug("clientSocket.pipe(serverSocket) has error: " + e.message)
          })
        }
      }
    )

    serverSocket.on("error", (err) => {
      clearTimeout(connectTimer)
      debug("serverSocket error", err)
      if (clientSocket.writable && !clientSocket.destroyed) {
        clientSocket.end(
          "HTTP/1.1 502 Bad Gateway\r\n" +
            "Content-Type: text/plain\r\n" +
            "\r\n" +
            "Upstream connection failed: " +
            (err as Error).message
        )
      }
      clientSocket.destroy()
    })

    clientSocket.on("destroyed", () => {
      debug("clientSocket - destroyed: \t %s %s", req.method, req.url)
      serverSocket.destroy()
    })
  }

  /** Proxy CONNECT through an upstream forward proxy */
  private _proxyConnectViaUpstream(
    req: Request,
    clientSocket: internal.Duplex,
    head: Buffer,
    upstream: { host: string; port: number; auth?: { user: string; pass: string } },
    localAddr: string | undefined
  ) {
    const dnsServer = req.locals.dns ?? this.#globalDns
    const lookup = dnsServer ? createLookupFunction(dnsServer) : undefined

    const connectOpts: net.NetConnectOpts = {
      host: upstream.host,
      port: upstream.port,
    }
    if (localAddr && localAddr !== "0.0.0.0") {
      connectOpts.localAddress = localAddr
    }
    if (lookup) {
      connectOpts.lookup = lookup
    }

    debug("proxyConnectViaUpstream: connecting to upstream %s:%s (bind=%s, dns=%s)", upstream.host, upstream.port, localAddr || "OS default", dnsServer || "OS default")

    const connectTimer = setTimeout(() => {
      debug("proxyConnectViaUpstream: connect timeout (%dms)", this.#connectTimeout)
      upstreamSocket.destroy(new Error("Connect timeout"))
    }, this.#connectTimeout)

    const upstreamSocket = net.connect(connectOpts, () => {
      clearTimeout(connectTimer)
      ;(upstreamSocket as net.Socket).setNoDelay(true)
      ;(clientSocket as net.Socket).setNoDelay(true)

      ;(upstreamSocket as net.Socket).setTimeout(this.#readTimeout, () => {
        debug("proxyConnectViaUpstream: read timeout (%dms)", this.#readTimeout)
        upstreamSocket.destroy()
      })

      // Build CONNECT request to upstream
      let connectReq = `CONNECT ${req.locals.urlParts.host}:${req.locals.urlParts.port} HTTP/1.1\r\n`
      connectReq += `Host: ${req.locals.urlParts.host}:${req.locals.urlParts.port}\r\n`
      if (upstream.auth) {
        connectReq +=
          "Proxy-Authorization: Basic " +
          Buffer.from(`${upstream.auth.user}:${upstream.auth.pass}`).toString("base64") +
          "\r\n"
      }
      connectReq += "\r\n"

      debug("proxyConnectViaUpstream: connected, sending CONNECT request")
      upstreamSocket.write(connectReq)
    })

    // Already consumed the initial TLS ClientHello from client (head)
    debug("proxyConnectViaUpstream: head buffer length = %d", head.length)

    // Read one response from upstream — "HTTP/1.1 200 Connection Established"
    let buffer = ""
    upstreamSocket.on("data", (chunk: Buffer) => {
      debug("proxyConnectViaUpstream: received data chunk from upstream (%d bytes): %s", chunk.length, chunk.toString().substring(0, 200))
      buffer += chunk.toString()
      if (buffer.includes("\r\n\r\n")) {
        const statusLine = buffer.split("\r\n")[0]
        debug("proxyConnectViaUpstream: upstream response status = %s", statusLine)

        // After receiving 200, any remaining data in this or subsequent chunks
        // beyond the headers is actually TLS data from the target that the
        // upstream proxy prematurely forwarded — save and replay to client.
        const headerEnd = buffer.indexOf("\r\n\r\n") + 4
        const leftover = headerEnd < buffer.length ? buffer.slice(headerEnd) : ""

        if (statusLine && statusLine.startsWith("HTTP/1.1 200")) {
          // Remove HTTP header parser BEFORE setting up pipes,
          // otherwise removeAllListeners would kill the pipe's data handler.
          upstreamSocket.removeAllListeners("data")

          // Forward success to client
          clientSocket.write(
            "HTTP/1.1 200 Connection Established\r\n" +
              "Proxy-agent: straightforward\r\n" +
              "\r\n"
          )
          // Forward TLS ClientHello (head) consumed during CONNECT, then pipe
          upstreamSocket.write(head)
          debug("proxyConnectViaUpstream: establishing bidirectional pipe")
          upstreamSocket.pipe(clientSocket).on("error", (e: Error) => {
            debug("upstreamSocket.pipe(clientSocket) has error: " + e.message)
          })
          clientSocket.pipe(upstreamSocket).on("error", (e: Error) => {
            debug("clientSocket.pipe(upstreamSocket) has error: " + e.message)
          })
          // If there's leftover TLS data after headers, forward to client
          if (leftover) {
            debug("proxyConnectViaUpstream: forwarding leftover TLS data to client (%d bytes)", leftover.length)
            clientSocket.write(leftover)
          }
        } else {
          // Upstream rejected the CONNECT
          debug("upstream CONNECT rejected: %s", statusLine)
          clientSocket.end(buffer)
          upstreamSocket.removeAllListeners("data")
        }
      }
    })

    upstreamSocket.on("connect", () => {
      debug("proxyConnectViaUpstream: upstream socket connect event fired")
    })

    upstreamSocket.on("error", (err) => {
      clearTimeout(connectTimer)
      debug("upstreamSocket error", err)
      if (clientSocket.writable && !clientSocket.destroyed) {
        clientSocket.end(
          "HTTP/1.1 502 Bad Gateway\r\n" +
            "Content-Type: text/plain\r\n" +
            "\r\n" +
            "Upstream connection failed: " +
            (err as Error).message
        )
      }
      clientSocket.destroy()
    })

    clientSocket.on("destroyed", () => {
      debug("clientSocket - destroyed: \t %s %s", req.method, req.url)
      upstreamSocket.destroy()
    })
  }

  private _onUpgrade(
    req: Request,
    clientSocket: internal.Duplex,
    head: Buffer
  ) {
    debug("onUpgrade: \t %s %s", req.headers.upgrade, req.url)
    debug("Unencrypted websockets are not supported.")
    this.emit("upgrade", req, clientSocket, head)
    clientSocket.end()
  }

  private _onRequestError(err: Error, socket: internal.Duplex) {
    // Work with err.code here, e.g ECONNRESET
    debug("onRequestError: \t %o", err)
    this.emit("requestError", err, socket)
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n")
  }

  private _onServerError(err: Error) {
    debug("onServerError: \t %o", err)
    this.emit("serverError", err)
  }

  private _onUncaughtException(err: Error) {
    debug("onUncaughtException: \t %o", err)
    this.emit("uncaughtException", err)
  }

  private _populateUrlParts(req: Request): boolean {
    if (!req.method || !req.url) {
      debug("_populateUrlParts: invalid request, missing method or url")
      return false
    }
    req.locals = {} as Request["locals"]
    req.locals.isConnect = req.method.toLowerCase() === "connect"
    if (req.locals.isConnect) {
      // CONNECT URL format: hostname:port, with optional brackets for IPv6: [::1]:443
      const match = req.url.match(/^\[(.+)\]:(\d+)$|^([^:]+):(\d+)$/)
      if (match) {
        const hostname = match[1] || match[3]
        const port = parseInt(match[2] || match[4])
        req.locals.urlParts = { host: hostname, port, path: "" }
      } else {
        debug("_populateUrlParts: unparseable CONNECT url: %s", req.url)
        return false
      }
    } else {
      const urlParts = new URL(req.url)
      req.locals.urlParts = {
        host: urlParts.host,
        port: parseInt(urlParts.port || "80"),
        path: urlParts.pathname + urlParts.search,
      }
    }
    return true
  }
}
