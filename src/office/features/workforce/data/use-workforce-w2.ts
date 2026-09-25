import { useMutation, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"

import { api } from "../../../../../convex/_generated/api"

// W2-HR-02/03/04/06: office hooks over convex/domains/workforce/{references,schedule,payroll}.ts.
// The server checks every right and restaurant scope again.

const references = api.domains.workforce.references
const schedule = api.domains.workforce.schedule
const payroll = api.domains.workforce.payroll
const departments = api.domains.corporation.departments

export type ListStatus = "active" | "inactive" | undefined

// ── References ───────────────────────────────────────────────────────────────

export function usePositions(status: ListStatus, enabled = true) {
  return useQuery(references.listPositions, enabled ? { status } : "skip")
}

export function useShiftTypes(status: ListStatus, enabled = true) {
  return useQuery(references.listShiftTypes, enabled ? { status } : "skip")
}

/** Active departments for the position card; skipped without «Подразделения — просмотр». */
export function useDepartmentOptions(enabled: boolean) {
  return useQuery(departments.listDepartments, enabled ? { status: "active" } : "skip")
}

export function useReferenceMutations() {
  return {
    savePosition: useMutation(references.savePosition),
    setPositionActive: useMutation(references.setPositionActive),
    saveShiftType: useMutation(references.saveShiftType),
    setShiftTypeActive: useMutation(references.setShiftTypeActive),
  }
}

// ── Schedule ─────────────────────────────────────────────────────────────────

export function useScheduleWeek(restaurantExternalId: string | undefined, weekStart: string) {
  return useQuery(schedule.scheduleWeek, restaurantExternalId ? { restaurantExternalId, weekStart } : "skip")
}

export function useScheduleMutations() {
  return {
    saveEntry: useMutation(schedule.saveEntry),
    removeEntry: useMutation(schedule.removeEntry),
    copyWeek: useMutation(schedule.copyWeek),
    publishWeek: useMutation(schedule.publishWeek),
  }
}

// ── Payroll ──────────────────────────────────────────────────────────────────

export function usePayrollRules(enabled = true) {
  return useQuery(payroll.listRules, enabled ? {} : "skip")
}

export function usePayrollRuns(restaurantExternalId: string | undefined) {
  return useQuery(payroll.listRuns, restaurantExternalId ? { restaurantExternalId } : "skip")
}

/** undefined while loading, null when missing or outside the user's restaurants. */
export function usePayrollRun(externalId: string) {
  return useQuery(payroll.getRun, { externalId })
}

export function usePayrollMutations() {
  return {
    saveRules: useMutation(payroll.saveRules),
    activateRules: useMutation(payroll.activateRules),
    saveAdjustment: useMutation(payroll.saveAdjustment),
    calculatePayroll: useMutation(payroll.calculatePayroll),
    postPayroll: useMutation(payroll.postPayroll),
    reversePayroll: useMutation(payroll.reversePayroll),
    createPayout: useMutation(payroll.createPayout),
  }
}

export type PositionRow = FunctionReturnType<typeof references.listPositions>[number]
export type ShiftTypeRow = FunctionReturnType<typeof references.listShiftTypes>[number]
export type DepartmentOption = FunctionReturnType<typeof departments.listDepartments>[number]
export type ScheduleWeek = FunctionReturnType<typeof schedule.scheduleWeek>
export type ScheduleRow = ScheduleWeek["rows"][number]
export type ScheduleShift = ScheduleRow["days"][number]["shifts"][number]
export type SaveEntryArgs = FunctionArgs<typeof schedule.saveEntry>
export type PayrollRulesRow = FunctionReturnType<typeof payroll.listRules>[number]
export type PayrollRunRow = FunctionReturnType<typeof payroll.listRuns>[number]
export type PayrollRunCard = NonNullable<FunctionReturnType<typeof payroll.getRun>>
export type PayrollLine = PayrollRunCard["run"]["lines"][number]
export type SaveAdjustmentArgs = FunctionArgs<typeof payroll.saveAdjustment>
