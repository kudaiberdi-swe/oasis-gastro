#!/usr/bin/env node
// Static guards for the hard rules in docs/IMPLEMENTATION-PLAN.md («Соглашения плана»).
// Ratchet: violations are counted per rule and file and compared with scripts/guards/baseline.json.
// CI fails on any count above the baseline; `--update-baseline` rewrites it (review it in the PR).

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const BASELINE_PATH = path.join(ROOT, "scripts/guards/baseline.json")
const PUBLIC_ALLOWLIST_PATH = path.join(ROOT, "scripts/guards/public-allowlist.json")

const AUTH_TOKENS = ["requireOperator", "requireAnyOperator", "requireSession", "requireManagerApproval", "requireOfficeCapability", "getOfficeAuthEmail"]
// resolveRestaurantIds (domains/workforce) calls requireRestaurantScope for every restaurant it resolves.
const SCOPE_TOKENS = ["requireRestaurantScope", "restaurantScopeFilter(", "hasScope(", "restaurantScopes", "resolveRestaurantIds("]

export const FRONTEND_RULES = [
  { id: "fe/hex-color", pattern: /#[0-9a-fA-F]{3,8}\b/g, test: (line) => /(["'`\s(\[])#[0-9a-fA-F]{3,8}\b/.test(line) },
  { id: "fe/rgb", pattern: /\brgba?\(/g },
  { id: "fe/white-literal", pattern: /\b(bg|text|border)-white\b/g },
  { id: "fe/palette-class", pattern: /\b(?:bg|text|border|ring|from|to|via|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g },
  { id: "fe/tiny-text", pattern: /\btext-\[(?:[1-9]|1[01])(?:\.\d+)?px\]/g },
  { id: "fe/heavy-weight", pattern: /\bfont-(?:extrabold|black)\b/g },
  { id: "fe/uppercase", pattern: /\buppercase\b/g },
  { id: "fe/api-any", pattern: /\(api as any\)/g },
  { id: "fe/outline-none-without-focus", pattern: /\boutline-none\b/g, test: (line) => /\boutline-none\b/.test(line) && !/focus-visible:/.test(line) },
]

function walk(dir, predicate, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "_generated") continue
      walk(full, predicate, out)
    } else if (predicate(full)) out.push(full)
  }
  return out
}

function countMatches(text, rule) {
  let count = 0
  for (const line of text.split("\n")) {
    if (rule.test && !rule.test(line)) continue
    const found = line.match(rule.pattern)
    if (found) count += rule.test ? 1 : found.length
  }
  return count
}

/** Frontend rules for one .tsx file. Print forms (`/print/`) may use raw colors (POS-DESIGN §6.6). */
export function scanFrontendSource(relativePath, text) {
  if (relativePath.includes("/print/")) return []
  return FRONTEND_RULES.map((rule) => ({ rule: rule.id, file: relativePath, count: countMatches(text, rule) })).filter((v) => v.count > 0)
}

/** Splits a Convex module into its exported registrations: `export const name = kind(`. */
export function exportedFunctions(text) {
  const re = /export const (\w+)\s*=\s*(query|mutation|action|internalQuery|internalMutation|internalAction|httpAction)\s*\(/g
  const hits = [...text.matchAll(re)]
  return hits.map((hit, index) => ({
    name: hit[1],
    kind: hit[2],
    body: text.slice(hit.index, index + 1 < hits.length ? hits[index + 1].index : text.length),
  }))
}

/** Backend rules for one Convex module. `functionId` is `domains/auth/actions:login`. */
export function scanBackendSource(relativePath, text, publicAllowlist = []) {
  const violations = []
  const modulePath = relativePath.replace(/^convex\//, "").replace(/\.ts$/, "")
  const errorThrows = (text.match(/throw new Error\(/g) ?? []).length
  if (errorThrows) violations.push({ rule: "be/throw-error", file: relativePath, count: errorThrows })

  for (const fn of exportedFunctions(text)) {
    const isPublic = fn.kind === "query" || fn.kind === "mutation" || fn.kind === "action"
    if (!isPublic) continue
    const functionId = `${modulePath}:${fn.name}`
    const allowlisted = publicAllowlist.includes(functionId)
    const authenticated = AUTH_TOKENS.some((token) => fn.body.includes(token))
    if (!authenticated && !allowlisted) violations.push({ rule: "be/public-without-auth", file: functionId, count: 1 })

    const argsSection = fn.body.split("handler:")[0]
    if (/v\.any\(\)/.test(argsSection)) violations.push({ rule: "be/any-arg", file: functionId, count: 1 })

    const takesRestaurant = /\brestaurant(ExternalId|Id)s?\s*:/.test(argsSection)
    const isOffice = fn.body.includes("requireOfficeCapability")
    if (isOffice && takesRestaurant && !SCOPE_TOKENS.some((token) => fn.body.includes(token))) {
      violations.push({ rule: "be/office-without-restaurant-scope", file: functionId, count: 1 })
    }
  }
  return violations
}

export function collectViolations(root = ROOT) {
  const publicAllowlist = JSON.parse(readFileSync(PUBLIC_ALLOWLIST_PATH, "utf8")).functions.map((entry) => entry.id)
  const violations = []
  for (const file of walk(path.join(root, "convex"), (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    violations.push(...scanBackendSource(path.relative(root, file), readFileSync(file, "utf8"), publicAllowlist))
  }
  for (const file of walk(path.join(root, "src"), (f) => f.endsWith(".tsx"))) {
    violations.push(...scanFrontendSource(path.relative(root, file), readFileSync(file, "utf8")))
  }
  return violations
}

function toTable(violations) {
  const table = {}
  for (const { rule, file, count } of violations) {
    table[rule] ??= {}
    table[rule][file] = (table[rule][file] ?? 0) + count
  }
  return table
}

/** Compares current violations with the baseline; returns lines describing regressions and improvements. */
export function compareWithBaseline(current, baseline) {
  const regressions = []
  const improvements = []
  for (const [rule, files] of Object.entries(current)) {
    for (const [file, count] of Object.entries(files)) {
      const allowed = baseline[rule]?.[file] ?? 0
      if (count > allowed) regressions.push(`${rule}  ${file}: ${count} (baseline ${allowed})`)
    }
  }
  for (const [rule, files] of Object.entries(baseline)) {
    for (const [file, allowed] of Object.entries(files)) {
      const count = current[rule]?.[file] ?? 0
      if (count < allowed) improvements.push(`${rule}  ${file}: ${count} (baseline ${allowed})`)
    }
  }
  return { regressions, improvements }
}

function main() {
  const current = toTable(collectViolations())
  if (process.argv.includes("--update-baseline")) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`)
    const total = Object.values(current).reduce((sum, files) => sum + Object.values(files).reduce((a, b) => a + b, 0), 0)
    console.log(`Baseline written: ${total} known violations. Review the diff of scripts/guards/baseline.json.`)
    return
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
  const { regressions, improvements } = compareWithBaseline(current, baseline)
  if (improvements.length) {
    console.log("Fewer violations than the baseline — run `npm run guards -- --update-baseline` to lock in:")
    for (const line of improvements) console.log(`  ↓ ${line}`)
  }
  if (regressions.length) {
    console.error("New guard violations (see «Соглашения плана» in docs/IMPLEMENTATION-PLAN.md):")
    for (const line of regressions) console.error(`  ✖ ${line}`)
    process.exit(1)
  }
  console.log("Guards: no new violations.")
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
