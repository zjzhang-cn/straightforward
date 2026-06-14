# Straightforward 改进计划

> 最后更新：2026-06-14

## 已完成

### P0 — Bug 修复 (5/5)

- [x] **P0-1**: 将 `server` 事件监听器移至构造函数，移除 `process.on("uncaughtException")` — commit `09d7d6d`
- [x] **P0-2**: `_populateUrlParts` 不再 `throw`，改为返回 `boolean`，调用方返回 400/502 — commit `80d9c45`
- [x] **P0-3**: CONNECT URL 解析支持 IPv6 地址 (`[::1]:443`) — commit `0f6c85d`
- [x] **P0-4**: `net.connect` error 处理器提前注册，连接失败返回 502 Bad Gateway — commit `6f8c249`

### 性能优化 (3/3)

- [x] **TCP_NODELAY**: CONNECT 隧道两端开启 `setNoDelay(true)`，消除 Nagle 算法 40ms+ 延迟 — commit `e8365ea`
- [x] **HTTP Keep-Alive Agent**: 复用上游 TCP+TLS 连接，RPS 从 27 提升到 140 (5x) — commit `f6f1699`
- [x] **Hop-by-hop 头清理**: 转发前剥离 `Connection`、`Proxy-Authorization`、`Transfer-Encoding` 等逐跳头 — commit `20ec24e`

### 测试

- [x] 完整测试套件 (32 tests, 2 skipped) — commit `e8c14e9`
- [x] 压力测试：60s / 64 并发 / 43 RPS / 零内存泄漏（~3% 失败率，因 httpbin.org 限流）
- [x] 当前测试总数：**75 tests passed, 2 skipped**（含 geosite.dat 9 + DomainTrie 13 + Resolver 12 + proxyRules 16 + ACL 18 + basics 5 + auth 1 + echo 1 + comprehensive 12）

### 统一配置文件 (proxyRules) ✅

- [x] **proxyRules 中间件** — commit `857fc5c`
- [x] **核心路由感知** (`_proxyRequest` / `_proxyConnect`) — commit `857fc5c`
- [x] **CLI 三层配置** (`--rules` / `--upstream-*` / 零配置) — commit `746e121`
- [x] **proxyRules 单元测试** (11 tests) — commit `a21601e`
- [x] **CLAUDE.md 更新** — commit `ba7f276`
- [x] **全局 localAddress** (`Straightforward({ localAddress })`) — commit `09d9ea9`
- [x] **CLI `--local-address` 透传** — commit `76b6757`
- [x] **README 更新** (proxyRules + localAddress 示例) — commit `55c65a5`

### 安全 & 兼容性 ✅

- [x] **Auth: Basic 认证大小写不敏感** — commit `d708cbd`
- [x] **Auth: user/pass 校验修复** — commit `d708cbd`
- [x] **CLI: DEBUG env 拼接修复** — commit `d708cbd`

### IP ACL (访问控制) ✅

- [x] **ACL 设计文档** (`docs/IP-ACL-DESIGN.md`) — commit `423d9da`
- [x] **ACL 中间件** (`src/middleware/acl.ts`): 白名单/黑名单、IPv4/IPv6 CIDR 匹配，零外部依赖 — commit `a8b19ea`
- [x] **ACL 单元测试** (18 tests): 精确匹配、CIDR、IPv6、CONNECT、优先级 — commit `854a04f`

### v2ray-rules-dat 集成 ✅

- [x] **Rule-set 模块** (`src/rule-set/`): DomainTrie 域名后缀匹配、RuleSetResolver 规则文件加载、零外部依赖 — commit `432fa8b`
- [x] **proxyRules geosite: 前缀**: `match` 字段支持 `geosite:gfw` 等语法，与 glob 规则共存 — commit `432fa8b`
- [x] **CLI `--rules-dir`**: 指定规则文件目录，自动加载所有 .txt 文件 — commit `432fa8b`
- [x] **Rule-set 单元测试** (25 tests): DomainTrie 13 + Resolver 12 — commit `5c7ff2b`
- [x] **proxyRules geosite 测试** (5 tests): mock resolver 集成测试 — commit `5c7ff2b`
- [x] **CLAUDE.md 更新**: rule-set 模块文档 — commit `9defb86`
- [x] **自动下载** (`src/rule-set/downloader.ts`): 从 GitHub Release 自动下载最新规则文件，零依赖 — commit `38755ee`
- [x] **CLI `--rules-download` / `--rules-download-force`** — commit `38755ee`

### geosite.dat 二进制格式支持 ✅

- [x] **零依赖 protobuf 解码器** (`src/rule-set/geosite-dat.ts`): 手写 varint/string/message 解析，支持 v2ray GeoSiteList 格式 — commit `05d7d02`
- [x] **Domain 类型映射**: Full(3) → 精确匹配，Domain(2) → 后缀匹配，Plain/Regex → 跳过 — commit `05d7d02`
- [x] **标签小写化**: `.dat` 中大写标签转为小写，与 v2ray 生态一致 — commit `05d7d02`
- [x] **resolver 集成**: 同时扫描 `.txt` 和 `.dat` 文件，`.txt` 标签优先级高于 `.dat` — commit `05d7d02`
- [x] **CLI `--rules-download-dat`**: 下载 geosite.dat 到规则目录 — commit `05d7d02`
- [x] **单元测试** (9 tests): 合成 dat 编码/解码、标签大小写、Full/Domain 匹配、真实文件验证 — commit `05d7d02`

### upstream CONNECT 隧道修复 ✅

- [x] **v2ray 规则文件 `full:` 前缀解析**: 修复 `full:dl.google.com` 字面匹配失败 — commit `5fa7cc1`
- [x] **head 缓冲区转发**: `_proxyConnectViaUpstream` 收到 200 后将 TLS ClientHello 写入上游 — commit `5fa7cc1`
- [x] **removeAllListeners 时序修复**: 移到 pipe() 之前，避免删掉 pipe 的 data 监听器 — commit `5fa7cc1`
- [x] **Bug 文档** (`docs/bugs/upstream-connect-fix.md`): 三个 bug 的根因分析和修复方案 — commit `5fa7cc1`

### CLI 工具增强 ✅

- [x] **`--show-tags [filter]`**: 列出 geosite.dat 中所有标签（1503 个），按域名数量排序，支持关键词过滤 — commit `1da16c3`
- [x] **`--show-domains <tag>`**: 列出指定标签下的所有域名，显示匹配类型 `[full]`/`[domain]` — commit `cf225a3`
- [x] **DomainTrie.list()**: 新增方法遍历 trie 中所有域名规则，支持 full/domain 类型区分 — commit `cf225a3`

---

## 待改进

### 优先级 1 — 安全 & 兼容性

- [x] **1.1 Auth: Basic 认证大小写不敏感** — commit `d708cbd`
- [x] **1.2 Auth: 只传 user 不传 pass 时显式报错** — commit `d708cbd`
- [x] **1.3 CLI: DEBUG 环境变量拼接 bug** — commit `d708cbd`

原设计文档（已实现，仅供参考）：

<details>
<summary>展开查看详细设计</summary>

#### 1.1 Auth: Basic 认证大小写不敏感

**文件**: [src/middleware/auth.ts:54](src/middleware/auth.ts#L54)

```diff
-const [proxyUser, proxyPass] = Buffer.from(
-  proxyAuth.replace("Basic ", ""),
-  "base64"
-)
+const [proxyUser, proxyPass] = Buffer.from(
+  proxyAuth.replace(/^basic\s+/i, ""),
+  "base64"
+)
```

**理由**: RFC 7617 允许 `basic`、`Basic`、`BASIC` 等变体，当前只处理 `Basic ` (大写 B + 空格)。

**风险**: 低，一行修改。

#### 1.2 Auth: 只传 `user` 不传 `pass` 时静默失效

**文件**: [src/middleware/auth.ts:60](src/middleware/auth.ts#L60)

```diff
-if (!dynamic && !!(!!user && !!pass)) {
+if (!dynamic && user && pass) {
   if (user !== proxyUser || pass !== proxyPass) {
     return sendAuthRequired()
   }
+} else if (!dynamic && (!user || !pass)) {
+  debug("auth: static mode requires both user and pass")
+  return sendAuthRequired()
 }
```

**理由**: 当前 `(!user || !pass)` 时认证静默无效，不报错。`!!(!!user && !!pass)` 三重否定冗余。

**风险**: 低。

#### 1.3 CLI: DEBUG 环境变量拼接 bug

**文件**: [cli.js:67](cli.js#L67)

```diff
-if (argv.debug) {
-  process.env.DEBUG += ",straightforward"
-}
+if (argv.debug) {
+  process.env.DEBUG = process.env.DEBUG
+    ? process.env.DEBUG + ",straightforward"
+    : "straightforward"
+}
```

**理由**: 当 `DEBUG` 未定义时，`process.env.DEBUG += ",straightforward"` 结果是 `"undefined,straightforward"` — `undefined` 不是合法的 debug 命名空间。

**风险**: 极低，三行修改。

</details>

---

### 优先级 2 — 代码质量

#### 2.1 MiddlewareDispatcher 递归优化

**文件**: [src/MiddlewareDispatcher.ts:40-51](src/MiddlewareDispatcher.ts#L40-L51)

```diff
 async function invokeMiddlewares<T>(
   context: T,
   middlewares: Middleware<T>[]
 ): Promise<void> {
-  if (!middlewares.length) return
-  const mw = middlewares[0]
-  return mw(context, async () => {
-    await invokeMiddlewares(context, middlewares.slice(1))
-  })
+  let i = 0
+  const next = async (): Promise<void> => {
+    if (i >= middlewares.length) return
+    return middlewares[i++](context, next)
+  }
+  return next()
 }
```

**理由**: 消除每次递归的 `.slice(1)` 数组复制（O(n²) 内存）。对 3-4 个中间件的场景影响小，但代码更简洁。

**风险**: 低，行为等价。

#### 2.2 添加 `remove()` 方法到 MiddlewareDispatcher

**文件**: [src/MiddlewareDispatcher.ts](src/MiddlewareDispatcher.ts)

```ts
/** Remove a middleware function previously added via use(). */
remove(mw: Middleware<T>): void {
  this.middlewares = this.middlewares.filter(m => m !== mw)
}
```

**理由**: 目前中间件只能加不能删。动态场景（如临时关闭认证）需要此方法。

**风险**: 低，纯新增。

#### 2.3 移除未使用的 `_onUncaughtException`

**文件**: [src/Straightforward.ts:334-337](src/Straightforward.ts#L334-L337)

该方法已无调用者（P0-1 移除了 `process.on` 注册），可以安全删除。

#### 2.4 Echo 注释拼写错误

**文件**: [src/middleware/echo.ts:6](src/middleware/echo.ts#L6)

```diff
-/** Echo an incoming proxy request by returning it's data */
+/** Echo an incoming proxy request by returning its data */
```

### 优先级 3 — 工程化

#### 3.1 添加 typecheck 脚本

**文件**: [package.json](package.json)

```json
"typecheck": "tsc --noEmit"
```

**理由**: CI 中应显式运行类型检查。当前只在 tsup build 时检查。

#### 3.2 升级依赖

| 包 | 当前版本 | 建议版本 | 理由 |
|---|---------|---------|------|
| `esbuild` | `^0.15.14` | `^0.24.0` | 2022 年版本，性能和大版本有显著改进 |
| `typescript` | `^4.9.3` | `^5.5.0` | TS 5 有更好的类型推断和性能 |
| `ava` | `^5.1.0` | `^6.0.0` | 新版支持 ESM、更好的并发 |
| `@types/node` | `^18.11.9` | `^20.0.0` | 匹配 `engines >= 16`，支持更多 API |

#### 3.3 CONNECT 隧道 Socket Keep-Alive

**文件**: [src/Straightforward.ts:261-309](src/Straightforward.ts#L261-L309)

```diff
 serverSocket.on("error", (err) => {
   // ...
 })

+serverSocket.setKeepAlive(true, 60_000)
+clientSocket.setKeepAlive(true, 60_000)

 clientSocket.on("destroyed", () => {
```

**理由**: 长时 CONNECT 隧道（WebSocket、大文件下载）可能被中间防火墙超时断开。TCP Keep-Alive 探测可防止此问题。

**风险**: 低，两行添加。

#### 3.4 压力测试暴露的 EventEmitter 警告

压力测试中出现 `MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 timeout listeners added to [Socket]`。这是测试脚本中 agent 复用带来的副作用，不影响生产使用，但可以考虑在 `_proxyRequest` 中为 socket timeout 设置合理上限。

---

## 功能增强方向

以下功能按"保持最小化、零外部依赖"的原则设计，均基于现有中间件体系扩展。

> **注**：以下"功能一"至"功能四"中的核心能力（出口 IP 绑定、二级代理、域名路由分发、统一配置文件）**已完成实现**。保留设计文档作为参考。最后完成的补充是 `Straightforward({ localAddress })` 全局源码 IP 绑定 — commit `09d9ea9`。

---

### 功能一：二级代理 (Upstream Proxy)

**场景**：本代理本身通过另一个上游代理出站。常见用途 — 代理链、内网出口、多层级网络隔离。

**当前状态**：`_proxyRequest` 直接 `http.request()` 到目标，`_proxyConnect` 直接 `net.connect()` 到目标。没有指定上游代理的能力。

**设计方案**：在 `StraightforwardOptions` 中添加 `upstream` 选项。底层利用 `http.Agent` 的代理能力：

```ts
interface UpstreamProxy {
  host: string
  port: number
  auth?: { user: string; pass: string }
  protocol?: "http" | "https"    // 到上游的协议
}

// 使用方式
const sf = new Straightforward({
  upstream: {
    host: "parent-proxy.example.com",
    port: 3128,
    auth: { user: "bob", pass: "secret" },
  },
})
```

**实现路径**：
1. `_proxyRequest` 使用 `hpagent` 风格的 Proxy-Agent 发送 HTTP 请求到上游
2. `_proxyConnect` 改为：先 CONNECT 到上游代理 → 通过上游隧道再建连目标 → 转发 CONNECT 响应给客户端
3. 认证自动添加 `Proxy-Authorization` 头

**复杂度**：~40 行新增，零外部依赖（用 Node.js 内置 `http`/`net` 实现）。

**与现有系统的关系**：上游代理配置会在构造函数中作为 `StraightforwardOptions.upstream` 传递，`_proxyRequest` 和 `_proxyConnect` 内部判断是否存在上游。

---

### 功能二：出口 IP 绑定 (Source IP Binding)

**场景**：服务器有多个网卡 / 多个出口 IP，需要根据目标域名或客户端来源选择不同的出口 IP。例如：
- 访问 `*.target-a.com` → 用网卡 `eth0` (10.0.0.1) 出站
- 访问 `*.target-b.com` → 用网卡 `eth1` (10.0.1.1) 出站
- 默认 → 用 `0.0.0.0`（系统路由选择）

**当前状态**：`net.connect()` 和 `http.request()` 都没有指定 `localAddress`，操作系统自动选择出口 IP 和网卡。

**设计方案**：`localAddress` 是 TCP 层的原生能力，Node.js `net.connect()` 和 `http.request()` 都支持。只需在两个地方传递：

#### 方案 A：全局绑定（一个代理实例绑定一个出口 IP）

```ts
// 最简单：整个代理绑定到固定网卡
const sf = new Straightforward({
  localAddress: "10.0.0.1", // 所有出站连接都从 eth0 出
})
```

在 `net.connect()` 和 `http.request()` 的 options 中添加 `localAddress`。

**改动**：`Straightforward.ts` 中 3 行代码：

```diff
 const proxyReq = http.request({
   method: req.method,
   headers,
   agent: this.#httpAgent,
+  ...(this.opts.localAddress ? { localAddress: this.opts.localAddress } : {}),
   ...req.locals.urlParts,
 })
```

```diff
 const serverSocket = net.connect(
   req.locals.urlParts.port,
   req.locals.urlParts.host,
+  { localAddress: this.opts.localAddress },
   () => { ... }
 )
```

**复杂度**：~5 行。

#### 方案 B：按域名绑定（与路由系统配合）

```ts
// 高级：不同域名从不同 IP 出站
sf.onRequest.use(middleware.bind({
  rules: [
    { match: "*.target-a.com", localAddress: "10.0.0.1" },
    { match: "*.target-b.com", localAddress: "10.0.1.1" },
    { match: "*", localAddress: "0.0.0.0" },
  ],
}))

sf.onConnect.use(middleware.bind({ /* 同上 */ }))
```

中间件将选中的 `localAddress` 写入 `req.locals`：

```ts
req.locals.localAddress = "10.0.0.1"
```

然后 `_proxyRequest` 和 `_proxyConnect` 读取 `req.locals.localAddress`。

**路由规则设计**（复用路由分发相同的匹配逻辑）：

```ts
interface BindRule {
  match: string           // glob: "*.example.com", "192.168.*", "*"
  localAddress: string    // IP: "10.0.0.1"
}
```

**实现路径**：
1. 新增 `src/middleware/bind.ts`（~25 行，纯中间件）
2. `_proxyRequest` 读取 `req.locals.localAddress`（+3 行）
3. `_proxyConnect` 读取 `req.locals.localAddress`（+3 行）

**复杂度**：~30 行新增。

#### 方案 C：动态按端口绑定（一个端口 = 一个出口）

```bash
# 开多个实例，各自绑定不同出口
node cli.js --port 8081 --local-address 10.0.0.1
node cli.js --port 8082 --local-address 10.0.1.1
```

CLI 添加 `--local-address` 选项：

```bash
node cli.js --port 8081 --local-address 10.0.0.1
node cli.js --port 8082 --local-address 10.0.1.1
```

客户端通过选择不同的代理端口来选择出口 IP。

**复杂度**：~5 行（CLI 加选项 + 透传到 Straightforward）。

---

### 功能三：域名路由分发 (Request Routing)

**场景**：根据目标域名或 IP 将请求分发到不同的上游代理。例如：
- `*.internal.corp` → 直连（不走代理）
- `*.google.com` → 代理 A
- `*` → 代理 B

**设计方案**：利用现有 `onRequest` / `onConnect` 中间件体系，新增内置的 `router` 中间件：

```ts
import { Straightforward, middleware } from "straightforward"

const sf = new Straightforward()

sf.onRequest.use(middleware.router({
  rules: [
    { match: "*.internal.corp", action: "direct" },
    { match: "*.google.com", action: "proxy", upstream: { host: "proxy-a.example.com", port: 8080 } },
    { match: "*", action: "proxy", upstream: { host: "proxy-b.example.com", port: 3128 } },
  ],
}))

sf.onConnect.use(middleware.router({ /* 同上 */ }))
```

**路由表设计**：

```ts
interface RoutingRule {
  /** Glob pattern matching the target hostname */
  match: string
  /** "direct" = 不走代理直连, "proxy" = 走指定上游 */
  action: "direct" | "proxy"
  /** 仅 action === "proxy" 时需要 */
  upstream?: {
    host: string
    port: number
    auth?: { user: string; pass: string }
  }
}
```

**实现路径**：
1. 在 `req.locals` 上放入 `upstream` 信息（router 中间件设置）
2. `_proxyRequest` 读取 `req.locals.upstream`，如果存在则用上游代理
3. `_proxyConnect` 同理

**复杂度**：~50 行（router 中间件 ~30 行 + Straightforward.ts 中 ~20 行读取 `req.locals.upstream`）。

**匹配顺序**：从上到下，第一个匹配的规则生效。`*` 作为通配符匹配任意字符（用 `micromatch`？不，自己写 ~10 行 glob → regex 转换，保持零依赖）。

---

---

### 功能四：统一配置文件 (Unified Rules Config)

将**出口 IP 绑定**、**二级代理**、**域名路由分发**三个能力合并为一个统一的配置文件规则系统，用 **proxyrules.json** 驱动整个代理行为。

#### 为什么合并？

单个规则文件解决三个独立中间件无法回答的问题：**"指定域名 → 指定出口 IP → 经过指定上游代理 → 到达目标"** 这条链路需要一条规则同时携带 `match` + `localAddress` + `upstream`，而不是三个中间件各自独立判断。

#### 规则数据结构

```jsonc
// proxyrules.json — 一条规则同时控制：路由、出口 IP、上游代理
{
  "rules": [
    {
      // ── 匹配条件 ──
      "match": "*.internal.corp",

      // ── 出口 IP 绑定 ──
      "localAddress": "10.0.0.1",

      // ── 上游代理 ──
      "upstream": {
        "host": "corp-proxy.internal",
        "port": 3128,
        "auth": { "user": "agent", "pass": "s3cret" }
      }
    },
    {
      "match": "*.aws.amazonaws.com",
      "localAddress": "10.0.1.1",
      "upstream": null          // null = 直连，不走上游代理
    },
    {
      "match": "*.google.com",
      "localAddress": "10.0.2.1",
      "upstream": {
        "host": "us-proxy.example.com",
        "port": 8080
      }
    },
    {
      "match": "*",
      "localAddress": "0.0.0.0",
      "upstream": null
    }
  ],
  "default": {
    "localAddress": "0.0.0.0",
    "upstream": null
  }
}
```

**TypeScript 类型**：

```ts
interface ProxyRule {
  /** Glob pattern matching target hostname */
  match: string
  /** Source IP to bind outgoing connection to. "0.0.0.0" = OS default */
  localAddress?: string
  /** Upstream proxy to route through. null | undefined = direct connect */
  upstream?: {
    host: string
    port: number
    auth?: { user: string; pass: string }
  } | null
}

interface ProxyRulesConfig {
  rules: ProxyRule[]
  /** Fallback when no rule matches */
  default?: {
    localAddress?: string
    upstream?: ProxyRule["upstream"]
  }
}
```

**第一条匹配规则生效**。每条规则只定义自己关心的字段，未定义字段继承 `default`。

#### 完整示例文件：`proxyrules.json`

```json
{
  "$schema": "https://raw.githubusercontent.com/berstend/straightforward/main/schemas/proxyrules.schema.json",
  "rules": [
    {
      "match": "*.internal.corp",
      "localAddress": "10.0.0.1",
      "upstream": {
        "host": "corp-proxy.internal",
        "port": 3128,
        "auth": { "user": "agent", "pass": "s3cret" }
      }
    },
    {
      "match": "*.aws.amazonaws.com",
      "localAddress": "10.0.1.1",
      "upstream": null
    },
    {
      "match": "*.google.com",
      "localAddress": "10.0.2.1",
      "upstream": {
        "host": "us-proxy.example.com",
        "port": 8080
      }
    },
    {
      "match": "*.microsoft.com",
      "localAddress": "10.0.2.1",
      "upstream": {
        "host": "us-proxy.example.com",
        "port": 8080
      }
    },
    {
      "match": "*.github.com",
      "localAddress": "10.0.2.1",
      "upstream": {
        "host": "us-proxy.example.com",
        "port": 8080
      }
    },
    {
      "match": "*.office365.com",
      "localAddress": "10.0.3.1",
      "upstream": {
        "host": "eu-proxy.example.com",
        "port": 3128,
        "auth": { "user": "o365", "pass": "cl0ud" }
      }
    },
    {
      "match": "*.eu-west-1.amazonaws.com",
      "localAddress": "10.0.3.1",
      "upstream": {
        "host": "eu-proxy.example.com",
        "port": 3128
      }
    },
    {
      "match": "10.*",
      "localAddress": "0.0.0.0",
      "upstream": null
    },
    {
      "match": "192.168.*",
      "localAddress": "0.0.0.0",
      "upstream": null
    },
    {
      "match": "*",
      "localAddress": "0.0.0.0",
      "upstream": null
    }
  ],
  "default": {
    "localAddress": "0.0.0.0",
    "upstream": null
  }
}
```

这个示例覆盖了典型的多网卡 + 多上游代理场景：

| 规则 | 说明 |
|------|------|
| `*.internal.corp` | 内网流量走企业代理 `corp-proxy:3128`，绑定内网网卡 `10.0.0.1` |
| `*.aws.amazonaws.com` | AWS API 直连（不走代理），绑定 DMZ 网卡 `10.0.1.1` |
| `*.google.com`, `*.microsoft.com`, `*.github.com` | 多个海外服务共享同一代理 `us-proxy:8080`，共享出口 `10.0.2.1` |
| `*.office365.com` | O365 走欧洲代理 `eu-proxy:3128`（带认证），绑定 `10.0.3.1` |
| `*.eu-west-1.amazonaws.com` | AWS 欧洲区走欧洲代理，绑定 `10.0.3.1` |
| `10.*`, `192.168.*` | RFC 1918 内网地址直连，系统选出口（确保内网可达） |
| `*` | 兜底规则：直连、系统选出口 |

**规则数量**：10 条，覆盖 6 个上游代理 + 2 个内网 CIDR + 1 个兜底。**顺序很重要**：规则从上到下匹配，第一匹配生效。

#### CLI 使用

```bash
# 使用配置文件
straightforward --rules ./proxyrules.json

# 无配置文件时，使用内置简化模式（等价于直连）
straightforward
# 等价于：所有请求直连、系统自动选出口 IP
```

#### 零配置模式：无文件时的默认行为

当不传 `--rules` 时，代理使用**内置默认规则**。默认行为的规则等价于：

```json
{
  "rules": [],
  "default": {
    "localAddress": "0.0.0.0",
    "upstream": null
  }
}
```

即：所有域名直连、由操作系统自动选择出口 IP，完全兼容当前版本的默认行为。

#### 简化模式：无需文件也能用 CLI 参数指定上游和出口

即使没有配置文件，也可以通过 CLI 参数使用上游代理和出口 IP：

```bash
# 所有流量经过一个上游代理
straightforward --upstream-host corp-proxy.internal --upstream-port 3128

# 所有流量绑定到固定出口 IP
straightforward --local-address 10.0.0.1

# 组合使用
straightforward \
  --upstream-host corp-proxy.internal --upstream-port 3128 \
  --upstream-auth "user:pass" \
  --local-address 10.0.0.1

# 组合使用（不含上游，仅绑定出口）
straightforward --local-address 10.0.1.1
```

**CLI → 运行时的映射**：当 CLI 指定了 `--upstream-*` 或 `--local-address` 时，内部自动构建一条 `match: "*"` 的万能规则：

```ts
// cli.js 内部
let rules
if (argv.rules) {
  rules = JSON.parse(fs.readFileSync(argv.rules, "utf-8")).rules
} else if (argv.upstreamHost || argv.localAddress) {
  // 简化的单出口 / 单上游模式
  rules = [
    {
      match: "*",
      localAddress: argv.localAddress || "0.0.0.0",
      upstream: argv.upstreamHost
        ? {
            host: argv.upstreamHost,
            port: argv.upstreamPort || 3128,
            ...(argv.upstreamAuth
              ? { auth: { user: argv.upstreamAuth.split(":")[0], pass: argv.upstreamAuth.split(":")[1] } }
              : {}),
          }
        : null,
    },
  ]
} else {
  // 零配置：默认直连
  rules = []
}
```

**设计原则**：

| 场景 | 使用方式 | 灵活性 |
|------|---------|--------|
| 零配置（默认） | `straightforward` | 最小：直连，系统选出口 |
| 单出口/单上游 | `straightforward --upstream-host ... --local-address ...` | 中：全局统一行为 |
| 完整规则 | `straightforward --rules proxyrules.json` | 高：按域名精细控制 |

这样从"零配置就能用"到"完整规则文件"构成一条平滑的学习曲线。

#### 程序化使用

```ts
import { Straightforward, proxyRules } from "straightforward"

// 方式 1：无规则（默认直连）
const sf1 = new Straightforward()
// 等价于所有请求直连、系统选出口

// 方式 2：内联规则（不读文件）
const sf2 = new Straightforward()
const rules = proxyRules({
  rules: [
    { match: "*.internal.corp", upstream: null, localAddress: "10.0.0.1" },
    { match: "*.google.com", upstream: { host: "us-proxy", port: 8080 }, localAddress: "10.0.2.1" },
    { match: "*", localAddress: "0.0.0.0" },
  ],
})
sf2.onRequest.use(rules)
sf2.onConnect.use(rules)

// 方式 3：从文件加载
import rulesFile from "./proxyrules.json" with { type: "json" }
const sf3 = new Straightforward()
sf3.onRequest.use(proxyRules({ rules: rulesFile.rules }))
sf3.onConnect.use(proxyRules({ rules: rulesFile.rules }))
```

#### 中间件行为：`proxyRules`

单个中间件，同时写入三个 `req.locals` 字段：

```ts
// proxyRules 中间件内部
for (const rule of rules) {
  if (globMatch(targetHost, rule.match)) {
    ctx.req.locals.upstream = rule.upstream || null
    ctx.req.locals.localAddress = rule.localAddress || "0.0.0.0"
    return next()
  }
}
// fallback: use default
ctx.req.locals.upstream = config.default?.upstream ?? null
ctx.req.locals.localAddress = config.default?.localAddress ?? "0.0.0.0"
return next()
```

然后 `_proxyRequest` 和 `_proxyConnect` 内部读取这两个值，无需感知路由逻辑。

#### 核心改动：Straightforward.ts 路由感知

```diff
 // _proxyRequest — 读取路由结果
+const upstream = req.locals.upstream
+const localAddr = req.locals.localAddress

+if (upstream) {
+  // 走上游代理逻辑：HTTP request → upstream → target
+  return this._proxyViaUpstream(req, res, upstream, localAddr)
+}
+// 直连逻辑（现有代码）
 const proxyReq = http.request({
   method: req.method,
   headers,
   agent: this.#httpAgent,
+  ...(localAddr && localAddr !== "0.0.0.0" ? { localAddress: localAddr } : {}),
   ...req.locals.urlParts,
 })
```

```diff
 // _proxyConnect — 读取路由结果
+if (req.locals.upstream) {
+  // 通过上游隧道连接
+  return this._proxyConnectViaUpstream(req, clientSocket, head, req.locals.upstream, req.locals.localAddress)
+}
 // 直连逻辑（现有代码）
 const serverSocket = net.connect(
   req.locals.urlParts.port,
   req.locals.urlParts.host,
+  { localAddress: req.locals.localAddress },
   () => { ... }
 )
```

#### 复杂度

| 组件 | 行数 | 说明 |
|------|------|------|
| `src/middleware/proxyRules.ts` | ~40 行 | glob 匹配 + 规则遍历 + 写入 locals |
| `Straightforward._proxyRequest` | +15 行 | 读取 `req.locals` + 上游代理分支 |
| `Straightforward._proxyConnect` | +25 行 | 读取 `req.locals` + 上游隧道分支 |
| `cli.js` | +8 行 | `--rules` 选项 + JSON 读取 |
| **总计** | **~90 行** | |

#### Glob → Regex 转换（零依赖，~12 行）

```ts
function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")  // escape regex specials
    .replace(/\*/g, "[^.]*")                // * matches within a segment
    .replace(/\\\*\\\*/g, ".*")             // ** crosses dots
  return new RegExp("^" + escaped + "$", "i")
}
// "*.google.com" → /^[^.]+\.google\.com$/i
// "*.internal.*" → /^[^.]+\.internal\.[^.]+$/i
// "*"            → /^.*$/i
```

#### `_proxyViaUpstream` 实现概要

```ts
private _proxyViaUpstream(req, res, upstream, localAddress) {
  // 1. 用 HTTP CONNECT 连接到上游代理
  // 2. 通过上游隧道向目标发起新的 HTTP 请求
  //    http.request({ ...req.locals.urlParts, agent: upstreamHttpsAgent })
  // 3. pipe 响应回客户端
}
```

#### `_proxyConnectViaUpstream` 实现概要

```ts
private _proxyConnectViaUpstream(req, clientSocket, head, upstream, localAddress) {
  // 1. net.connect() 到上游代理
  // 2. 发送 CONNECT target:port HTTP/1.1 + Proxy-Authorization
  // 3. 接收上游 200 Connection Established
  // 4. 转发给客户端 → 建立双向 pipe
}
```

#### 配置文件热加载（可选后续）

```ts
// 监听文件变化，零停机更新规则
fs.watch("proxyrules.json", () => {
  const newRules = JSON.parse(fs.readFileSync("proxyrules.json", "utf-8"))
  proxyRulesMiddleware.reload(newRules.rules)
})
```

---

#### 设计审查：当前 `proxyRules` 方案的不足与建议

对当前设计进行完整审查后，以下问题值得考虑：

##### 问题 1：`upstream: null` vs `upstream: undefined` 语义不清

当前 `upstream` 可以是 `null` 或 `undefined`，两者行为相同（直连），但语义混在一起。建议明确区分：

```ts
interface ProxyRule {
  match: string
  action: "connect" | "forward"    // CONNECT 隧道 / HTTP 转发
  localAddress?: string
  upstream?: UpstreamProxy         // 不写 = 直连; 写了 = 走这个上游
}
```

`null`/`undefined` 统一为"不写"。

##### 问题 2：规则匹配缺少 `type` 字段区分 HTTP 和 CONNECT

当前规则同时作用于 `onRequest`（HTTP）和 `onConnect`（HTTPS），但没有能力对同一域名区分 HTTP 和 CONNECT 行为。某些场景下 HTTP 需要走一个代理，CONNECT 需要走另一个。

```diff
 interface ProxyRule {
   match: string
+  /** 仅对特定请求类型生效，不写 = 两种都匹配 */
+  type?: "http" | "connect"
   localAddress?: string
   upstream?: UpstreamProxy | null
 }
```

##### 问题 3：缺少 `priority` 字段 — 规则顺序太脆弱

当前"第一条匹配生效"依赖数组顺序。人编辑 JSON 时很容易误排序。加 `priority` 更健壮：

```json
{ "match": "*.google.com", "priority": 100, "upstream": {...} }
{ "match": "*.google.co.uk", "priority": 200, "upstream": {...} }
```

`priority` 越高越优先。省略时按出现顺序（兼容当前行为）。但考虑到复杂度，**可以作为可选字段**，不是必须。

##### 问题 4：没有超时、重试、熔断配置

上游代理可能宕机，当前设计没有容错机制。建议：

```json
{
  "match": "*.google.com",
  "localAddress": "10.0.2.1",
  "upstream": {
    "host": "us-proxy.example.com",
    "port": 8080,
    "timeout": 10000,
    "retries": 2,
    "circuitBreaker": {
      "failureThreshold": 5,
      "resetTimeout": 30000
    }
  }
}
```

**但有争议**：代理自身存活（如 `requestTimeout`）已经有全局配置。上游代理的容错应该放在上游代理本身，而不是中间代理。建议先不加，等实际需求出来再考虑。

##### 问题 5：匹配维度太窄 — 只能按域名

当前 `match` 只匹配目标 hostname。实际场景可能还需要按端口、协议、客户端 IP 匹配：

```ts
interface ProxyRule {
  match: {
    host?: string            // "*.google.com"
    port?: number | string   // 443 | "8000-9000"
    protocol?: "http" | "https" | "ws"
    clientIP?: string        // "10.0.0.0/8" — 按客户端来源路由
  }
}
```

**建议**：第一版保持 `match: string` 简单匹配域名。等后续真正需要多维度匹配时再加，保持渐进式复杂度。

##### 问题 6：upstream 缺乏负载均衡能力

如果一个上游代理不够用，需要多个上游做负载均衡：

```json
{
  "match": "*.google.com",
  "upstream": [
    { "host": "us-proxy-1.example.com", "port": 8080, "weight": 2 },
    { "host": "us-proxy-2.example.com", "port": 8080, "weight": 1 }
  ]
}
```

`weight: 2` 的代理收到两倍请求。实现用加权轮询。

**但**：这是 Nginx/Envoy 的领域，不是个前向代理该做的。建议**不做**，保持 `upstream` 为单对象。

##### 问题 7：规则校验 — JSON Schema

`$schema` 引用的 schema 文件需要真的发布。建议第一版就带一个简单的 JSON Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["rules"],
  "properties": {
    "rules": {
      "type": "array",
      "items": { "$ref": "#/definitions/rule" }
    },
    "default": { "$ref": "#/definitions/defaults" }
  },
  "definitions": {
    "rule": {
      "type": "object",
      "required": ["match"],
      "properties": {
        "match": { "type": "string" },
        "localAddress": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+\\.\\d+$" },
        "upstream": {
          "oneOf": [
            { "type": "null" },
            {
              "type": "object",
              "required": ["host", "port"],
              "properties": {
                "host": { "type": "string" },
                "port": { "type": "number", "minimum": 1, "maximum": 65535 },
                "auth": {
                  "type": "object",
                  "required": ["user", "pass"],
                  "properties": {
                    "user": { "type": "string" },
                    "pass": { "type": "string" }
                  }
                }
              }
            }
          ]
        }
      }
    }
  }
}
```

##### 改进建议总结

| # | 建议 | 是否纳入第一版 |
|---|------|:---:|
| 1 | 统一 `upstream` 语义，去掉 `null` | **是** |
| 2 | 规则 `type?: "http" \| "connect"` | **是** — 小改动 |
| 3 | `priority` 字段覆盖顺序 | **可延后** — 数组顺序对 JSON 够用 |
| 4 | 上游超时、重试、熔断 | **不做** — 责任在代理链上游节点 |
| 5 | 多维度匹配（端口、协议、客户端 IP） | **可延后** — 第一版用 hostname 足够 |
| 6 | 上游负载均衡（多 upstream） | **不做** — 非前向代理职责 |
| 7 | JSON Schema 随第一版发布 | **是** — 对配置体验很重要 |

### 功能五：IP 访问控制 (ACL Middleware)

**场景**：基于客户端 IP 允许/拒绝连接。类似防火墙白名单/黑名单。

**设计方案**：新增内置的 `acl` 中间件：

```ts
sf.onRequest.use(middleware.acl({
  allow: ["10.0.0.0/8", "127.0.0.1"],
  deny: ["192.168.1.100"],
}))

sf.onConnect.use(middleware.acl({ /* 同上 */ }))
```

**实现路径**：
1. 支持 CIDR 格式（`10.0.0.0/8`）和单个 IP（`127.0.0.1`）
2. 用 `net.isIP()` 和手动子网掩码计算（~15 行），零依赖
3. `allow` 列表优先于 `deny` 列表
4. 被拒绝的连接返回 403 Forbidden

**复杂度**：~35 行（纯独立中间件，不修改 Straightforward.ts）。

---

### 功能六：请求/响应头改写 (Header Rewrite Middleware)

**场景**：在转发前添加、删除、修改请求或响应头。常用于：
- 注入 `X-Forwarded-For` 链
- 隐藏 `User-Agent`
- 修改 `Host` 头做域名映射

**设计方案**：新增 `headers` 中间件：

```ts
sf.onRequest.use(middleware.headers({
  request: {
    set: { "X-Forwarded-For": "${client.ip}" },
    remove: ["User-Agent", "Referer"],
  },
  response: {
    set: { "X-Proxied-By": "straightforward" },
  },
}))
```

**变量支持**：`${client.ip}`、`${target.host}`、`${target.port}` 等上下文变量。

**复杂度**：~40 行。请求头改写直接在 `onRequest` 中操作 `req.headers` 对象，响应头改写在 `onResponse` 中操作 `proxyRes.headers`。

**注意**：上一个功能（P0-3: Hop-by-hop 头清理）已在 `_proxyRequest` 中剥离了 `Proxy-Authorization` 等头。如果用户通过此功能显式添加这些头，需要确保添加时机在剥离之后。当前剥离在 `_proxyRequest` 内部、管道建立之前执行，所以 `headers` 中间件（在 `onRequest` 阶段）添加的头会被后续的 hop-by-hop 剥离影响。建议文档中说明 **hop-by-hop 头始终被剥离，用户无法覆盖**（这是正确的安全行为）。

---

### 功能七：连接数限制 (Connection Limiting)

**场景**：限制每个客户端 IP 的并发连接数，防止单个客户端耗尽资源。

**设计方案**：新增 `connectionLimit` 中间件：

```ts
sf.onRequest.use(middleware.connectionLimit({ maxConnectionsPerIP: 8 }))
sf.onConnect.use(middleware.connectionLimit({ maxConnectionsPerIP: 4 }))
```

**实现路径**：
1. 在中间件闭包中维护 `Map<ip, count>`
2. 监听 `res.on("close")` 和 `clientSocket.on("close")` 递减计数
3. 超限返回 429 Too Many Requests

**复杂度**：~50 行。注意并发安全（Node.js 单线程，Map 操作天然安全）。

---

### 功能八：结构化访问日志 (Structured Logging)

**场景**：以 JSON 格式记录每个代理请求的元数据（客户端 IP、目标、耗时、状态码等），便于接入日志系统（ELK、Loki 等）。

**设计方案**：现有日志用 `debug` 模块输出，添加一个 `accessLog` 中间件：

```ts
sf.onResponse.use(middleware.accessLog({
  format: "json",              // "json" | "text"
  stream: process.stdout,      // 可写流，默认 stdout
  fields: ["method", "url", "statusCode", "duration", "clientIP"],
}))
```

**输出示例**：
```json
{"timestamp":"2026-06-13T10:30:00Z","method":"GET","url":"https://example.com/","statusCode":200,"duration":123,"clientIP":"10.0.0.5","type":"connect"}
```

**复杂度**：~30 行。纯中间件，收集上下文信息 + `Date.now()` 计时。

---

### 功能九：集群模式零停机重启 (Graceful Shutdown)

**场景**：生产环境中重启代理而不丢弃活跃连接。

**当前状态**：`cluster()` 支持多进程，但 `close()` 立即关闭，活跃连接被中断。

**设计方案**：
```ts
// 优雅关闭：停止接受新连接，等待活跃连接完成
sf.gracefulClose({ timeout: 10_000 }) // 10 秒超时后强制关闭
```

**实现路径**：
1. `server.close()` 停止接受新连接（Node.js 内置行为）
2. 追踪活跃连接计数（`_onRequest` +1, `res.on("finish")` -1）
3. 超时后 `server.closeAllConnections()`（Node 18.2+）强制终止

**复杂度**：~30 行。

---

## 功能优先级矩阵

| 功能 | 复杂度 | 价值 | 独立中间件？ | 推荐 |
|------|--------|------|-------------|------|
| 统一配置文件 (proxyRules) | ~90 行 | 高（合并三个核心能力） | 否（改核心 + 新建中间件） | **已完成** ✅ |
| 出口 IP 绑定 | — | — | — | **合并入 proxyRules** |
| 二级代理 | — | — | — | **合并入 proxyRules** |
| 域名路由分发 | — | — | — | **合并入 proxyRules** |
| v2ray-rules-dat 集成 | ~350 行 | 高（复用社区规则） | 是（纯模块 + proxyRules 扩展） | **已完成** ✅ |
| IP ACL | ~170 行 | 中（安全增强） | 是（纯中间件） | **已完成** ✅ |
| Header 改写 | ~40 行 | 中（灵活性强） | 是（纯中间件） | 第五 |
| 连接数限制 | ~50 行 | 中（防滥用） | 是（纯中间件） | 第六 |
| 结构化日志 | ~30 行 | 低（debug 已够用） | 是（纯中间件） | 第七 |
| 优雅关闭 | ~30 行 | 低（单机场景少） | 否（需改核心） | 第八 |

---

## 不做（功能类）

以下是有意不做的事项及理由：

| 事项 | 理由 |
|------|------|
| SSL 拦截 (MITM) | 违背项目定位：明确不支持的场景 |
| 反向代理 / 负载均衡 | 已有专用工具 (nginx, node-http-proxy) |
| 透明代理 | 需要 iptables 配置，非 Node.js 层面 |
| 缓存代理 | 增加复杂度，违背零依赖原则 |
| SNI/CONNECT 多路复用 | 过度工程化，CONNECT 隧道语义上已是单路 |
| HTTP/2 上游 | 需要 `http2` 模块 + TLS，增加显著复杂度 |
| PAC (Proxy Auto-Config) | 属于客户端特性，服务端代理不需要 |
| Web 管理界面 | 非核心功能，可由社区 fork 添加 |
| 缓存 DNS 解析 | Node.js 内置 DNS 已有缓存 |
| 流量统计 / 计费 | 特定场景需求，可通过 middleware 自定义 |

---

## 性能基准

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| 平均 RPS (60s, 64 并发) | ~27 | ~140 |
| Heap Used | 14-15 MB 稳定 | 14-26 MB 稳定 |
| Heap 峰值回收 | 124→17 MB | 137→18 MB |
| 成功率 | 100% | 99.9% |
| 内存泄漏 | 无 | 无 |
