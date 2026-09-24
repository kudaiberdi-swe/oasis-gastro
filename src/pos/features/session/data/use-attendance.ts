import { useMutation, useQuery } from "convex/react"

import { api } from "../../../../../convex/_generated/api"

/** Clock in / clock out from the profile (W1-HR-05, W1-POS-14); null while not clocked in. */
export function useAttendance(sessionToken: string | null, enabled: boolean) {
  const current = useQuery(api.domains.workforce.attendance.myAttendance, sessionToken && enabled ? { sessionToken } : "skip")
  return {
    current,
    clockIn: useMutation(api.domains.workforce.attendance.clockIn),
    clockOut: useMutation(api.domains.workforce.attendance.clockOut),
  }
}
