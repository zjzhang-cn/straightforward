/**
 * Zero-dependency geosite.dat parser.
 *
 * Decodes the v2ray GeoSiteList protobuf format using only Buffer operations.
 * No external protobuf library required.
 *
 * Schema (v2fly/v2ray-core common/protocol/geosite.proto):
 *   message GeoSiteList { repeated GeoSite entry = 1; }
 *   message GeoSite { string code = 1; repeated Domain domain = 2; }
 *   message Domain { Type type = 1; string value = 2; repeated Attribute attribute = 3; }
 *   enum Type { Plain=0; Regex=1; Domain=2; Full=3; }
 *
 * Only wire types 0 (varint) and 2 (length-delimited) appear in geosite.dat.
 */

import { readFileSync } from "fs"
import { basename } from "path"
import { DomainTrie } from "./domain-trie"

import Debug from "debug"
const debug = Debug("straightforward:rule-set")

// ============================================================
// Protobuf wire format primitives
// ============================================================

/** Read a varint from buf at offset. Returns value and new offset. */
function readVarint(buf: Buffer, offset: number): { value: number; offset: number } {
  let result = 0
  let shift = 0
  while (offset < buf.length) {
    const byte = buf[offset]
    result |= (byte & 0x7f) << shift
    offset++
    if ((byte & 0x80) === 0) break
    shift += 7
  }
  return { value: result >>> 0, offset }
}

/** Read a protobuf field tag: (field_number << 3) | wire_type */
function readTag(buf: Buffer, offset: number): { field: number; wireType: number; offset: number } {
  const { value, offset: newOffset } = readVarint(buf, offset)
  return { field: value >>> 3, wireType: value & 0x07, offset: newOffset }
}

/** Read a length-delimited string */
function readString(buf: Buffer, offset: number): { value: string; offset: number } {
  const { value: len, offset: lenEnd } = readVarint(buf, offset)
  const value = buf.toString("utf8", lenEnd, lenEnd + len)
  return { value, offset: lenEnd + len }
}

/** Read a length-delimited bytes field, returns slice and new offset */
function readBytes(buf: Buffer, offset: number): { end: number; offset: number } {
  const { value: len, offset: lenEnd } = readVarint(buf, offset)
  return { end: lenEnd + len, offset: lenEnd }
}

/** Skip an unknown field based on wire type */
function skipField(buf: Buffer, offset: number, wireType: number): number {
  if (wireType === 0) {
    // varint
    const { offset: newOffset } = readVarint(buf, offset)
    return newOffset
  }
  if (wireType === 2) {
    // length-delimited
    const { value: len, offset: lenEnd } = readVarint(buf, offset)
    return lenEnd + len
  }
  if (wireType === 5) return offset + 4 // 32-bit fixed
  if (wireType === 1) return offset + 8 // 64-bit fixed
  return offset
}

// ============================================================
// Protobuf message parsers
// ============================================================

/** Domain.Type enum values */
const enum DomainType {
  Plain = 0,  // keyword/substr — skipped
  Regex = 1,  // regex — skipped
  Domain = 2, // suffix match → trie.insert()
  Full = 3,   // exact match → trie.insertFull()
}

interface ParsedDomain {
  type: DomainType
  value: string
}

/** Parse a Domain message */
function parseDomain(buf: Buffer, offset: number, end: number): ParsedDomain {
  const domain: ParsedDomain = { type: DomainType.Domain, value: "" }
  while (offset < end) {
    const { field, wireType, offset: next } = readTag(buf, offset)
    offset = next
    if (field === 1 && wireType === 0) {
      // Domain.type
      const { value, offset: newOffset } = readVarint(buf, offset)
      domain.type = value as DomainType
      offset = newOffset
    } else if (field === 2 && wireType === 2) {
      // Domain.value
      const { value, offset: newOffset } = readString(buf, offset)
      domain.value = value
      offset = newOffset
    } else {
      // skip attribute (field 3) and unknown fields
      offset = skipField(buf, offset, wireType)
    }
  }
  return domain
}

interface ParsedSite {
  code: string
  domains: ParsedDomain[]
}

/** Parse a Site/GeoSite message */
function parseSite(buf: Buffer, offset: number, end: number): ParsedSite {
  const site: ParsedSite = { code: "", domains: [] }
  while (offset < end) {
    const { field, wireType, offset: next } = readTag(buf, offset)
    offset = next
    if (field === 1 && wireType === 2) {
      // Site.code
      const { value, offset: newOffset } = readString(buf, offset)
      site.code = value
      offset = newOffset
    } else if (field === 2 && wireType === 2) {
      // Site.domain (embedded Domain message)
      const { end: domainEnd, offset: domainStart } = readBytes(buf, offset)
      const domain = parseDomain(buf, domainStart, domainEnd)
      site.domains.push(domain)
      offset = domainEnd
    } else {
      offset = skipField(buf, offset, wireType)
    }
  }
  return site
}

// ============================================================
// Public API
// ============================================================

/**
 * Load a geosite.dat file and return a Map of tag → DomainTrie.
 *
 * Each "site" (code) in the .dat file becomes a separate trie.
 * Domain types:
 *   - Full (3): exact match via insertFull()
 *   - Domain (2): suffix match via insert()
 *   - Plain (0), Regex (1): skipped
 */
export function loadGeositeDat(filePath: string): Map<string, DomainTrie> {
  const buf = readFileSync(filePath)
  const result = new Map<string, DomainTrie>()
  const fname = basename(filePath)

  let offset = 0
  let siteCount = 0
  let domainCount = 0

  // Parse top-level SiteList / GeoSiteList message
  while (offset < buf.length) {
    const { field, wireType, offset: next } = readTag(buf, offset)
    offset = next
    if (field === 1 && wireType === 2) {
      // entries/entry — a Site message
      const { end: siteEnd, offset: siteStart } = readBytes(buf, offset)
      const site = parseSite(buf, siteStart, siteEnd)
      offset = siteEnd

      if (!site.code) continue

      // Lowercase tag for case-insensitive lookup (v2ray uses lowercase: geosite:cn)
      const tag = site.code.toLowerCase()
      const trie = new DomainTrie()
      let trieDomainCount = 0

      for (const domain of site.domains) {
        if (!domain.value) continue

        if (domain.type === DomainType.Full) {
          trie.insertFull(domain.value)
          trieDomainCount++
        } else if (domain.type === DomainType.Domain) {
          trie.insert(domain.value)
          trieDomainCount++
        }
        // Plain (0) and Regex (1) are skipped
      }

      result.set(tag, trie)
      siteCount++
      domainCount += trieDomainCount
      debug(
        `geosite.dat: loaded tag "%s" (%d domains) from %s`,
        tag,
        trieDomainCount,
        fname
      )
    } else {
      offset = skipField(buf, offset, wireType)
    }
  }

  debug(
    `geosite.dat: parsed %d sites, %d domains from %s (%d bytes)`,
    siteCount,
    domainCount,
    fname,
    buf.length
  )

  return result
}
