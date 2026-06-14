#!/usr/bin/env node
// @ts-check

const yargs = require("yargs")
const pkg = require("./package.json")

const argv = yargs
  // @ts-ignore
  .usage("Usage: $0 --port 9191 [options]")
  .option("port", {
    alias: "p",
    default: 8081,
    describe: `Port to bind on`,
    type: "number",
  })
  .option("host", {
    default: "0.0.0.0",
    describe: `Host/interface to bind on`,
    type: "string",
  })
  .option("auth", {
    alias: "a",
    describe: `Enable proxy authentication`,
    type: "string",
  })
  .option("dynamic-auth", {
    // alias: "a",
    describe: `Enable proxy authentication with no validation`,
    type: "boolean",
  })
  .example('$0 --auth "user:pass"', "Require authentication")
  .option("echo", {
    alias: "e",
    describe: `Enable echo mode (mock all http responses)`,
    type: "boolean",
  })
  .example("$0 --echo", "Mock responses for all http requests")
  .option("debug", {
    alias: "d",
    describe: `Enabled debug output`,
    type: "boolean",
  })
  .option("cluster", {
    alias: "c",
    describe: `Run a cluster of proxies (using number of CPUs)`,
    type: "boolean",
  })
  .option("cluster-count", {
    describe: `Specify how many cluster workers to spawn`,
    type: "number",
  })
  .option("rules", {
    describe: `Path to proxyrules.json config file`,
    type: "string",
  })
  .option("rules-dir", {
    describe: `Directory containing rule-set .txt files (for geosite: prefix in proxyRules)`,
    type: "string",
  })
  .option("rules-download", {
    describe: `Auto-download rule-set files from loyalsoldier/v2ray-rules-dat release (default: gfw,direct-list,proxy-list)`,
    type: "string",
  })
  .option("rules-download-force", {
    describe: `Force re-download even if rule files already exist locally`,
    type: "boolean",
  })
  .option("rules-download-dat", {
    describe: `Download geosite.dat (binary format with all tags in one file)`,
    type: "boolean",
  })
  .option("upstream-host", {
    describe: `Upstream proxy host (when not using --rules)`,
    type: "string",
  })
  .option("upstream-port", {
    describe: `Upstream proxy port (when not using --rules)`,
    type: "number",
    default: 3128,
  })
  .option("upstream-auth", {
    describe: `Upstream proxy auth "user:pass" (when not using --rules)`,
    type: "string",
  })
  .option("local-address", {
    describe: `Source IP address to bind outgoing connections to`,
    type: "string",
  })
  .option("quiet", {
    alias: "q",
    describe: `Suppress request logs`,
    type: "boolean",
  })
  .option("silent", {
    alias: "s",
    describe: `Don't print anything to stdout`,
    type: "boolean",
  })
  .help("h")
  .alias("h", "help")
  .epilog(`Report issues at ${pkg.bugs.url}`).argv

if (argv.debug) {
  process.env.DEBUG = process.env.DEBUG
    ? process.env.DEBUG + ",straightforward*"
    : "straightforward*"
}

const { Straightforward, middleware } = require("./dist/index.js")

async function cli() {
  const opts = {}
  if (argv.localAddress) {
    opts.localAddress = argv.localAddress
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
