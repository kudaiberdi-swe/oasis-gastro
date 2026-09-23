#!/usr/bin/env node
// Orchestrates extract -> import -> reconcile in one command. Master-data only by design —
// there's no `--master-only` flag to pass because Phase 3 never extracts anything else.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const forwardedArgs = process.argv.slice(2)
const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`

function run(script, extraArgs) {
  const result = spawnSync("node", ["--env-file=.env", path.join("scripts", "iiko", script), `--run-id=${runId}`, ...extraArgs, ...forwardedArgs], { stdio: "inherit" })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run("extract.mjs", [])
const inputDir = path.join(".iiko-cache", runId)
run("import-convex.mjs", [`--input=${inputDir}`])
if (fs.existsSync(path.join(inputDir, "staging.jsonl"))) run("reconcile.mjs", [`--input=${inputDir}`])
