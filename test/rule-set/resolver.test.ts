import anyTest, { TestFn } from "ava"
import { writeFileSync, mkdtempSync, existsSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { ruleSet } from "../../src"
const { createRuleSetResolver } = ruleSet

const test = anyTest as TestFn<{ rulesDir: string }>

let tmpBase: string

test.before(() => {
  tmpBase = mkdtempSync(join(tmpdir(), "straightforward-rule-set-"))
})

test.after(() => {
  if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true })
})

function writeRulesDir(name: string, files: Record<string, string>): string {
  const dir = join(tmpBase, name)
  // mkdirSync recursive
  const { mkdirSync } = require("fs")
  mkdirSync(dir, { recursive: true })
  for (const [filename, content] of Object.entries(files)) {
    writeFileSync(join(dir, filename), content, "utf-8")
  }
  return dir
}

// ============================================================
// Resolver: loading
// ============================================================

test("resolver: empty dir → no tags loaded", (t) => {
  const dir = writeRulesDir("empty", {})
  const r = createRuleSetResolver(dir)
  t.deepEqual(r.tags(), [])
})

test("resolver: loads .txt files as tags", (t) => {
  const dir = writeRulesDir("basic", {
    "gfw.txt": "google.com\nyoutube.com\nfacebook.com\n",
    "direct.txt": "baidu.com\nqq.com\n",
  })
  const r = createRuleSetResolver(dir)
  t.deepEqual(r.tags().sort(), ["direct", "gfw"])
  t.true(r.has("gfw"))
  t.true(r.has("direct"))
  t.false(r.has("nonexistent"))
})

test("resolver: ignores non-txt files", (t) => {
  const dir = writeRulesDir("mixed", {
    "gfw.txt": "google.com\n",
    "readme.md": "# rules\n",
    "notes": "some notes\n",
  })
  const r = createRuleSetResolver(dir)
  t.deepEqual(r.tags(), ["gfw"])
})

test("resolver: nonexistent dir → empty, no crash", (t) => {
  const r = createRuleSetResolver("/tmp/definitely-nonexistent-dir-12345")
  t.deepEqual(r.tags(), [])
  t.false(r.has("anything"))
  t.false(r.match("anything", "google.com"))
})

// ============================================================
// Resolver: matching
// ============================================================

test("resolver: match via tag — exact", (t) => {
  const dir = writeRulesDir("match-exact", {
    "test.txt": "google.com\n",
  })
  const r = createRuleSetResolver(dir)
  t.true(r.match("test", "google.com"))
})

test("resolver: match via tag — suffix (subdomain)", (t) => {
  const dir = writeRulesDir("match-suffix", {
    "test.txt": "google.com\n",
  })
  const r = createRuleSetResolver(dir)
  t.true(r.match("test", "www.google.com"))
  t.true(r.match("test", "mail.google.com"))
  t.false(r.match("test", "notgoogle.com"))
  t.false(r.match("test", "example.com"))
})

test("resolver: match via tag — case insensitive", (t) => {
  const dir = writeRulesDir("match-case", {
    "test.txt": "Google.Com\n",
  })
  const r = createRuleSetResolver(dir)
  t.true(r.match("test", "www.google.com"))
  t.true(r.match("test", "WWW.GOOGLE.COM"))
})

test("resolver: match ignores comments and empty lines", (t) => {
  const dir = writeRulesDir("match-comments", {
    "test.txt": "# this is a comment\n\ngoogle.com\n\n# another comment\nyoutube.com\n",
  })
  const r = createRuleSetResolver(dir)
  t.true(r.match("test", "google.com"))
  t.true(r.match("test", "www.youtube.com"))
})

test("resolver: path reference — direct file path", (t) => {
  const dir = writeRulesDir("path-ref", {
    "custom.txt": "example.org\n",
  })
  const filePath = join(dir, "custom.txt")
  const r = createRuleSetResolver() // no rulesDir, only path refs
  t.true(r.match(filePath, "www.example.org"))
  t.false(r.match(filePath, "google.com"))
})

test("resolver: path reference caches on first load", (t) => {
  const dir = writeRulesDir("path-cache", {
    "custom.txt": "example.org\n",
  })
  const filePath = join(dir, "custom.txt")
  const r = createRuleSetResolver()
  // First call loads, second uses cache
  t.true(r.match(filePath, "example.org"))
  t.true(r.match(filePath, "example.org")) // from cache
  t.true(r.has(filePath))
})

test("resolver: tag not found → returns false", (t) => {
  const r = createRuleSetResolver()
  t.false(r.match("nonexistent", "google.com"))
})

// ============================================================
// Resolver: large file handling
// ============================================================

test("resolver: large rule set (500 domains)", (t) => {
  const domains = Array.from({ length: 500 }, (_, i) => `host${i}.example.com`).join("\n")
  const dir = writeRulesDir("large", { "big.txt": domains })
  const r = createRuleSetResolver(dir)
  t.true(r.has("big"))
  t.true(r.match("big", "host42.example.com"))
  t.true(r.match("big", "sub.host42.example.com"))
  t.false(r.match("big", "host999999.example.com"))
})
