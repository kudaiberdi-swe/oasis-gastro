import { v, ConvexError } from "convex/values"

import { mutation } from "../../_generated/server"
import { getOpenShift, requireManagerApproval, requireOperator, touchSession } from "../../lib/auth"
import { writeAudit } from "../../lib/audit"
import { roundKzt } from "../../lib/money"
import { businessDateFor } from "../../lib/time"
import { VARIANCE_APPROVAL_KZT } from "../../lib/policy"
import { journalReady } from "../../lib/checkoutCore"
import { postJournalEntry } from "../../lib/ledger"
import { assertPeriodOpen } from "../../lib/periods"
import { settingInForce } from "../../lib/retailSettings"
import { closeShiftAttendance, openAttendance } from "../../lib/attendance"
import { buildClosePreview, buildXReportSnapshot, calculateSummary } from "./queries"

export const open = mutation({
  args: { sessionToken: v.string(), openingCash: v.number(), note: v.string() },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    if (!Number.isFinite(args.openingCash) || args.openingCash < 0) throw new ConvexError("Начальный остаток не может быть отрицательным")
    if (await getOpenShift(ctx, access.terminal._id)) throw new ConvexError("На этой кассе уже открыта смена")
    const latest = await ctx.db.query("shifts").withIndex("by_terminal_opened", (q) => q.eq("terminalId", access.terminal._id)).order("desc").first()
    const now = Date.now()
    const number = (latest?.number ?? 0) + 1
    const shiftId = await ctx.db.insert("shifts", {
      restaurantId: access.restaurant._id,
      terminalId: access.terminal._id,
      number,
      // Fixed when the shift opens: every order of a shift that runs past midnight stays in one day.
      businessDate: businessDateFor(now, access.restaurant.businessDayCutoffMinutes),
      status: "open",
      openedBy: access.employee._id,
      openedAt: now,
      openingCash: roundKzt(args.openingCash),
      openingNote: args.note.trim(),
    })
    await ctx.db.insert("shiftEvents", { shiftId, type: "open", amount: roundKzt(args.openingCash), reason: args.note.trim() || "Открытие смены", actorId: access.employee._id, createdAt: now })
    await openAttendance(ctx, access, "pos-shift", shiftId) // W1-HR-05: attendance with the shift
    await touchSession(ctx, access.session._id)
    await writeAudit(ctx, access, { action: "shift.open", summary: `Открыта смена №${number} с остатком ${roundKzt(args.openingCash)} ₸`, shiftId })
    return shiftId
  },
})

/**
 * Cash in / cash out (W1-POS-08). With a cash operation type from the retail settings the direction,
 * limit, manager rule and accounts come from the type and the movement is posted (Dr/Cr cash account
 * and its corresponding account). The free direction + reason form stays for older clients.
 * Every cash-out needs a manager.
 */
export const recordCashMovement = mutation({
  args: {
    sessionToken: v.string(),
    cashOperationTypeExternalId: v.optional(v.string()),
    direction: v.optional(v.union(v.literal("cash-in"), v.literal("cash-out"))),
    amount: v.number(),
    reason: v.optional(v.string()),
    comment: v.optional(v.string()),
    idempotencyKey: v.string(),
    managerApprovalToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const shift = await getOpenShift(ctx, access.terminal._id)
    if (!shift) throw new ConvexError("Смена не открыта")
    const now = Date.now()
    const setting = args.cashOperationTypeExternalId ? await settingInForce(ctx, "cash-operation-type", args.cashOperationTypeExternalId, access.restaurant.externalId, now, "Кассовая операция") : null
    const type = setting?.data.kind === "cash-operation-type" ? setting.data : null
    const direction = type?.direction ?? args.direction
    if (!direction) throw new ConvexError("Выберите тип кассовой операции")
    const comment = (args.comment ?? args.reason ?? "").trim()
    const reason = setting ? [setting.name, comment].filter(Boolean).join(": ") : comment
    const amount = roundKzt(args.amount)

    const existing = await ctx.db.query("shiftEvents").withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", args.idempotencyKey)).unique()
    if (existing) {
      if (existing.shiftId !== shift._id || existing.type !== direction || existing.amount !== amount || existing.reason !== reason) throw new ConvexError("Ключ кассовой операции уже использован")
      return existing._id
    }
    if (!Number.isFinite(args.amount) || args.amount <= 0) throw new ConvexError("Введите сумму больше нуля")
    if (!setting && reason.length < 3) throw new ConvexError("Укажите причину кассовой операции")
    if (type && amount > type.maximumAmount) throw new ConvexError(`Сумма больше лимита операции — ${type.maximumAmount} ₸`)
    const manager = direction === "cash-out" || type?.requireManager ? await requireManagerApproval(ctx, args.managerApprovalToken, access.restaurant._id) : null
    if (direction === "cash-out") {
      const summary = await calculateSummary(ctx, shift)
      if (amount > summary.expectedCash) throw new ConvexError("Сумма больше, чем учтено в кассе")
    }
    await assertPeriodOpen(ctx, { organizationExternalId: access.restaurant.organizationExternalId, restaurantExternalId: access.restaurant.externalId, businessDate: shift.businessDate, moduleId: "cash-operations" })
    const eventId = await ctx.db.insert("shiftEvents", {
      shiftId: shift._id,
      type: direction,
      amount,
      reason,
      actorId: access.employee._id,
      idempotencyKey: args.idempotencyKey,
      createdAt: now,
      ...(setting ? { cashOperationTypeExternalId: setting.externalId, cashOperationTypeName: setting.name } : {}),
    })
    if (type && (await journalReady(ctx))) {
      const entry = await postJournalEntry(ctx, {
        externalId: `cash:${args.idempotencyKey}`,
        restaurantExternalId: access.restaurant.externalId,
        sourceModuleId: "cash-operations",
        sourceExternalId: String(eventId),
        sourceNumber: `Смена №${shift.number}`,
        occurredAt: now,
        businessDate: shift.businessDate,
        debitAccount: direction === "cash-in" ? type.cashAccount : type.correspondingAccount,
        creditAccount: direction === "cash-in" ? type.correspondingAccount : type.cashAccount,
        amount,
        description: `${direction === "cash-in" ? "Внесение" : "Изъятие"}: ${reason}`,
      })
      await ctx.db.patch(eventId, { journalEntryId: entry.externalId })
    }
    await touchSession(ctx, access.session._id)
    await writeAudit(ctx, access, {
      action: `shift.${direction}`,
      summary: `${direction === "cash-in" ? "Внесение" : "Изъятие"} ${amount} ₸: ${reason}`,
      shiftId: shift._id,
      ...(manager ? { managerId: manager._id } : {}),
    })
    return eventId
  },
})

/**
 * «Сверить» of the blind close (POS-DESIGN §6.2): the counted amount goes to the audit journal first, then
 * the expected cash and the variance are revealed. A cashier sees the expected amount only this way, so
 * every reveal — and a recount after it — stays on record for the manager.
 */
export const reconcileCount = mutation({
  args: { sessionToken: v.string(), countedCash: v.number() },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const shift = await getOpenShift(ctx, access.terminal._id)
    if (!shift) throw new ConvexError("Смена уже закрыта")
    if (!Number.isFinite(args.countedCash) || args.countedCash < 0) throw new ConvexError("Фактическая наличность не может быть отрицательной")
    const countedCash = roundKzt(args.countedCash)
    const { expectedCash } = await calculateSummary(ctx, shift)
    const variance = countedCash - expectedCash
    await touchSession(ctx, access.session._id)
    await writeAudit(ctx, access, { action: "shift.count", summary: `Сверка смены №${shift.number}: насчитано ${countedCash} ₸, расхождение ${variance} ₸`, shiftId: shift._id, details: { countedCash, expectedCash, variance } })
    return { countedCash, expectedCash, variance, managerThreshold: VARIANCE_APPROVAL_KZT }
  },
})

export const close = mutation({
  args: { sessionToken: v.string(), countedCash: v.number(), note: v.string(), managerApprovalToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const shift = await getOpenShift(ctx, access.terminal._id)
    if (!shift) throw new ConvexError("Смена уже закрыта")
    if (!Number.isFinite(args.countedCash) || args.countedCash < 0) throw new ConvexError("Фактическая наличность не может быть отрицательной")
    const preview = await buildClosePreview(ctx, shift)
    if (preview.blockers.length) throw new ConvexError("Закройте или отложите все открытые заказы")
    const countedCash = roundKzt(args.countedCash)
    const variance = countedCash - preview.expectedCash
    if (variance !== 0 && args.note.trim().length < 3) throw new ConvexError("При расхождении обязательно укажите комментарий")
    const manager = Math.abs(variance) >= VARIANCE_APPROVAL_KZT ? await requireManagerApproval(ctx, args.managerApprovalToken, access.restaurant._id) : null
    const now = Date.now()
    const zReportNumber = `Z-${shift.businessDate.replaceAll("-", "")}-${String(access.terminal.terminalNumber).padStart(2, "0")}-${String(shift.number).padStart(3, "0")}`
    const snapshot = await buildXReportSnapshot(ctx, shift)
    await ctx.db.patch(shift._id, {
      status: "closed",
      expectedCash: preview.expectedCash,
      countedCash,
      variance,
      closeNote: args.note.trim(),
      closedBy: access.employee._id,
      closedAt: now,
      zReportNumber,
      ...(manager ? { managerApprovedBy: manager._id } : {}),
    })
    if (manager) {
      await ctx.db.insert("shiftEvents", { shiftId: shift._id, type: "manager-override", amount: Math.abs(variance), reason: `Подтверждено расхождение ${variance} ₸`, actorId: manager._id, createdAt: now })
    }
    await ctx.db.insert("shiftEvents", { shiftId: shift._id, type: "close", amount: countedCash, reason: args.note.trim() || "Закрытие смены", actorId: access.employee._id, createdAt: now })
    await closeShiftAttendance(ctx, shift._id)
    const zReportId = await ctx.db.insert("zReports", {
      shiftId: shift._id,
      number: zReportNumber,
      restaurantId: access.restaurant._id,
      terminalId: access.terminal._id,
      businessDate: shift.businessDate,
      shiftNumber: shift.number,
      openedAt: shift.openedAt,
      closedAt: now,
      closedBy: access.employee._id,
      closedByName: access.employee.displayName,
      openingCash: shift.openingCash,
      countedCash,
      variance,
      snapshot,
      nonFiscal: true,
      createdAt: now,
    })
    await touchSession(ctx, access.session._id)
    await writeAudit(ctx, access, { action: "shift.close", summary: `Закрыта смена №${shift.number}; расхождение ${variance} ₸`, shiftId: shift._id, ...(manager ? { managerId: manager._id } : {}) })
    return { shiftId: shift._id, zReportId, zReportNumber, variance, ...preview }
  },
})

export const createXReport = mutation({
  args: { sessionToken: v.string(), idempotencyKey: v.string(), managerApprovalToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const shift = await getOpenShift(ctx, access.terminal._id)
    if (!shift) throw new ConvexError("Смена не открыта")
    const existing = await ctx.db.query("xReports").withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", args.idempotencyKey)).unique()
    if (existing) {
      if (existing.shiftId !== shift._id || existing.terminalId !== access.terminal._id) throw new ConvexError("Ключ X-отчёта уже использован")
      return existing
    }
    // A cashier can't self-authorize an X-report — a manager PIN must witness it.
    const manager = access.employee.role === "cashier" ? await requireManagerApproval(ctx, args.managerApprovalToken, access.restaurant._id) : null
    const [snapshot, previousReport, openedBy] = await Promise.all([
      buildXReportSnapshot(ctx, shift),
      ctx.db.query("xReports").withIndex("by_shift_sequence", (q) => q.eq("shiftId", shift._id)).order("desc").first(),
      ctx.db.get(shift.openedBy),
    ])
    const generatedAt = Date.now()
    const sequence = (previousReport?.sequence ?? 0) + 1
    const reportNumber = `X-${shift.businessDate.replaceAll("-", "")}-${String(access.terminal.terminalNumber).padStart(2, "0")}-${String(shift.number).padStart(3, "0")}-${String(sequence).padStart(3, "0")}`
    const report = {
      reportVersion: 1,
      idempotencyKey: args.idempotencyKey,
      reportNumber,
      sequence,
      shiftId: shift._id,
      shiftNumber: shift.number,
      terminalId: access.terminal._id,
      terminalName: access.terminal.name,
      terminalNumber: access.terminal.terminalNumber,
      restaurantId: access.restaurant._id,
      restaurantName: access.restaurant.name,
      restaurantAddress: access.restaurant.address,
      businessDate: shift.businessDate,
      openedAt: shift.openedAt,
      generatedAt,
      openedByName: openedBy?.displayName ?? "Сотрудник",
      generatedByName: access.employee.displayName,
      generatedByRole: access.employee.role,
      openingCash: shift.openingCash,
      ...snapshot,
      nonFiscal: true as const,
    }
    const reportId = await ctx.db.insert("xReports", report)
    await touchSession(ctx, access.session._id)
    await writeAudit(ctx, access, { action: "shift.x-report", summary: `Сформирован X-отчёт ${reportNumber} без закрытия смены`, shiftId: shift._id, ...(manager ? { managerId: manager._id } : {}) })
    return { _id: reportId, ...report }
  },
})
