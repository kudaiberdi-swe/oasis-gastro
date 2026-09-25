import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { generateResetCode } from "../../convex/domains/integrations/adapters/email"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")

describe("office password recovery (W2-ACL-08)", () => {
  it("codes are 8 digits", () => {
    for (let index = 0; index < 50; index++) expect(generateResetCode()).toMatch(/^\d{8}$/)
  })

  it("queues a letter only for an active user, masks the code, and never reports it sent without a provider", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
      await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
      await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
      await ctx.db.insert("officeUsers", { externalId: "old", email: "old@sandyq.test", name: "Бывший", roleExternalId: "administrator", restaurantScopes: ["*"], active: false })
    })
    const expiresAt = Date.now() + 900_000
    for (const email of ["nobody@sandyq.test", "old@sandyq.test"]) expect(await t.mutation(internal.domains.integrations.adapters.email.enqueuePasswordReset, { email, resetToken: "12345678", expiresAt })).toBeNull()
    expect(await t.run((ctx) => ctx.db.query("integrationJobs").collect())).toHaveLength(0)

    expect(await t.mutation(internal.domains.integrations.adapters.email.enqueuePasswordReset, { email: " Admin@Sandyq.test ", resetToken: "12345678", expiresAt })).toBeNull()
    await t.mutation(internal.domains.integrations.adapters.email.enqueuePasswordReset, { email: "admin@sandyq.test", resetToken: "12345678", expiresAt })
    const [job] = await t.run((ctx) => ctx.db.query("integrationJobs").collect())
    expect(job).toMatchObject({ provider: "email", operation: "office-user.password-reset", payload: { to: "admin@sandyq.test", resetToken: "12345678" } })
    const admin = t.withIdentity({ email: "admin@sandyq.test" })
    const shown = await admin.query(api.domains.integrations.queries.getIntegrationJob, { externalId: job.externalId })
    expect(JSON.stringify(shown)).not.toContain("12345678")

    await t.mutation(internal.domains.integrations.internal.processIntegrationJobs, {})
    const [after] = await t.run((ctx) => ctx.db.query("integrationJobs").collect())
    expect(after.status).not.toBe("completed")
    expect(after.error).toMatch(/Б-B6/)
  })
})
