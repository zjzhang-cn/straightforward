import { readFileSync, existsSync, readdirSync } from "fs"
import { resolve, basename, extname } from "path"
import { DomainTrie } from "./domain-trie"

import Debug from "debug"
const debug = Debug("straightforward:rule-set")

// ============================================================
// Types
// ============================================================

export interface RuleSetResolver {
  /** Check if `hostname` matches the given rule-set tag. */
  match(tag: string, hostname: string): boolean
  /** Check whether a tag is loaded. */
  has(tag: string): boolean
  /** List all loaded tags. */
  tags(): string[]
}

// ============================================================
// Factory
// ============================================================

/**
 * Create a RuleSetResolver from a rules directory.
 *
 * Scans `rulesDir` for *.txt files. Each file becomes a tag named
 * by its basename (without `.txt`). E.g. `gfw.txt` → tag `gfw`.
 *
 * Supports two kinds of tag reference:
 *   1. Named: `geosite:gfw`  → looks up `gfw.txt` in rulesDir
 *   2. Path:  `geosite:./custom.txt` → loads that specific file
 */
export function createRuleSetResolver(rulesDir?: string): RuleSetResolver {
  // Map<tag, trie>
  const cache = new Map<string, DomainTrie>()

  // Auto-load all .txt files from rulesDir
  if (rulesDir) {
    const dir = resolve(rulesDir)
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter(
        (f) => extname(f) === ".txt"
      )
      for (const file of files) {
        const tag = basename(file, ".txt")
        try {
          const trie = loadTxtFile(resolve(dir, file))
          cache.set(tag, trie)
          debug(`rule-set: loaded "${tag}" (%d domains) from %s`, trie.size, file)
        } catch (err: any) {
          debug(`rule-set: failed to load %s: %s`, file, err.message)
        }
      }
      debug(`rule-set: %d tags loaded from %s`, cache.size, dir)
    } else {
      debug(`rule-set: directory not found: %s`, dir)
    }
  }

  return {
    match(tag: string, hostname: string): boolean {
      const trie = cache.get(tag) ?? loadSingleFile(tag)
      if (!trie) return false
      return trie.match(hostname)
    },

    has(tag: string): boolean {
      return cache.has(tag) || existsSync(tag)
    },

    tags(): string[] {
      return Array.from(cache.keys())
    },
  }

  /**
   * Try to load a tag as a file path (for path references like
   * `geosite:./local/custom.txt`). Caches on success.
   */
  function loadSingleFile(tag: string): DomainTrie | undefined {
    // If tag looks like a file path
    if (tag.includes("/") || tag.includes("\\") || tag.includes(".")) {
      const path = resolve(tag)
      if (existsSync(path)) {
        try {
          const trie = loadTxtFile(path)
          cache.set(tag, trie)
          debug(`rule-set: loaded "%s" (%d domains) from path`, basename(tag), trie.size)
          return trie
        } catch (err: any) {
          debug(`rule-set: failed to load path %s: %s`, tag, err.message)
        }
      }
    }
    return undefined
  }
}

// ============================================================
// File loader
// ============================================================

function loadTxtFile(filePath: string): DomainTrie {
  const text = readFileSync(filePath, "utf-8")
  const trie = new DomainTrie()
  let count = 0
  for (const line of text.split("\n")) {
    const raw = line.trim()
    if (!raw || raw.startsWith("#")) continue

    // Parse v2ray rule-set prefix types:
    //   domain:google.com  → suffix match (same as no prefix)
    //   full:google.com    → exact match only
    //   keyword:google     → not supported, skip
    //   regexp:.*\.com     → not supported, skip
    //   (no prefix)        → suffix match (default)
    let mode: "domain" | "full" = "domain"
    let domain = raw
    if (raw.startsWith("domain:")) {
      mode = "domain"
      domain = raw.slice("domain:".length)
    } else if (raw.startsWith("full:")) {
      mode = "full"
      domain = raw.slice("full:".length)
    } else if (raw.startsWith("keyword:") || raw.startsWith("regexp:")) {
      // skip unsupported types
      continue
    }

    if (domain) {
      if (mode === "full") {
        trie.insertFull(domain)
      } else {
        trie.insert(domain)
      }
      count++
    }
  }
  debug(`rule-set: parsed %d lines → %d unique domains from %s`, count, trie.size, basename(filePath))
  return trie
}
