import type { GenericMutationCtx } from "convex/server"
import type { DataModel, Id } from "../_generated/dataModel"
import type { PosAccess } from "./auth"

type MutationCtx = GenericMutationCtx<DataModel>

export async function writeAudit(
  ctx: MutationCtx,
  access: PosAccess,
  details: {
    action: string
    summary: string
    shiftId?: Id<"shifts">
    orderId?: Id<"orders">
    managerId?: Id<"employees">
  },
) {
  await ctx.db.insert("auditEvents", {
    actorKey: access.employee.code,
    action: details.action,
    summary: details.summary,
    resourceType: details.orderId ? "order" : details.shiftId ? "shift" : "pos-session",
    resourceExternalId: String(details.orderId ?? details.shiftId ?? access.session._id),
    organizationExternalId: access.restaurant.organizationExternalId,
    restaurantExternalId: access.restaurant.externalId,
    occurredAt: Date.now(),
    terminalId: access.terminal._id,
    actorId: access.employee._id,
    ...(details.shiftId ? { shiftId: details.shiftId } : {}),
    ...(details.orderId ? { orderId: details.orderId } : {}),
    ...(details.managerId ? { managerId: details.managerId } : {}),
  })
}
