# CLI 工具增强

> 最后更新：2026-06-14 | 状态：✅ 已完成

## 已完成

- [x] **`--show-tags [filter]`**: 列出 geosite.dat 中所有标签（1503 个），按域名数量排序，支持关键词过滤 — commit `1da16c3`
- [x] **`--show-domains <tag>`**: 列出指定标签下的所有域名，显示匹配类型 `[full]`/`[domain]` — commit `cf225a3`
- [x] **DomainTrie.list()**: 新增方法遍历 trie 中所有域名规则 — commit `cf225a3`

## 使用示例

```bash
# 列出所有标签（按域名数量降序）
node cli.js --rules-dir ./rules/ --show-tags

# 按关键词过滤
node cli.js --rules-dir ./rules/ --show-tags cn        # 包含 "cn" 的标签
node cli.js --rules-dir ./rules/ --show-tags gfw       # 包含 "gfw" 的标签

# 列出指定标签的所有域名
node cli.js --rules-dir ./rules/ --show-domains gfw         # GFW 域名列表
node cli.js --rules-dir ./rules/ --show-domains apple-cn    # Apple 中国 CDN 域名
node cli.js --rules-dir ./rules/ --show-domains cn          # 中国域名（约 112k）
```

## 输出格式

`--show-tags` 输出示例：
```
geosite.dat: 1503 tags total

## Geolocation / Region (3)
--------------------------------------------------------
  cn                                          112,732 domains
  geolocation-!cn                              26,666 domains
  geolocation-cn                                4,718 domains

## Category (category-*) (113)
--------------------------------------------------------
  category-ads-all                            167,470 domains
  category-companies                            8,544 domains
  ...

## Services / Companies (1384)
--------------------------------------------------------
  google                                         1,068 domains
  gfw                                            4,232 domains
  ...
```

`--show-domains gfw` 输出示例：
```
Tag: gfw (4232 domains)

  [domain]   kawase.com
  [domain]   torrentprivacy.com
  [domain]   10musume.com
  ...
```

`--show-domains apple-cn` 输出示例：
```
Tag: apple-cn (163 domains)

  [full]     a1.mzstatic.com
  [full]     a2.mzstatic.com
  [full]     adcdownload.apple.com
  [domain]   apple.com
  [domain]   apple-mapkit.com
  ...
```

`[full]` 表示精确匹配，`[domain]` 表示后缀匹配。
