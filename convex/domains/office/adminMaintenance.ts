import { createAccount, invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server"
import { ConvexError, v } from "convex/values"

import { internal } from "../../_generated/api"
import { internalAction, internalMutation, internalQuery } from "../../_generated/server"
import { assertOfficePassword } from "../../auth"
import { insertAudit } from "../../lib/audit"

// Administrator maintenance (W1-ACL-07), run only from the CLI (scripts/set-office-password.sh).
// Internal functions: nothing here is callable from a browser.

export const getOfficePasswordAccountState = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const officeUser = await ctx.db.query("officeUsers").withIndex("by_email", (q) => q.eq("email", args.email)).unique()
    if (!officeUser?.active) throw new ConvexError("Активный офисный пользователь не найден")
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", args.email))
      .unique()
    return { officeUserName: officeUser.name, officeUserExternalId: officeUser.externalId, accountUserId: account?.userId ?? null }
  },
})

export const recordPasswordSet = internalMutation({
  args: { email: v.string(), officeUserExternalId: v.string(), created: v.boolean() },
  handler: async (ctx, args) => {
    const organization = (await ctx.db.query("organizations").take(3)).find((row) => row.active)
    await insertAudit(ctx, {
      actorKey: "system-cli",
      action: "office-user.password-set",
      summary: `${args.created ? "Создан вход" : "Сменён пароль"} для ${args.email}`,
      resourceType: "office-user",
      resourceExternalId: args.officeUserExternalId,
      organizationExternalId: organization?.externalId ?? "*",
      capability: "office.users.edit",
    })
  },
})

/** Sets or resets the Convex Auth password of an existing active office user and ends their sessions. */
export const setOfficePassword = internalAction({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, args): Promise<{ email: string; created: boolean }> => {
    const email = args.email.trim().toLocaleLowerCase("en-US")
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new ConvexError("Укажите корректный email")
    assertOfficePassword(args.password)
    const state = await ctx.runQuery(internal.domains.office.adminMaintenance.getOfficePasswordAccountState, { email })
    let created = false
    if (state.accountUserId) {
      await modifyAccountCredentials(ctx, { provider: "password", account: { id: email, secret: args.password } })
      await invalidateSessions(ctx, { userId: state.accountUserId })
    } else {
      await createAccount(ctx, { provider: "password", account: { id: email, secret: args.password }, profile: { email, name: state.officeUserName } })
      created = true
    }
    await ctx.runMutation(internal.domains.office.adminMaintenance.recordPasswordSet, { email, officeUserExternalId: state.officeUserExternalId, created })
    return { email, created }
  },
})
