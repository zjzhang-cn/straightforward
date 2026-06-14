# 性能优化记录

> 最后更新：2026-06-14

## 已完成 (3/3) ✅

- [x] **TCP_NODELAY**: CONNECT 隧道两端开启 `setNoDelay(true)`，消除 Nagle 算法 40ms+ 延迟 — commit `e8365ea`
- [x] **HTTP Keep-Alive Agent**: 复用上游 TCP+TLS 连接，RPS 从 27 提升到 140 (5x) — commit `f6f1699`
- [x] **Hop-by-hop 头清理**: 转发前剥离 `Connection`、`Proxy-Authorization`、`Transfer-Encoding` 等逐跳头 — commit `20ec24e`

## 性能基准

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| 平均 RPS (60s, 64 并发) | ~27 | ~140 |
| Heap Used | 14-15 MB 稳定 | 14-26 MB 稳定 |
| Heap 峰值回收 | 124→17 MB | 137→18 MB |
| 成功率 | 100% | 99.9% |
| 内存泄漏 | 无 | 无 |

压力测试：`node --expose-gc -r esbuild-register test/stress.ts`（60s, 64 并发, httpbin.org）
