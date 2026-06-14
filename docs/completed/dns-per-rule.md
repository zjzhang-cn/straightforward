# 按规则指定 DNS 服务器

> 状态：✅ 已完成 | commit `54779f7`

## 概述

支持在代理规则中为不同域名指定不同的 DNS 服务器。当前代理完全依赖操作系统默认 DNS 解析，新增功能允许：

- GFW 封锁域名 → 使用 `8.8.8.8` 等海外 DNS 避免 DNS 污染
- 国内域名 → 使用 `223.5.5.5` 等国内 DNS 获得更快解析和就近 CDN
- 内网域名 → 使用内网 DNS 解析内部服务

## 设计方案

### 核心机制：Node.js `lookup` 选项

Node.js 的 `http.request()` 和 `net.connect()` 都支持自定义 `lookup` 函数。使用 `dns.promises.Resolver`（支持实例级 DNS 服务器配置，不影响全局），每个 DNS 服务器创建一个 `Resolver` 实例并缓存。

### 文件结构

```
src/
  dns-resolver.ts          # 新增：DNS lookup 工厂函数 + 缓存
  Straightforward.ts       # 修改：4 个代理方法注入 lookup
  middleware/proxyRules.ts  # 修改：类型 + 中间件传播
cli.js                     # 修改：--dns CLI 选项
test/dns-resolver.test.ts  # 新增：12 个单元测试
```

### DNS Resolver 模块 (`src/dns-resolver.ts`)

```ts
import { promises as dnsPromises, LookupFunction } from "dns"
import * as net from "net"

const resolverCache = new Map<string, dnsPromises.Resolver>()
const MAX_CACHE_SIZE = 20

export function createLookupFunction(dnsServer: string): LookupFunction {
  let resolver = resolverCache.get(dnsServer)
  if (!resolver) {
    // FIFO 淘汰
    if (resolverCache.size >= MAX_CACHE_SIZE) { ... }
    resolver = new dnsPromises.Resolver()
    resolver.setServers([dnsServer])
    resolverCache.set(dnsServer, resolver)
  }
  return (hostname, options, callback) => {
    const promise = options.family === 6
      ? resolver!.resolve6(hostname)
      : resolver!.resolve4(hostname)
    promise.then(addrs => callback(null, addrs[0], ...))
           .catch(err => callback(err, "", 0))
  }
}
```

### 优先级链（与 `localAddress` 一致）

```
per-rule dns > CLI --dns / opts.dns > OS 默认
```

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | 规则中的 `dns` 字段 | 最高优先级，按域名精细控制 |
| 2 | `--dns` CLI 选项 | 全局默认，作用于所有连接 |
| 3 | OS 默认 | `lookup` 为 `undefined`，行为不变 |

### 类型变更

**ProxyRule** 新增 `dns?: string`

```typescript
export interface ProxyRule {
  match: string
  type?: "http" | "connect"
  localAddress?: string
  upstream?: UpstreamProxy
  dns?: string  // 新增
}
```

**RequestLocals** 新增 `dns?: string`

```typescript
export interface RequestLocals {
  isConnect: boolean
  urlParts: { host: string; port: number; path: string }
  upstream?: { host: string; port: number; auth?: { user: string; pass: string } }
  localAddress?: string
  dns?: string  // 新增
}
```

### 注入点（4 个代理方法）

| 方法 | 注入位置 | 解析目标 |
|------|---------|---------|
| `_proxyRequest` | `http.request({ lookup })` | 目标服务器 |
| `_proxyRequestViaUpstream` | `http.request({ lookup })` | 上游代理 |
| `_proxyConnect` | `net.connect({ lookup })` | 目标服务器 |
| `_proxyConnectViaUpstream` | `net.connect({ lookup })` | 上游代理 |

**关键设计**：走上游代理时，DNS 解析的是**上游代理的 hostname**（非目标），这符合代理链语义。

### 默认行为（零变更）

当 `dns` 未指定时，`lookup` 为 `undefined`，Node.js 使用 OS 默认 DNS，与之前行为完全一致。

## CLI 使用

### --dns 选项

```bash
# 全局指定 DNS
straightforward --dns 8.8.8.8

# 组合使用
straightforward --dns 8.8.8.8 --rules rules.json
```

### Help 输出

```
网络:
  --local-address  出口源 IP 地址 (多网卡选择出口)    [字符串]
  --dns            自定义 DNS 服务器 (格式: IP地址)    [字符串]
```

## 配置示例

### 基础 DNS 分流

```json
{
  "rules": [
    { "match": "geosite:gfw", "dns": "8.8.8.8", "upstream": { "host": "127.0.0.1", "port": 1082 } },
    { "match": "geosite:cn", "dns": "223.5.5.5", "upstream": null },
    { "match": "*", "dns": "8.8.8.8" }
  ]
}
```

### DNS + upstream + localAddress 组合

```json
{
  "rules": [
    {
      "match": "geosite:gfw",
      "dns": "8.8.8.8",
      "localAddress": "198.18.0.1",
      "upstream": { "host": "127.0.0.1", "port": 1082 }
    },
    {
      "match": "geosite:cn",
      "dns": "223.5.5.5",
      "localAddress": "192.168.3.78",
      "upstream": null
    }
  ]
}
```

### 仅 DNS 分流（无上游代理）

```json
{
  "rules": [
    { "match": "geosite:gfw", "dns": "8.8.8.8" },
    { "match": "geosite:cn", "dns": "223.5.5.5" },
    { "match": "*", "dns": "1.1.1.1" }
  ]
}
```

## 调试输出

```
straightforward proxyConnect: CONNECT www.google.com:443 → direct to www.google.com:443 (bind=OS default, dns=8.8.8.8)
straightforward proxyConnect: CONNECT www.baidu.com:443 → direct to www.baidu.com:443 (bind=192.168.3.78, dns=223.5.5.5)
```

## 测试

12 个单元测试：

| 测试 | 说明 |
|------|------|
| `createLookupFunction returns a function` | 工厂函数返回 lookup 函数 |
| `resolver instances are cached` | 同一 DNS 服务器复用 Resolver |
| `different DNS servers return different functions` | 不同 DNS 服务器不同实例 |
| `lookup calls callback with address` | 真实 DNS 解析验证 |
| `invalid DNS server produces error` | 无效 DNS 服务器错误处理 |
| `opts.dns is available` | Straightforward 选项传递 |
| `no dns by default` | 默认无 DNS |
| `per-rule dns is set on req.locals` | 规则 DNS 传播到 locals |
| `missing dns leaves req.locals.dns undefined` | 无 DNS 规则不污染 |
| `default.dns is applied` | 默认 DNS 应用到未匹配规则 |
| `per-rule dns overrides default.dns` | 规则 DNS 优先于默认 |
| `dns works alongside upstream and localAddress` | 三种字段共存 |
