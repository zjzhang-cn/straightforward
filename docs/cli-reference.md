# CLI 命令参考手册

> straightforward v4.2.2

## 目录

- [基础用法](#基础用法)
- [服务器选项](#服务器选项)
- [认证选项](#认证选项)
- [模式选项](#模式选项)
- [规则选项](#规则选项)
- [上游代理选项](#上游代理选项)
- [网络选项](#网络选项)
- [输出选项](#输出选项)
- [常用组合示例](#常用组合示例)
- [调试模式输出](#调试模式输出)

---

## 基础用法

```bash
straightforward [options]

# 或
node cli.js [options]
```

**最简启动**：

```bash
straightforward --port 8081
```

---

## 服务器选项

| 选项 | 缩写 | 默认值 | 说明 |
|------|------|--------|------|
| `--port <number>` | `-p` | `8081` | 监听端口 |
| `--host <string>` | — | `0.0.0.0` | 监听地址/接口 |

```bash
# 监听所有接口的 9191 端口
straightforward --port 9191

# 仅监听本地回环地址
straightforward --port 8081 --host 127.0.0.1
```

---

## 认证选项

| 选项 | 缩写 | 说明 |
|------|------|------|
| `--auth <user:pass>` | `-a` | 静态认证，校验用户名和密码 |
| `--dynamic-auth` | — | 动态认证模式，解析 `Proxy-Authorization` 头但不校验 |

```bash
# 静态认证
straightforward --port 8081 --auth "user:pass"

# 客户端使用
curl -x http://user:pass@127.0.0.1:8081 https://example.com

# 动态认证 (不校验密码，但解析认证头)
straightforward --port 8081 --dynamic-auth
```

---

## 模式选项

| 选项 | 缩写 | 说明 |
|------|------|------|
| `--echo` | `-e` | 回显模式，mock 所有 HTTP 响应为 JSON |
| `--debug` | `-d` | 调试模式，显示详细连接线路信息 |
| `--cluster` | `-c` | 集群模式，按 CPU 核心数启动 worker |
| `--cluster-count <number>` | — | 指定集群 worker 数量 |

```bash
# 回显模式 (测试用)
straightforward --echo

# 调试模式 (查看连接线路)
straightforward --debug

# 集群模式 (8 核 CPU 启动 8 个 worker)
straightforward --cluster

# 集群模式 (指定 4 个 worker)
straightforward --cluster --cluster-count 4
```

---

## 规则选项

### 配置文件

| 选项 | 说明 |
|------|------|
| `--rules <path>` | 代理规则配置文件路径 |
| `--rules-dir <path>` | 规则集目录 (用于 `geosite:` 前缀) |

### 自动下载规则

| 选项 | 说明 |
|------|------|
| `--rules-download [tags]` | 下载 .txt 规则文件 (默认: gfw,direct-list,proxy-list) |
| `--rules-download-dat` | 下载 geosite.dat 二进制文件 (1503 标签) |
| `--rules-download-force` | 强制重新下载，覆盖已有文件 |

### 规则查看

| 选项 | 说明 |
|------|------|
| `--show-tags [filter]` | 查看 geosite.dat 标签列表 (可选: 过滤词) |
| `--show-domains <tag>` | 查看指定标签的域名列表 |

```bash
# 下载 .txt 规则文件
straightforward --rules-dir ./rules/ --rules-download

# 下载 geosite.dat (二进制格式，1503 标签)
straightforward --rules-dir ./rules/ --rules-download-dat

# 强制重新下载
straightforward --rules-dir ./rules/ --rules-download --rules-download-force

# 查看所有标签
straightforward --rules-dir ./rules/ --show-tags

# 过滤标签
straightforward --rules-dir ./rules/ --show-tags gfw

# 查看 gfw 标签的域名
straightforward --rules-dir ./rules/ --show-domains gfw

# 查看 apple-cn 标签的域名
straightforward --rules-dir ./rules/ --show-domains apple-cn
```

---

## 上游代理选项

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `--upstream-host <string>` | — | 上游代理主机 |
| `--upstream-port <number>` | `3128` | 上游代理端口 |
| `--upstream-auth <user:pass>` | — | 上游代理认证 |

```bash
# 所有流量走上游代理
straightforward --port 8081 --upstream-host proxy.example.com

# 指定端口和认证
straightforward --port 8081 \
  --upstream-host proxy.example.com \
  --upstream-port 8080 \
  --upstream-auth "user:pass"
```

---

## 网络选项

| 选项 | 说明 |
|------|------|
| `--local-address <ip>` | 出口源 IP 地址 (多网卡选择出口) |

```bash
# 绑定到 VPN 接口
straightforward --port 8081 --local-address 198.18.0.1

# 绑定到物理网卡
straightforward --port 8081 --local-address 192.168.3.78

# 系统自动选择 (默认行为)
straightforward --port 8081 --local-address 0.0.0.0
```

---

## 输出选项

| 选项 | 缩写 | 说明 |
|------|------|------|
| `--quiet` | `-q` | 静默请求日志 (不显示每次请求) |
| `--silent` | `-s` | 完全不输出到 stdout |

---

## 常用组合示例

### 基本代理

```bash
straightforward --port 8081
```

### 带认证的代理

```bash
straightforward --port 8081 --auth "user:pass"
curl -x http://user:pass@127.0.0.1:8081 https://example.com
```

### 使用 geosite.dat 分流

```bash
# 1. 下载 geosite.dat
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

### 多网卡分流

```bash
# VPN 走 198.18.0.1，国内走 192.168.3.78
straightforward --rules-dir ./rules/ --rules rules.local.json --port 8081
```

### 集群模式

```bash
# 按 CPU 核心数启动
straightforward --port 8081 --cluster

# 指定 4 个 worker
straightforward --port 8081 --cluster --cluster-count 4
```

### 调试模式

```bash
straightforward --port 8081 --debug
```

### 静默模式 (后台运行)

```bash
straightforward --port 8081 --silent &
```

---

## 调试模式输出

使用 `--debug` 或 `-d` 启动时，会显示详细的连接线路信息：

```
2026-06-14T03:58:34.447Z straightforward:middleware proxyRules: matched "geosite:gfw" → host=www.google.com type=connect upstream=127.0.0.1:1082 bind=OS default
2026-06-14T03:58:34.448Z straightforward proxyConnect: CONNECT www.google.com:443 → upstream 127.0.0.1:1082 (bind=0.0.0.0)
2026-06-14T03:58:34.532Z straightforward:middleware proxyRules: matched "geosite:cn" → host=www.baidu.com type=connect upstream=none(direct) bind=192.168.3.78
2026-06-14T03:58:34.533Z straightforward proxyConnect: CONNECT www.baidu.com:443 → direct to www.baidu.com:443 (bind=192.168.3.78)
```

日志格式：`[时间戳] [模块] [事件] → [连接线路]`
