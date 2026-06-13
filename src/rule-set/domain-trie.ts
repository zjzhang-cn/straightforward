/**
 * Domain Suffix Trie — efficient domain matching against rule sets.
 *
 * Reverses domain labels so suffix matching becomes prefix matching
 * in the trie. "google.com" inserted as com → google chain; querying
 * "www.google.com" walks com → google → www and hits the rule node.
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

  /** Number of rules inserted */
  get size(): number {
    return this.#size
  }

  /** Insert a domain rule (e.g. "google.com") */
  insert(domain: string): void {
    const labels = reverseLabels(domain.trim())
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
   *   - Exact: hostname === rule
   *   - Suffix: hostname ends with "." + rule
   *
   * "google.com" matches "www.google.com" and "mail.google.com"
   * "google.com" does NOT match "notgoogle.com"
   */
  match(hostname: string): boolean {
    const labels = reverseLabels(hostname.trim())
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
    this.#size = 0
  }
}
