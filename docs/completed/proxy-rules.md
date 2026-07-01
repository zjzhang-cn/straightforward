# 统一配置文件 (proxyRules)

> 最后更新：2026-06-14 | 状态：✅ 已完成

## 概述

将**出口 IP 绑定**、**二级代理**、**域名路由分发**三个能力合并为一个统一的配置文件规则系统，用 `proxyrules.json` 驱动整个代理行为。

单个规则文件解决三个独立中间件无法回答的问题：**"指定域名 → 指定出口 IP → 经过指定上游代理 → 到达目标"**

## 实现清单

- [x] **proxyRules 中间件** — commit `857fc5c`
- [x] **核心路由感知** (`_proxyRequest` / `_proxyConnect`) — commit `857fc5c`
- [x] **CLI 三层配置** (`--rules` / `--upstream` / 零配置) — commit `746e121`
- [x] **proxyRules 单元测试** (16 tests) — commit `a21601e`
- [x] **全局 localAddress** (`Straightforward({ localAddress })`) — commit `09d9ea9`
- [x] **CLI `--local-address` 透传** — commit `76b6757`

## 规则数据结构

```ts
interface ProxyRule {
  match: string        // Glob 模式: "*.google.com", "geosite:gfw", "*"
  type?: "http" | "connect"  // 可选，仅对特定请求类型生效
  localAddress?: string       // 出口源 IP
  upstream?: "http://proxy.example.com:8080" | {  // 上游代理 (URL 字符串或对象)
    host: string
    port: number
    protocol?: "http" | "socks5"
    auth?: { user: string; pass: string }
  } | null                    // null = 直连
}
```

## 三层配置

| 层级 | 使用方式 | 灵活性 |
|------|---------|--------|
| 零配置 | `straightforward` | 最小：直连，系统选出口 |
| CLI 参数 | `--upstream --local-address` | 中：全局统一行为 |
| 配置文件 | `--rules proxyrules.json` | 高：按域名精细控制 |

## Glob → Regex 转换（零依赖，~12 行）

```ts
function globToRegex(glob: string): RegExp {
  if (glob === "*") return /^.+$/i
  let result = ""
  // * → [^.]*  (单段), ** → .*  (跨段)
  // 转义特殊字符
  return new RegExp("^" + result + "$", "i")
}
```

## 设计决策

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| 1 | `upstream: null` vs `undefined` | `null` 显式直连 | 语义清晰 |
| 2 | `type?: "http" \| "connect"` | 已实现 | 支持 HTTP/CONNECT 分别路由 |
| 3 | `priority` 字段 | 不做 | 数组顺序对 JSON 配置足够 |
| 4 | 上游超时/重试/熔断 | 不做 | 责任在上游代理节点 |
| 5 | 多维度匹配 | 不做 | hostname 匹配足够 |
| 6 | 上游负载均衡 | 不做 | 非前向代理职责 |
