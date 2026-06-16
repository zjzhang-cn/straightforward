# DNS over HTTPS（DoH）支持

> 状态：✅ 已完成 | commit `待提交`

## 概述

为 `--dns` 选项增加 DNS over HTTPS (DoH) 支持，使用 `https://` 前缀触发。当配置 DoH 服务器时，通过 HTTPS 发送 DNS 查询，避免 DNS 劫持/污染。

## 背景

当前 `--dns` 仅支持 IP 地址格式（如 `8.8.8.8`），通过 `dns.promises.Resolver` 的 UDP 协议查询。在某些网络环境下，UDP DNS 会被劫持或污染，导致域名解析结果不准确。

DoH（RFC 8484）将 DNS 查询封装在 HTTPS 请求中：
- 使用 TLS 加密，防止中间人篡改
- 通过 443 端口，与正常 HTTPS 流量无异，难以被定向封锁
- 标准 POST 模式：`Content-Type: application/dns-message`，body 为 DNS wire format

## 设计方案

### 检测逻辑

在 `createLookupFunction()` 中检测 `dnsServer` 参数前缀：

```
https://doh.pub/dns-query          → DoH (RFC 8484 POST)
https://dns.google/dns-query       → DoH (RFC 8484 POST)
8.8.8.8                           → 现有行为 (dns.promises.Resolver)
```

### 实现

#### 复用现有架构

- 不新增中间件，不改 CLI 选项名
- 仅在 `dns-resolver.ts` 内部判断：DNS 服务器字符串以 `https://` 开头时走 DoH 路径
- 解析器缓存（`resolverCache`）仍然有效，不同 DoH URL 独立缓存

#### DNS Wire Format 编解码

实现最小 DNS 协议处理（仅支持 A/AAAA 查询和响应）：

```
DNS Query (12 字节头部 + 问题部分):
  Header:
    ID (2 bytes)        → 随机
    Flags (2 bytes)     → 0x0100 (标准查询, RD=1)
    QDCOUNT (2 bytes)   → 1
    ANCOUNT (2 bytes)   → 0
    NSCOUNT (2 bytes)   → 0
    ARCOUNT (2 bytes)   → 0
  Question:
    QNAME               → 长度标签编码 (如 3www7example3com0)
    QTYPE (2 bytes)     → 1 (A) 或 28 (AAAA)
    QCLASS (2 bytes)    → 1 (IN)

DNS Response (解析 ANCOUNT 条 Answer):
  Answer Section:
    NAME (2 bytes)      → 0xc00c (压缩指针)
    TYPE (2 bytes)      → 1 (A) 或 28 (AAAA)
    CLASS (2 bytes)     → 1 (IN)
    TTL (4 bytes)       → 跳过
    RDLENGTH (2 bytes)  → 4 (A) 或 16 (AAAA)
    RDATA              → IPv4 (4 bytes) 或 IPv6 (16 bytes)
```

复杂度：~100 行，仅使用 Node.js 内置 `Buffer` 和 `https` 模块。

### 变更文件

| 文件 | 变更 |
|------|------|
| `src/dns-resolver.ts` | 新增 DoH 检测、DNS wire format 编解码器、`resolveViaDoH` 函数 |
| `test/dns-resolver.test.ts` | 新增 DoH 查询测试 |
| `docs/completed/doh.md` | 新建本文档 |

### CLI 示例

```bash
# 传统 DNS
straightforward --dns 8.8.8.8

# DNS over HTTPS (DoH)
straightforward --dns https://doh.pub/dns-query

# proxyRules 中使用 DoH
{
  "rules": [
    { "match": "*", "dns": "https://doh.pub/dns-query" }
  ]
}
```

## 验证

```bash
# 单元测试
npx ava -v test/dns-resolver.test.ts

# 全量测试
npm test
```
