import { defineConfig } from "@playwright/test"

import type { E2EOptions } from "./e2e/fixtures"

// Local e2e (W0-CI-03). Runs against the Vite dev server on the dev Convex deployment — the /dev/*
// harness routes exist only in dev builds. Uses the installed Chrome, no browser download.
// Not wired into GitHub Actions yet: CI runs are paused by the owner; add an `e2e` job when resumed.
const PORT = 5198
const themes = ["day", "night"] as const
const surfaces = [
  { name: "pos-1280", viewport: { width: 1280, height: 800 } },
  { name: "pos-1440", viewport: { width: 1440, height: 900 } },
  { name: "office-1440", viewport: { width: 1440, height: 900 } },
  { name: "kitchen-1920", viewport: { width: 1920, height: 1080 } },
] as const

export default defineConfig<E2EOptions>({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: surfaces.flatMap((surface) =>
    themes.map((theme) => ({
      name: `${surface.name}-${theme}`,
      use: { viewport: surface.viewport, theme, surface: surface.name.split("-")[0] as E2EOptions["surface"] },
    })),
  ),
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/dev/ui`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
