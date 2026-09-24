import { describe, expect, it } from "vitest"

import { scanSource } from "../../scripts/check-unbounded-queries.mjs"

const rules = (source) => scanSource("convex/x.ts", source).map((violation) => violation.rule)

describe("unbounded query gate (W1-PLT-09)", () => {
  it("flags a collect without an index range", () => {
    expect(rules(`await ctx.db.query("products").collect()`)).toEqual(["q/unbounded-collect"])
    expect(rules(`await ctx.db.query("categories").withIndex("by_sort_order").collect()`)).toEqual(["q/unbounded-collect"])
  })

  it("allows a ranged index collect and paginate", () => {
    expect(rules(`await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", id)).collect()`)).toEqual([])
    expect(rules(`await ctx.db.query("financeRecords").withIndex("by_module_status_date", (q) => q.eq("moduleId", m)).paginate(opts)`)).toEqual([])
  })

  it("flags take over 200 and an in-memory filter after take", () => {
    expect(rules(`await ctx.db.query("guests").order("desc").take(500)`)).toEqual(["q/take-over-200"])
    expect(rules(`(await ctx.db.query("restaurants").take(100)).filter((row) => row.active)`)).toEqual(["q/filter-after-take"])
    expect(rules(`await ctx.db.query("restaurants").withIndex("by_active_and_name", (q) => q.eq("active", true)).take(200)`)).toEqual([])
  })

  it("exempts migration batches", () => {
    expect(rules(`// migration-batch\nawait ctx.db.query("auditEvents").collect()`)).toEqual([])
  })
})
