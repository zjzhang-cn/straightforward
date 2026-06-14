# 测试记录

> 最后更新：2026-06-14

## 测试统计

当前测试总数：**87 tests passed, 2 skipped**

| 测试文件 | 测试数量 | 说明 |
|---------|---------|------|
| `test/rule-set/geosite-dat.test.ts` | 9 | geosite.dat 解析器测试 |
| `test/rule-set/domain-trie.test.ts` | 13 | DomainTrie 单元测试 |
| `test/rule-set/resolver.test.ts` | 12 | 规则集加载器测试 |
| `test/proxyRules.test.ts` | 16 | 路由规则中间件测试 |
| `test/acl.test.ts` | 18 | IP ACL 测试 |
| `test/basics.test.ts` | 5 | 基础功能测试 |
| `test/comprehensive.test.ts` | 12 | 综合测试 |
| `test/auth.test.ts` | 1 | 认证测试 |
| `test/echo.test.ts` | 1 | 回显测试 |

## 运行测试

```bash
# 全部根目录测试
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

## 压力测试

| 指标 | 结果 |
|------|------|
| 持续时间 | 60s |
| 并发数 | 64 |
| 平均 RPS | ~140 |
| 内存泄漏 | 无 |
| 失败率 | ~3%（httpbin.org 限流） |
