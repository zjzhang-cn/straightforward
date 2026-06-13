/**
 * Auto-downloader for loyalsoldier/v2ray-rules-dat release assets.
 *
 * Downloads .txt rule files from the latest GitHub release, using
 * Node.js built-in https module. Zero additional dependencies.
 *
 * Default tags: gfw, direct-list, proxy-list
 *
 * Usage:
 *   import { downloadRules } from "./downloader"
 *   const result = await downloadRules("/path/to/rules/dir", ["gfw", "direct-list"])
 *   // result: { downloaded: ["gfw", "direct-list"], skipped: [] }
 */

import { existsSync, mkdirSync, renameSync, createWriteStream } from "fs"
import { join, basename } from "path"
import https from "https"

import Debug from "debug"
const debug = Debug("straightforward:rule-set")

// ============================================================
// Constants
// ============================================================

const API_URL =
  "https://api.github.com/repos/Loyalsoldier/v2ray-rules-dat/releases/latest"
const DEFAULT_TAGS = ["gfw", "direct-list", "proxy-list"]

export interface DownloadResult {
  downloaded: string[]
  skipped: string[]
  errors: { tag: string; message: string }[]
}

// ============================================================
// Public API
// ============================================================

/**
 * Download rule files from the latest GitHub release.
 *
 * Skips files that already exist locally, unless `force` is true.
 *
 * @param rulesDir  Target directory for .txt files
 * @param tags      Rule tags to download (default: gfw, direct-list, proxy-list)
 * @param force     If true, re-download even if local file exists
 */
export async function downloadRules(
  rulesDir: string,
  tags?: string[],
  force?: boolean
): Promise<DownloadResult> {
  const result: DownloadResult = { downloaded: [], skipped: [], errors: [] }

  // Ensure target directory exists
  mkdirSync(rulesDir, { recursive: true })

  // Resolve release tag
  let releaseTag: string
  try {
    releaseTag = await fetchReleaseTag()
    debug(
      `downloader: latest release = %s`,
      releaseTag
    )
  } catch (err: any) {
    debug(`downloader: failed to fetch release: %s`, err.message)
    result.errors.push({ tag: "__release__", message: err.message })
    return result
  }

  const tagList = tags?.length ? tags : DEFAULT_TAGS

  for (const tag of tagList) {
    const filename = `${tag}.txt`
    const destPath = join(rulesDir, filename)

    // Skip if already exists (unless force)
    if (existsSync(destPath) && !force) {
      debug(`downloader: skipping "${tag}" — already exists`)
      result.skipped.push(tag)
      continue
    }

    const url = `https://github.com/Loyalsoldier/v2ray-rules-dat/releases/download/${releaseTag}/${filename}`

    try {
      debug(`downloader: downloading "${tag}" from %s`, url)
      await downloadFile(url, destPath)
      result.downloaded.push(tag)
      debug(`downloader: downloaded "${tag}" → %s`, destPath)
    } catch (err: any) {
      debug(`downloader: failed to download "${tag}": %s`, err.message)
      result.errors.push({ tag, message: err.message })
    }
  }

  return result
}

// ============================================================
// Helpers
// ============================================================

/**
 * Fetch the latest release tag_name from GitHub API.
 */
function fetchReleaseTag(): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(API_URL)
    const req = https.get(
      {
        hostname: url.hostname,
        path: url.pathname,
        headers: {
          "User-Agent": "straightforward-proxy",
          Accept: "application/vnd.github+json",
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API returned ${res.statusCode}`))
          return
        }

        let body = ""
        res.on("data", (chunk) => (body += chunk))
        res.on("end", () => {
          try {
            const json = JSON.parse(body)
            resolve(json.tag_name as string)
          } catch (e) {
            reject(new Error("Failed to parse GitHub API response"))
          }
        })
      }
    )
    req.on("error", reject)
    req.setTimeout(15_000, () => {
      req.destroy()
      reject(new Error("GitHub API request timed out"))
    })
  })
}

/**
 * Download a file via HTTPS, writing to a temp file then renaming atomically.
 */
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmpPath = destPath + ".tmp"
    const file = createWriteStream(tmpPath)

    const req = https.get(url, (res) => {
      // Follow redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location
        if (redirectUrl) {
          downloadFile(redirectUrl, destPath).then(resolve, reject)
          return
        }
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }

      res.pipe(file)
      file.on("finish", () => {
        file.close(() => {
          // Atomically rename .tmp → final name
          try {
            renameSync(tmpPath, destPath)
            resolve()
          } catch (err) {
            reject(err)
          }
        })
      })
    })

    req.on("error", (err) => {
      file.close(() => {})
      reject(err)
    })

    req.setTimeout(30_000, () => {
      req.destroy()
      file.close(() => {})
      reject(new Error(`Download timed out`))
    })

    file.on("error", (err) => {
      req.destroy()
      reject(err)
    })
  })
}
