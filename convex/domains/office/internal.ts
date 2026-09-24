import { v } from "convex/values"

import { internalMutation } from "../../_generated/server"
import { upsertSystemRoles } from "../../lib/systemRoles"

/** For an office that was bootstrapped before the system roles existed (prod). Does not touch users. */
export const seedSystemRoles = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => upsertSystemRoles(ctx, args.dryRun ?? false),
})
