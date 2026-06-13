import http from "http"
import net from "net"
import cluster from "cluster"
import { EventEmitter } from "events"
import internal from "stream"

import { MiddlewareDispatcher } from "./MiddlewareDispatcher"

import { auth } from "./middleware/auth"
import { echo } from "./middleware/echo"

import os from "os"
const numCPUs = os.cpus().length

import Debug from "debug"
const debug = Debug("straightforward")

export interface StraightforwardOptions {
  requestTimeout: number
}

export type Request = http.IncomingMessage & RequestAdditions

export interface RequestLocals {
  isConnect: boolean
  urlParts: { host: string; port: number; path: string }
  upstream?: { host: string; port: number; auth?: { user: string; pass: string } }
  localAddress?: string
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
    // debug("proxyReq: \t %s %s", req.method, req.url, req.locals)

    // Strip hop-by-hop headers before forwarding
    const headers: Record<string, string | string[] | undefined> = { ...req.headers }
    for (const key of Object.keys(headers)) {
      if (Straightforward.#HOP_BY_HOP.has(key.toLowerCase())) {
        delete headers[key]
      }
    }

    const upstream = req.locals.upstream
    const localAddr = req.locals.localAddress

    if (upstream) {
      return this._proxyRequestViaUpstream(req, res, upstream, localAddr, headers)
    }

    // https://nodejs.org/api/http.html#http_http_request_options_callback
    const proxyReq = http.request({
      method: req.method,
      headers,
      agent: this.#httpAgent,
      ...(localAddr && localAddr !== "0.0.0.0" ? { localAddress: localAddr } : {}),
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
      socket.setTimeout(this.opts.requestTimeout, () => {
        debug("proxyReq: onTimeout", this.opts.requestTimeout)
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

    const proxyReq = http.request({
      method: req.method,
      host: upstream.host,
      port: upstream.port,
      path: req.url,
      headers,
      agent,
      ...(localAddr && localAddr !== "0.0.0.0" ? { localAddress: localAddr } : {}),
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
      socket.setTimeout(this.opts.requestTimeout, () => {
        debug("proxyReqUpstream: onTimeout", this.opts.requestTimeout)
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
    const localAddr = req.locals.localAddress

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

    const serverSocket = net.connect(connectOpts, () => {
        ;(serverSocket as net.Socket).setNoDelay(true)
        ;(clientSocket as net.Socket).setNoDelay(true)

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
    const connectOpts: net.NetConnectOpts = {
      host: upstream.host,
      port: upstream.port,
    }
    if (localAddr && localAddr !== "0.0.0.0") {
      connectOpts.localAddress = localAddr
    }

    const upstreamSocket = net.connect(connectOpts, () => {
      ;(upstreamSocket as net.Socket).setNoDelay(true)
      ;(clientSocket as net.Socket).setNoDelay(true)

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

      upstreamSocket.write(connectReq)
    })

    // Read one response from upstream — "HTTP/1.1 200 Connection Established"
    let buffer = ""
    upstreamSocket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString()
      if (buffer.includes("\r\n\r\n")) {
        const statusLine = buffer.split("\r\n")[0]
        if (statusLine && statusLine.startsWith("HTTP/1.1 200")) {
          // Forward success to client
          clientSocket.write(
            "HTTP/1.1 200 Connection Established\r\n" +
              "Proxy-agent: straightforward\r\n" +
              "\r\n"
          )
          // Bidirectional pipe
          upstreamSocket.pipe(clientSocket).on("error", (e: Error) => {
            debug("upstreamSocket.pipe(clientSocket) has error: " + e.message)
          })
          clientSocket.pipe(upstreamSocket).on("error", (e: Error) => {
            debug("clientSocket.pipe(upstreamSocket) has error: " + e.message)
          })
        } else {
          // Upstream rejected the CONNECT
          debug("upstream CONNECT rejected: %s", statusLine)
          clientSocket.end(buffer)
        }
        upstreamSocket.removeAllListeners("data")
      }
    })

    upstreamSocket.on("error", (err) => {
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
