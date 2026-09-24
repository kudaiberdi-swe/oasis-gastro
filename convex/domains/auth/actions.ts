"use node"

import { v, ConvexError } from "convex/values"

import { action } from "../../_generated/server"
import { internal } from "../../_generated/api"
import { constantTimeEqual, derivePinHash, sha256 } from "../../lib/auth"
import { APPROVAL_TTL_MS, isValidPin, SESSION_TTL_MS } from "../../lib/policy"
import { sessionPurpose } from "../../lib/validators"

export const login = action({
  args: {
    employeeCode: v.string(),
    pin: v.string(),
    terminalExternalId: v.string(),
    purpose: sessionPurpose,
  },
  handler: async (ctx, args): Promise<{
    sessionToken: string
    expiresAt: number
    employee: { id: string; code: string; displayName: string; role: string }
    terminal: { id: string; externalId: string; name: string; terminalNumber: number }
    restaurant: { id: string; externalId: string; name: string; city: string }
  }> => {
    const now = Date.now()
    // No valid PIN is shorter than 4 or longer than 6 digits; same message as a wrong PIN.
    if (!isValidPin(args.pin)) throw new ConvexError("Неверный код сотрудника или PIN")
    const record = await ctx.runQuery(internal.domains.auth.internal.getLoginRecord, {
      employeeCode: args.employeeCode,
      terminalExternalId: args.terminalExternalId,
    })
    if (!record?.employee.active || !record.terminal.active || !record.restaurant.active) {
      throw new ConvexError("Неверный код сотрудника или PIN")
    }
    if (record.employee.lockedUntil && record.employee.lockedUntil > now) {
      const minutes = Math.max(1, Math.ceil((record.employee.lockedUntil - now) / 60_000))
      throw new ConvexError(`Слишком много попыток. Повторите через ${minutes} мин.`)
    }
    if (args.purpose === "manager-approval" && record.employee.role !== "manager" && record.employee.role !== "administrator") {
      throw new ConvexError("Требуется PIN менеджера")
    }
    const calculated = await derivePinHash(args.pin, record.employee.pinSalt)
    if (!constantTimeEqual(calculated, record.employee.pinHash)) {
      await ctx.runMutation(internal.domains.auth.internal.recordFailedAttempt, {
        employeeId: record.employee._id,
        now,
      })
      throw new ConvexError("Неверный код сотрудника или PIN")
    }
    const sessionToken = randomToken()
    const tokenHash = await sha256(sessionToken)
    const expiresAt = now + (args.purpose === "operator" ? SESSION_TTL_MS : APPROVAL_TTL_MS)
    await ctx.runMutation(internal.domains.auth.internal.createSession, {
      employeeId: record.employee._id,
      terminalId: record.terminal._id,
      tokenHash,
      purpose: args.purpose,
      now,
      expiresAt,
    })
    return {
      sessionToken,
      expiresAt,
      employee: {
        id: record.employee._id,
        code: record.employee.code,
        displayName: record.employee.displayName,
        role: record.employee.role,
      },
      terminal: {
        id: record.terminal._id,
        externalId: record.terminal.externalId,
        name: record.terminal.name,
        terminalNumber: record.terminal.terminalNumber,
      },
      restaurant: {
        id: record.restaurant._id,
        externalId: record.restaurant.externalId,
        name: record.restaurant.name,
        city: record.restaurant.city ?? record.restaurant.address.split(",")[0],
      },
    }
  },
})

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}
