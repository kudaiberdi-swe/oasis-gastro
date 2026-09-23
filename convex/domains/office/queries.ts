import { query } from "../../_generated/server"
import { getOfficeAuthEmail, hasScope } from "../../lib/officeAccess"
import { listOperationalRestaurants } from "../../lib/restaurants"

/**
 * Everything the office shell needs to decide what to render: is this account bootstrapped,
 * what can it see, what can it do. `ready: false` means "signed in, but no officeUsers row (or
 * no restaurants) yet" — the frontend offers bootstrap() only to OFFICE_BOOTSTRAP_EMAIL.
 */
export const context = query({
  args: {},
  handler: async (ctx) => {
    const email = await getOfficeAuthEmail(ctx)
    const user = email ? await ctx.db.query("officeUsers").withIndex("by_email", (q) => q.eq("email", email)).unique() : null
    const role = user ? await ctx.db.query("officeRoles").withIndex("by_external_id", (q) => q.eq("externalId", user.roleExternalId)).unique() : null
    const allRestaurants = await listOperationalRestaurants(ctx)
    const restaurants = user ? allRestaurants.filter((restaurant) => hasScope(user.restaurantScopes, restaurant.externalId)) : []
    return {
      email,
      ready: Boolean(user?.active && role && restaurants.length),
      user,
      capabilities: role?.capabilities ?? [],
      restaurants,
    }
  },
})
