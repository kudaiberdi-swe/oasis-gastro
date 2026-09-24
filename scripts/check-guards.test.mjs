import { describe, expect, it } from "vitest"

import { compareWithBaseline, scanBackendSource, scanFrontendSource } from "./check-guards.mjs"

const rules = (violations) => violations.map((v) => `${v.rule} ${v.file}`)

describe("backend guards", () => {
  it("flags a public function without an auth check", () => {
    const source = `export const list = query({ args: {}, handler: async (ctx) => ctx.db.query("x").collect() })`
    expect(rules(scanBackendSource("convex/domains/demo/queries.ts", source))).toContain("be/public-without-auth domains/demo/queries:list")
  })

  it("accepts an authenticated or allowlisted function and ignores internal ones", () => {
    const source = [
      `export const a = query({ args: { sessionToken: v.string() }, handler: async (ctx, args) => { await requireOperator(ctx, args.sessionToken) } })`,
      `export const b = query({ args: {}, handler: async () => [] })`,
      `export const c = internalMutation({ args: {}, handler: async () => {} })`,
    ].join("\n")
    expect(scanBackendSource("convex/domains/demo/queries.ts", source, ["domains/demo/queries:b"])).toEqual([])
  })

  it("flags throw new Error, v.any() args and office functions without restaurant scope", () => {
    const source = [
      `export const save = mutation({ args: { data: v.any(), restaurantExternalId: v.string() }, handler: async (ctx) => { await requireOfficeCapability(ctx, "office.x.edit"); throw new Error("x") } })`,
    ].join("\n")
    expect(rules(scanBackendSource("convex/domains/demo/mutations.ts", source))).toEqual([
      "be/throw-error convex/domains/demo/mutations.ts",
      "be/any-arg domains/demo/mutations:save",
      "be/office-without-restaurant-scope domains/demo/mutations:save",
    ])
  })
})

describe("frontend guards", () => {
  it("flags hardcoded colors, tiny text, heavy weights and bare outline-none", () => {
    const source = `<div className="bg-[#303840] text-[9px] font-black bg-white text-amber-500 outline-none" />`
    expect(rules(scanFrontendSource("src/demo.tsx", source)).map((r) => r.split(" ")[0])).toEqual([
      "fe/hex-color",
      "fe/white-literal",
      "fe/palette-class",
      "fe/tiny-text",
      "fe/heavy-weight",
      "fe/outline-none-without-focus",
    ])
  })

  it("allows outline-none with a visible focus replacement and skips print forms", () => {
    expect(scanFrontendSource("src/demo.tsx", `<input className="outline-none focus-visible:outline-2" />`)).toEqual([])
    expect(scanFrontendSource("src/pos/print/receipt.tsx", `<div style={{ color: "#000" }} />`)).toEqual([])
  })
})

describe("baseline ratchet", () => {
  it("reports only counts above the baseline as regressions", () => {
    const { regressions, improvements } = compareWithBaseline(
      { "fe/uppercase": { "src/a.tsx": 2, "src/b.tsx": 1 } },
      { "fe/uppercase": { "src/a.tsx": 3 } },
    )
    expect(regressions).toEqual(["fe/uppercase  src/b.tsx: 1 (baseline 0)"])
    expect(improvements).toEqual(["fe/uppercase  src/a.tsx: 2 (baseline 3)"])
  })
})
