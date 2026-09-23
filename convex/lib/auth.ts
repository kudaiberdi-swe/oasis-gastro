import type { GenericMutationCtx, GenericQueryCtx } from "convex/server"
import type { DataModel, Id } from "../_generated/dataModel"

type QueryCtx = GenericQueryCtx<DataModel>
type MutationCtx = GenericMutationCtx<DataModel>
type AnyCtx = QueryCtx | MutationCtx

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function requireSession(ctx: AnyCtx, sessionToken: string, purpose: "operator" | "manager-approval") {
  if (!sessionToken) throw new Error("Касса заблокирована")
  const tokenHash = await sha256(sessionToken)
  const session = await ctx.db
    .query("posSessions")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique()
  const now = Date.now()
  if (!session || session.revokedAt || session.expiresAt <= now || session.purpose !== purpose) {
    throw new Error("Сессия истекла. Войдите снова")
  }
  const [employee, terminal] = await Promise.all([ctx.db.get(session.employeeId), ctx.db.get(session.terminalId)])
  if (!employee?.active || !terminal?.active) throw new Error("Доступ к кассе отключён")
  const restaurant = await ctx.db.get(terminal.restaurantId)
  if (!restaurant?.active || !employee.restaurantIds.includes(restaurant._id)) {
    throw new Error("Нет доступа к ресторану")
  }
  if (employee.terminalIds?.length && !employee.terminalIds.includes(terminal._id)) {
    throw new Error("Нет доступа к терминалу")
  }
  return { session, employee, terminal, restaurant }
}

export type PosAccess = Awaited<ReturnType<typeof requireSession>>

export async function requireOperator(ctx: AnyCtx, sessionToken: string): Promise<PosAccess> {
  return requireSession(ctx, sessionToken, "operator")
}

/**
 * A manager PIN authorizes exactly one privileged operation. The session is revoked the instant
 * it validates — reusing an approval token would silently turn a spot approval into an open one.
 */
export async function requireManagerApproval(
  ctx: MutationCtx,
  approvalToken: string | undefined,
  restaurantId: Id<"restaurants">,
) {
  if (!approvalToken) throw new Error("Требуется подтверждение менеджера")
  const access = await requireSession(ctx, approvalToken, "manager-approval")
  if (access.employee.role !== "manager" && access.employee.role !== "administrator") {
    throw new Error("Недостаточно прав для подтверждения")
  }
  if (access.terminal.restaurantId !== restaurantId) {
    throw new Error("Менеджер должен работать в том же ресторане")
  }
  await ctx.db.patch(access.session._id, { revokedAt: Date.now() })
  return access.employee
}

export async function touchSession(ctx: MutationCtx, sessionId: Id<"posSessions">) {
  await ctx.db.patch(sessionId, { lastActivityAt: Date.now() })
}

export async function getOpenShift(ctx: AnyCtx, terminalId: Id<"posTerminals">) {
  return ctx.db
    .query("shifts")
    .withIndex("by_terminal_status", (q) => q.eq("terminalId", terminalId).eq("status", "open"))
    .unique()
}

export async function requireOpenShift(ctx: AnyCtx, terminalId: Id<"posTerminals">) {
  const shift = await getOpenShift(ctx, terminalId)
  if (!shift) throw new Error("Сначала откройте кассовую смену")
  return shift
}
