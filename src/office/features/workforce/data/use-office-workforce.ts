import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"

import { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"

// «Сотрудники» (W1-HR-01) and «Журнал явки» (W1-HR-05): office hooks over convex/domains/workforce.
// The server checks every right and restaurant scope again; PIN hashes never reach the client.

const queries = api.domains.workforce.queries
const mutations = api.domains.workforce.mutations
const attendance = api.domains.workforce.attendance

export const WORKFORCE_PAGE_SIZE = 50

export function useWorkforceBranches() {
  return useQuery(queries.listBranches) ?? []
}

export function usePosEmployees(enabled = true) {
  const employees = useQuery(queries.listPosEmployees, enabled ? {} : "skip")
  return { employees: employees ?? [], loading: employees === undefined }
}

export function useUnprovisionedEmployees() {
  const candidates = useQuery(queries.listUnprovisioned)
  return { candidates: candidates ?? [], loading: candidates === undefined }
}

export function useSuggestedCredentials(enabled: boolean) {
  return useQuery(queries.suggestCredentials, enabled ? {} : "skip")
}

export function useEmployeesList(args: { status?: "active" | "inactive"; search: string; restaurantExternalId?: string; enabled: boolean }) {
  return usePaginatedQuery(
    queries.listEmployees,
    args.enabled ? { status: args.status, search: args.search.trim() || undefined, restaurantExternalId: args.restaurantExternalId } : "skip",
    { initialNumItems: WORKFORCE_PAGE_SIZE },
  )
}

/** undefined while loading, null when missing or outside the user's restaurants. */
export function useEmployee(employeeId: EmployeeId) {
  return useQuery(queries.getEmployee, { employeeId })
}

export function useWorkforceMutations() {
  const provisionPosAccess = useMutation(mutations.provisionPosAccess)
  const setEmployeeActive = useMutation(mutations.setEmployeeActive)
  const updateEmployeeAssignment = useMutation(mutations.updateEmployeeAssignment)
  const resetPin = useMutation(mutations.resetPin)
  const createPosEmployee = useMutation(mutations.createPosEmployee)
  const updateEmployeeProfile = useMutation(mutations.updateEmployeeProfile)
  return { provisionPosAccess, setEmployeeActive, updateEmployeeAssignment, resetPin, createPosEmployee, updateEmployeeProfile }
}

export function useAttendanceList(args: { status?: AttendanceStatus; search: string; restaurantExternalId?: string; enabled: boolean }) {
  return usePaginatedQuery(
    attendance.list,
    args.enabled ? { status: args.status, search: args.search.trim() || undefined, restaurantExternalId: args.restaurantExternalId } : "skip",
    { initialNumItems: WORKFORCE_PAGE_SIZE },
  )
}

export function useAttendanceRecord(externalId: string | null) {
  return useQuery(attendance.get, externalId ? { externalId } : "skip")
}

export function useAttendanceMutations() {
  const save = useMutation(attendance.save)
  const transition = useMutation(attendance.transition)
  return { save, transition }
}

export type PosEmployee = ReturnType<typeof usePosEmployees>["employees"][number]
export type UnprovisionedCandidate = ReturnType<typeof useUnprovisionedEmployees>["candidates"][number]
export type EmployeeId = Id<"employees">
export type EmployeeRow = FunctionReturnType<typeof queries.listEmployees>["page"][number]
export type EmployeeCard = NonNullable<FunctionReturnType<typeof queries.getEmployee>>
export type CreateEmployeeArgs = FunctionArgs<typeof mutations.createPosEmployee>
export type UpdateProfileArgs = FunctionArgs<typeof mutations.updateEmployeeProfile>
export type AttendanceRow = FunctionReturnType<typeof attendance.list>["page"][number]
export type AttendanceRecord = NonNullable<FunctionReturnType<typeof attendance.get>>
export type AttendanceStatus = AttendanceRow["status"]
export type SaveAttendanceArgs = FunctionArgs<typeof attendance.save>
export type AttendanceAction = FunctionArgs<typeof attendance.transition>["action"]
