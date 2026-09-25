import { useMutation, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"

import { api } from "../../../../../convex/_generated/api"

// Report mailings (W2-RPT-06) over convex/domains/reports/schedules: the owner's own schedules; the
// server checks `office.report-schedules.view/edit`, the report's right and the restaurant scope again.

const schedules = api.domains.reports.schedules

export type ReportSchedule = FunctionReturnType<typeof schedules.listSchedules>[number]
export type SaveScheduleArgs = FunctionArgs<typeof schedules.saveSchedule>

/** `enabled: false` (no `office.report-schedules.view`) never calls the server. */
export function useReportSchedules(enabled = true) {
  return useQuery(schedules.listSchedules, enabled ? {} : "skip")
}

export function useReportScheduleActions() {
  return {
    save: useMutation(schedules.saveSchedule),
    setActive: useMutation(schedules.setScheduleActive),
    remove: useMutation(schedules.deleteSchedule),
    runNow: useMutation(schedules.runScheduleNow),
  }
}
