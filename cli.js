#!/usr/bin/env node
// @ts-check

const yargs = require("yargs")
const pkg = require("./package.json")

const argv = yargs
  // @ts-ignore
  .usage("Usage: $0 [options]\n\nstraightforward — 极简 Node.js 正向代理服务器")
  .option("port", {
    alias: "p",
    default: 8081,
    describe: `监听端口`,
    type: "number",
    group: "服务器:",
  })
  .option("host", {
    default: "0.0.0.0",
    describe: `监听地址/接口 (默认: 0.0.0.0)`,
    type: "string",
    group: "服务器:",
  })
  .option("auth", {
    alias: "a",
    describe: `代理认证 (格式: user:pass)`,
    type: "string",
    group: "认证:",
  })
  .option("dynamic-auth", {
    describe: `动态认证模式 (不校验 user:pass)`,
    type: "boolean",
    group: "认证:",
  })
  .option("echo", {
    alias: "e",
    describe: `回显模式 (mock 所有 HTTP 响应)`,
    type: "boolean",
    group: "模式:",
  })
  .option("debug", {
    alias: "d",
    describe: `调试模式 (显示详细连接线路信息)`,
    type: "boolean",
    group: "模式:",
  })
  .option("cluster", {
    alias: "c",
    describe: `集群模式 (按 CPU 核心数)`,
    type: "boolean",
    group: "模式:",
  })
  .option("cluster-count", {
    describe: `指定集群 worker 数量`,
    type: "number",
    group: "模式:",
  })
  .option("rules", {
    describe: `代理规则配置文件路径`,
    type: "string",
    group: "规则:",
  })
  .option("rules-dir", {
    describe: `规则集目录 (用于 geosite: 前缀)`,
    type: "string",
    group: "规则:",
  })
  .option("rules-download", {
    describe: `下载 .txt 规则文件 (默认: gfw,direct-list,proxy-list)`,
    type: "string",
    group: "规则:",
  })
  .option("rules-download-force", {
    describe: `强制重新下载规则文件`,
    type: "boolean",
    group: "规则:",
  })
  .option("rules-download-dat", {
    describe: `下载 geosite.dat 二进制文件 (1503 标签)`,
    type: "boolean",
    group: "规则:",
  })
  .option("show-tags", {
    describe: `查看 geosite.dat 标签列表 (可选: 过滤词)`,
    type: "string",
    group: "规则:",
  })
  .option("show-domains", {
    describe: `查看指定标签的域名列表`,
    type: "string",
    group: "规则:",
  })
  .option("upstream-host", {
    describe: `上游代理主机 (配合 --rules 或单独使用)`,
    type: "string",
    group: "上游代理:",
  })
  .option("upstream-port", {
    describe: `上游代理端口`,
    type: "number",
    default: 3128,
    group: "上游代理:",
  })
  .option("upstream-auth", {
    describe: `上游代理认证 (格式: user:pass)`,
    type: "string",
    group: "上游代理:",
  })
  .option("local-address", {
    describe: `出口源 IP 地址 (多网卡选择出口)`,
    type: "string",
    group: "网络:",
  })
  .option("dns", {
    describe: `自定义 DNS 服务器 (格式: IP地址，如 8.8.8.8)`,
    type: "string",
    group: "网络:",
  })
  .option("quiet", {
    alias: "q",
    describe: `静默请求日志`,
    type: "boolean",
    group: "输出:",
  })
  .option("silent", {
    alias: "s",
    describe: `完全不输出到 stdout`,
    type: "boolean",
    group: "输出:",
  })
  .help("h")
  .alias("h", "help")
  // @ts-ignore
  .group(["help", "version"], "其他:")
  .example([
    ["$0 --port 8081", "基本代理 (HTTP + HTTPS)"],
    ['$0 --port 8081 --auth "user:pass"', "带认证的代理"],
    ["$0 --port 8081 --upstream-host proxy.example.com", "所有流量走上游代理"],
    ["$0 --rules-dir ./rules/ --rules rules.json", "使用配置文件分流"],
    ["$0 --rules-dir ./rules/ --rules-download-dat", "下载 geosite.dat"],
    ["$0 --rules-dir ./rules/ --show-tags", "查看所有可用标签"],
    ["$0 --rules-dir ./rules/ --show-domains gfw", "查看 gfw 标签的域名"],
    ["$0 --port 8081 --local-address 10.0.0.1", "绑定出口 IP"],
    ["$0 --port 8081 --debug", "调试模式 (显示连接线路)"],
    ["$0 --port 8081 --cluster", "集群模式"],
  ])
  .epilog(`Report issues at ${pkg.bugs.url}`).argv

if (argv.debug) {
  process.env.DEBUG = process.env.DEBUG
    ? process.env.DEBUG + ",straightforward*"
    : "straightforward*"
}

const { Straightforward, middleware } = require("./dist/index.js")

// ── Show tags / domains from geosite.dat ──
if (argv.showTags !== undefined || argv.showDomains) {
  const { ruleSet } = require("./dist/index.js")
  const fs = require("fs")
  const path = require("path")
  const rulesDir = argv.rulesDir || path.join(__dirname, "rules")
  const datFile = path.join(rulesDir, "geosite.dat")

  if (!fs.existsSync(datFile)) {
    console.error(`Error: ${datFile} not found. Use --rules-dir to specify the directory or download it with --rules-download-dat`)
    process.exit(1)
  }

  const map = ruleSet.loadGeositeDat(datFile)

  if (argv.showDomains) {
    // Show domains for a specific tag
    const tag = argv.showDomains.toLowerCase()
    const trie = map.get(tag)
    if (!trie) {
      console.error(`Tag "${tag}" not found in geosite.dat`)
      console.error(`Available tags: ${Array.from(map.keys()).sort().join(", ")}`)
      process.exit(1)
    }
    const domains = trie.list()
    console.log(`Tag: ${tag} (${domains.length} domains)\n`)
    for (const { domain, mode } of domains) {
      const modeTag = mode === "full" ? "[full]" : "[domain]"
      console.log(`  ${modeTag.padEnd(10)} ${domain}`)
    }
    process.exit(0)
  }

  // Show all tags (optionally filtered)
  const filter = typeof argv.showTags === "string" && argv.showTags !== ""
    ? argv.showTags.toLowerCase()
    : null

  const tags = Array.from(map.entries())
    .filter(([tag]) => !filter || tag.includes(filter))
    .sort((a, b) => b[1].size - a[1].size) // Sort by domain count descending

  if (tags.length === 0) {
    console.error(`No tags found matching "${filter}"`)
    process.exit(1)
  }

  // Categorize
  const geo = tags.filter(([t]) => t.startsWith("geolocation-") || ["cn", "ru", "ir", "hk", "tw", "mo", "jp"].includes(t))
  const category = tags.filter(([t]) => t.startsWith("category-") && !geo.some(([g]) => g === t))
  const services = tags.filter(([t]) => !t.startsWith("category-") && !t.startsWith("geolocation-") && !geo.some(([g]) => g === t) && !t.startsWith("tld-") && !t.startsWith("win-"))
  const tlds = tags.filter(([t]) => t.startsWith("tld-"))
  const winRules = tags.filter(([t]) => t.startsWith("win-"))

  const printTable = (title, items) => {
    if (items.length === 0) return
    console.log(`\n## ${title} (${items.length})`)
    console.log("-".repeat(56))
    for (const [tag, trie] of items) {
      const count = trie.size.toLocaleString().padStart(8)
      console.log(`  ${tag.padEnd(42)} ${count} domains`)
    }
  }

  console.log(`geosite.dat: ${map.size} tags total`)

  if (!filter) {
    // Show summary when no filter
    printTable("Geolocation / Region", geo)
    printTable("Category (category-*)", category)
    printTable("TLD", tlds)
    printTable("Windows Rules", winRules)
    printTable("Services / Companies", services)
  } else {
    // Show all matching tags in one table
    console.log(`\nFiltered by: "${filter}"`)
    console.log("-".repeat(56))
    for (const [tag, trie] of tags) {
      const count = trie.size.toLocaleString().padStart(8)
      console.log(`  ${tag.padEnd(42)} ${count} domains`)
    }
  }

  process.exit(0)
}

async function cli() {
  const opts = {}
  if (argv.localAddress) {
    opts.localAddress = argv.localAddress
  }
  if (argv.dns) {
    opts.dns = argv.dns
  }

  const sf = new Straightforward(opts)

  if (!argv.silent) {
    sf.on("listen", (port, _pid, _server, host) => {
      console.log(`
      straightforward forward-proxy running on ${host || "localhost"}:${port}
      `)
    })
    sf.on("serverError", (err) => console.error("An error occured.", err))
  }

  // ── Auto-download rule files (before loading resolver) ──
  if (argv.rulesDownload || argv.rulesDownloadForce || argv.rulesDownloadDat) {
    if (!argv.rulesDir) {
      console.error("Error: --rules-download/--rules-download-dat requires --rules-dir to be set")
      process.exit(1)
    }
    const { ruleSet } = require("./dist/index.js")

    // Download .txt files (individual tags)
    if (argv.rulesDownload || argv.rulesDownloadForce) {
      const tags = argv.rulesDownload === true || argv.rulesDownload === ""
        ? undefined  // use defaults
        : argv.rulesDownload.split(",").map((s) => s.trim()).filter(Boolean)
      if (!argv.silent && !argv.quiet) {
        console.log(`  Downloading rule-set files (${tags?.join(",") || "default"}) from loyalsoldier/v2ray-rules-dat...`)
      }
      const result = await ruleSet.downloadRules(argv.rulesDir, tags, !!argv.rulesDownloadForce)
      if (!argv.silent && !argv.quiet) {
        if (result.downloaded.length) console.log(`    Downloaded: ${result.downloaded.join(", ")}`)
        if (result.skipped.length) console.log(`    Skipped (already exist): ${result.skipped.join(", ")}`)
        if (result.errors.length) result.errors.forEach(e => console.error(`    Error [${e.tag}]: ${e.message}`))
      }
    }

    // Download geosite.dat (binary format with all tags)
    if (argv.rulesDownloadDat) {
      if (!argv.silent && !argv.quiet) {
        console.log(`  Downloading geosite.dat from loyalsoldier/v2ray-rules-dat...`)
      }
      const result = await ruleSet.downloadGeositeDat(argv.rulesDir, !!argv.rulesDownloadForce)
      if (!argv.silent && !argv.quiet) {
        if (result.downloaded.length) console.log(`    Downloaded: ${result.downloaded.join(", ")}`)
        if (result.skipped.length) console.log(`    Skipped (already exist): ${result.skipped.join(", ")}`)
        if (result.errors.length) result.errors.forEach(e => console.error(`    Error [${e.tag}]: ${e.message}`))
      }
    }
  }

  // ── Rule-set resolver (for geosite: prefix) ──
  let ruleSets
  if (argv.rulesDir) {
    const { ruleSet } = require("./dist/index.js")
    ruleSets = ruleSet.createRuleSetResolver(argv.rulesDir)
    if (!argv.silent && !argv.quiet) {
      console.log(`  Rule-set dir: ${argv.rulesDir} (${ruleSets.tags().length} tags loaded)`)
    }
  }

  // ── Proxy rules (unified config: upstream + localAddress + routing) ──
  let rulesConfig
  if (argv.rules) {
    rulesConfig = require("fs").readFileSync(argv.rules, "utf-8")
    rulesConfig = JSON.parse(rulesConfig)
    if (rulesConfig.rules) {
      if (ruleSets) rulesConfig.ruleSets = ruleSets
      sf.onRequest.use(middleware.proxyRules(rulesConfig))
      sf.onConnect.use(middleware.proxyRules(rulesConfig))
      if (!argv.silent && !argv.quiet) {
        console.log(`  Loaded ${rulesConfig.rules.length} proxy rule(s) from ${argv.rules}`)
      }
    }
  } else if (argv.upstreamHost || argv.localAddress) {
    // Simplified single-rule mode
    const upstream = argv.upstreamHost
      ? {
          host: argv.upstreamHost,
          port: argv.upstreamPort || 3128,
          ...(argv.upstreamAuth
            ? {
                auth: {
                  user: argv.upstreamAuth.split(":")[0],
                  pass: argv.upstreamAuth.split(":")[1] || "",
                },
              }
            : {}),
        }
      : undefined

    rulesConfig = {
      rules: [
        {
          match: "*",
          localAddress: argv.localAddress,
          upstream,
          ...(argv.dns ? { dns: argv.dns } : {}),
        },
      ],
    }
    if (ruleSets) rulesConfig.ruleSets = ruleSets
    sf.onRequest.use(middleware.proxyRules(rulesConfig))
    sf.onConnect.use(middleware.proxyRules(rulesConfig))
    if (!argv.silent && !argv.quiet) {
      const parts = []
      if (upstream) parts.push(`upstream=${upstream.host}:${upstream.port}`)
      if (argv.localAddress) parts.push(`localAddress=${argv.localAddress}`)
      console.log(`  Unified rule: ${parts.join(", ") || "direct"}`)
    }
  }

  if (argv.auth && !argv.dynamicAuth) {
    const [user, pass] = argv.auth.split(":")
    sf.onRequest.use(middleware.auth({ user, pass }))
    sf.onConnect.use(middleware.auth({ user, pass }))
  }

  if (argv.dynamicAuth) {
    sf.onRequest.use(middleware.auth({ dynamic: true }))
    sf.onConnect.use(middleware.auth({ dynamic: true }))
  }

  if (argv.echo) {
    sf.onRequest.use(middleware.echo)
  }

  if (!argv.quiet && !argv.silent && !argv.debug) {
    sf.onRequest.use(async ({ req, res }, next) => {
      console.log(`\t ${req.method} \t\t ${req.url}`)
      return next()
    })
    sf.onConnect.use(async ({ req }, next) => {
      console.log(`\t ${req.method} \t ${req.url}`)
      return next()
    })
  }
  argv.cluster
    ? await sf.cluster(argv.port, argv.clusterCount, argv.host)
    : await sf.listen(argv.port, argv.host)
}

cli()
