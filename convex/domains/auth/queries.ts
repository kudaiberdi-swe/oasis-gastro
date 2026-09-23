import { v } from "convex/values"

import { query } from "../../_generated/server"
import { requireOperator } from "../../lib/auth"

export const current = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    return {
      expiresAt: access.session.expiresAt,
      employee: {
        id: access.employee._id,
        code: access.employee.code,
        displayName: access.employee.displayName,
        role: access.employee.role,
      },
      terminal: {
        id: access.terminal._id,
        externalId: access.terminal.externalId,
        name: access.terminal.name,
        terminalNumber: access.terminal.terminalNumber,
      },
      restaurant: {
        id: access.restaurant._id,
        externalId: access.restaurant.externalId,
        name: access.restaurant.name,
        city: access.restaurant.city,
      },
    }
  },
})
