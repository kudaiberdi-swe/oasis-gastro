#!/usr/bin/env node
// Reads a staged run's sanitized JSONL and pushes it into Convex in one call via
// `npx convex run domains/iiko/mutations:importBatch` — never touches iiko itself.

import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { parseArgs, readJsonl } from "./lib.mjs"

const args = parseArgs(process.argv.slice(2))

function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}

function latestRunDirectory() {
  const root = ".iiko-cache"
  if (!fs.existsSync(root)) fail("No .iiko-cache/ runs found — run `npm run iiko:extract` first")
  const runs = fs
    .readdirSync(root)
    .filter((name) => fs.existsSync(path.join(root, name, "manifest.json")))
    .map((name) => ({ name, mtime: fs.statSync(path.join(root, name, "manifest.json")).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  if (!runs.length) fail("No completed runs found in .iiko-cache/")
  return path.join(root, runs[0].name)
}

const inputDir = path.resolve(args.input ?? latestRunDirectory())
const manifestPath = path.join(inputDir, "manifest.json")
if (!fs.existsSync(manifestPath)) fail(`No manifest.json in ${inputDir}`)
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
const rows = readJsonl(path.join(inputDir, "staging.jsonl"))

console.log(`Importing ${rows.length} staged record(s) from ${inputDir} (run ${manifest.runExternalId})…`)

const departments = rows
  .filter((row) => row.domain === "organization")
  .map((row) => ({
    externalId: row.recordExternalId,
    parentExternalId: row.payload.parentId ? String(row.payload.parentId) : undefined,
    code: row.payload.code ? String(row.payload.code) : undefined,
    name: String(row.payload.name ?? ""),
    type: String(row.payload.type ?? "DEPARTMENT"),
    payloadHash: row.payloadHash,
  }))

const employees = rows
  .filter((row) => row.domain === "workforce")
  .map((row) => ({
    externalId: row.recordExternalId,
    code: row.payload.code ? String(row.payload.code) : undefined,
    displayName: String(row.payload.name ?? "Без имени"),
    mainRoleCode: row.payload.mainRoleCode ? String(row.payload.mainRoleCode) : undefined,
    departmentCodes: [row.payload.departmentCodes ?? []].flat().map(String),
    active: row.payload.deleted !== true,
    payloadHash: row.payloadHash,
  }))

function run(fn, jsonArgs) {
  const result = spawnSync("npx", ["convex", "run", fn, JSON.stringify(jsonArgs), "--typecheck", "disable"], { stdio: "inherit" })
  if (result.status !== 0) fail(`convex run ${fn} failed`)
}

function chunk(array, size) {
  const chunks = []
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size))
  return chunks
}

// A single importBatch call over hundreds of records can exceed Convex's per-mutation
// operation budget — split into small chunks, departments first (employees' filtering in
// extract.mjs already depends on department codes, but the import order doesn't matter here
// since both write to independent tables).
const CHUNK_SIZE = 50
run("domains/iiko/mutations:beginRun", { runExternalId: manifest.runExternalId })
for (const batch of chunk(departments, CHUNK_SIZE)) run("domains/iiko/mutations:importBatch", { departments: batch, employees: [] })
for (const batch of chunk(employees, CHUNK_SIZE)) run("domains/iiko/mutations:importBatch", { departments: [], employees: batch })
run("domains/iiko/mutations:completeRun", { runExternalId: manifest.runExternalId, counts: { departments: departments.length, employees: employees.length } })

console.log(`\n✔ Imported ${departments.length} department(s) and ${employees.length} employee(s).`)
console.log("  Verify with: npx convex data iikoDepartments   /   npx convex data iikoEmployees")
