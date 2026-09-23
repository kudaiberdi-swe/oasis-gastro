#!/usr/bin/env node
// A deliberately simple reconciliation: since Phase 3 imports master data only (no sales/orders
// history), there's no financial total to cross-check against — just verify the mirror tables
// actually contain what the last staged run said they should. Exits 1 on mismatch.

import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { parseArgs, readJsonl } from "./lib.mjs"

function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}

const args = parseArgs(process.argv.slice(2))
const inputDir = path.resolve(args.input)
if (!inputDir || !fs.existsSync(inputDir)) fail("Pass --input=.iiko-cache/<run-directory>")

const rows = readJsonl(path.join(inputDir, "staging.jsonl"))
const stagedDepartments = rows.filter((r) => r.domain === "organization").length
const stagedEmployees = rows.filter((r) => r.domain === "workforce").length

const result = spawnSync("npx", ["convex", "run", "domains/iiko/queries:mirrorCounts", "{}", "--typecheck", "disable"], { encoding: "utf8" })
if (result.status !== 0) fail("convex run domains/iiko/queries:mirrorCounts failed")
const mirrorCounts = JSON.parse(result.stdout.trim())

console.log(`Staged:  ${stagedDepartments} department(s), ${stagedEmployees} employee(s)`)
console.log(`Mirror:  ${mirrorCounts.departments} department(s), ${mirrorCounts.employees} employee(s)`)

if (mirrorCounts.departments < stagedDepartments || mirrorCounts.employees < stagedEmployees) {
  fail("Mirror table has fewer rows than the last staged run — import may be incomplete")
}

console.log("\n✔ Reconciliation passed — mirror tables cover the last staged run.")
