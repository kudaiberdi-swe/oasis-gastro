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

/**
 * The terminal picker before anyone signs in — the one public query without a session (allowlisted in
 * scripts/guards/public-allowlist.json). Only active branches with active terminals; no Convex ids,
 * no staff, nothing beyond what is printed on the terminal itself.
 */
export const posTerminalOptions = query({
  args: {},
  handler: async (ctx) => {
    const restaurants = await ctx.db.query("restaurants").withIndex("by_active_and_name", (q) => q.eq("active", true)).take(200)
    const options = await Promise.all(
      restaurants.map(async (restaurant) => {
        const terminals = await ctx.db
          .query("posTerminals")
          .withIndex("by_restaurant_active_and_number", (q) => q.eq("restaurantId", restaurant._id).eq("active", true))
          .take(50)
        return {
          restaurantExternalId: restaurant.externalId,
          restaurantName: restaurant.name,
          city: restaurant.city ?? null,
          address: restaurant.address || null,
          // Cashier terminals only: kitchen screens and office terminals are not picked at the POS.
          terminals: terminals
            .filter((terminal) => terminal.kind === undefined || terminal.kind === "pos")
            .map((terminal) => ({ externalId: terminal.externalId, name: terminal.name, terminalNumber: terminal.terminalNumber })),
        }
      }),
    )
    return options.filter((option) => option.terminals.length > 0)
  },
})
