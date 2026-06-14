# SEA 内置 geosite.dat 规则集

> 状态：✅ 已完成 | commit `91c2298`

## 概述

将 `geosite.dat` (~10MB) 通过 Node.js SEA 的 `assets` 配置打包进可执行文件，实现单文件分发、零配置开箱即用的规则分流。

## 背景

当前 SEA 打包的可执行文件（`dist/straightforward`，126MB）不包含规则文件。用户使用 `geosite:cn`、`geosite:gfw` 等标签时，必须额外指定 `--rules-dir` 或手动下载 `geosite.dat`。这破坏了"单文件分发"的体验。

Node.js SEA 支持 `assets` 配置，允许将任意文件打包进可执行文件，运行时通过 `require('node:sea').getRawAsset()` 读取。

## 设计方案

### 核心方案：SEA assets + 内存读取 fallback 链

```
外部 --rules-dir 的 .txt       ──优先级最高──► 覆盖内置同名标签
外部 --rules-dir 的 .dat       ──优先级中────► 覆盖内置同名标签
SEA 内置 geosite.dat           ──优先级最低──► 默认规则来源（Phase 0）
```

**优先级**：`外部 .txt > 外部 .dat > SEA 内置 .dat`

### 修改文件清单

| 文件 | 变更 |
|------|------|
| `sea-config.json` | 添加 `assets: { "rules/geosite.dat": "rules/geosite.dat" }` |
| `src/rule-set/geosite-dat.ts` | 新增 `parseGeositeDat(buf, name)` 函数；`loadGeositeDat()` 改为调用它 |
| `src/rule-set/resolver.ts` | `createRuleSetResolver()` 新增可选参数 `builtinDatBuffer?: Buffer`；Phase 0 加载 |
| `cli.js` | SEA 检测 + asset 读取 + 传入 resolver；`--show-tags` / `--show-domains` 适配 |
| `test/rule-set/geosite-dat.test.ts` | 新增 `parseGeositeDat` 从 Buffer 解析的测试 |

### 关键函数变更

#### `geosite-dat.ts` — 拆分解码器

将原有 `loadGeositeDat()` 的解析逻辑提取为 `parseGeositeDat()`，使其可被文件路径和 Buffer 两种来源复用：

```ts
// 从 Buffer 解析（SEA asset 和文件路径共用）
export function parseGeositeDat(buf: Buffer, name: string): Map<string, DomainTrie> {
  const result = new Map<string, DomainTrie>()
  let offset = 0, siteCount = 0, domainCount = 0
  while (offset < buf.length) {
    // ... 原有解析逻辑 ...
  }
  return result
}

// 从文件路径加载（保持向后兼容）
export function loadGeositeDat(filePath: string): Map<string, DomainTrie> {
  const buf = readFileSync(filePath)
  return parseGeositeDat(buf, basename(filePath))
}
```

#### `resolver.ts` — Phase 0 内置加载

```ts
export function createRuleSetResolver(
  rulesDir?: string,
  builtinDatBuffer?: Buffer
): RuleSetResolver {
  const cache = new Map<string, DomainTrie>()

  // Phase 0: 加载 SEA 内置 geosite.dat（优先级最低）
  if (builtinDatBuffer) {
    const tagMap = parseGeositeDat(builtinDatBuffer, "<builtin>")
    for (const [tag, trie] of tagMap) {
      cache.set(tag, trie)
    }
    debug("rule-set: loaded %d tags from SEA built-in geosite.dat", cache.size)
  }

  // Phase 1: 加载外部 .dat（覆盖内置同名标签）
  // Phase 2: 加载外部 .txt（最高优先级，覆盖所有）
  // ... 现有逻辑不变 ...
}
```

#### `cli.js` — SEA 检测

```js
// 读取 SEA 内置 geosite.dat
let builtinDatBuffer = null
if (require("node:sea").isSea()) {
  const asset = require("node:sea").getRawAsset("rules/geosite.dat")
  if (asset) {
    builtinDatBuffer = Buffer.from(asset)
    if (!argv.silent && !argv.quiet) {
      console.log("  SEA built-in geosite.dat loaded (%d bytes)", builtinDatBuffer.length)
    }
  }
}

// 有内置资源或外部目录时创建 resolver
if (argv.rulesDir || builtinDatBuffer) {
  ruleSets = ruleSet.createRuleSetResolver(argv.rulesDir, builtinDatBuffer)
}
```

#### `sea-config.json` — 资产声明

```json
{
  "main": "dist/sea-bundle.js",
  "output": "dist/straightforward",
  "disableExperimentalSEAWarning": true,
  "useCodeCache": true,
  "assets": {
    "rules/geosite.dat": "rules/geosite.dat"
  }
}
```

### 文件大小

| 组件 | 大小 |
|------|------|
| SEA 二进制（当前） | ~126 MB |
| geosite.dat | ~10 MB |
| SEA 二进制（打包后） | ~136 MB |

### 默认行为（零变更）

- **非 SEA 环境**（`node cli.js`）：行为完全不变，仍从 `--rules-dir` 读取
- **SEA 环境无 --rules-dir**：使用内置 geosite.dat，开箱即用
- **SEA 环境有 --rules-dir**：外部文件覆盖内置同名标签

## 测试

| 测试 | 说明 |
|------|------|
| parseGeositeDat from Buffer (synthetic) | 内存中构建 .dat 数据并解析 |
| parseGeositeDat from file | 与 loadGeositeDat 结果一致 |
| resolver with builtinDatBuffer | Phase 0 加载，标签可用 |
| resolver with builtinDatBuffer + external .txt | 外部 .txt 覆盖内置标签 |
| loadGeositeDat backward compat | 保持原有 API 不变 |

## 验证

```bash
# 单元测试
npx ava -v test/rule-set/geosite-dat.test.ts

# 全量测试
npm test

# SEA 构建
npm run build:sea

# 验证 SEA 内置 geosite.dat
./dist/straightforward --show-tags cn

# 验证开箱即用（无需 --rules-dir）
./dist/straightforward --rules rules.local.json --port 8081 --debug
```
