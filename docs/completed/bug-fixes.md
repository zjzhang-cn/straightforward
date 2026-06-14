# Bug 修复记录

> 最后更新：2026-06-14

## P0 — 紧急 Bug 修复 (5/5) ✅

- [x] **P0-1**: 将 `server` 事件监听器移至构造函数，移除 `process.on("uncaughtException")` — commit `09d7d6d`
- [x] **P0-2**: `_populateUrlParts` 不再 `throw`，改为返回 `boolean`，调用方返回 400/502 — commit `80d9c45`
- [x] **P0-3**: CONNECT URL 解析支持 IPv6 地址 (`[::1]:443`) — commit `0f6c85d`
- [x] **P0-4**: `net.connect` error 处理器提前注册，连接失败返回 502 Bad Gateway — commit `6f8c249`

## 安全 & 兼容性修复 ✅

- [x] **Auth: Basic 认证大小写不敏感** — commit `d708cbd`
- [x] **Auth: user/pass 校验修复** — commit `d708cbd`
- [x] **CLI: DEBUG env 拼接修复** — commit `d708cbd`

### Auth: Basic 认证大小写不敏感

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

### Auth: 只传 `user` 不传 `pass` 时静默失效

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

### CLI: DEBUG 环境变量拼接 bug

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

## upstream CONNECT 隧道修复 ✅

> 详细文档见 [docs/bugs/upstream-connect-fix.md](bugs/upstream-connect-fix.md)

- [x] **v2ray 规则文件 `full:` 前缀解析**: 修复 `full:dl.google.com` 字面匹配失败 — commit `5fa7cc1`
- [x] **head 缓冲区转发**: `_proxyConnectViaUpstream` 收到 200 后将 TLS ClientHello 写入上游 — commit `5fa7cc1`
- [x] **removeAllListeners 时序修复**: 移到 pipe() 之前，避免删掉 pipe 的 data 监听器 — commit `5fa7cc1`
