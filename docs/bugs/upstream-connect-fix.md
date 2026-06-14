# Bug 文档：二级代理 CONNECT 隧道修复

## 问题现象

```
curl -x http://127.0.0.1:8081 https://dl.google.com
curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to dl.google.com:443
```

直连正常，但通过上游代理的 CONNECT 隧道 SSL 握手失败。

---

## Bug 1：v2ray 规则文件 `full:` 前缀未被解析

### 原因

`loyalsoldier/v2ray-rules-dat` 的规则文件使用 v2ray 域名类型前缀：

```
full:dl.google.com          ← 精确匹配（只匹配 dl.google.com 本身）
domain:google.com           ← 后缀匹配（匹配 *.google.com）
```

旧代码 `loadTxtFile()` 直接把整行当域名插入 DomainTrie：

```ts
// 旧代码
const domain = line.trim()
trie.insert(domain)  // 插入了 "full:dl.google.com" 字面字符串
```

trie 里存的是 `full:dl.google.com`，而实际请求的 hostname 是 `dl.google.com`，永远匹配不上。`geosite:google-cn` 规则形同虚设（只有 `google-cn.txt` 和 `apple-cn.txt` 用了 `full:` 前缀，`gfw.txt` 和 `china-list.txt` 没有前缀所以不受影响）。

### 解决方法

**`src/rule-set/domain-trie.ts`**：新增 `#fullMatch: Set<string>` 存储精确匹配域名，新增 `insertFull()` 方法。

```ts
export class DomainTrie {
  #fullMatch = new Set<string>()

  insertFull(domain: string): void {
    const key = domain.trim().toLowerCase()
    if (key && !this.#fullMatch.has(key)) {
      this.#fullMatch.add(key)
      this.#size++
    }
  }

  match(hostname: string): boolean {
    const key = hostname.trim().toLowerCase()
    // 先检查精确匹配
    if (this.#fullMatch.has(key)) return true
    // 再检查 trie 后缀匹配
    // ...
  }
}
```

**`src/rule-set/resolver.ts`**：`loadTxtFile()` 解析四种 v2ray 前缀类型：

| 前缀 | 语义 | 处理方式 |
|------|------|---------|
| `full:domain` | 精确匹配 | `trie.insertFull(domain)` |
| `domain:domain` | 后缀匹配 | `trie.insert(domain)` |
| `keyword:word` | 关键词（不支持） | 跳过 |
| `regexp:pattern` | 正则（不支持） | 跳过 |
| 无前缀 | 后缀匹配（默认） | `trie.insert(domain)` |

---

## Bug 2：`head` 缓冲区未转发给上游代理

### 原因

HTTPS CONNECT 流程中，Node.js 的 `server.on("connect")` 事件会在 `head` 参数中传递 client socket 上已读取的第一个数据块（即 TLS ClientHello）。

直连路径正确地将 `head` 写入了目标服务器：

```ts
// _proxyConnect — 正确
serverSocket.write(head)  // ✅ ClientHello 发给目标
```

但 `_proxyConnectViaUpstream` 在收到上游 200 后，忘记了这一步：

```ts
// _proxyConnectViaUpstream — 旧代码
clientSocket.write("HTTP/1.1 200 Connection Established\r\n...")
// ❌ 没有 upstreamSocket.write(head)
upstreamSocket.pipe(clientSocket)
clientSocket.pipe(upstreamSocket)
```

TLS ClientHello 被丢弃，上游代理无数据可转发，SSL 握手失败。

### 解决方法

在收到上游 200 后、建立 pipe 之前，将 `head` 写入上游 socket：

```ts
clientSocket.write("HTTP/1.1 200 Connection Established\r\n...")
upstreamSocket.write(head)  // ✅ 转发 ClientHello 到上游
upstreamSocket.pipe(clientSocket)
clientSocket.pipe(upstreamSocket)
```

---

## Bug 3：`removeAllListeners("data")` 杀掉了 pipe 的 data 监听器

### 原因

这是三个 bug 中最隐蔽的一个。流程如下：

```ts
// 旧代码
upstreamSocket.on("data", (chunk) => {
  // HTTP header parser — 解析上游返回的 200 响应头
  buffer += chunk.toString()
  if (buffer.includes("\r\n\r\n")) {
    // 收到完整 HTTP 响应头
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n...")
    upstreamSocket.write(head)
    upstreamSocket.pipe(clientSocket)   // ① pipe() 注册了 data 监听器
    clientSocket.pipe(upstreamSocket)
    upstreamSocket.removeAllListeners("data")  // ② 把 ① 的监听器也删了！
  }
})
```

`Stream.pipe()` 内部通过 `src.on("data", ondata)` 注册监听器。在 pipe 之后调用 `removeAllListeners("data")` 会 **同时删除 HTTP header parser 和 pipe 刚注册的 data 监听器**。

结果：上游代理回传的 TLS ServerHello 等数据无人接听，SSL 握手永远超时。

### 解决方法

把 `removeAllListeners("data")` 移到 `pipe()` **之前**执行，此时只有 HTTP header parser 这一个监听器需要清理：

```ts
// 新代码
if (buffer.includes("\r\n\r\n")) {
  const statusLine = buffer.split("\r\n")[0]
  if (statusLine.startsWith("HTTP/1.1 200")) {
    // 先清理 HTTP header parser（此时只有它一个 data 监听器）
    upstreamSocket.removeAllListeners("data")
    // 再建立管道
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n...")
    upstreamSocket.write(head)
    upstreamSocket.pipe(clientSocket)  // pipe 注册新的 data 监听器，不受影响
    clientSocket.pipe(upstreamSocket)
  }
}
```

---

## 修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `src/rule-set/domain-trie.ts` | 新增 `#fullMatch` Set + `insertFull()` + `match()` 先检查精确匹配 |
| `src/rule-set/resolver.ts` | `loadTxtFile()` 解析 `full:`/`domain:`/`keyword:`/`regexp:` 前缀 |
| `src/Straightforward.ts` | `_proxyConnectViaUpstream`: 写入 `head`、`removeAllListeners` 移到 pipe 之前、添加调试日志 |

## 验证结果

| 目标 | 路由 | 状态 | 耗时 |
|------|------|------|------|
| `dl.google.com` | `geosite:gfw` → upstream `127.0.0.1:1082` | HTTP 302 ✅ | 1.76s |
| `www.baidu.com` | `*` → direct | HTTP 200 ✅ | 0.07s |
| 全部单元测试 | — | 66 passed, 2 skipped ✅ | — |
