# 请求/响应头改写中间件

> 状态：✅ 已完成

## 概述

新增一个 `headers` 中间件，支持在代理过程中改写请求头和响应头，包括设置、追加和删除。常见场景：

- 添加 `X-Forwarded-For` 让目标服务器知道真实客户端 IP
- 删除 `User-Agent` 隐藏客户端指纹
- 添加 `X-Proxied-By` 标记经过的代理
- 改写 `Cache-Control` 控制缓存行为
- 删除 `Server` / `X-Powered-By` 隐藏源站信息

## 设计方案

### 单个中间件、两种上下文

同一个 `headers` 中间件工厂同时支持 `onRequest` 和 `onResponse`：

- **onRequest**：改写客户端请求头，作用于转发给上游/目标的请求
- **onResponse**：改写上游响应头，作用于返回给客户端的响应

### API 设计

```ts
// 请求头改写
sf.onRequest.use(middleware.headers({
  set: { "X-Forwarded-For": "${client.ip}" },
  remove: ["User-Agent"],
}))

// 响应头改写
sf.onResponse.use(middleware.headers({
  set: { "X-Proxied-By": "straightforward" },
  remove: ["Server", "X-Powered-By"],
}))
```

### 配置类型

```ts
export interface HeadersOptions {
  /** Headers to set or overwrite. Values support variable interpolation. */
  set?: Record<string, string>
  /** Header names to remove (case-insensitive). */
  remove?: string[]
}
```

### 支持的变量

变量在 `set` 的值中使用 `${variableName}` 语法：

| 变量 | 说明 | 可用上下文 |
|------|------|-----------|
| `${client.ip}` | 客户端 IP 地址 | onRequest, onResponse |
| `${target.host}` | 目标服务器主机名 | onRequest, onResponse |
| `${target.port}` | 目标服务器端口 | onRequest, onResponse |
| `${req.method}` | 请求方法 (GET/POST/...) | onRequest, onResponse |
| `${req.url}` | 完整请求 URL | onRequest, onResponse |
| `${proxy.status}` | 上游响应状态码 | onResponse only |
| `${upstream.host}` | 上游代理主机名 | onRequest, onResponse |
| `${upstream.port}` | 上游代理端口 | onRequest, onResponse |

### 执行时机

```
客户端 → onRequest 中间件链 → [_proxyRequest (hop-by-hop 剥离 → headers 已生效)] → 上游
上游 → onResponse 中间件链 → 返回客户端
         ↑
    headers 中间件在此改写响应头
```

- **请求头改写**：在 `onRequest` 阶段，直接修改 `req.headers`。核心代理方法 `_proxyRequest` 已在构造转发头时做了 hop-by-hop 剥离，用户无法覆盖逐跳头。
- **响应头改写**：在 `onResponse` 阶段，直接修改 `proxyRes.headers`。

### 关键设计决策

1. **不做 copy-on-write**：直接修改 `req.headers` / `proxyRes.headers`，零开销
2. **不保护 hop-by-hop 头**：`_proxyRequest` 的 hop-by-hop 剥离在最后执行，即使用户设置了 `Connection` 等头也会被剥离。`set` 阶段不报错，静默覆盖。
3. **变量缺失不抛异常**：如果 `${upstream.host}` 在直连模式下 undefined，替换为空字符串
4. **大小写不敏感**：`remove` 匹配时统一 lower-case 比较
5. **类型安全**：中间件签名自动适配 `onRequest` / `onResponse` 上下文

### 文件结构

```
src/middleware/headers.ts    # 新建：headers 中间件
```

只有 1 个文件，~60 行。

### 伪代码

```ts
export const headers = (opts: HeadersOptions): Middleware<...> => {
  return async (ctx, next) => {
    // 1. 确定当前上下文类型
    const isReq = isRequest(ctx)   // onRequest
    const isRes = isResponse(ctx)  // onResponse

    // 2. 获取要操作的头对象
    let targetHeaders: Record<string, ...>
    if (isReq) {
      targetHeaders = ctx.req.headers
    } else if (isRes) {
      targetHeaders = ctx.proxyRes.headers
    }

    // 3. 删除指定头
    if (opts.remove) {
      for (const name of opts.remove) {
        for (const key of Object.keys(targetHeaders)) {
          if (key.toLowerCase() === name.toLowerCase()) {
            delete targetHeaders[key]
          }
        }
      }
    }

    // 4. 设置指定头（变量插值）
    if (opts.set) {
      const vars = buildVars(ctx)   // 构建变量表
      for (const [name, value] of Object.entries(opts.set)) {
        const resolved = interpolate(value, vars)
        targetHeaders[name] = resolved
      }
    }

    return next()
  }
}
```

## 使用示例

### 基本头改写

```json
{
  "rules": [
    { "match": "*" }
  ]
}
```

```ts
import { Straightforward, middleware } from "straightforward"

const sf = new Straightforward()

// 请求头：添加 X-Forwarded-For，删除 User-Agent
sf.onRequest.use(middleware.headers({
  set: { "X-Forwarded-For": "${client.ip}" },
  remove: ["User-Agent", "Referer"],
}))

// 响应头：隐藏源站信息
sf.onResponse.use(middleware.headers({
  set: { "X-Proxied-By": "straightforward" },
  remove: ["Server", "X-Powered-By", "Via"],
}))

sf.listen(8081)
```

### 与 proxyRules 组合

```ts
sf.onRequest.use(middleware.proxyRules(config))
sf.onRequest.use(middleware.headers({
  set: { "X-Forwarded-For": "${client.ip}" },
}))
sf.onResponse.use(middleware.headers({
  set: { "Cache-Control": "no-store" },
}))
```

> **注意**：`headers` 中间件应在 `proxyRules` 之后注册，这样变量 `${upstream.host}` 能读取到规则匹配结果。

## 边缘情况

| 场景 | 行为 |
|------|------|
| `set` 的 header 名与已有 header 重复 | 覆盖旧值 |
| `remove` 不存在的 header | 静默跳过 |
| 变量 `${upstream.host}` 在直连模式下 | 替换为空字符串 `""` |
| hop-by-hop 头（如 `Connection`）被 set | 在 `_proxyRequest` 中会被剥离 |
| CONNECT 隧道 | 不适用（CONNECT 无 HTTP 头改写） |
| `set` 和 `remove` 同时为空 | 直接 next()，零开销 |

## CLI 集成

不新增 CLI 选项。`headers` 中间件是纯编程式 API，仅在代码中使用。

## 测试

| 测试 | 说明 |
|------|------|
| set request headers | 设置请求头，验证生效 |
| remove request headers | 删除请求头 |
| set response headers | 设置响应头 |
| remove response headers | 删除响应头 |
| variable interpolation | `${client.ip}` 等变量替换 |
| missing variable → empty string | undefined 变量降级 |
| case-insensitive remove | 大小写不敏感删除 |
| empty opts → noop | 无操作直通 |
| works with proxyRules | 组合使用，变量能读取 upstream |

## 复杂度

~60 行代码，零外部依赖，纯中间件操作。不影响核心代理逻辑。
