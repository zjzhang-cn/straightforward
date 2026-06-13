# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

`straightforward` is a minimal (~200 SLOC) forward proxy written in TypeScript. It supports HTTP, HTTPS (CONNECT tunneling), and WebSocket (wss) proxying. All requests/responses are streamed by default. It has only two runtime dependencies: `debug` for logging and `yargs` for the CLI.

## Commands

```bash
# Build (CJS + ESM + type declarations via tsup)
npm run build

# Bundle CLI into single JS file (for SEA)
npm run build:sea:bundle

# Build standalone executable (Node.js SEA — requires static Node binary, not Homebrew's)
npm run build:sea

# Run all tests (AVA, verbose)
npm test

# Run a single test file
npx ava -v test/basics.test.ts

# Run a specific test by title
npx ava -v -m "can proxy basic http requests"

# TypeScript REPL with esbuild-register
npm run ts

# Start the proxy CLI (after building)
node cli.js --port 8081

# Start the standalone executable
./dist/straightforward --port 8081
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
- **`proxyRules`** — unified routing middleware. Reads a rule table (match glob → upstream proxy + source IP), sets `req.locals.upstream` and `req.locals.localAddress`. Supports `type: "http" | "connect"` filtering, wildcard fallback with `default` section. Works on both `onRequest` and `onConnect`. The core (`Straightforward._proxyRequest` / `_proxyConnect`) reads these locals to route through an upstream proxy or bind specific local addresses.

### Rule-set module (`src/rule-set/`)

Zero-dependency domain matching engine for `geosite:` prefixed rules in proxyRules:

- **`DomainTrie`** (`domain-trie.ts`) — reversed-domain suffix trie. Inserts domain rules by reversing their labels (e.g. `google.com` → `com.google`), then matches hostnames by walking the trie. O(domain-length) match time. Supports suffix match semantics (same as v2ray `Domain` type): `google.com` matches `www.google.com` but not `notgoogle.com`.
- **`resolver.ts`** — `createRuleSetResolver(rulesDir)` scans a directory of `.txt` files, loads each as a named tag (e.g. `gfw.txt` → tag `"gfw"`), and provides `match(tag, hostname)` for efficient domain lookup. Also supports direct file-path references (`geosite:./custom.txt`).
- **`index.ts`** — barrel export as `ruleSet` namespace.

Usage: download `gfw.txt`, `direct-list.txt`, etc. from [loyalsoldier/v2ray-rules-dat releases](https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest), then reference them in proxyRules:

```json
{
  "rules": [
    { "match": "geosite:gfw", "upstream": { "host": "us-proxy", "port": 8080 } },
    { "match": "*.internal.corp", "upstream": null },
    { "match": "*", "upstream": { "host": "default-proxy", "port": 3128 } }
  ]
}
```

CLI: `straightforward --rules-dir ./rules/ --rules proxyrules.json`

Auto-download rule files from the latest release:
```bash
# Download default set (gfw, direct-list, proxy-list)
straightforward --rules-dir ./rules/ --rules-download

# Download specific tags
straightforward --rules-dir ./rules/ --rules-download gfw,apple-cn,google-cn

# Force re-download even if local files exist
straightforward --rules-dir ./rules/ --rules-download --rules-download-force

# Combine with rules config
straightforward --rules-dir ./rules/ --rules-download --rules proxyrules.json
```
- **`downloader.ts`** — zero-dependency downloader using Node.js built-in `https`. Fetches latest release tag from GitHub API, downloads .txt rule files atomically (temp file → rename). Skips existing files unless `force` is true.

### CLI (`cli.js`)

Plain JS entry point (not TypeScript). Uses `yargs` to parse options, then instantiates `Straightforward`, wires up auth/echo/proxyRules middleware based on flags, and calls `sf.listen()` or `sf.cluster()`.

Three-tier config:
1. Zero-config: `straightforward` → direct connect, OS picks source IP
2. CLI-only: `--upstream-host/port` + `--local-address` → single global rule
3. Full: `--rules proxyrules.json` → per-domain routing with upstream + source IP

### Types

Request URL parts (`host`, `port`, `path`) are parsed in `_populateUrlParts()` and stored on `req.locals`. For CONNECT requests the URL has the format `hostname:port`; for regular HTTP requests it's a full URL.

## Tests

Tests use AVA with `esbuild-register` for TypeScript. Each test file increments a base port per-test to avoid conflicts. The test utilities (`test/utils.ts`) create proxy agents via `hpagent` (for HTTPS/CONNECT) and `proxy-agent` (for HTTP requests).

Test files:
- `test/basics.test.ts` — server start/stop, HTTP proxying, HTTPS proxying, middleware triggering
- `test/auth.test.ts` — dynamic authentication + echo integration
- `test/echo.test.ts` — echo middleware
- `test/proxyRules.test.ts` — proxyRules unit tests (glob matching, type filtering, defaults, rule ordering, geosite: prefix)
- `test/comprehensive.test.ts` — P0 fixes verification + edge cases (stress test is `test/stress.ts`)
- `test/rule-set/domain-trie.test.ts` — DomainTrie unit tests (exact, suffix, dedup, case-insensitive, 10k volume)
- `test/rule-set/resolver.test.ts` — RuleSetResolver unit tests (file loading, matching, path references, large sets)

## Code conventions

- TypeScript strict mode, target ES2020, output to `dist/`
- Prettier with `semi: false`, 2-space indentation
- EditorConfig enforces UTF-8, LF line endings
- Node.js `debug` module with namespace `straightforward` — enable via `DEBUG=straightforward`

## Performance

| Optimization | Effect |
|---|---|
| TCP_NODELAY on CONNECT sockets | Eliminates ~40ms Nagle-algorithm delay per packet |
| HTTP Keep-Alive Agent (`#httpAgent`) | Reuses upstream TCP+TLS connections, 5-10x throughput gain |
| Hop-by-hop header stripping | Removes `Connection`, `Proxy-Authorization`, `Transfer-Encoding`, etc. before forwarding — prevents connection misrouting |
| Upstream proxy agent reuse (`#upstreamAgents`) | Per-upstream agent cache; reuses connections to the same upstream proxy |

Stress test: `node --expose-gc -r esbuild-register test/stress.ts` (60s, 64 concurrent, httpbin.org).

## Node.js SEA (standalone executable)

`sea-config.json` defines the SEA build. The output is `dist/straightforward` — a self-contained ~126MB binary that runs without Node.js installed.

系统已安装静态链接的 Node.js v25.9.0（`~/.local/node-v25.9.0/`），`npm run build:sea` 可直接执行。

Build process:
1. `npm run build:sea:bundle` — esbuild bundles `cli.js` + deps into `dist/sea-bundle.js`
2. `npm run build:sea` — alias for `node --build-sea=sea-config.json`，生成 `dist/straightforward`
3. `codesign --sign - dist/straightforward` — ad-hoc sign for macOS

## 交互规律

- 每次完成我交给你的任务后, 你都要通知我说爸爸工作完成了
