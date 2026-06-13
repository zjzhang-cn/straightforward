import anyTest, { TestFn } from "ava"
import { ruleSet } from "../../src"
const { DomainTrie } = ruleSet

const test = anyTest as TestFn<{}>

// ============================================================
// DomainTrie unit tests
// ============================================================

test("DomainTrie: empty trie matches nothing", (t) => {
  const trie = new DomainTrie()
  t.false(trie.match("google.com"))
  t.false(trie.match(""))
  t.is(trie.size, 0)
})

test("DomainTrie: exact match", (t) => {
  const trie = new DomainTrie()
  trie.insert("google.com")
  t.true(trie.match("google.com"))
  t.is(trie.size, 1)
})

test("DomainTrie: suffix match — subdomain", (t) => {
  const trie = new DomainTrie()
  trie.insert("google.com")
  t.true(trie.match("www.google.com"), "www.google.com should match google.com")
  t.true(trie.match("mail.google.com"), "mail.google.com should match google.com")
  t.true(trie.match("a.b.google.com"), "a.b.google.com should match google.com")
})

test("DomainTrie: suffix match — NOT partial label", (t) => {
  const trie = new DomainTrie()
  trie.insert("google.com")
  t.false(trie.match("notgoogle.com"), "notgoogle.com should NOT match google.com")
  t.false(trie.match("google.com.evil.com"), "google.com.evil.com should NOT match google.com")
})

test("DomainTrie: multiple rules", (t) => {
  const trie = new DomainTrie()
  trie.insert("google.com")
  trie.insert("facebook.com")
  trie.insert("github.com")
  t.is(trie.size, 3)
  t.true(trie.match("www.google.com"))
  t.true(trie.match("api.facebook.com"))
  t.true(trie.match("github.com"))
  t.false(trie.match("twitter.com"))
})

test("DomainTrie: dedup — same domain inserted twice", (t) => {
  const trie = new DomainTrie()
  trie.insert("google.com")
  trie.insert("google.com")
  t.is(trie.size, 1)
})

test("DomainTrie: case insensitive", (t) => {
  const trie = new DomainTrie()
  trie.insert("Google.Com")
  t.true(trie.match("www.google.com"))
  t.true(trie.match("WWW.GOOGLE.COM"))
})

test("DomainTrie: empty string and whitespace ignored", (t) => {
  const trie = new DomainTrie()
  trie.insert("")
  trie.insert("  ")
  t.is(trie.size, 0)
})

test("DomainTrie: exact match wins over longer hostname", (t) => {
  const trie = new DomainTrie()
  trie.insert("google.com")
  // "com" alone is NOT inserted, so "something.com" should NOT match
  t.false(trie.match("example.com"), "example.com should NOT match google.com")
})

test("DomainTrie: more specific rule matches first", (t) => {
  const trie = new DomainTrie()
  trie.insert("google.com")
  trie.insert("mail.google.com")
  // Both should match mail.google.com — trie will find google.com first (shorter path)
  t.true(trie.match("mail.google.com"))
  t.true(trie.match("www.google.com"))
})

test("DomainTrie: TLD rule matches everything under it", (t) => {
  const trie = new DomainTrie()
  trie.insert("cn")
  t.true(trie.match("baidu.cn"))
  t.true(trie.match("www.baidu.cn"))
  t.false(trie.match("baidu.com"))
})

test("DomainTrie: clear removes all rules", (t) => {
  const trie = new DomainTrie()
  trie.insert("google.com")
  trie.insert("facebook.com")
  t.is(trie.size, 2)
  trie.clear()
  t.is(trie.size, 0)
  t.false(trie.match("google.com"))
  t.false(trie.match("facebook.com"))
})

test("DomainTrie: large volume — 10k domains", (t) => {
  const trie = new DomainTrie()
  for (let i = 0; i < 10000; i++) {
    trie.insert(`host${i}.example.com`)
  }
  t.is(trie.size, 10000)
  t.true(trie.match("host5000.example.com"))
  t.false(trie.match("host99999.example.com"))
})
