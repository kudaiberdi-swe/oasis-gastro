import { v } from "convex/values"

import { internalMutation } from "../../../_generated/server"
import { writeOfficeAudit } from "../../../lib/officeAccess"

// Office e-mail (W2-ACL-08): letters leave only through the integration queue. The provider (SMTP or
// Resend) is blocker Б-B6 — until it is chosen the «email» adapter fails honestly and the job ends in
// dead-letter instead of pretending the letter was sent.

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
    const now = Date.now()
    const idempotencyKey = `password-reset:${email}:${args.expiresAt}`
    if (await ctx.db.query("integrationJobs").withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", idempotencyKey)).unique()) return null
    await ctx.db.insert("integrationJobs", {
      externalId: `job-${crypto.randomUUID()}`,
      provider: EMAIL_PROVIDER,
      direction: "outbound",
      operation: "office-user.password-reset",
      sourceExternalId: user.externalId,
      idempotencyKey,
      status: "queued",
      attempts: 0,
      payload: { to: email, template: "office-password-reset", resetToken: args.resetToken, expiresAt: args.expiresAt },
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
      organizationExternalId: user.organizationScopes?.find((id) => id !== "*"),
    })
    await writeOfficeAudit(ctx, email, { action: "office-user.password-reset", summary: "Запрошено восстановление пароля", resourceType: "office-user", resourceExternalId: user.externalId })
    return null
  },
})
