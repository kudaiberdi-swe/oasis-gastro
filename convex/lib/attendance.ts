import { ConvexError } from "convex/values"
import type { GenericMutationCtx } from "convex/server"

import type { DataModel, Doc, Id } from "../_generated/dataModel"
import type { PosAccess } from "./auth"
import { nextNumber } from "./numbering"
import { businessDateFor } from "./time"

type MutationCtx = GenericMutationCtx<DataModel>

// Attendance from the POS (W1-HR-05): clock-in / clock-out and the automatic record with a shift.

export const hoursBetween = (clockIn: number, clockOut: number, breakMinutes: number) => Math.max(0, Math.round(((clockOut - clockIn) / 3_600_000 - breakMinutes / 60) * 100) / 100)

export async function openAttendanceOf(ctx: MutationCtx, employeeId: Id<"employees">) {
  return ctx.db.query("attendanceRecords").withIndex("by_employee_status", (q) => q.eq("employeeId", employeeId).eq("status", "active")).order("desc").first()
}

/** Opens the employee's attendance unless one is already open (idempotent). */
export async function openAttendance(ctx: MutationCtx, access: PosAccess, source: "pos" | "pos-shift", shiftId?: Id<"shifts">) {
  const open = await openAttendanceOf(ctx, access.employee._id)
  if (open) return open
  const now = Date.now()
  const businessDate = businessDateFor(now, access.restaurant.businessDayCutoffMinutes)
  const number = await nextNumber(ctx, { moduleId: "attendance", prefix: "ЯВ", organizationExternalId: access.restaurant.organizationExternalId, businessDate })
  const id = await ctx.db.insert("attendanceRecords", {
    externalId: `attendance-${crypto.randomUUID()}`,
    number,
    employeeId: access.employee._id,
    employeeCode: access.employee.code,
    employeeName: access.employee.displayName,
    organizationExternalId: access.restaurant.organizationExternalId,
    restaurantExternalId: access.restaurant.externalId,
    businessDate,
    status: "active",
    clockIn: now,
    breakMinutes: 0,
    attendanceType: "worked",
    source,
    terminalExternalId: access.terminal.externalId,
    ...(shiftId ? { shiftId } : {}),
    version: 1,
    searchText: `${number} ${access.employee.displayName} ${access.employee.code}`.toLocaleLowerCase("ru"),
    createdAt: now,
    updatedAt: now,
  })
  return (await ctx.db.get(id))!
}

async function close(ctx: MutationCtx, record: Doc<"attendanceRecords">) {
  const now = Date.now()
  await ctx.db.patch(record._id, { status: "completed", clockOut: now, hours: hoursBetween(record.clockIn, now, record.breakMinutes), version: record.version + 1, updatedAt: now })
  return (await ctx.db.get(record._id))!
}

/** Closes the employee's open attendance; `required` makes a missing one an error (clockOut). */
export async function closeAttendance(ctx: MutationCtx, employeeId: Id<"employees">, required: boolean) {
  const open = await openAttendanceOf(ctx, employeeId)
  if (!open) {
    if (required) throw new ConvexError("Нет открытой отметки прихода")
    return null
  }
  return close(ctx, open)
}

/** A shift closing closes the attendance it opened, whoever closes the shift. */
export async function closeShiftAttendance(ctx: MutationCtx, shiftId: Id<"shifts">) {
  const record = await ctx.db.query("attendanceRecords").withIndex("by_shift", (q) => q.eq("shiftId", shiftId)).first()
  return record?.status === "active" ? close(ctx, record) : null
}
