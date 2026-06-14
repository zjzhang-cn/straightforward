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

#### 3.2 升级依赖

| 包 | 当前版本 | 建议版本 | 理由 |
|---|---------|---------|------|
| `esbuild` | `^0.15.14` | `^0.24.0` | 性能改进 |
| `typescript` | `^4.9.3` | `^5.5.0` | TS 5 更好类型推断 |
| `ava` | `^5.1.0` | `^6.0.0` | ESM 支持 |
| `@types/node` | `^18.11.9` | `^20.0.0` | 匹配 engines >= 16 |

#### 3.3 CONNECT 隧道 Socket Keep-Alive

**文件**: [src/Straightforward.ts](src/Straightforward.ts)

```diff
+serverSocket.setKeepAlive(true, 60_000)
+clientSocket.setKeepAlive(true, 60_000)
```

**理由**: 长时 CONNECT 隧道可能被防火墙超时断开。

#### 3.4 EventEmitter 警告

压力测试中出现 `MaxListenersExceededWarning`，可在 `_proxyRequest` 中为 socket timeout 设置合理上限。

---

## 功能增强方向

> 以下功能均遵循"保持最小化、零外部依赖"原则。

### 功能六：请求/响应头改写

```ts
sf.onRequest.use(middleware.headers({
  request: { set: { "X-Forwarded-For": "${client.ip}" }, remove: ["User-Agent"] },
  response: { set: { "X-Proxied-By": "straightforward" } },
}))
```

**复杂度**: ~40 行，纯中间件。注意 hop-by-hop 头始终被剥离，用户无法覆盖。

### 功能七：连接数限制

```ts
sf.onRequest.use(middleware.connectionLimit({ maxConnectionsPerIP: 8 }))
```

**复杂度**: ~50 行。维护 `Map<ip, count>`，超限返回 429。

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
| Header 改写 | ~40 行 | 中 | 待实现 |
| 连接数限制 | ~50 行 | 中 | 待实现 |
| 结构化日志 | ~30 行 | 低 | 待实现 |
| 优雅关闭 | ~30 行 | 低 | 待实现 |

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
