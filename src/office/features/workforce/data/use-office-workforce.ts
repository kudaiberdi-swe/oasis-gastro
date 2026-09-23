import { useMutation, useQuery } from "convex/react"

import { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"

export function useWorkforceBranches() {
  return useQuery(api.domains.workforce.queries.listBranches) ?? []
}

export function usePosEmployees() {
  const employees = useQuery(api.domains.workforce.queries.listPosEmployees)
  return { employees: employees ?? [], loading: employees === undefined }
}

export function useUnprovisionedEmployees() {
  const candidates = useQuery(api.domains.workforce.queries.listUnprovisioned)
  return { candidates: candidates ?? [], loading: candidates === undefined }
}

export function useSuggestedCredentials(enabled: boolean) {
  return useQuery(api.domains.workforce.queries.suggestCredentials, enabled ? {} : "skip")
}

export function useWorkforceMutations() {
  const provisionPosAccess = useMutation(api.domains.workforce.mutations.provisionPosAccess)
  const setEmployeeActive = useMutation(api.domains.workforce.mutations.setEmployeeActive)
  const updateEmployeeAssignment = useMutation(api.domains.workforce.mutations.updateEmployeeAssignment)
  const resetPin = useMutation(api.domains.workforce.mutations.resetPin)
  return { provisionPosAccess, setEmployeeActive, updateEmployeeAssignment, resetPin }
}

export type PosEmployee = ReturnType<typeof usePosEmployees>["employees"][number]
export type UnprovisionedCandidate = ReturnType<typeof useUnprovisionedEmployees>["candidates"][number]
export type EmployeeId = Id<"employees">
