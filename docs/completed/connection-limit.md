# 连接数限制中间件

> 状态：✅ 已完成

## 概述

新增 `connectionLimit` 中间件，限制单个 IP 的并发连接数，防止滥用。超限返回 429 Too Many Requests。

## 设计方案

### API

```ts
sf.onRequest.use(middleware.connectionLimit({ maxConnectionsPerIP: 8 }))
sf.onConnect.use(middleware.connectionLimit({ maxConnectionsPerIP: 8 }))
```

### 配置类型

```ts
export interface ConnectionLimitOptions {
  /** 每个 IP 最大并发连接数。默认 50 */
  maxConnectionsPerIP?: number
  /** HTTP 状态码。默认 429 */
  statusCode?: number
  /** 拒绝消息。默认 "Too Many Requests" */
  message?: string
  /** 排除的 IP 列表（不受限制）。如 "127.0.0.1" */
  whitelist?: string[]
}
```

### 计数机制

维护 `Map<clientIP, count>`，每个请求到来时 +1，请求结束时 -1。

```ts
const connections = new Map<string, number>()

// 请求进入
const ip = ctx.req.socket.remoteAddress
const current = connections.get(ip) || 0
if (current >= max) return send429(...)
connections.set(ip, current + 1)

// 请求结束（通过 'close' / 'finish' 事件）
ctx.req.on("close", () => {
  const c = connections.get(ip) || 1
  if (c <= 1) connections.delete(ip)
  else connections.set(ip, c - 1)
})
```

### 执行时机

```
客户端 → onRequest 中间件链 → [connectionLimit 计数 +1] → proxyRequest → 响应 → 'close' 事件 → 计数 -1
客户端 → onConnect 中间件链 → [connectionLimit 计数 +1] → proxyConnect → 响应 → 'close' 事件 → 计数 -1
```

### 关键设计决策

1. **onRequest 和 onConnect 分开计数**：HTTP 请求和 CONNECT 隧道各自独立。用户可以选择只限制一种。
2. **同时注册两者时计数累加**：一个 IP 可以同时有 8 个 HTTP + 8 个 CONNECT。
3. **请求结束后 -1**：监听 `req.on("close")` 确保无论成功/失败/超时都会释放计数槽位。
4. **内存安全**：`Map<ip, count>` 在最后一个连接关闭时删除条目。
5. **白名单**：`127.0.0.1` 等本地 IP 不应被限制。

### 文件结构

```
src/middleware/connectionLimit.ts    # 新建
test/connection-limit.test.ts       # 新建
```

### 伪代码

```ts
export const connectionLimit = (opts: ConnectionLimitOptions): Middleware<...> => {
  const max = opts.maxConnectionsPerIP ?? 50
  const whitelist = new Set(opts.whitelist ?? ["127.0.0.1", "::1"])
  const connections = new Map<string, number>()

  return async (ctx, next) => {
    const ip = ctx.req.socket.remoteAddress || "unknown"

    if (whitelist.has(ip)) return next()

    const current = connections.get(ip) || 0
    if (current >= max) {
      debug("connectionLimit: %s exceeded limit (%d), returning %d", ip, max, statusCode)
      return sendDeny(ctx, statusCode, message)
    }

    connections.set(ip, current + 1)
    debug("connectionLimit: %s → %d/%d", ip, current + 1, max)

    ctx.req.on("close", () => {
      const c = connections.get(ip) || 1
      if (c <= 1) connections.delete(ip)
      else connections.set(ip, c - 1)
    })

    return next()
  }
}
```

### CLI 集成

不新增 CLI 选项，纯编程式 API。

## 测试

| 测试 | 说明 |
|------|------|
| allows request under limit | 未超限请求正常通过 |
| blocks request over limit | 超限请求返回 429 |
| releases slot on close | 连接关闭后槽位释放 |
| whitelist bypass | 白名单 IP 不受限制 |
| default maxConnectionsPerIP = 50 | 默认值验证 |
| per-IP isolation | 不同 IP 独立计数 |
| cleanup on last connection | 最后一个连接释放后删除 Map 条目 |

## 复杂度

~60 行代码。零外部依赖。
