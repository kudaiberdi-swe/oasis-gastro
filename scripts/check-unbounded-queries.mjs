#!/usr/bin/env node
// W1-PLT-09 — no full scans in Convex code (B-27, S-9). In convex/**/*.ts (not tests, not _generated):
//   q/unbounded-collect  .collect() on a query without an index range (withIndex(..., q => q.eq/gte/lte…))
//   q/take-over-200      .take(n) with n > 200
//   q/filter-after-take  .take(…) followed by an in-memory .filter
// A query preceded by a `// migration-batch` comment (within 3 lines) is exempt. Existing violations
// are listed in scripts/guards/unbounded-allowlist.json with the task that removes them; the check
// fails on anything new or on more than the listed count.
//
//   node scripts/check-unbounded-queries.mjs [--update-allowlist]

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ALLOWLIST_PATH = path.join(ROOT, "scripts/guards/unbounded-allowlist.json")
const TERMINALS = [".collect()", ".take(", ".paginate(", ".first()", ".unique()"]

/** Every ctx.db.query(...) chain in a source (also when split across lines), from the query to its terminal call. */
function chains(source) {
  const result = []
  const starts = [...source.matchAll(/\bdb\s*\.\s*query\(/g)].map((match) => match.index)
  for (let i = 0; i < starts.length; i += 1) {
    const index = starts[i]
    const limit = starts[i + 1] ?? source.length
    let end = -1
    let terminal = null
    for (const candidate of TERMINALS) {
      const at = source.indexOf(candidate, index)
      if (at >= 0 && at < limit && (end < 0 || at < end)) {
        end = at
        terminal = candidate
      }
    }
    if (end < 0) continue
    const afterTerminal = source.slice(end, end + 160)
    const line = source.slice(0, index).split("\n").length
    const before = source.slice(0, index).split("\n").slice(-4).join("\n")
    result.push({ chain: source.slice(index, end), terminal, afterTerminal, line, exempt: before.includes("migration-batch") })
  }
  return result
}

function hasIndexRange(chain) {
  const withIndex = chain.indexOf(".withIndex(")
  if (withIndex < 0) return false
  return /\bq\s*\)?\s*=>[\s\S]*?\.(eq|gt|gte|lt|lte)\(/.test(chain.slice(withIndex))
}

export function scanSource(file, source) {
  const violations = []
  for (const { chain, terminal, afterTerminal, line, exempt } of chains(source)) {
    if (exempt) continue
    if (terminal === ".collect()" && !hasIndexRange(chain)) violations.push({ rule: "q/unbounded-collect", file, line })
    if (terminal === ".take(") {
      const n = Number(/^\.take\((\d+)/.exec(afterTerminal)?.[1])
      if (n > 200) violations.push({ rule: "q/take-over-200", file, line })
      if (/^\.take\([^)]*\)\)?\s*(\.then\(\(?\w+\)?\s*=>\s*\w+)?\.filter\(/.test(afterTerminal)) violations.push({ rule: "q/filter-after-take", file, line })
    }
  }
  return violations
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (name === "_generated" || name === "node_modules") continue
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) out.push(full)
  }
  return out
}

export function collect(root = ROOT) {
  return walk(path.join(root, "convex")).flatMap((file) => scanSource(path.relative(root, file), readFileSync(file, "utf8")))
}

function countByKey(violations) {
  const counts = {}
  for (const violation of violations) {
    const key = `${violation.rule} ${violation.file}`
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = collect()
  const counts = countByKey(violations)
  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"))
  if (process.argv.includes("--update-allowlist")) {
    const entries = Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, { count, task: allowlist.entries[key]?.task ?? "TODO" }]))
    writeFileSync(ALLOWLIST_PATH, JSON.stringify({ ...allowlist, entries }, null, 2) + "\n")
    console.log(`Allowlist written: ${violations.length} known unbounded queries.`)
    process.exit(0)
  }
  const failures = []
  for (const [key, count] of Object.entries(counts)) {
    const allowed = allowlist.entries[key]?.count ?? 0
    if (count > allowed) failures.push(`${key}: ${count} (allowed ${allowed})${allowed === 0 ? "" : ` — ${allowlist.entries[key].task}`}`)
  }
  const fixed = Object.entries(allowlist.entries).filter(([key, entry]) => (counts[key] ?? 0) < entry.count)
  if (fixed.length) {
    console.log("Fewer unbounded queries than allowed — run with --update-allowlist to lock in:")
    for (const [key] of fixed) console.log(`  ↓ ${key}`)
  }
  if (failures.length) {
    console.error("New unbounded queries (W1-PLT-09: use an index range, paginate, or take ≤ 200):")
    for (const line of failures) console.error(`  ✖ ${line}`)
    const lines = violations.filter((violation) => failures.some((failure) => failure.startsWith(`${violation.rule} ${violation.file}`)))
    for (const violation of lines) console.error(`    ${violation.file}:${violation.line} ${violation.rule}`)
    process.exit(1)
  }
  console.log(`Unbounded queries: no new ones (${violations.length} listed with their fixing task).`)
}
