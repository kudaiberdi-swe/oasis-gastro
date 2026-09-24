import { describe, expect, it } from "vitest"

import { checkTheme, contrastRatio } from "../../scripts/check-contrast.mjs"

describe("theme contrast (W0-FND-02)", () => {
  it("computes WCAG ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5)
    expect(contrastRatio("#8c2323", "#8c2323")).toBeCloseTo(1, 5)
  })

  it("passes every text and control pair in day and night", () => {
    expect(checkTheme()).toEqual([])
  })

  it("reports a low-contrast pair and a token missing from a theme", () => {
    const css = [':root,\n[data-theme="day"] {', "  --foreground: #cccccc;", "  --background: #ffffff;", "}", '[data-theme="night"] {', "}"].join("\n")
    const failures = checkTheme(css)
    expect(failures).toContain("day: --foreground on --background = 1.61 (needs 4.5)")
    expect(failures.some((line) => line.startsWith("day: missing --card"))).toBe(true)
  })
})
