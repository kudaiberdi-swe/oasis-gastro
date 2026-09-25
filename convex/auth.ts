import { Email } from "@convex-dev/auth/providers/Email"
import { Password } from "@convex-dev/auth/providers/Password"
import { convexAuth } from "@convex-dev/auth/server"
import type { GenericActionCtx } from "convex/server"
import { ConvexError } from "convex/values"

import { internal } from "./_generated/api"
import type { DataModel } from "./_generated/dataModel"
import { generateResetCode, RESET_CODE_TTL_S } from "./domains/integrations/adapters/email"

/** Office password rule, shared with domains/office/adminMaintenance (W1-ACL-07). */
export function assertOfficePassword(password: string) {
  if (password.length < 10 || !/[A-ZА-Я]/.test(password) || !/[a-zа-я]/.test(password) || !/\d/.test(password)) {
    throw new ConvexError("Пароль: минимум 10 символов, заглавная и строчная буквы, цифра")
  }
}

/**
 * Password recovery (W2-ACL-08): an 8-digit code valid 15 minutes, sent only through the integration
 * queue. Convex Auth checks the code against the e-mail it was requested for; failed attempts are
 * limited below.
 */
const passwordReset = Email({
  id: "office-password-reset",
  maxAge: RESET_CODE_TTL_S,
  generateVerificationToken: async () => generateResetCode(),
  // Convex Auth passes its action ctx as the second argument (untyped in Auth.js's signature).
  async sendVerificationRequest({ identifier, token, expires }, ...rest: unknown[]) {
    const ctx = rest[0] as GenericActionCtx<DataModel>
    await ctx.runMutation(internal.domains.integrations.adapters.email.enqueuePasswordReset, { email: identifier, resetToken: token, expiresAt: expires.getTime() })
  },
})

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password({
    profile(params) {
      const email = String(params.email ?? "").trim().toLocaleLowerCase("en-US")
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new ConvexError("Укажите корректный email")
      return { email, name: String(params.name ?? email).trim() }
    },
    validatePasswordRequirements: assertOfficePassword,
    reset: passwordReset,
  })],
  signIn: { maxFailedAttempsPerHour: 5 },
})
