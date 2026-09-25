import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import { setup } from "./fixtures/pos"

const views = api.domains.reports.mutations
const config = { dateFrom: "2026-09-01", dateTo: "2026-09-07", restaurantExternalIds: ["almaty"] }

describe("saved report views (W1-RPT-05)", () => {
  it("owner-only views, scope checked on save, favorite toggles", async () => {
    const { t } = await setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("restaurants", { externalId: "shymkent", organizationExternalId: "sandyq", name: "Шымкент", address: "—", timezone: "Asia/Almaty", active: true })
      await ctx.db.insert("officeRoles", { externalId: "analyst", name: "Аналитик", capabilities: ["office.reports.view", "office.report-favorites.view", "office.report-favorites.edit"], system: false })
      await ctx.db.insert("officeUsers", { externalId: "a", email: "a@sandyq.test", name: "А", roleExternalId: "analyst", restaurantScopes: ["almaty"], active: true })
      await ctx.db.insert("officeUsers", { externalId: "b", email: "b@sandyq.test", name: "Б", roleExternalId: "analyst", restaurantScopes: ["almaty"], active: true })
    })
    const a = t.withIdentity({ email: "a@sandyq.test" })
    const b = t.withIdentity({ email: "b@sandyq.test" })
    await expect(a.mutation(views.saveView, { reportId: "sales-01", name: "Шымкент", favorite: true, config: { ...config, restaurantExternalIds: ["shymkent"] } })).rejects.toThrow(/Нет доступа/)
    const id = await a.mutation(views.saveView, { reportId: "sales-01", name: "Неделя", favorite: true, config })
    expect((await a.query(views.listViews, { favoritesOnly: true })).map((row) => [row.externalId, row.reportTitle])).toEqual([[id, "Выручка по дням"]])
    expect(await b.query(views.listViews, {})).toEqual([])
    await expect(b.mutation(views.deleteView, { externalId: id })).rejects.toThrow(/не найдено/)
    expect(await a.mutation(views.toggleFavorite, { reportId: "sales-01", config })).toEqual({ favorite: false })
    expect(await a.mutation(views.toggleFavorite, { reportId: "sales-02", config })).toEqual({ favorite: true })
    expect((await a.query(views.listViews, { favoritesOnly: true })).map((row) => row.reportId)).toEqual(["sales-02"])
  })
})
