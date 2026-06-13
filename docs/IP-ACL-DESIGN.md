# IP ACL (Access Control List) 功能设计文档

> 基于客户端 IP 地址的访问控制中间件，支持白名单、黑名单、CIDR 网段匹配。
> 纯中间件实现，零外部依赖，不需要修改 `Straightforward.ts`。

## 数据模型

```ts
interface AclOptions {
  /** 白名单 — 匹配后直接放行（优先级最高），不在白名单中 → 检查黑名单 */
  allow?: string[]
  /** 黑名单 — 匹配后拒绝连接。空 = 不拒绝任何 IP */
  deny?: string[]
  /** 拒绝时的 HTTP 状态码，默认 403 */
  statusCode?: number
  /** 拒绝时返回的消息文本 */
  message?: string
}
```

### 允许的 IP 格式

| 格式 | 示例 | 匹配规则 |
|------|------|---------|
| 单个 IPv4 | `"10.0.0.1"`, `"127.0.0.1"` | 精确匹配 |
| 单个 IPv6 | `"::1"`, `"fe80::1"` | 精确匹配 |
| CIDR IPv4 | `"10.0.0.0/8"`, `"172.16.0.0/12"`, `"192.168.1.0/24"` | 子网匹配 |
| CIDR IPv6 | `"::1/128"`, `"fe80::/10"` | 子网匹配 |

## 匹配逻辑

```
1. 从 ctx.req 获取客户端 IP（通过 socket.remoteAddress）
2. 如果 allow 列表非空：
   - 遍历 allow 列表，找到匹配 → 放行 (call next())
   - 所有 allow 都不匹配 → 拒绝 (403)
3. 如果 deny 列表非空：
   - 遍历 deny 列表，找到匹配 → 拒绝 (403)
   - 所有 deny 都不匹配 → 放行 (call next())
4. 两个列表都为空 → 放行 (call next())
```

**优先级**：`allow` > `deny`。如果 IP 同时在两个列表中，由于 `allow` 先判断，IP 会被放行。

## 使用示例

```ts
// 只允许内网 IP 和本机访问
sf.onRequest.use(middleware.acl({
  allow: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.1"],
}))

// 拒绝特定 IP，其余放行
sf.onRequest.use(middleware.acl({
  deny: ["192.168.1.100", "10.0.0.0/8"],
}))

// 白名单 + 黑名单组合
sf.onRequest.use(middleware.acl({
  allow: ["10.0.0.0/8"],      // 10.x 内网放行
  deny: ["10.0.0.5"],          // 但 10.0.0.5 被拒绝
  statusCode: 403,
  message: "Access denied by ACL",
}))

// 同时作用于 HTTP 和 CONNECT
sf.onConnect.use(middleware.acl({ allow: ["10.0.0.0/8"] }))
```

## 实现文件

| 文件 | 变更 |
|------|------|
| `src/middleware/acl.ts` | **新建** — ACL 中间件实现 (~50 行) |
| `src/middleware/index.ts` | 导出 `acl` |

## IP 匹配算法（零外部依赖）

```ts
function ipMatches(clientIP: string, rule: string): boolean {
  // 精确匹配：无斜杠
  if (!rule.includes("/")) {
    return clientIP === rule
  }

  // CIDR 匹配
  const [network, bits] = rule.split("/")
  const prefixLen = parseInt(bits, 10)

  const isV4 = net.isIPv4(clientIP) && net.isIPv4(network)
  const isV6 = net.isIPv6(clientIP) && net.isIPv6(network)

  if (!isV4 && !isV6) return false

  if (isV4) {
    const clientNum = ipv4ToNumber(clientIP)
    const networkNum = ipv4ToNumber(network)
    const mask = ~((1 << (32 - prefixLen)) - 1) >>> 0
    return (clientNum & mask) === (networkNum & mask)
  }

  // IPv6: 将地址转为 BigInt，比较前缀
  const clientNum = ipv6ToBigInt(clientIP)
  const networkNum = ipv6ToBigInt(network)
  const mask = ~((1n << BigInt(128 - prefixLen)) - 1n)
  return (clientNum & mask) === (networkNum & mask)
}
```

## 拒绝时的行为

### onRequest (HTTP)

```
HTTP/1.1 403 Forbidden
Content-Type: text/plain

Access denied: your IP 10.0.0.5 is not allowed
```

### onConnect (HTTPS)

```
HTTP/1.1 403 Forbidden
Content-Type: text/plain

Access denied: your IP 10.0.0.5 is not allowed
```

## 测试计划

| 测试 | 说明 |
|------|------|
| `acl allows matching IP` | 精确 IP 在白名单中 → 放行 |
| `acl denies matching IP` | IP 在黑名单中 → 返回 403 |
| `acl allows CIDR subnet` | `10.0.0.0/8` 匹配 `10.1.2.3` → 放行 |
| `acl denies CIDR subnet` | `192.168.0.0/16` 匹配 `192.168.1.1` → 拒绝 |
| `acl allow overrides deny` | IP 同时在白名单和黑名单 → 放行 |
| `acl passes when lists are empty` | 两个列表都为空 → 放行 |
| `acl default deny when allow set but no match` | 不在白名单中 → 拒绝 |
| `acl IPv4 localhost is recognized` | `127.0.0.1` 精确匹配 |
| `acl IPv6 localhost is recognized` | `::1` 精确匹配 |
| `acl custom status code and message` | 拒绝时返回自定义状态码和消息 |
| `acl works with onConnect` | CONNECT 请求被正确拒绝（socket.end） |
| `acl middleware does not call next() on deny` | 拒绝时中间件链停止 |

## CLI 集成（可选，不阻塞）

```bash
# 白名单 IP 或 CIDR（逗号分隔）
straightforward --acl-allow "10.0.0.0/8,127.0.0.1"

# 黑名单 IP 或 CIDR（逗号分隔）
straightforward --acl-deny "192.168.1.100,10.0.0.5"
```

## 复杂度估算

| 组件 | 行数 |
|------|------|
| `src/middleware/acl.ts` | ~50 行 |
| `test/acl.test.ts` | ~80 行 |
| `src/middleware/index.ts` | +1 行 |
| **总计** | **~131 行** |

## 与其他中间件的关系

- `acl` 在中间件链中应放在 `proxyRules` 之前或之后，取决于需求：
  - 放在 `proxyRules` **之前**：先检查 IP，再决定路由 → 未授权的 IP 连路由都不会被计算
  - 放在 `proxyRules` **之后**：先路由，再检查 IP → 可以用来限制特定域名只能从特定 IP 访问
- `acl` 和 `auth` 是互补的：`auth` 验证代理凭据，`acl` 验证来源 IP
