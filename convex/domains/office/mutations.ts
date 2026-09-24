import { ConvexError } from "convex/values"

import { mutation } from "../../_generated/server"
import { getOfficeAuthEmail } from "../../lib/officeAccess"
import { listOperationalRestaurants } from "../../lib/restaurants"
import { seedChartOfAccountsRows } from "../finance/seed"

declare const process: { env: Record<string, string | undefined> }

const OWNER_EXTERNAL_ID = "office-admin"

/**
 * One-shot: turns the signed-in Convex Auth account into the office administrator, but only for
 * the exact email in the OFFICE_BOOTSTRAP_EMAIL deployment env var — set once via
 * `npx convex env set OFFICE_BOOTSTRAP_EMAIL <email>`, never exposed to the client. Safe to call
 * repeatedly (idempotent upsert), so a returning admin can re-run it to pick up new branches.
 */
export const bootstrap = mutation({
  args: {},
  handler: async (ctx) => {
    const email = await getOfficeAuthEmail(ctx)
    const bootstrapEmail = process.env.OFFICE_BOOTSTRAP_EMAIL?.trim().toLocaleLowerCase("en-US")
    if (!email || !bootstrapEmail || email !== bootstrapEmail) throw new ConvexError("Инициализация Office не разрешена для этой учётной записи")

    const restaurants = await listOperationalRestaurants(ctx)
    if (!restaurants.length) throw new ConvexError("Сначала должен быть хотя бы один активный ресторан с терминалом")

    const existingRole = await ctx.db.query("officeRoles").withIndex("by_external_id", (q) => q.eq("externalId", "administrator")).unique()
    const roleValue = { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true }
    if (existingRole) await ctx.db.patch(existingRole._id, roleValue)
    else await ctx.db.insert("officeRoles", roleValue)

    const existingOwner = await ctx.db.query("officeUsers").withIndex("by_email", (q) => q.eq("email", email)).unique()
    const ownerValue = {
      externalId: existingOwner?.externalId ?? OWNER_EXTERNAL_ID,
      email,
      name: existingOwner?.name ?? "Администратор",
      roleExternalId: "administrator",
      restaurantScopes: ["*"], // the bootstrapped administrator is network-wide, including branches added later
      active: true,
    }
    if (existingOwner) await ctx.db.patch(existingOwner._id, ownerValue)
    else await ctx.db.insert("officeUsers", ownerValue)

    // The chart of accounts every posting refers to (idempotent).
    const accounts = await seedChartOfAccountsRows(ctx)
    return { restaurants: restaurants.length, accounts: accounts.total }
  },
})
