import test from "ava"
import { ruleSet } from "../../src"
import { resolve } from "path"
import { writeFileSync, mkdirSync, rmSync } from "fs"

const DAT_FILE = resolve(__dirname, "../../rules/geosite.dat")
const TMP_DIR = resolve(__dirname, "../../../tmp-test-geosite-dat")

// ============================================================
// Test helpers
// ============================================================

// Build a minimal geosite.dat in memory using raw protobuf encoding
function buildDat(
  sites: Array<{ code: string; domains: Array<{ type: number; value: string }> }>
): Buffer {
  const parts: Buffer[] = []

  for (const site of sites) {
    // Encode Domain messages
    const domainBufs: Buffer[] = []
    for (const d of site.domains) {
      const valueBuf = encodeString(2, d.value)
      const typeBuf = encodeVarint(1, d.type)
      domainBufs.push(encodeMessage(2, Buffer.concat([typeBuf, valueBuf])))
    }

    // Encode Site message: code (field 1) + repeated domain (field 2)
    const codeBuf = encodeString(1, site.code)
    const siteBuf = Buffer.concat([codeBuf, ...domainBufs])
    parts.push(encodeMessage(1, siteBuf))
  }

  return Buffer.concat(parts)
}

function encodeVarint(field: number, value: number): Buffer {
  const tag = (field << 3) | 0 // wire type 0 (varint)
  const tagBuf = encodeRawVarint(tag)
  const valBuf = encodeRawVarint(value)
  return Buffer.concat([tagBuf, valBuf])
}

function encodeString(field: number, value: string): Buffer {
  const tag = (field << 3) | 2 // wire type 2 (length-delimited)
  const tagBuf = encodeRawVarint(tag)
  const data = Buffer.from(value, "utf8")
  const lenBuf = encodeRawVarint(data.length)
  return Buffer.concat([tagBuf, lenBuf, data])
}

function encodeMessage(field: number, data: Buffer): Buffer {
  const tag = (field << 3) | 2
  const tagBuf = encodeRawVarint(tag)
  const lenBuf = encodeRawVarint(data.length)
  return Buffer.concat([tagBuf, lenBuf, data])
}

function encodeRawVarint(value: number): Buffer {
  const bytes: number[] = []
  let v = value >>> 0
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80)
    v >>>= 7
  }
  bytes.push(v & 0x7f)
  return Buffer.from(bytes)
}

// ============================================================
// Tests
// ============================================================

test("geosite.dat: load synthetic dat with one site", (t) => {
  const buf = buildDat([
    {
      code: "test",
      domains: [
        { type: 2, value: "example.com" },  // Domain (suffix match)
        { type: 3, value: "exact.example.com" }, // Full (exact match)
      ],
    },
  ])

  // Write to tmp file and load
  mkdirSync(TMP_DIR, { recursive: true })
  const filePath = resolve(TMP_DIR, "test.dat")
  writeFileSync(filePath, buf)

  const map = ruleSet.loadGeositeDat(filePath)
  t.is(map.size, 1)

  const trie = map.get("test")!
  t.truthy(trie)
  t.true(trie.match("example.com"))
  t.true(trie.match("sub.example.com")) // suffix match
  t.true(trie.match("exact.example.com"))
  t.false(trie.match("other.com"))

  rmSync(TMP_DIR, { recursive: true })
})

test("geosite.dat: tag names are lowercased", (t) => {
  const buf = buildDat([
    {
      code: "MY-TAG",
      domains: [{ type: 2, value: "example.com" }],
    },
  ])

  mkdirSync(TMP_DIR, { recursive: true })
  const filePath = resolve(TMP_DIR, "case.dat")
  writeFileSync(filePath, buf)

  const map = ruleSet.loadGeositeDat(filePath)
  t.true(map.has("my-tag"))
  t.false(map.has("MY-TAG"))

  rmSync(TMP_DIR, { recursive: true })
})

test("geosite.dat: Full type uses exact match only", (t) => {
  const buf = buildDat([
    {
      code: "fulltest",
      domains: [{ type: 3, value: "google.com" }],
    },
  ])

  mkdirSync(TMP_DIR, { recursive: true })
  const filePath = resolve(TMP_DIR, "full.dat")
  writeFileSync(filePath, buf)

  const map = ruleSet.loadGeositeDat(filePath)
  const trie = map.get("fulltest")!

  t.true(trie.match("google.com"))
  t.false(trie.match("www.google.com")) // NOT a suffix match
  t.false(trie.match("notgoogle.com"))

  rmSync(TMP_DIR, { recursive: true })
})

test("geosite.dat: Domain type uses suffix match", (t) => {
  const buf = buildDat([
    {
      code: "domaintest",
      domains: [{ type: 2, value: "google.com" }],
    },
  ])

  mkdirSync(TMP_DIR, { recursive: true })
  const filePath = resolve(TMP_DIR, "domain.dat")
  writeFileSync(filePath, buf)

  const map = ruleSet.loadGeositeDat(filePath)
  const trie = map.get("domaintest")!

  t.true(trie.match("google.com"))
  t.true(trie.match("www.google.com"))
  t.true(trie.match("mail.google.com"))
  t.false(trie.match("notgoogle.com"))
  t.false(trie.match("other.com"))

  rmSync(TMP_DIR, { recursive: true })
})

test("geosite.dat: Plain and Regex types are skipped", (t) => {
  const buf = buildDat([
    {
      code: "skiptest",
      domains: [
        { type: 0, value: "keyword" },   // Plain — skip
        { type: 1, value: ".*\\.com" },  // Regex — skip
        { type: 2, value: "example.com" }, // Domain — keep
      ],
    },
  ])

  mkdirSync(TMP_DIR, { recursive: true })
  const filePath = resolve(TMP_DIR, "skip.dat")
  writeFileSync(filePath, buf)

  const map = ruleSet.loadGeositeDat(filePath)
  const trie = map.get("skiptest")!

  // Only Domain type (example.com) should be present
  t.is(trie.size, 1)
  t.true(trie.match("example.com"))
  t.false(trie.match("keyword"))
  t.false(trie.match("anything.com"))

  rmSync(TMP_DIR, { recursive: true })
})

test("geosite.dat: multiple sites in one file", (t) => {
  const buf = buildDat([
    {
      code: "site1",
      domains: [{ type: 2, value: "example1.com" }],
    },
    {
      code: "site2",
      domains: [{ type: 2, value: "example2.com" }],
    },
  ])

  mkdirSync(TMP_DIR, { recursive: true })
  const filePath = resolve(TMP_DIR, "multi.dat")
  writeFileSync(filePath, buf)

  const map = ruleSet.loadGeositeDat(filePath)
  t.is(map.size, 2)

  const site1 = map.get("site1")!
  t.true(site1.match("example1.com"))
  t.false(site1.match("example2.com"))

  const site2 = map.get("site2")!
  t.true(site2.match("example2.com"))
  t.false(site2.match("example1.com"))

  rmSync(TMP_DIR, { recursive: true })
})

// Real geosite.dat test — only runs if the file exists
const hasRealDat = (() => {
  try {
    const { existsSync } = require("fs")
    return existsSync(DAT_FILE)
  } catch {
    return false
  }
})()

if (hasRealDat) {
  test("geosite.dat: real file — loads tags", (t) => {
    const map = ruleSet.loadGeositeDat(DAT_FILE)
    t.true(map.size > 100, `Expected > 100 tags, got ${map.size}`)
    t.true(map.has("cn"))
    t.true(map.has("gfw"))
    t.true(map.has("google"))
    t.true(map.has("apple-cn"))
    t.true(map.has("geolocation-!cn"))
  })

  test("geosite.dat: real file — cn matches baidu.com but not google.com", (t) => {
    const map = ruleSet.loadGeositeDat(DAT_FILE)
    const cn = map.get("cn")!
    t.true(cn.match("baidu.com"))
    t.true(cn.match("www.baidu.com"))
    t.false(cn.match("www.google.com"))
    t.false(cn.match("google.com"))
  })

  test("geosite.dat: real file — gfw matches google.com but not baidu.com", (t) => {
    const map = ruleSet.loadGeositeDat(DAT_FILE)
    const gfw = map.get("gfw")!
    t.true(gfw.match("www.google.com"))
    t.true(gfw.match("twitter.com"))
    t.false(gfw.match("baidu.com"))
  })
}
