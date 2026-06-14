/**
 * Domain Suffix Trie — efficient domain matching against rule sets.
 *
 * Reverses domain labels so suffix matching becomes prefix matching
 * in the trie. "google.com" inserted as com → google chain; querying
 * "www.google.com" walks com → google → www and hits the rule node.
 *
 * Supports two match semantics (same as v2ray):
 *   - Domain (suffix): the default. "google.com" matches "www.google.com"
 *   - Full (exact): "google.com" matches ONLY "google.com"
 *
 * Zero dependencies. O(domain-length) match time.
 */

// ============================================================
// Types
// ============================================================

interface TrieNode {
  children: Map<string, TrieNode>
  /** true if this node represents a complete rule domain */
  isRule: boolean
}

// ============================================================
// Helper
// ============================================================

function reverseLabels(domain: string): string[] {
  return domain.toLowerCase().split(".").reverse()
}

// ============================================================
// DomainTrie
// ============================================================

export class DomainTrie {
  #root: TrieNode = { children: new Map(), isRule: false }
  #size = 0
  /** Full-match domains: exact match only, no suffix expansion */
  #fullMatch = new Set<string>()

  /** Number of rules inserted */
  get size(): number {
    return this.#size
  }

  /** Insert a domain rule (e.g. "google.com") */
  insert(domain: string): void {
    this._insertWithMode(domain, false)
  }

  /** Insert as full-match only (e.g. "google.com" matches only "google.com") */
  insertFull(domain: string): void {
    this._insertWithMode(domain, true)
  }

  private _insertWithMode(domain: string, fullMode: boolean): void {
    const key = domain.trim().toLowerCase()
    if (!key) return

    if (fullMode) {
      if (!this.#fullMatch.has(key)) {
        this.#fullMatch.add(key)
        this.#size++
      }
      return
    }

    // Domain (suffix) mode: insert into trie
    const labels = reverseLabels(key)
    if (labels.length === 0 || labels[0] === "") return

    let node = this.#root
    for (const label of labels) {
      let child = node.children.get(label)
      if (!child) {
        child = { children: new Map(), isRule: false }
        node.children.set(label, child)
      }
      node = child
    }
    if (!node.isRule) {
      node.isRule = true
      this.#size++
    }
  }

  /**
   * Check if `hostname` matches any rule in the trie.
   *
   * Match semantics (same as v2ray Domain type):
   *   - Full: hostname === rule (exact)
   *   - Suffix: hostname ends with "." + rule
   *
   * "google.com" matches "www.google.com" and "mail.google.com"
   * "google.com" does NOT match "notgoogle.com"
   */
  match(hostname: string): boolean {
    const key = hostname.trim().toLowerCase()
    if (!key) return false

    // Check full-match set first (exact match)
    if (this.#fullMatch.has(key)) return true

    // Check trie (suffix match)
    const labels = reverseLabels(key)
    if (labels.length === 0 || labels[0] === "") return false

    let node = this.#root
    for (const label of labels) {
      const child = node.children.get(label)
      if (!child) return false
      if (child.isRule) return true // matched a rule domain
      node = child
    }
    return false
  }

  /** Remove all rules */
  clear(): void {
    this.#root.children.clear()
    this.#root.isRule = false
    this.#fullMatch.clear()
    this.#size = 0
  }

  /**
   * List all domains in the trie.
   *
   * Returns an array of objects with the domain string and its match mode:
   *   { domain: "google.com", mode: "domain" }  — suffix match
   *   { domain: "dl.google.com", mode: "full" }  — exact match only
   */
  list(): Array<{ domain: string; mode: "domain" | "full" }> {
    const results: Array<{ domain: string; mode: "domain" | "full" }> = []

    // Full-match entries
    for (const domain of this.#fullMatch) {
      results.push({ domain, mode: "full" })
    }

    // Trie entries (suffix match)
    this._walkTrie(this.#root, [], results)

    return results
  }

  private _walkTrie(
    node: TrieNode,
    labels: string[],
    results: Array<{ domain: string; mode: "domain" | "full" }>
  ): void {
    if (node.isRule && labels.length > 0) {
      results.push({ domain: labels.slice().reverse().join("."), mode: "domain" })
    }
    for (const [label, child] of node.children) {
      labels.push(label)
      this._walkTrie(child, labels, results)
      labels.pop()
    }
  }
}
