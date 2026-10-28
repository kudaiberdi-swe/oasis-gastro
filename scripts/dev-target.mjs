// Target guard of the dev-only seed scripts (seed-demo-logins.mjs, seed-shafran.mjs): DEV deployment
// dapper-lobster-404 by name, with no override and no --prod. The Convex functions they call check it again
// on the server (convex/domains/seed/shafran.ts assertDevDeployment).

import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

export const DEV = "dapper-lobster-404"

export function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}

export function convex(args, { quiet = false } = {}) {
  const result = spawnSync("npx", ["convex", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) fail(`convex ${args[0]} failed${quiet ? "" : `: ${(result.stderr || result.stdout).trim().split("\n").slice(-3).join(" ")}`}`)
  return result.stdout
}

function deploymentFromEnvLocal() {
  try {
    return readFileSync(".env.local", "utf8").match(/^CONVEX_DEPLOYMENT=(\S+)/m)?.[1] ?? ""
  } catch {
    return ""
  }
}

/** Exits unless the Convex CLI targets the dev deployment — by its configuration and by what it actually resolves to. */
export function requireDevTarget() {
  if (process.argv.includes("--prod")) fail("There is no --prod: this script runs on the dev deployment only")
  if (process.env.CONVEX_DEPLOY_KEY) fail("CONVEX_DEPLOY_KEY is set — it would redirect the CLI; unset it")
  if (process.env.CONVEX_URL || process.env.CONVEX_SELF_HOSTED_URL) fail("CONVEX_URL / CONVEX_SELF_HOSTED_URL is set — unset it")
  const deployment = process.env.CONVEX_DEPLOYMENT ?? deploymentFromEnvLocal()
  if (deployment !== `dev:${DEV}`) fail(`Refusing: deployment is "${deployment || "not configured"}", expected dev:${DEV}`)
  const resolved = convex(["dashboard", "--no-open"]).trim()
  if (!resolved.endsWith(`/d/${DEV}`)) fail(`Refusing: the Convex CLI resolves to ${resolved}, expected ${DEV}`)
  console.log(`Target: ${DEV} (dev)`)
}
