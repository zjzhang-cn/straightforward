import test from "ava"
import net from "net"
import { socks5Connect } from "../src/socks5"

// ============================================================
// SOCKS5 Test Server
// ============================================================

interface TestSocks5Server {
  port: number
  close(): void
}

/**
 * Create a minimal SOCKS5 test server.
 *
 * Uses ordered one-time data listeners instead of a single onData,
 * so that after the CONNECT handshake completes, data flows freely.
 */
function createTestSocks5Server(
  opts: { acceptAuth?: boolean; failAuth?: boolean; rejectConnect?: boolean } = {}
): Promise<TestSocks5Server> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      // Step 1: Read greeting
      socket.once("data", (buf: Buffer) => {
        if (buf[0] !== 0x05) {
          socket.write(Buffer.from([0x05, 0xff]))
          return
        }

        if (opts.acceptAuth) {
          socket.write(Buffer.from([0x05, 0x02]))
          // Step 2: Read auth sub-negotiation
          socket.once("data", (authBuf: Buffer) => {
            if (opts.failAuth) {
              socket.write(Buffer.from([0x01, 0x01]))
              return
            }
            socket.write(Buffer.from([0x01, 0x00]))
            // Step 3: Read CONNECT
            socket.once("data", handleConnect)
          })
        } else {
          socket.write(Buffer.from([0x05, 0x00]))
          // Step 2: Read CONNECT
          socket.once("data", handleConnect)
        }
      })

      function handleConnect(buf: Buffer) {
        if (buf[0] !== 0x05 || buf[1] !== 0x01) {
          socket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
          return
        }

        if (opts.rejectConnect) {
          socket.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
          return
        }

        // Success
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))

        // Now echo any data sent through the tunnel
        socket.on("data", (data: Buffer) => {
          socket.write(data)
        })
      }
    })

    server.listen(0, () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        close: () => server.close(),
      })
    })
  })
}

// ============================================================
// Tests
// ============================================================

test("SOCKS5: basic handshake succeeds", async (t) => {
  const srv = await createTestSocks5Server()
  t.teardown(() => srv.close())

  const socket = net.connect(srv.port)
  await new Promise<void>((resolve) => socket.on("connect", resolve))

  await socks5Connect({ socket, target: { host: "example.com", port: 80 } })

  t.true(socket.writable)
  t.false(socket.destroyed)
  socket.end()
})

test("SOCKS5: can send data through tunnel", async (t) => {
  const srv = await createTestSocks5Server()
  t.teardown(() => srv.close())

  const socket = net.connect(srv.port)
  await new Promise<void>((resolve) => socket.on("connect", resolve))

  await socks5Connect({ socket, target: { host: "example.com", port: 80 } })

  const result = await new Promise<string>((resolve, reject) => {
    socket.on("data", (chunk) => resolve(chunk.toString()))
    socket.write(Buffer.from("HELLO"))
    setTimeout(() => reject(new Error("No response")), 1000)
  })

  t.is(result, "HELLO")
  socket.end()
})

test("SOCKS5: auth with user/pass succeeds", async (t) => {
  const srv = await createTestSocks5Server({ acceptAuth: true })
  t.teardown(() => srv.close())

  const socket = net.connect(srv.port)
  await new Promise<void>((resolve) => socket.on("connect", resolve))

  await socks5Connect({
    socket,
    target: { host: "example.com", port: 80 },
    auth: { user: "testuser", pass: "testpass" },
  })

  t.true(socket.writable)
  socket.end()
})

test("SOCKS5: auth failure rejects", async (t) => {
  const srv = await createTestSocks5Server({ acceptAuth: true, failAuth: true })
  t.teardown(() => srv.close())

  const socket = net.connect(srv.port)
  await new Promise<void>((resolve) => socket.on("connect", resolve))

  await t.throwsAsync(
    socks5Connect({
      socket,
      target: { host: "example.com", port: 80 },
      auth: { user: "baduser", pass: "badpass" },
    }),
    { message: /authentication failed/ }
  )
  socket.end()
})

test("SOCKS5: connection rejected", async (t) => {
  const srv = await createTestSocks5Server({ rejectConnect: true })
  t.teardown(() => srv.close())

  const socket = net.connect(srv.port)
  await new Promise<void>((resolve) => socket.on("connect", resolve))

  await t.throwsAsync(
    socks5Connect({ socket, target: { host: "example.com", port: 80 } }),
    { message: /CONNECT rejected/ }
  )
  socket.end()
})

test("SOCKS5: target with IPv4 address", async (t) => {
  const srv = await createTestSocks5Server()
  t.teardown(() => srv.close())

  const socket = net.connect(srv.port)
  await new Promise<void>((resolve) => socket.on("connect", resolve))

  await socks5Connect({ socket, target: { host: "93.184.216.34", port: 443 } })

  t.true(socket.writable)
  socket.end()
})

test("SOCKS5: target with IPv6 address", async (t) => {
  const srv = await createTestSocks5Server()
  t.teardown(() => srv.close())

  const socket = net.connect(srv.port)
  await new Promise<void>((resolve) => socket.on("connect", resolve))

  await socks5Connect({
    socket,
    target: { host: "2606:2800:220:1:248:1893:25c8:1946", port: 443 },
  })

  t.true(socket.writable)
  socket.end()
})

test("SOCKS5: handshake timeout rejects", async (t) => {
  // Connect to a socket that never responds to the greeting
  const slowServer = net.createServer(() => {
    // Don't send any data
  })
  await new Promise<void>((resolve) => slowServer.listen(0, resolve))
  const port = (slowServer.address() as net.AddressInfo).port

  const socket = net.connect(port)
  await new Promise<void>((resolve) => socket.on("connect", resolve))

  await t.throwsAsync(
    socks5Connect({ socket, target: { host: "example.com", port: 80 }, timeout: 200 }),
    { message: /timeout/ }
  )

  socket.destroy()
  slowServer.close()
})

// ============================================================
// Integration: tunnel data flow
// ============================================================

test("SOCKS5: HTTP request through tunnel echoes back", async (t) => {
  const srv = await createTestSocks5Server()
  t.teardown(() => srv.close())

  const socket = net.connect(srv.port)
  await new Promise<void>((resolve) => socket.on("connect", resolve))

  await socks5Connect({ socket, target: { host: "example.com", port: 80 } })

  const httpReq = "GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n"
  socket.write(httpReq)

  const result = await new Promise<string>((resolve, reject) => {
    socket.once("data", (data) => resolve(data.toString()))
    socket.write(httpReq)
    setTimeout(() => reject(new Error("No response")), 1000)
  })

  t.true(result.includes("GET"))
  t.true(result.includes("example.com"))
  socket.destroy()
})
