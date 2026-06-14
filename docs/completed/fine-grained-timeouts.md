# 细粒度超时控制

> 状态：✅ 已完成

## 概述

当前只有一个 `requestTimeout`（默认 60s），通过 `socket.setTimeout()` 同时控制连接建立和空闲读取。这不够精细化：连接超时和空闲超时是两个不同阶段，应该独立控制。

目标：新增 `connectTimeout` 和 `readTimeout`，与现有 `requestTimeout` 共存。

## 设计方案

### 配置接口

```ts
export interface StraightforwardOptions {
  /** TCP 连接建立超时（毫秒）。默认 10s */
  connectTimeout?: number
  /** Socket 空闲读超时（毫秒）。连接建立后无数据则超时。默认 30s */
  readTimeout?: number
  /** @deprecated 保留向后兼容，映射为 connectTimeout + readTimeout 的组合。默认 60s */
  requestTimeout?: number
  localAddress?: string
  dns?: string
}
```

### 优先级逻辑

```
1. 显式设置 connectTimeout → 使用该值
2. 显式设置 requestTimeout（无 connectTimeout） → connectTimeout = requestTimeout（向后兼容）
3. 都未设置 → connectTimeout = 10_000（默认）

同理 readTimeout。
```

在构造函数中解析：

```ts
this.#connectTimeout = opts.connectTimeout ?? opts.requestTimeout ?? 10_000
this.#readTimeout = opts.readTimeout ?? opts.requestTimeout ?? 30_000
```

### 连接超时实现（HTTP 请求）

`http.request()` 本身不提供连接超时选项。需要手动计时：

```ts
const connectTimer = setTimeout(() => {
  proxyReq.destroy(new Error("Connect timeout"))
}, this.#connectTimeout)

proxyReq.on("socket", (socket) => {
  clearTimeout(connectTimer)  // 连接成功，清除连接超时
  socket.setTimeout(this.#readTimeout, () => {
    proxyReq.destroy(new Error("Read timeout"))
  })
  // ... pipe
})
```

### 连接超时实现（CONNECT 隧道）

`net.connect()` 同样不提供连接超时。手动计时：

```ts
const connectTimer = setTimeout(() => {
  serverSocket.destroy(new Error("Connect timeout"))
}, this.#connectTimeout)

const serverSocket = net.connect(connectOpts, () => {
  clearTimeout(connectTimer)
  serverSocket.setTimeout(this.#readTimeout, () => {
    serverSocket.destroy(new Error("Read timeout"))
  })
  // ... pipe
})
```

### 读超时说明

`socket.setTimeout(ms, callback)` 的行为：如果在 `ms` 毫秒内 socket 处于空闲状态（无数据读写），则触发回调。每次有数据读写时计时器自动重置。这正好满足"读超时"的语义：数据传输中不会超时，只有卡住时才超时。

### 注入点

| 方法 | connectTimeout | readTimeout |
|------|---------------|-------------|
| `_proxyRequest` | 手动 setTimeout，socket 事件时清除 | `socket.setTimeout()` |
| `_proxyRequestViaUpstream` | 同上 | `socket.setTimeout()` |
| `_proxyConnect` | 手动 setTimeout，connect 回调时清除 | `serverSocket.setTimeout()` |
| `_proxyConnectViaUpstream` | 同上 | `upstreamSocket.setTimeout()` |

### 向后兼容

| 现有代码 | 行为 |
|----------|------|
| `new Straightforward()` | connect=10s, read=30s（新的默认值） |
| `new Straightforward({ requestTimeout: 20000 })` | connect=20s, read=20s（都使用 requestTimeout） |
| `new Straightforward({ connectTimeout: 5000, readTimeout: 15000 })` | 纯新配置 |

> **注意**：默认值从 60s 拆分为 connect=10s + read=30s。这是一个行为变更：以前连接建立最多等 60s，现在最多等 10s。这在实践中更合理（连接应该在 10s 内完成）。

### 文件变更

```
src/Straightforward.ts    # 修改：构造函数 + 4 个代理方法
test/timeout.test.ts      # 新建：单元测试
```

## 测试

| 测试 | 说明 |
|------|------|
| default timeouts | connectTimeout=10s, readTimeout=30s |
| custom connectTimeout | opts.connectTimeout 生效 |
| custom readTimeout | opts.readTimeout 生效 |
| backward compat: requestTimeout | opts.requestTimeout 兼容 |
| connectTimeout fires on slow connect | 连接超时触发 |
| readTimeout fires on idle socket | 读超时触发 |
| connectTimeout + readTimeout override requestTimeout | 新配置优先 |
