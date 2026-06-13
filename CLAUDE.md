# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

`straightforward` is a minimal (~200 SLOC) forward proxy written in TypeScript. It supports HTTP, HTTPS (CONNECT tunneling), and WebSocket (wss) proxying. All requests/responses are streamed by default. It has only two runtime dependencies: `debug` for logging and `yargs` for the CLI.

## Commands

```bash
# Build (CJS + ESM + type declarations via tsup)
npm run build

# Run all tests (AVA, verbose)
npm test

# Run a single test file
npx ava -v test/basics.test.ts

# Run a specific test by title
npx ava -v -m "can proxy basic http requests"

# TypeScript REPL with esbuild-register
npm run ts

# Start the proxy CLI (after building)
node cli.js --port 9191
```

## Architecture

### Core class: `Straightforward` (`src/Straightforward.ts`)

The `Straightforward` class extends `EventEmitter` and wraps a `http.createServer()`. It exposes three middleware dispatchers as public properties:

- **`onRequest`** — middleware chain for HTTP requests. The built-in default handler (`_proxyRequest`) streams the request to the target server via `http.request()` and pipes the response back.
- **`onResponse`** — middleware chain triggered when the upstream response arrives, before piping it to the client. Receives `{ req, res, proxyRes }`.
- **`onConnect`** — middleware chain for HTTPS/WSS CONNECT requests. The built-in default handler (`_proxyConnect`) opens a raw TCP socket to the target (`net.connect`) and bidirectionally pipes between client and server.

The flow: incoming request → parse URL parts → dispatch to middleware chain → if the request wasn't ended by middleware, run the built-in proxy handler.

Key methods: `listen(port, host?)`, `close()`, `cluster(port, count?, host?)`.

### Middleware system (`src/MiddlewareDispatcher.ts`)

Middleware functions have the signature `(context, next) => void | Promise<void>`. The `dispatch` method runs the chain in order — each middleware receives the context and a `next()` callback that proceeds to the next middleware. If a middleware doesn't call `next()`, the chain stops (used by `auth` to block unauthenticated requests and `echo` to short-circuit with a mock response).

### Built-in middleware (`src/middleware/`)

- **`auth`** — supports static (`{ user, pass }`) and dynamic (`{ dynamic: true }`) authentication. In dynamic mode it parses the `Proxy-Authorization` header and populates `ctx.req.locals.proxyUser`/`proxyPass` without validating. Works on both `onRequest` and `onConnect`.
- **`echo`** — short-circuits HTTP requests by returning request info as JSON. For `onRequest` only.

### CLI (`cli.js`)

Plain JS entry point (not TypeScript). Uses `yargs` to parse options, then instantiates `Straightforward`, wires up auth/echo middleware based on flags, and calls `sf.listen()` or `sf.cluster()`.

### Types

Request URL parts (`host`, `port`, `path`) are parsed in `_populateUrlParts()` and stored on `req.locals`. For CONNECT requests the URL has the format `hostname:port`; for regular HTTP requests it's a full URL.

## Tests

Tests use AVA with `esbuild-register` for TypeScript. Each test file increments a base port per-test to avoid conflicts. The test utilities (`test/utils.ts`) create proxy agents via `hpagent` (for HTTPS/CONNECT) and `proxy-agent` (for HTTP requests).

Test files:
- `test/basics.test.ts` — server start/stop, HTTP proxying, HTTPS proxying, middleware triggering
- `test/auth.test.ts` — dynamic authentication + echo integration
- `test/echo.test.ts` — echo middleware

## Code conventions

- TypeScript strict mode, target ES2020, output to `dist/`
- Prettier with `semi: false`, 2-space indentation
- EditorConfig enforces UTF-8, LF line endings
- Node.js `debug` module with namespace `straightforward` — enable via `DEBUG=straightforward`
