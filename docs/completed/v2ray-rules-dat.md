# v2ray 规则集集成

> 最后更新：2026-06-14 | 状态：✅ 已完成

## 概述

支持 v2ray 生态的两种规则文件格式，在配置文件中使用 `geosite:` 前缀引用：

| 格式 | 说明 | 标签数量 |
|------|------|---------|
| `.txt` | 文本格式，每行一个域名 | 每个文件一个标签 |
| `.dat` | 二进制 protobuf 格式 | 单文件 1503 标签 |

## 实现清单

- [x] **DomainTrie** (`src/rule-set/domain-trie.ts`): 反转域名后缀 trie，O(域名长度) 匹配 — commit `432fa8b`
- [x] **RuleSetResolver** (`src/rule-set/resolver.ts`): 扫描目录，加载 .txt/.dat 规则文件 — commit `432fa8b`
- [x] **proxyRules geosite: 前缀**: `match` 字段支持 `geosite:gfw` 等语法 — commit `432fa8b`
- [x] **CLI `--rules-dir`**: 指定规则文件目录 — commit `432fa8b`
- [x] **自动下载** (`src/rule-set/downloader.ts`): 从 GitHub Release 下载 .txt 规则文件 — commit `38755ee`
- [x] **CLI `--rules-download` / `--rules-download-force`** — commit `38755ee`
- [x] **geosite.dat 二进制解析** (`src/rule-set/geosite-dat.ts`): 零依赖 protobuf 解码器 — commit `05d7d02`
- [x] **CLI `--rules-download-dat`**: 下载 geosite.dat — commit `05d7d02`
- [x] **CLI `--show-tags` / `--show-domains`**: 检查 geosite.dat 内容 — commit `1da16c3`, `cf225a3`
- [x] **Unit tests**: DomainTrie 13 + Resolver 12 + geosite.dat 9 + proxyRules geosite 5

## 域名类型映射

| 类型 | `.txt` 前缀 | `.dat` 枚举值 | 匹配行为 |
|------|------------|--------------|---------|
| Domain | `domain:` | 2 | 后缀匹配：`google.com` → `www.google.com` |
| Full | `full:` | 3 | 精确匹配：`google.com` 仅匹配 `google.com` |
| 无前缀 | 无 | — | 后缀匹配（默认） |
| Plain | `keyword:` | 0 | 跳过 |
| Regex | `regexp:` | 1 | 跳过 |

## 标签优先级

`.txt` 文件标签 **优先于** `.dat` 内同名标签。这允许用自定义 `.txt` 覆盖 `.dat` 中的任何规则。

## 常用标签

| 标签 | 域名数量 | 说明 |
|------|---------|------|
| `cn` | 112,732 | 中国域名 |
| `gfw` | 4,232 | GFW 封锁域名 |
| `google` | 1,068 | Google 全部 |
| `apple-cn` | 163 | Apple 中国 CDN |
| `geolocation-!cn` | 26,666 | 非中国域名 |
| `telegram` | 21 | Telegram |
| `twitter` | 24 | Twitter/X |
| `youtube` | — | YouTube |
| `github` | — | GitHub |
| `microsoft` | — | Microsoft |
| `openai` | — | OpenAI |
| `anthropic` | — | Anthropic (Claude) |

## Protobuf 解码器设计

`geosite-dat.ts` 实现零依赖的 protobuf wire format 解码器，只解两个 wire type：

| Wire Type | 说明 | 用途 |
|-----------|------|------|
| 0 (varint) | 变长整数 | Domain.Type 枚举值 |
| 2 (length-delimited) | 长度前缀 | 字符串（code、value）和嵌套消息 |

核心原语：`readVarint()`, `readTag()`, `readString()`, `skipField()`

解析流程：`GeoSiteList` → repeated `GeoSite` → `code` + repeated `Domain` → `type` + `value`
