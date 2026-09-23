#!/usr/bin/env node
// Discovers the iiko API surface (--discover-only, pulls no data) or extracts the master-data
// endpoints in endpoint-registry.mjs into a local, sanitized, gitignored staging file. Never
// writes anything back to iiko — see lib.mjs's IikoClient, which only ever exposes GET.

import path from "node:path"

import { IikoClient, contentHash, ensureDirectory, parseResponse, parseWadl, readIikoConfig, recordExternalKey, recordsFromPayload, sanitizeRecord, parseArgs, writeJson, writeJsonl } from "./lib.mjs"
import { ENDPOINTS } from "./endpoint-registry.mjs"

const args = parseArgs(process.argv.slice(2))
const config = readIikoConfig({ credentialsFile: args.credentialsFile })
const runExternalId = String(args.runId ?? `run-${new Date().toISOString().replace(/[:.]/g, "-")}`)
const outputRoot = path.resolve(args.output ?? ".iiko-cache", runExternalId)

// The iiko account behind these credentials is a holding of 8 brands sharing one corporate
// structure (verified: ~30 branches, ~2716 employees total). This project is scoped to one
// brand only — see BRD.md §5 and CLAUDE.md. Filter by department name at extract time so the
// other brands' departments/employees never even reach the local staging file, let alone Convex.
// Default aliases cover the observed spelling variants for Sandyq specifically (including one
// Cyrillic-only department, "Сандык Кайнар") — pass --brand to match a single exact term instead.
const BRAND_ALIASES = args.brand ? [String(args.brand)] : ["sandyq", "сандык"]
function matchesBrand(name) {
  const lower = String(name ?? "").toLocaleLowerCase()
  return BRAND_ALIASES.some((alias) => lower.includes(alias.toLocaleLowerCase()))
}

const client = new IikoClient(config)
console.log(`Logging in to ${config.host} as ${config.login}…`)
await client.login()

try {
  if (args.discoverOnly) {
    console.log("Fetching application.wadl (discovery only — no business data pulled)…")
    const wadl = await client.get("application.wadl?detail=true", { accept: "application/xml" })
    const endpoints = parseWadl(wadl.text)
    const nonOptions = endpoints.filter((e) => e.method !== "OPTIONS")
    console.log(`\n✔ Discovered ${nonOptions.length} operations (excluding OPTIONS) at ${config.host}`)
    console.log(`  This project only ever calls: ${ENDPOINTS.map((e) => `GET /${e.path}`).join(", ")}`)
  } else {
    console.log(`Extracting ${ENDPOINTS.length} endpoint(s) into ${outputRoot}, scoped to brand aliases [${BRAND_ALIASES.join(", ")}]…`)
    const rows = []
    const endpointResults = []
    let matchedDepartmentCodes = new Set()

    for (const endpoint of ENDPOINTS) {
      try {
        const response = await client.get(endpoint.path, { accept: "application/xml" })
        const payload = parseResponse(response)
        const allRecords = recordsFromPayload(payload)

        let records = allRecords
        if (endpoint.domain === "organization") {
          records = allRecords.filter((r) => matchesBrand(r.name))
          matchedDepartmentCodes = new Set(records.map((r) => r.code).filter(Boolean).map(String))
          console.log(`  Matched ${records.length}/${allRecords.length} department(s); codes: ${[...matchedDepartmentCodes].join(", ") || "(none — a JURPERSON row has no own code)"}`)
          console.log(`  Matched names: ${records.map((r) => r.name).join(" | ")}`)
        } else if (endpoint.domain === "workforce") {
          records = allRecords.filter((r) => {
            const codes = [r.departmentCodes ?? [], r.responsibilityDepartmentCodes ?? []].flat().map(String)
            return codes.some((code) => matchedDepartmentCodes.has(code))
          })
          console.log(`  Matched ${records.length}/${allRecords.length} employee(s) whose department codes intersect the matched set`)
        }

        for (const record of records) {
          const sanitized = sanitizeRecord(record, endpoint.domain)
          const recordExternalId = recordExternalKey(sanitized, endpoint.key)
          rows.push({
            endpointKey: endpoint.key,
            domain: endpoint.domain,
            recordExternalId,
            payload: sanitized,
            payloadHash: contentHash(sanitized),
          })
        }
        endpointResults.push({ endpointKey: endpoint.key, status: "ok", count: records.length, totalSeen: allRecords.length })
        console.log(`  ✔ ${endpoint.key}: staged ${records.length} of ${allRecords.length} record(s) seen`)
      } catch (error) {
        endpointResults.push({ endpointKey: endpoint.key, status: "error", message: error.message })
        console.error(`  ✖ ${endpoint.key}: ${error.message}`)
      }
    }

    ensureDirectory(outputRoot)
    writeJsonl(path.join(outputRoot, "staging.jsonl"), rows)
    writeJson(path.join(outputRoot, "manifest.json"), {
      runExternalId,
      extractedAt: new Date().toISOString(),
      host: config.host,
      rowCount: rows.length,
      endpointResults,
      stagingChecksum: contentHash(rows),
    })
    console.log(`\n✔ Staged ${rows.length} sanitized record(s) to ${outputRoot}/staging.jsonl`)
    console.log(`  Run this import with: npm run iiko:import -- --input=${outputRoot}`)
  }
} finally {
  await client.logout()
  console.log("Logged out.")
}
