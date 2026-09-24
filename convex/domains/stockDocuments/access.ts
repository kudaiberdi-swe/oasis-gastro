import { ConvexError } from "convex/values"
import type { GenericQueryCtx } from "convex/server"

import type { DataModel, Doc } from "../../_generated/dataModel"
import { effectiveScopes, hasScope } from "../../lib/officeAccess"

type QueryCtx = GenericQueryCtx<DataModel>

/** A document is reachable when its restaurant and both warehouses are in the user's scopes. */
export async function assertDocumentScope(ctx: QueryCtx, user: Doc<"officeUsers">, role: Doc<"officeRoles">, document: Pick<Doc<"stockDocuments">, "restaurantExternalId" | "sourceWarehouseExternalId" | "destinationWarehouseExternalId">) {
  if (!hasScope(user.restaurantScopes, document.restaurantExternalId)) throw new ConvexError("Документ не найден")
  const scopes = await effectiveScopes(ctx, user, role)
  for (const warehouse of [document.sourceWarehouseExternalId, document.destinationWarehouseExternalId]) {
    if (warehouse && !hasScope(scopes.warehouseScopes, warehouse)) throw new ConvexError("Нет доступа к складу")
  }
}
