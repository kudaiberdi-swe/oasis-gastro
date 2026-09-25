#!/usr/bin/env node
// Imports recipe cards from the technologist's CSV into *draft* versions (W1-RCP-04); they are checked and
// activated in the office. Columns (header row, «;» or «,»): product; ingredient; unit (кг|л|шт); quantity;
// unit_weight_kg; cold_loss_percent; hot_loss_percent; batch_yield.
//
//   node scripts/import-recipes.mjs --file=recipes.csv [--effective-from=2026-10-01]
//
// Runs against the deployment of the current `npx convex` context (dev by default). A dry run is printed
// first; nothing is written without a «y». Prod only by the technologist's decision (blocker in the plan).

import fs from "node:fs"
import readline from "node:readline/promises"
import { spawnSync } from "node:child_process"

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")))
if (!args.file || !fs.existsSync(args.file)) {
  console.error("✖ Pass --file=<path to CSV>")
  process.exit(1)
}

const text = fs.readFileSync(args.file, "utf8").replace(/^﻿/, "")
const [header, ...lines] = text.split(/\r?\n/).filter((line) => line.trim())
const separator = header.includes(";") ? ";" : ","
const columns = header.split(separator).map((column) => column.trim().toLowerCase())
const at = (name) => columns.indexOf(name)
const number = (value) => (value === undefined || value.trim() === "" ? undefined : Number(value.replace(",", ".")))
const rows = lines.map((line) => {
  const cells = line.split(separator)
  const get = (name) => (at(name) >= 0 ? cells[at(name)]?.trim() : undefined)
  return {
    product: get("product") ?? "",
    ingredient: get("ingredient") ?? "",
    unit: get("unit") ?? "кг",
    quantity: number(get("quantity")) ?? 0,
    unitWeightKg: number(get("unit_weight_kg")),
    coldLossPercent: number(get("cold_loss_percent")),
    hotLossPercent: number(get("hot_loss_percent")),
    batchYield: number(get("batch_yield")),
  }
}).map((row) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)))

const effectiveFrom = Date.parse(`${args["effective-from"] ?? new Date().toISOString().slice(0, 10)}T00:00:00+05:00`)
const call = (dryRun) => {
  const result = spawnSync("npx", ["convex", "run", "domains/recipes/seed:importRecipesFromCsv", JSON.stringify({ rows, effectiveFrom, dryRun }), "--typecheck", "disable"], { encoding: "utf8" })
  if (result.status !== 0) {
    console.error(result.stderr)
    process.exit(1)
  }
  return JSON.parse(result.stdout.trim())
}

const report = call(true)
console.log(`Dry run: ${report.rows} rows → ${report.draftsCreated} draft recipe(s), ${report.linesCreated} line(s)`)
if (report.unmatchedProducts.length) console.log(`  Products not found: ${report.unmatchedProducts.join(" | ")}`)
if (report.unmatchedIngredients.length) console.log(`  Ingredients not found: ${report.unmatchedIngredients.join(" | ")}`)
if (report.invalid.length) console.log(`  Invalid: ${report.invalid.join(" | ")}`)
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const answer = await rl.question("Create these drafts? [y/N] ")
rl.close()
if (answer.trim() !== "y") {
  console.log("Nothing written.")
  process.exit(0)
}
const applied = call(false)
console.log(`✔ ${applied.draftsCreated} draft version(s) created — check and activate them in /office/nomenclature.`)
