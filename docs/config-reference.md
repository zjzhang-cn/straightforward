# 配置文件参考手册

> straightforward v4.2.2

## 目录

- [三层配置体系](#三层配置体系)
- [配置文件格式](#配置文件格式)
- [规则字段详解](#规则字段详解)
- [匹配模式](#匹配模式)
- [v2ray 规则集](#v2ray-规则集)
- [示例配置文件](#示例配置文件)
- [配置文件生成工具](#配置文件生成工具)

---

## 三层配置体系

| 层级 | 使用方式 | 灵活性 |
|------|---------|--------|
| 零配置 | `straightforward` | 最小：所有流量直连 |
| CLI 参数 | `--upstream --local-address` | 中：全局统一行为 |
| 配置文件 | `--rules proxyrules.json` | 高：按域名精细控制 |

### 零配置模式

```bash
straightforward
```

等价于：所有域名直连，操作系统自动选择出口 IP。

### CLI 简化模式

```bash
# 所有流量走一个上游代理
straightforward --upstream http://proxy.example.com:8080

# SOCKS5 上游代理
straightforward --upstream socks5://127.0.0.1:1080

# 带认证的上游代理
straightforward --upstream http://user:pass@proxy.example.com:8080

# 所有流量绑定到一个出口 IP
straightforward --local-address 192.168.3.78

# 组合使用
straightforward --upstream http://proxy.example.com:8080 --local-address 192.168.3.78
```

### 配置文件模式

```bash
straightforward --rules rules.local.json --rules-dir ./rules/
```

---

## 配置文件格式

```json
{
  "rules": [
    {
      "match": "匹配模式",
      "type": "请求类型 (可选)",
      "localAddress": "出口源 IP (可选)",
      "upstream": "http://user:pass@proxy.example.com:8080"
    }
  ],
  "default": {
    "localAddress": "0.0.0.0",
    "upstream": null
  }
}
```

---

## 规则字段详解

### `match` (必填)

匹配目标域名或 IP 的模式。支持三种格式：

| 格式 | 示例 | 说明 |
|------|------|------|
| 通配符 | `"*"`, `"*.google.com"`, `"192.168.*"` | glob 模式匹配 |
| v2ray 规则集 | `"geosite:gfw"`, `"geosite:cn"` | 查询规则集标签 |
| 自定义规则文件 | `"geosite:./custom.txt"` | 加载指定路径的 .txt 文件 |

**匹配顺序**：从上到下，第一条匹配的规则生效。

### `type` (可选)

仅对特定请求类型生效。省略 = 两种都匹配。

| 值 | 说明 |
|---|------|
| `"http"` | 仅 HTTP 请求 (onRequest) |
| `"connect"` | 仅 CONNECT 请求 (onConnect) |

```json
{ "match": "*.example.com", "type": "http", "upstream": "http://proxy-a:8080" }
{ "match": "*.example.com", "type": "connect", "upstream": "http://proxy-b:1082" }
```

### `localAddress` (可选)

出口源 IP 地址，用于多网卡服务器选择出口。省略时使用全局 `--local-address` 设置或系统默认。

| 值 | 说明 |
|---|------|
| `"192.168.3.78"` | 从物理网卡 `en0` 出站 |
| `"198.18.0.1"` | 从 VPN 虚拟网卡 `utun6` 出站 |
| `"0.0.0.0"` | 系统自动选择 (默认) |

```json
{ "match": "geosite:gfw", "localAddress": "198.18.0.1" }
{ "match": "geosite:cn", "localAddress": "192.168.3.78" }
```

### `upstream` (可选)

上游代理地址。`null` 或省略 = 直连。

| 字段 | 类型 | 说明 |
|------|------|------|
| `host` | `string` | 上游代理主机 (必填) |
| `port` | `number` | 上游代理端口 (必填) |
| `auth` | `{ user, pass }` | 上游代理认证 (可选) |

```json
{
  "match": "geosite:gfw",
  "upstream": "http://proxy-user:proxy-pass@127.0.0.1:1082"
}
```

或对象格式（向后兼容）：

```json
{
  "match": "geosite:gfw",
  "upstream": {
    "host": "127.0.0.1",
    "port": 1082,
    "auth": { "user": "proxy-user", "pass": "proxy-pass" }
  }
}
```

`null` 值表示**显式直连**，不走任何上游代理：

```json
{ "match": "geosite:cn", "upstream": null }
```

### `default` (可选)

当没有规则匹配时的默认行为。

```json
{
  "rules": [...],
  "default": {
    "localAddress": "0.0.0.0",
    "upstream": null
  }
}
```

未定义的字段默认值：
- `localAddress` → `"0.0.0.0"` (系统选择)
- `upstream` → `null` (直连)

---

## 匹配模式

### 通配符匹配

| 模式 | 说明 | 匹配 |
|------|------|------|
| `"*"` | 匹配所有 | `example.com`, `192.168.1.1` |
| `"*.google.com"` | 子域名通配 | `www.google.com`, `mail.google.com` |
| `"*.internal.*"` | 多段通配 | `app.internal.corp`, `db.internal.local` |
| `"192.168.*"` | IP 通配 | `192.168.1.1`, `192.168.100.200` |
| `"*.cn"` | 顶级域通配 | `baidu.com`, `qq.com` |

### v2ray 规则集匹配

| 模式 | 说明 |
|------|------|
| `"geosite:gfw"` | GFW 封锁域名 (4232 个) |
| `"geosite:cn"` | 中国域名 (112,732 个) |
| `"geosite:google"` | Google 全部 (1068 个) |
| `"geosite:telegram"` | Telegram (21 个) |
| `"geosite:twitter"` | Twitter/X (24 个) |
| `"geosite:youtube"` | YouTube |
| `"geosite:github"` | GitHub |
| `"geosite:openai"` | OpenAI |
| `"geosite:anthropic"` | Anthropic (Claude) |
| `"geosite:apple-cn"` | Apple 中国 CDN (163 个) |
| `"geosite:category-ads-all"` | 广告域名 (167,470 个) |

**查看所有标签**：`node cli.js --rules-dir ./rules/ --show-tags`

**查看标签域名**：`node cli.js --rules-dir ./rules/ --show-domains gfw`

---

## v2ray 规则集

### 支持的格式

| 格式 | 文件 | 来源 |
|------|------|------|
| `.txt` | 每行一个域名 | [loyalsoldier/v2ray-rules-dat](https://github.com/Loyalsoldier/v2ray-rules-dat/releases) |
| `.dat` | 二进制 protobuf | 同上，所有标签在一个文件 |

### 域名类型映射

| 类型 | `.txt` 前缀 | `.dat` 枚举 | 匹配行为 |
|------|------------|------------|---------|
| Domain | `domain:` | 2 | 后缀匹配 |
| Full | `full:` | 3 | 精确匹配 |
| 无前缀 | 无 | — | 后缀匹配 (默认) |

### 标签优先级

`.txt` 文件标签 **优先于** `.dat` 内同名标签。允许用自定义 `.txt` 覆盖 `.dat` 中的任何规则。

### 使用方式

```bash
# 下载 geosite.dat
straightforward --rules-dir ./rules/ --rules-download-dat

# 在配置文件中引用
{ "match": "geosite:gfw", "upstream": "http://127.0.0.1:1082" }
{ "match": "geosite:cn", "upstream": null }
```

---

## 示例配置文件

### 基础分流 (VPN + 直连)

```json
{
  "rules": [
    { "match": "geosite:gfw", "upstream": "http://127.0.0.1:1082" },
    { "match": "geosite:cn", "upstream": null },
    { "match": "*", "upstream": null }
  ]
}
```

### 多出口 IP 分流

```json
{
  "rules": [
    { "match": "geosite:gfw", "localAddress": "198.18.0.1", "upstream": "http://127.0.0.1:1082" },
    { "match": "geosite:cn", "localAddress": "192.168.3.78", "upstream": null },
    { "match": "*", "localAddress": "192.168.3.78", "upstream": null }
  ]
}
```

### 多上游代理分流

```json
{
  "rules": [
    { "match": "geosite:gfw", "upstream": "http://127.0.0.1:1082" },
    { "match": "geosite:telegram", "upstream": "http://127.0.0.1:1083" },
    { "match": "geosite:youtube", "upstream": "http://proxy-us.example.com:8080" },
    { "match": "geosite:openai", "upstream": "http://proxy-jp.example.com:3128" },
    { "match": "geosite:cn", "upstream": null },
    { "match": "*", "upstream": null }
  ]
}
```

### 带认证的上游代理

```json
{
  "rules": [
    {
      "match": "geosite:gfw",
      "upstream": "http://user1:pass1@proxy-us.example.com:8080"
    },
    {
      "match": "geosite:openai",
      "upstream": "http://user2:pass2@proxy-jp.example.com:3128"
    },
    { "match": "*", "upstream": null }
  ]
}
```

### 广告过滤

```json
{
  "rules": [
    { "match": "geosite:category-ads-all", "upstream": "http://127.0.0.1:1084" },
    { "match": "*", "upstream": null }
  ]
}
```

### 按请求类型分流

```json
{
  "rules": [
    { "match": "*.example.com", "type": "http", "upstream": "http://proxy-a:8080" },
    { "match": "*.example.com", "type": "connect", "upstream": "http://proxy-b:1082" },
    { "match": "*", "upstream": null }
  ]
}
```

### 完整示例 (多网卡 + 多代理 + 认证)

```json
{
  "rules": [
    { "match": "geosite:category-ads-all", "localAddress": "0.0.0.0", "upstream": "http://127.0.0.1:1084" },
    { "match": "geosite:gfw", "localAddress": "198.18.0.1", "upstream": "http://127.0.0.1:1082" },
    { "match": "geosite:telegram", "localAddress": "198.18.0.1", "upstream": "http://127.0.0.1:1083" },
    { "match": "geosite:youtube", "localAddress": "198.18.0.1", "upstream": "http://u1:p1@proxy-us.example.com:8080" },
    { "match": "geosite:openai", "localAddress": "198.18.0.1", "upstream": "http://u2:p2@proxy-jp.example.com:3128" },
    { "match": "geosite:cn", "localAddress": "192.168.3.78", "upstream": null },
    { "match": "*.cn", "localAddress": "192.168.3.78", "upstream": null },
    { "match": "192.168.*", "localAddress": "192.168.3.78", "upstream": null },
    { "match": "*", "localAddress": "198.18.0.1", "upstream": "http://127.0.0.1:1082" }
  ],
  "default": {
    "localAddress": "192.168.3.78",
    "upstream": null
  }
}
```

---

## 配置文件生成工具

使用 `--show-tags` 和 `--show-domains` 检查可用的规则标签：

```bash
# 查看所有 1503 个标签
straightforward --rules-dir ./rules/ --show-tags

# 按关键词过滤
straightforward --rules-dir ./rules/ --show-tags cn

# 查看标签下的域名
straightforward --rules-dir ./rules/ --show-domains gfw
```
