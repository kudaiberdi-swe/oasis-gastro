import { v } from "convex/values"

import { internalMutation } from "../../../_generated/server"
import { enqueueIntegrationJob } from "../../../lib/integrationQueue"
import { writeOfficeAudit } from "../../../lib/officeAccess"
import { PASSWORD_RESET_OPERATION } from "./messaging"

// Office e-mail (W2-ACL-08): letters leave only through the integration queue. The «email» adapter is
// Resend (W3-INT-06, messaging.ts): until RESEND_API_KEY is set the job ends in dead-letter with
// «ключ не задан» instead of pretending the letter was sent.

export const EMAIL_PROVIDER = "email"
export const RESET_CODE_TTL_S = 15 * 60

/** An 8-digit one-time code (crypto random, no modulo bias worth noting at 10^8 of 2^32). */
export function generateResetCode() {
  const [value] = crypto.getRandomValues(new Uint32Array(1))
  return String(value % 100_000_000).padStart(8, "0")
}

/**
 * Queues the reset letter for an active office user. An unknown or disabled e-mail queues nothing and
 * returns the same — the caller's response never tells whether the address exists. The code sits in
 * the job under `resetToken`, which getIntegrationJob masks.
 */
export const enqueuePasswordReset = internalMutation({
  args: { email: v.string(), resetToken: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLocaleLowerCase("en-US")
    const user = await ctx.db.query("officeUsers").withIndex("by_email", (q) => q.eq("email", email)).unique()
    if (!user?.active) return null
    const queued = await enqueueIntegrationJob(ctx, {
      provider: EMAIL_PROVIDER,
      operation: PASSWORD_RESET_OPERATION,
      sourceExternalId: user.externalId,
      idempotencyKey: `password-reset:${email}:${args.expiresAt}`,
      payload: { to: email, template: "office-password-reset", resetToken: args.resetToken, expiresAt: args.expiresAt },
      organizationExternalId: user.organizationScopes?.find((id) => id !== "*"),
    })
    if (!queued.created) return null
    await writeOfficeAudit(ctx, email, { action: "office-user.password-reset", summary: "Запрошено восстановление пароля", resourceType: "office-user", resourceExternalId: user.externalId })
    return null
  },
})
