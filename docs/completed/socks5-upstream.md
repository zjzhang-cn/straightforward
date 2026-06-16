# SOCKS5 上游代理

> 状态：✅ 已完成 | commit `6f6766c`

## 概述

为 `proxyRules` 的 `upstream` 增加 `protocol: "socks5"` 支持，使流量可以通过 SOCKS5 代理转发（如 Shadowsocks、Clash 等）。

## 背景

当前 `upstream` 仅支持 HTTP(S) 正向代理协议。部分代理工具（Shadowsocks、Trojan、Clash）提供 SOCKS5 接口，不支持则无法级联。

SOCKS5（RFC 1928）是透明的 TCP 隧道协议：
- 握手 → 认证协商 → CONNECT 请求 → 隧道建立
- 之后的数据直接透传，与 CONNECT 代理类似
- 支持域名、IPv4、IPv6 三种目标地址类型

## 设计方案

### 协议扩展

在 `upstream` 字段增加可选 `protocol` 属性：

```ts
// 当前
upstream?: { host: string; port: number; auth?: { user: string; pass: string } }

// 扩展后
upstream?: {
  host: string; port: number;
  protocol?: "http" | "socks5";  // 默认 "http"
  auth?: { user: string; pass: string }
}
```

### SOCKS5 握手

实现为独立函数 `socks5Connect()`，放在 `src/socks5.ts`：

```
步骤1：TCP 连接到 SOCKS5 代理
步骤2：发送 Greeting（版本 5，无认证 0x00）
步骤3：接收 Server Choice（版本 5，选中的认证方法）
步骤4：发送 CONNECT 请求（CMD=0x01）到目标 host:port
步骤5：接收 CONNECT 响应（REP=0x00 为成功）
步骤6：返回已建立隧道的 Socket
```

支持两种认证方式：
- 无认证（0x00）—— 默认尝试
- 用户名/密码认证（0x02）—— 如果 `upstream.auth` 设置了 user/pass

### 核心变更

`_proxyConnectViaUpstream` 检测 `upstream.protocol === "socks5"` 时分流：

```
HTTP 上游 (protocol="http" 或省略):
  TCP 连接 → 发送 HTTP CONNECT → 解析响应 → 双向 pipe

SOCKS5 上游 (protocol="socks5"):
  TCP 连接 → SOCKS5 握手 → 双向 pipe
```

`_proxyRequestViaUpstream` 同理：
```
HTTP 上游:
  http.request() 到上游代理

SOCKS5 上游:
  SOCKS5 握手 → 在隧道中发送 HTTP 请求 → 转发响应
```

### 地址编码

SOCKS5 CONNECT 请求中目标地址的编码：
- 域名：`ATYP=0x03`，前导 1 字节长度
- IPv4：`ATYP=0x01`，4 字节
- IPv6：`ATYP=0x04`，16 字节

对于 CONNECT 请求，目标地址是客户端请求的目标（`req.locals.urlParts.host:port`）。
对于 HTTP 请求，目标地址来自 URL 解析。

### 变更文件

| 文件 | 变更 |
|------|------|
| `src/socks5.ts` | 新建，SOCKS5 握手函数 |
| `src/Straightforward.ts` | #RequestLocals.upstream 增加 `protocol` 字段；_proxyConnectViaUpstream SOCKS5 分流；_proxyRequestViaUpstream SOCKS5 隧道 |
| `src/middleware/proxyRules.ts` | 上游类型定义增加 `protocol` |
| `src/index.ts` | 导出 socks5 模块 |
| `test/socks5.test.ts` | SOCKS5 握手 + 代理流程测试 |

### 使用示例

```json
{
  "rules": [
    { "match": "geosite:gfw", "upstream": {
      "protocol": "socks5",
      "host": "127.0.0.1",
      "port": 1080
    }},
    { "match": "*", "upstream": null }
  ]
}
```

## 验证

```bash
# 启动本地 SOCKS5 代理用于测试
ssh -D 1080 -N user@server

# 运行代理
node cli.js --rules rules.json --port 8081 --debug

# 测试 HTTP 通过 SOCKS5
curl -x http://127.0.0.1:8081 http://example.com

# 测试 HTTPS 通过 SOCKS5
curl -x http://127.0.0.1:8081 https://www.google.com

# 单元测试
npx ava -v test/socks5.test.ts
```
