# Straightforward 改进计划

> 最后更新：2026-06-14

---

## 已完成

### Bug 修复 ✅

详见 [docs/completed/bug-fixes.md](docs/completed/bug-fixes.md)

- [x] **P0-1**: server 事件监听器移至构造函数，移除 uncaughtException — `09d7d6d`
- [x] **P0-2**: `_populateUrlParts` 不再 throw，返回 boolean — `80d9c45`
- [x] **P0-3**: CONNECT URL 解析支持 IPv6 (`[::1]:443`) — `0f6c85d`
- [x] **P0-4**: `net.connect` error 处理器提前注册，返回 502 — `6f8c249`
- [x] **Auth Basic 大小写不敏感** / **user/pass 校验修复** / **DEBUG env 拼接修复** — `d708cbd`
- [x] **upstream CONNECT 隧道修复**（full: 前缀解析、head 转发、removeAllListeners 时序） — `5fa7cc1`

### 性能优化 ✅

详见 [docs/completed/performance.md](docs/completed/performance.md)

- [x] **TCP_NODELAY**: CONNECT 隧道消除 40ms+ Nagle 延迟 — `e8365ea`
- [x] **HTTP Keep-Alive Agent**: 上游连接复用，RPS 从 27 提升到 140 (5x) — `f6f1699`
- [x] **Hop-by-hop 头清理**: 转发前剥离逐跳头 — `20ec24e`

### 统一配置文件 (proxyRules) ✅

详见 [docs/completed/proxy-rules.md](docs/completed/proxy-rules.md)

- [x] **proxyRules 中间件** — `857fc5c`
- [x] **核心路由感知**（`_proxyRequest` / `_proxyConnect`）— `857fc5c`
- [x] **CLI 三层配置**（`--rules` / `--upstream-*` / 零配置）— `746e121`
- [x] **全局 localAddress** — `09d9ea9`
- [x] **CLI `--local-address` 透传** — `76b6757`

### v2ray 规则集集成 ✅

详见 [docs/completed/v2ray-rules-dat.md](docs/completed/v2ray-rules-dat.md)

- [x] **DomainTrie** — 域名后缀 trie，O(域名长度) 匹配 — `432fa8b`
- [x] **RuleSetResolver** — 扫描 .txt/.dat 规则文件 — `432fa8b`
- [x] **proxyRules geosite: 前缀** — `432fa8b`
- [x] **CLI `--rules-dir` / `--rules-download` / `--rules-download-force`** — `432fa8b`, `38755ee`
- [x] **geosite.dat 二进制解析** — 零依赖 protobuf 解码器 — `05d7d02`
- [x] **CLI `--rules-download-dat`** — `05d7d02`

### IP ACL (访问控制) ✅

详见 [docs/IP-ACL-DESIGN.md](docs/IP-ACL-DESIGN.md)

- [x] **ACL 中间件** — 白名单/黑名单、IPv4/IPv6 CIDR 匹配 — `a8b19ea`
- [x] **ACL 单元测试** (18 tests) — `854a04f`

### CLI 工具增强 ✅

详见 [docs/completed/cli-tools.md](docs/completed/cli-tools.md)

- [x] **`--show-tags [filter]`** — 列出 geosite.dat 标签 — `1da16c3`
- [x] **`--show-domains <tag>`** — 列出标签下的域名 — `cf225a3`
- [x] **DomainTrie.list()** — 遍历 trie 域名 — `cf225a3`

### 按规则指定 DNS 服务器 ✅

详见 [docs/completed/dns-per-rule.md](docs/completed/dns-per-rule.md)

- [x] **DNS Resolver 工厂** (`src/dns-resolver.ts`): 使用 `dns.promises.Resolver` 实例级 DNS，FIFO 缓存 — `54779f7`
- [x] **proxyRules 集成**: ProxyRule/Config/Locals 新增 `dns` 字段 — `54779f7`
- [x] **核心注入**: 4 个代理方法向 `http.request()`/`net.connect()` 注入 `lookup` — `54779f7`
- [x] **CLI `--dns`**: 全局 DNS 服务器选项 — `54779f7`
- [x] **单元测试** (12 tests): DNS resolver 工厂 + proxyRules 传播 — `54779f7`

### 测试 ✅

详见 [docs/completed/testing.md](docs/completed/testing.md)

- [x] 测试总数：**87 passed, 2 skipped**
- [x] 压力测试：60s / 64 并发 / ~140 RPS / 零内存泄漏

---

## 待改进

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

**理由**: 消除每次递归的 `.slice(1)` 数组复制（O(n²) 内存）。

#### 2.2 添加 `remove()` 方法到 MiddlewareDispatcher

```ts
remove(mw: Middleware<T>): void {
  this.middlewares = this.middlewares.filter(m => m !== mw)
}
```

**理由**: 目前中间件只能加不能删。

#### 2.3 移除未使用的 `_onUncaughtException`

**文件**: [src/Straightforward.ts](src/Straightforward.ts)

该方法已无调用者，可以安全删除。

#### 2.4 Echo 注释拼写错误

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

#### 3.2 升级依赖 ✅

| 包 | 升级前 | 升级后 | 理由 |
|---|--------|--------|------|
| `esbuild` | `^0.15.14` | `^0.24.0` | 性能改进 |
| `typescript` | `^4.9.3` | `^5.7.0` | TS 5 更好类型推断 |
| `@types/node` | `^18.11.9` | `^22.0.0` | 匹配 engines >= 16 |
| `ava` | `^5.1.0` | `^5.1.0` | **未升级** — ava 6 仅支持 ESM，需要大范围调整测试文件 |

> commit `59f367e`

#### 3.3 CONNECT 隧道 Socket Keep-Alive

**文件**: [src/Straightforward.ts](src/Straightforward.ts)

```diff
+serverSocket.setKeepAlive(true, 60_000)
+clientSocket.setKeepAlive(true, 60_000)
```

**理由**: 长时 CONNECT 隧道可能被防火墙超时断开。

#### 3.4 EventEmitter 警告

压力测试中出现 `MaxListenersExceededWarning`，可在 `_proxyRequest` 中为 socket timeout 设置合理上限。

#### 3.5 CONNECT 隧道空闲超时

**文件**: [src/Straightforward.ts](src/Straightforward.ts)

```ts
serverSocket.setTimeout(300_000, () => serverSocket.destroy())
clientSocket.setTimeout(300_000, () => clientSocket.destroy())
```

**理由**: 客户端网络断开但没有发送 FIN 时，服务端 socket 会永远挂着，造成资源泄漏。设置空闲超时自动回收。

#### 3.6 细粒度超时控制

当前只有一个 `requestTimeout`（60s）。生产环境建议拆分为：

```ts
export interface StraightforwardOptions {
  connectTimeout: number   // TCP 连接建立超时，默认 10s
  readTimeout: number      // 读取响应数据超时，默认 30s
  writeTimeout: number     // 写入请求数据超时，默认 30s
}
```

**理由**: 单一超时不够精细，一个慢请求可能挂住整个连接池。不同阶段的超时应该独立可控。

#### 3.7 响应体大小限制

在 `_onResponse` 的 pipe 链中加一个 Transform stream，可配置最大响应体大小，超限则截断并记录警告。

```ts
export interface StraightforwardOptions {
  maxResponseSize?: number  // 响应体最大字节数，默认无限制
}
```

**理由**: 防止恶意大文件下载耗尽内存。复杂度 ~30 行。

#### 3.8 Debug 模式打印 SNI

CONNECT 隧道建立时，客户端发送的第一个 TLS ClientHello 包含 SNI（Server Name Indication）。可在 debug 模式下解析 `head` buffer 的 SNI 字段并打印。

**文件**: [src/Straightforward.ts](src/Straightforward.ts) `_proxyConnect` / `_proxyConnectViaUpstream`

**理由**: 方便排查"这个 CONNECT 实际连到了哪个域名"，纯调试增强，零性能影响。复杂度 ~20 行。

---

## 功能增强方向

> 以下功能均遵循"保持最小化、零外部依赖"原则。

### 功能六：请求/响应头改写 ✅

详见 [docs/completed/header-rewrite.md](docs/completed/header-rewrite.md)

- [x] **headers 中间件** — 支持 onRequest/onResponse，变量插值，set/remove 操作 — `待提交`

```ts
sf.onRequest.use(middleware.headers({
  request: { set: { "X-Forwarded-For": "${client.ip}" }, remove: ["User-Agent"] },
  response: { set: { "X-Proxied-By": "straightforward" } },
}))
```

**复杂度**: ~40 行，纯中间件。注意 hop-by-hop 头始终被剥离，用户无法覆盖。

### 功能七：连接数限制 ✅

详见 [docs/completed/connection-limit.md](docs/completed/connection-limit.md)

- [x] **connectionLimit 中间件** — 单 IP 并发连接数限制，超限返回 429，支持白名单 — `待提交`

```ts
sf.onRequest.use(middleware.connectionLimit({ maxConnectionsPerIP: 8 }))
```

**复杂度**: ~60 行。维护 `Map<ip, count>`，超限返回 429。

### 功能八：结构化访问日志

```ts
sf.onResponse.use(middleware.accessLog({
  format: "json",
  fields: ["method", "url", "statusCode", "duration", "clientIP"],
}))
```

**复杂度**: ~30 行。

### 功能九：集群模式零停机重启

```ts
sf.gracefulClose({ timeout: 10_000 }) // 10 秒超时后强制关闭
```

**复杂度**: ~30 行。

### 功能十：SOCKS5 上游代理

```ts
sf.onConnect.use(middleware.proxyRules({
  rules: [
    {
      match: "geosite:gfw",
      upstream: { protocol: "socks5", host: "127.0.0.1", port: 1080 },
    },
  ],
}))
```

**复杂度**: ~80 行。在 `_proxyConnectViaUpstream` 中检测 upstream 类型，SOCKS5 握手（版本协商 + 请求 + 地址解析），然后正常 pipe 数据流。

**理由**: Shadowsocks、Trojan、Clash 等工具提供 SOCKS5 接口，不支持则无法级联。

### 功能十一：健康检查端点

```ts
const sf = new Straightforward({ healthCheck: true })
// GET /healthz → 200 { "status": "ok", "uptime": 12345, "connections": 42 }
```

**复杂度**: ~20 行。在 `_onRequest` 中检测路径，匹配 `/healthz` 则直接返回 JSON 状态响应。

**理由**: 部署到负载均衡器后面时需要健康检查端点判断实例是否存活。

### 功能十二：`close()` 优雅关闭

```ts
sf.close({ graceful: true, timeout: 10_000 })
// 停止接受新连接 → 等待现有连接完成 → 超时后强制关闭
```

**复杂度**: ~30 行。与功能九（集群零停机重启）互补：功能九针对集群 worker 退出，此功能针对单实例 graceful shutdown。

### 功能十三：SEA 内置 geosite.dat 规则集

> 计划文档：[~/.claude/plans/snug-inventing-kay.md](~/.claude/plans/snug-inventing-kay.md)

将 geosite.dat (~10MB) 通过 SEA `assets` 配置打包进可执行文件，实现单文件分发、开箱即用的规则分流。

**优先级**：`外部 .txt > 外部 .dat > SEA 内置 .dat`

**变更文件**：
- `sea-config.json` — 添加 `assets: { "rules/geosite.dat": "rules/geosite.dat" }`
- `src/rule-set/geosite-dat.ts` — 拆分 `loadGeositeDat()` → `loadGeositeDat()` + `parseGeositeDat(buf, name)`
- `src/rule-set/resolver.ts` — `createRuleSetResolver()` 接收可选 `builtinDatBuffer?: Buffer`
- `cli.js` — SEA 检测 + asset 读取 + 传入 resolver

**复杂度**: ~30 行代码变更 + 配置。SEA 二进制 ~126MB → ~136MB (+8%)。

**状态**: 📝 计划就绪

```ts
sf.close({ graceful: true, timeout: 10_000 })
// 停止接受新连接 → 等待现有连接完成 → 超时后强制关闭
```

**复杂度**: ~30 行。与功能九（集群零停机重启）互补：功能九针对集群 worker 退出，此功能针对单实例 graceful shutdown。

---

## 功能优先级矩阵

| 功能 | 复杂度 | 价值 | 状态 |
|------|--------|------|------|
| 统一配置文件 (proxyRules) | ~90 行 | 高 | ✅ 已完成 |
| 出口 IP 绑定 | — | — | ✅ 合并入 proxyRules |
| 二级代理 | — | — | ✅ 合并入 proxyRules |
| 域名路由分发 | — | — | ✅ 合并入 proxyRules |
| v2ray-rules-dat 集成 | ~350 行 | 高 | ✅ 已完成 |
| IP ACL | ~170 行 | 中 | ✅ 已完成 |
| geosite.dat 支持 | ~200 行 | 高 | ✅ 已完成 |
| Header 改写 | ~60 行 | 中 | ✅ 已完成 |
| 连接数限制 | ~60 行 | 中 | ✅ 已完成 |
| 结构化日志 | ~30 行 | 低 | 待实现 |
| 优雅关闭 | ~30 行 | 低 | 待实现 |
| SOCKS5 上游代理 | ~80 行 | 中 | 待实现 |
| 健康检查端点 | ~20 行 | 低 | 待实现 |
| close() 优雅关闭 | ~30 行 | 中 | 待实现 |
| SEA 内置 geosite.dat | ~30 行 | 高 | 📝 计划就绪 |

---

## 不做

| 事项 | 理由 |
|------|------|
| SSL 拦截 (MITM) | 违背项目定位 |
| 反向代理 / 负载均衡 | 推荐 nginx |
| 透明代理 | 需要 iptables |
| 缓存代理 | 违背零依赖原则 |
| HTTP/2 上游 | 增加显著复杂度 |
| PAC (Proxy Auto-Config) | 客户端特性 |
| Web 管理界面 | 非核心功能 |
| 上游负载均衡 | 非前向代理职责 |
