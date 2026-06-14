# straightforward

> 一个用 Node.js 编写的极简正向代理服务器

[![npm](https://img.shields.io/npm/v/straightforward.svg)](https://www.npmjs.com/package/straightforward)
[![size](https://img.shields.io/bundlephobia/min/straightforward)](https://bundlephobia.com/package/straightforward)
[![license](https://img.shields.io/npm/l/straightforward.svg)](https://github.com/berstend/straightforward/blob/master/LICENSE)

---

## 目录

- [项目简介](#项目简介)
- [核心特性](#核心特性)
- [安装与构建](#安装与构建)
- [快速开始](#快速开始)
- [CLI 完整参数](#cli-完整参数)
- [配置文件详解](#配置文件详解)
- [v2ray 规则集集成](#v2ray-规则集集成)
- [中间件系统](#中间件系统)
- [程序化使用 (API)](#程序化使用-api)
- [架构说明](#架构说明)
- [性能优化](#性能优化)
- [IP 访问控制 (ACL)](#ip-访问控制-acl)
- [Node.js SEA 独立可执行文件](#nodejs-sea-独立可执行文件)
- [测试](#测试)
- [常见问题 (FAQ)](#常见问题-faq)

---

## 项目简介

`straightforward` 是一个极简 (~200 行核心代码) 的 Node.js 正向代理服务器。支持 HTTP、HTTPS (CONNECT 隧道) 和 WebSocket (wss) 代理。所有请求/响应默认流式传输，无外部运行时依赖（仅 `debug` 和 `yargs`）。

### 适用场景

- 快速启动一个正向代理，开箱即用
- 按域名/IP 路由到不同的上游代理（分流）
- 绑定不同出口 IP（多网卡服务器）
- 使用 v2ray 规则集（`geosite:cn`、`geosite:gfw` 等）智能分流
- Mock 响应用于测试
- 作为代理链的中间节点

### 不支持的场景

| 不支持 | 原因 |
|--------|------|
| SSL 拦截 (MITM) | 违背正向代理定位，推荐 mitmproxy |
| 反向代理 / 负载均衡 | 推荐 nginx、node-http-proxy |
| 透明代理 | 需要 iptables，非应用层 |
| 缓存代理 | 增加复杂度，违背零依赖原则 |

---

## 核心特性

| 特性 | 说明 |
|------|------|
| HTTP/HTTPS/WebSocket 代理 | 支持 CONNECT 隧道、HTTP 转发、wss |
| 统一配置文件 (`proxyRules`) | 一条规则同时控制：路由 + 出口 IP + 上游代理 + DNS |
| v2ray 规则集 (`geosite:`) | 支持 `.txt` 和 `.dat` 二进制格式，1500+ 标签 |
| 自动下载规则文件 | 从 GitHub Release 自动获取最新规则 |
| IP ACL 访问控制 | 白名单/黑名单、CIDR 匹配、IPv4/IPv6 |
| 认证中间件 | 静态密码 / 动态认证 |
| 请求/响应头改写 | 变量插值、set/remove 操作 |
| 连接数限制 | 按 IP 限制并发连接数，白名单豁免 |
| 按规则指定 DNS 服务器 | 不同域名使用不同 DNS 服务器避免污染 |
| 细粒度超时控制 | connectTimeout + readTimeout 分离 |
| 零外部运行时依赖 | 仅 `debug` + `yargs`，手写 protobuf 解码器 |
| TCP_NODELAY | CONNECT 隧道消除 40ms+ Nagle 延迟 |
| HTTP Keep-Alive | 上游连接复用，吞吐量提升 5x |
| Hop-by-hop 头清理 | 自动剥离逐跳头防止连接错乱 |
| 集群模式 | 利用多核 CPU |
| Node.js SEA | 打包为独立可执行文件，无需 Node.js 运行时 |

---

## 安装与构建

### 环境要求

- Node.js >= 16
- npm 或 yarn

### 安装

```bash
# 全局安装
npm install -g straightforward

# 或使用 npx 无需安装
npx straightforward --port 8081

# 或克隆仓库
git clone https://github.com/berstend/straightforward.git
cd straightforward
npm install
```

### 构建

```bash
# 构建 CJS + ESM + 类型声明
npm run build

# 构建 CLI 单文件打包 (esbuild)
npm run build:sea:bundle

# 构建独立可执行文件 (Node.js SEA)
npm run build:sea
# 
dist/straightforward --rules-dir ./rules/ --rules rules.local.json --port 8081 -d
```

### 运行测试

```bash
# 运行全部测试
npm test

# 运行单个测试文件
npx ava -v test/basics.test.ts

# 按标题过滤测试
npx ava -v -m "can proxy basic http requests"
```

---

## 快速开始

### 最简启动

```bash
# 启动代理，监听 8081 端口
straightforward --port 8081

# 或
node cli.js --port 8081
```

```bash
# 使用代理
curl -x http://127.0.0.1:8081 http://httpbin.org/ip
curl -x http://127.0.0.1:8081 https://www.google.com
```

### 带认证

```bash
straightforward --port 8081 --auth "user:pass"
curl -x http://user:pass@127.0.0.1:8081 http://httpbin.org/ip
```

### 指定上游代理

```bash
straightforward --port 8081 --upstream-host proxy.example.com --upstream-port 3128 --upstream-auth "user:pass"
```

### 绑定出口 IP（多网卡服务器）

```bash
straightforward --port 8081 --local-address 10.0.0.1
```

### 使用配置文件分流

```bash
straightforward --port 8081 --rules ./proxyrules.json
```

---

## CLI 完整参数

```
Usage: straightforward --port 9191 [options]

Options:
  -p, --port              监听端口                        [number] [default: 8081]
      --host              监听地址/接口                    [string] [default: "0.0.0.0"]
  -a, --auth              启用代理认证 (格式: user:pass)   [string]
      --dynamic-auth      启用动态认证（不校验）           [boolean]
  -e, --echo              启用回显模式（mock 响应）        [boolean]
  -d, --debug             启用调试输出                     [boolean]
  -c, --cluster           集群模式（按 CPU 数量）          [boolean]
      --cluster-count     指定集群 worker 数量             [number]
      --rules             代理规则配置文件路径             [string]
      --rules-dir         规则集目录（用于 geosite: 前缀） [string]
      --rules-download    自动下载 .txt 规则文件           [string]
      --rules-download-dat  下载 geosite.dat 二进制文件    [boolean]
      --rules-download-force  强制重新下载                 [boolean]
      --upstream-host     上游代理主机                     [string]
      --upstream-port     上游代理端口                     [number] [default: 3128]
      --upstream-auth     上游代理认证 (格式: user:pass)   [string]
      --local-address     出口源 IP 地址                   [string]
  -q, --quiet             静默请求日志                     [boolean]
  -s, --silent            完全不输出到 stdout              [boolean]
  -h, --help              显示帮助信息                     [boolean]
```

### 启动示例

```bash
# 基本代理
straightforward --port 8081

# 开启 debug 模式（显示连接线路信息）
straightforward --port 8081 --debug

# 使用配置文件 + 规则集目录
straightforward --port 8081 --rules-dir ./rules/ --rules rules.json

# 自动下载规则文件（.txt 格式）
straightforward --rules-dir ./rules/ --rules-download

# 自动下载 geosite.dat（二进制格式，1500+ 标签）
straightforward --rules-dir ./rules/ --rules-download-dat

# 下载全部
straightforward --rules-dir ./rules/ --rules-download --rules-download-dat

# 集群模式
straightforward --port 8081 --cluster
```

---

## 配置文件详解

### 三层配置体系

| 层级 | 使用方式 | 灵活性 |
|------|---------|--------|
| 零配置 | `straightforward` | 最小：所有流量直连 |
| CLI 参数 | `--upstream-host --local-address` | 中：全局统一行为 |
| 配置文件 | `--rules proxyrules.json` | 高：按域名精细控制 |

### 配置文件格式

```json
{
  "rules": [
    {
      "match": "geosite:cn",
      "localAddress": "192.168.3.78",
      "upstream": null
    },
    {
      "match": "geosite:gfw",
      "upstream": {
        "host": "127.0.0.1",
        "port": 1082
      }
    },
    {
      "match": "*.google.com",
      "upstream": {
        "host": "proxy-us.example.com",
        "port": 8080,
        "auth": {
          "user": "bob",
          "pass": "secret"
        }
      }
    },
    {
      "match": "192.168.*",
      "upstream": null
    },
    {
      "match": "*",
      "upstream": null
    }
  ]
}
```

### 规则字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `match` | `string` | 匹配模式（见下方） |
| `type` | `"http" \| "connect"` | 可选，仅对特定请求类型生效 |
| `localAddress` | `string` | 可选，出口源 IP（`"0.0.0.0"` = 系统默认） |
| `upstream` | `object \| null` | 可选，上游代理（`null` = 直连） |
| `upstream.host` | `string` | 上游代理主机 |
| `upstream.port` | `number` | 上游代理端口 |
| `upstream.auth` | `{ user, pass }` | 可选，上游代理认证 |
| `dns` | `string` | 可选，自定义 DNS 服务器（如 `"8.8.8.8"`） |

### 匹配模式 (`match`)

| 模式 | 说明 | 示例 |
|------|------|------|
| `*` | 通配符，匹配所有 | `"*"` |
| `*.domain.com` | 子域名通配 | `"*.google.com"` → 匹配 `www.google.com` |
| `geosite:tag` | v2ray 规则集 | `"geosite:gfw"`、`"geosite:cn"` |
| `geosite:./path.txt` | 自定义规则文件 | `"geosite:./custom.txt"` |

**规则从上到下匹配，第一条匹配的规则生效。**

### DNS 分流

支持在规则中为不同域名指定不同的 DNS 服务器，优先级：`per-rule dns > CLI --dns > OS 默认`。

```json
{
  "rules": [
    {
      "match": "geosite:gfw",
      "dns": "8.8.8.8",
      "upstream": { "host": "127.0.0.1", "port": 1082 }
    },
    {
      "match": "geosite:cn",
      "dns": "223.5.5.5",
      "upstream": null
    },
    {
      "match": "*",
      "dns": "1.1.1.1"
    }
  ]
}
```

DNS 解析使用 `dns.promises.Resolver` 实例（不影响系统全局 DNS），Resolver 实例按服务器地址缓存（FIFO，最多 20 个）。

### 匹配优先级

1. **geosite:tag** — 查询规则集（DomainTrie，O(域名长度)）
2. **glob 模式** — `*` 通配符匹配（转换为正则）

---

## v2ray 规则集集成

### 概述

支持 v2ray 生态的两种规则文件格式：

| 格式 | 说明 | 标签数量 |
|------|------|---------|
| `.txt` | 文本格式，每行一个域名 | 每个文件一个标签 |
| `.dat` | 二进制 protobuf 格式 | 单文件 1500+ 标签 |

### 快速使用

#### 方法一：使用 geosite.dat（推荐）

```bash
# 1. 自动下载 geosite.dat
straightforward --rules-dir ./rules/ --rules-download-dat

# 2. 编写配置文件 rules.local.json
cat > rules.local.json << 'EOF'
{
  "rules": [
    { "match": "geosite:cn", "upstream": null },
    { "match": "geosite:gfw", "upstream": { "host": "127.0.0.1", "port": 1082 } },
    { "match": "*", "upstream": null }
  ]
}
EOF

# 3. 启动代理
straightforward --rules-dir ./rules/ --rules rules.local.json --port 8081
```

#### 方法二：使用 .txt 文件

```bash
# 1. 自动下载常用 .txt 规则文件
straightforward --rules-dir ./rules/ --rules-download

# 2. 或手动下载指定标签
straightforward --rules-dir ./rules/ --rules-download gfw,apple-cn,google-cn

# 3. 启动（与 geosite.dat 相同，.txt 标签优先级高于 .dat）
straightforward --rules-dir ./rules/ --rules rules.local.json --port 8081
```

### 标签优先级

- `.txt` 文件标签 **优先于** `.dat` 内同名标签
- 例如：`rules/gfw.txt` 的 `gfw` 标签会覆盖 `geosite.dat` 中的 `gfw` 标签
- 这允许你用自定义 `.txt` 覆盖 `.dat` 中的任何规则

### 域名类型映射

| 类型 | `.txt` 前缀 | `.dat` 枚举值 | 匹配行为 |
|------|------------|--------------|---------|
| Domain | `domain:` | 2 | 后缀匹配：`google.com` → `www.google.com` |
| Full | `full:` | 3 | 精确匹配：`google.com` 仅匹配 `google.com` |
| 无前缀 | 无 | — | 后缀匹配（默认） |
| Plain | `keyword:` | 0 | 跳过 |
| Regex | `regexp:` | 1 | 跳过 |

### 可用标签示例（来自 geosite.dat）

常用的标签（均小写）：

| 标签 | 说明 | 域名数量 |
|------|------|---------|
| `cn` | 中国域名 | ~112,000 |
| `gfw` | GFW 封锁域名 | ~4,200 |
| `google` | Google 全部 | ~1,000 |
| `apple-cn` | Apple 中国 CDN | ~160 |
| `geolocation-!cn` | 非中国域名 | ~26,000 |
| `telegram` | Telegram | ~20 |
| `twitter` | Twitter/X | ~24 |
| `youtube` | YouTube | — |
| `github` | GitHub | — |
| `microsoft` | Microsoft | — |

完整列表：[v2fly/domain-list-community](https://github.com/v2fly/domain-list-community)

### 集成规则示例

```json
{
  "rules": [
    {
      "match": "geosite:gfw",
      "localAddress": "198.18.0.1",
      "upstream": {
        "host": "127.0.0.1",
        "port": 1082
      }
    },
    {
      "match": "geosite:cn",
      "localAddress": "192.168.3.78",
      "upstream": null
    },
    {
      "match": "geosite:apple-cn",
      "localAddress": "192.168.3.78",
      "upstream": null
    },
    {
      "match": "*.cn",
      "localAddress": "192.168.3.78",
      "upstream": null
    },
    {
      "match": "*",
      "localAddress": "192.168.3.78",
      "upstream": null
    }
  ]
}
```

这个配置实现了：
- GFW 封锁域名 → 走 VPN 接口 `198.18.0.1` + 上游代理
- 国内域名 → 走物理网卡 `192.168.3.78`，直连
- 其他域名 → 走物理网卡 `192.168.3.78`，直连

---

## 中间件系统

### 架构

`Straightforward` 暴露三个中间件调度器：

```
                   客户端请求
                       │
              ┌────────┴────────┐
              │                 │
         HTTP 请求          CONNECT 请求
              │                 │
         onRequest          onConnect
         中间件链            中间件链
              │                 │
         _proxyRequest     _proxyConnect
              │                 │
         onResponse
         中间件链
              │
         响应返回客户端
```

中间件签名为 `(context, next) => void | Promise<void>`，每个中间件调用 `next()` 继续执行链，不调用则中断。

### 内置中间件

#### auth — 认证

```js
// 静态认证
sf.onRequest.use(middleware.auth({ user: "bob", pass: "secret" }))
sf.onConnect.use(middleware.auth({ user: "bob", pass: "secret" }))

// 动态认证（解析 Proxy-Authorization 头，不校验）
sf.onRequest.use(middleware.auth({ dynamic: true }))
sf.onConnect.use(middleware.auth({ dynamic: true }))
```

#### echo — 回显

```js
// Mock 所有 HTTP 请求，返回请求信息 JSON
sf.onRequest.use(middleware.echo)
```

#### proxyRules — 统一路由

```js
const rules = {
  rules: [
    { match: "*.internal", upstream: null },
    { match: "geosite:gfw", upstream: { host: "127.0.0.1", port: 1082 } },
    { match: "*", upstream: null }
  ],
  ruleSets: ruleSets  // 可选，geosite: 前缀需要
}

sf.onRequest.use(middleware.proxyRules(rules))
sf.onConnect.use(middleware.proxyRules(rules))
```

#### acl — IP 访问控制

```js
sf.onRequest.use(middleware.acl({
  allow: ["127.0.0.1", "10.0.0.0/8"],
  deny: ["192.168.1.100"]
}))
```

#### headers — 请求/响应头改写

```js
// 请求头：添加 X-Forwarded-For，删除 User-Agent
sf.onRequest.use(middleware.headers({
  set: { "X-Forwarded-For": "${client.ip}" },
  remove: ["User-Agent"],
}))

// 响应头：隐藏源站信息
sf.onResponse.use(middleware.headers({
  set: { "X-Proxied-By": "straightforward" },
  remove: ["Server", "X-Powered-By"],
}))
```

支持的变量：`${client.ip}`、`${target.host}`、`${target.port}`、`${req.method}`、`${req.url}`、`${upstream.host}`、`${upstream.port}`、`${proxy.status}`（仅 onResponse）。

#### connectionLimit — 连接数限制

```js
// 每个 IP 最多 8 个并发连接
sf.onRequest.use(middleware.connectionLimit({ maxConnectionsPerIP: 8 }))
sf.onConnect.use(middleware.connectionLimit({ maxConnectionsPerIP: 8 }))

// 自定义状态码和白名单
sf.onRequest.use(middleware.connectionLimit({
  maxConnectionsPerIP: 20,
  statusCode: 503,
  whitelist: ["10.0.0.0/8"],
}))
```

超限返回 429 Too Many Requests，连接关闭时自动释放槽位。默认白名单：`127.0.0.1`、`::1`。

---

## 程序化使用 (API

```js
// ESM: import { Straightforward, middleware, ruleSet } from "straightforward"
// CJS:
const { Straightforward, middleware, ruleSet } = require("straightforward")

;(async () => {
  const sf = new Straightforward({
    localAddress: "10.0.0.1",  // 全局出口 IP
    dns: "8.8.8.8",            // 全局默认 DNS
    connectTimeout: 10_000,    // TCP 连接超时 (默认 10s)
    readTimeout: 30_000,       // Socket 空闲读超时 (默认 30s)
  })

  // 请求日志
  sf.onRequest.use(async ({ req, res }, next) => {
    console.log(`HTTP ${req.method} ${req.url}`)
    return next()
  })

  sf.onConnect.use(async ({ req }, next) => {
    console.log(`CONNECT ${req.url}`)
    return next()
  })

  // 加载规则集
  const ruleSets = ruleSet.createRuleSetResolver("./rules/")

  // 配置路由规则
  const config = {
    rules: [
      { match: "geosite:cn", upstream: null, localAddress: "192.168.3.78" },
      { match: "geosite:gfw", upstream: { host: "127.0.0.1", port: 1082 } },
      { match: "*", upstream: null }
    ],
    ruleSets
  }

  sf.onRequest.use(middleware.proxyRules(config))
  sf.onConnect.use(middleware.proxyRules(config))

  // 头改写
  sf.onRequest.use(middleware.headers({
    set: { "X-Forwarded-For": "${client.ip}" },
    remove: ["User-Agent"],
  }))
  sf.onResponse.use(middleware.headers({
    set: { "X-Proxied-By": "straightforward" },
    remove: ["Server"],
  }))

  // 连接数限制
  sf.onRequest.use(middleware.connectionLimit({ maxConnectionsPerIP: 50 }))
  sf.onConnect.use(middleware.connectionLimit({ maxConnectionsPerIP: 50 }))

  await sf.listen(8081)
  console.log("Proxy running on http://0.0.0.0:8081")
})()
```

### 事件

```js
sf.on("listen", (port, pid, server, host) => { ... })
sf.on("close", () => { ... })
sf.on("serverError", (err) => { ... })
```

---

## 架构说明

### 文件结构

```
straightforward/
├── src/
│   ├── Straightforward.ts        # 核心代理类（HTTP/CONNECT/WebSocket）
│   ├── MiddlewareDispatcher.ts    # 中间件调度器
│   ├── dns-resolver.ts           # DNS lookup 工厂（按 DNS 服务器缓存 Resolver）
│   ├── index.ts                   # 顶层导出
│   ├── middleware/
│   │   ├── auth.ts               # 认证中间件（静态/动态）
│   │   ├── echo.ts               # 回显中间件（Mock 响应）
│   │   ├── proxyRules.ts         # 统一路由中间件（匹配 → upstream + localAddress + dns）
│   │   ├── acl.ts                # IP 访问控制中间件（白名单/黑名单/CIDR）
│   │   ├── headers.ts            # 请求/响应头改写中间件（变量插值）
│   │   ├── connectionLimit.ts    # 连接数限制中间件（按 IP 计数）
│   │   └── index.ts              # 中间件模块导出
│   └── rule-set/
│       ├── domain-trie.ts        # 域名后缀 trie（O(域名长度) 匹配，支持 full/suffix）
│       ├── resolver.ts           # 规则集加载器（.txt + .dat，标签优先级）
│       ├── geosite-dat.ts        # 零依赖 protobuf 解码器（varint/string/message）
│       ├── downloader.ts         # GitHub Release 自动下载器
│       └── index.ts              # 模块导出
├── test/
│   ├── basics.test.ts            # 基础功能测试 (5)
│   ├── auth.test.ts              # 认证测试 (1)
│   ├── echo.test.ts              # 回显测试 (1)
│   ├── proxyRules.test.ts        # 路由规则测试 (16)
│   ├── acl.test.ts               # ACL 测试 (18)
│   ├── headers.test.ts           # Header 改写测试 (13)
│   ├── connection-limit.test.ts  # 连接数限制测试 (13)
│   ├── dns-resolver.test.ts      # DNS 解析测试 (12)
│   ├── timeout.test.ts           # 超时控制测试 (11)
│   ├── comprehensive.test.ts     # 综合测试 (12)
│   ├── stress.ts                 # 压力测试 (60s, 64 并发)
│   ├── utils.ts                  # 测试工具
│   └── rule-set/
│       ├── domain-trie.test.ts   # DomainTrie 测试 (13)
│       ├── resolver.test.ts      # Resolver 测试 (12)
│       └── geosite-dat.test.ts   # geosite.dat 解析测试 (9)
├── rules/                        # 规则文件目录
│   ├── geosite.dat               # v2ray 二进制规则文件（1503 标签）
│   ├── gfw.txt                   # GFW 域名列表
│   ├── china-list.txt            # 中国域名列表
│   ├── apple-cn.txt              # Apple 中国 CDN
│   └── google-cn.txt             # Google 中国服务
├── docs/                         # 文档
│   ├── bugs/                     # Bug 分析文档
│   ├── completed/                # 已完成功能设计文档
│   ├── cli-reference.md          # CLI 参考
│   ├── config-reference.md       # 配置参考
│   └── IP-ACL-DESIGN.md          # IP ACL 设计文档
├── cli.js                        # CLI 入口
├── README_zh.md                  # 中文 README（本文件）
└── IMPROVEMENTS.md               # 改进计划
```

### 请求流程

```
客户端 ──CONNECT──► Straightforward
                        │
                   _populateUrlParts()
                        │
                   onRequest / onConnect 中间件链
                        │
                   proxyRules 中间件
                   ├── match: "geosite:gfw" → upstream + localAddress
                   ├── match: "*.google.com" → upstream + localAddress
                   └── match: "*" → upstream + localAddress
                        │
                   读取 req.locals.upstream
                   ├── 有 upstream → _proxyConnectViaUpstream()
                   │   └── net.connect(上游代理) → 发 CONNECT → 双向 pipe
                   └── 无 upstream → _proxyConnect()
                       └── net.connect(目标) → 双向 pipe
```

---

## 性能优化

| 优化项 | 效果 |
|--------|------|
| TCP_NODELAY | CONNECT 隧道开启 `setNoDelay(true)`，消除 Nagle 算法 40ms+ 延迟 |
| HTTP Keep-Alive | 复用上游 TCP+TLS 连接，RPS 从 ~27 提升到 ~140 (5x) |
| Hop-by-hop 头清理 | 转发前剥离 `Connection`、`Proxy-Authorization` 等逐跳头 |
| 上游代理 Agent 缓存 | 每个上游代理地址维护独立的 Keep-Alive Agent |
| DNS Resolver 缓存 | 每个 DNS 服务器缓存一个 Resolver 实例，FIFO 管理，最多 20 个 |
| 连接超时 | `connectTimeout` 独立控制连接建立超时（默认 10s），防止慢连接挂住连接池 |
| 空闲超时 | `readTimeout` Socket 空闲释放（默认 30s），数据传输中自动刷新 |
| 流式传输 | 所有请求/响应默认 pipe，不缓冲 |
| DomainTrie | 域名匹配 O(域名长度)，支持 10k+ 域名规则 |

### 性能基准

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| 平均 RPS (60s, 64 并发) | ~27 | ~140 |
| Heap 稳定使用 | 14-15 MB | 14-26 MB |
| 内存泄漏 | 无 | 无 |

压力测试：`node --expose-gc -r esbuild-register test/stress.ts`（60s, 64 并发, httpbin.org）

---

## IP 访问控制 (ACL)

```js
sf.onRequest.use(middleware.acl({
  allow: ["127.0.0.1", "10.0.0.0/8"],  // 白名单
  deny: ["192.168.1.100"]               // 黑名单
}))
sf.onConnect.use(middleware.acl({ /* 同上 */ }))
```

### 功能

- **IPv4/IPv6** 精确匹配和 CIDR 子网匹配
- **allow 优先于 deny**（同时在两个列表中时，allow 生效）
- 被拒绝的 HTTP 请求返回 `403 Forbidden`
- 被拒绝的 CONNECT 请求返回 `403` 并关闭 socket
- **零外部依赖**，手动实现 CIDR 子网掩码计算

---

## Node.js SEA 独立可执行文件

将代理打包为单个可执行文件，无需安装 Node.js：

```bash
# 1. 确保有静态链接的 Node.js（不是 Homebrew 的动态链接版本）
#    静态 Node.js 下载地址：https://nodejs.org/dist/

# 2. 构建
npm run build:sea:bundle   # 打包 JS 到单文件
npm run build:sea          # 生成 dist/straightforward

# 3. macOS 签名（必须）
codesign --sign - dist/straightforward

# 4. 运行
./dist/straightforward --port 8081
```

**注意事项**：
- Homebrew 的 Node.js 是动态链接的 stub + libnode.dylib，不支持 SEA
- 需要下载静态链接的 Node.js 二进制文件（约 127MB）
- SEA 输出约 126MB

---

## 测试

### 测试套件

| 测试文件 | 测试数量 | 说明 |
|---------|---------|------|
| `domain-trie.test.ts` | 13 | DomainTrie 单元测试 |
| `resolver.test.ts` | 12 | 规则集加载器测试 |
| `geosite-dat.test.ts` | 9 | geosite.dat 解析测试 |
| `proxyRules.test.ts` | 16 | 路由规则中间件测试 |
| `acl.test.ts` | 18 | IP ACL 测试 |
| `headers.test.ts` | 13 | Header 改写测试 |
| `connection-limit.test.ts` | 13 | 连接数限制测试 |
| `dns-resolver.test.ts` | 12 | DNS 解析测试 |
| `timeout.test.ts` | 11 | 超时控制测试 |
| `basics.test.ts` | 5 | 基础功能测试 |
| `auth.test.ts` | 1 | 认证测试 |
| `echo.test.ts` | 1 | 回显测试 |
| `comprehensive.test.ts` | 12 | 综合测试 |
| **总计** | **136 passed, 2 skipped** | |

### 运行测试

```bash
# 全部测试
npm test

# 规则集相关测试
npx ava -v test/rule-set/*.test.ts

# 单个测试文件
npx ava -v test/proxyRules.test.ts

# 按标题过滤
npx ava -v -m "geosite:cn"

# 压力测试
node --expose-gc -r esbuild-register test/stress.ts
```

---

## 常见问题 (FAQ)

### geosite:cn 没有匹配到域名？

检查以下几点：
1. `rules/` 目录下是否有 `geosite.dat` 或 `cn.txt`
2. `.dat` 文件中的标签是**小写**的（`cn`、`gfw`）
3. 使用 `--debug` 模式查看匹配日志
4. `.txt` 标签优先级高于 `.dat`，检查是否有冲突

### 上游代理 HTTPS 访问失败 (SSL_ERROR_SYSCALL)？

确保：
1. 上游代理支持 CONNECT 方法
2. `upstream.host` 和 `upstream.port` 正确
3. 如果上游代理需要认证，配置 `upstream.auth`

### 如何查看连接走了哪条线路？

使用 `--debug` 模式，会打印详细的路由信息：

```
straightforward --debug --rules-dir ./rules/ --rules rules.local.json --port 8081
```

输出示例：
```
proxyRules: matched "geosite:gfw" → host=www.google.com type=connect upstream=127.0.0.1:1082 bind=OS default
proxyConnect: CONNECT www.google.com:443 → upstream 127.0.0.1:1082 (bind=0.0.0.0)
```

### geosite.dat 文件很大，加载慢？

正常。`geosite.dat` 约 10MB，包含 1503 个标签、数十万个域名规则。首次加载（包括构建 DomainTrie）约 50-100ms。后续匹配使用 trie，O(域名长度)，微秒级。

### 如何只下载 geosite.dat 而不下载 .txt 文件？

```bash
straightforward --rules-dir ./rules/ --rules-download-dat
```

---

## 许可证

MIT
