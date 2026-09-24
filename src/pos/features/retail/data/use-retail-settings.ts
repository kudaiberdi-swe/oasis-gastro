import { useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { useMemo } from "react"

import { api } from "../../../../../convex/_generated/api"

// Published retail settings of the terminal's restaurant (W1-RTL-01): order types, payment types,
// deletion reasons, cash operation types. Each list is narrowed to its own `data` kind so the UI never reads the wrong fields.

type ActiveSettings = FunctionReturnType<typeof api.domains.retail.queries.activeForPos>
type SettingRow = ActiveSettings["paymentTypes"][number]
type WithData<Kind extends SettingRow["data"]["kind"]> = Omit<SettingRow, "data"> & { data: Extract<SettingRow["data"], { kind: Kind }> }

export type PosPaymentType = WithData<"payment-type">
export type PosOrderType = WithData<"order-type">
export type PosDeletionReason = WithData<"deletion-reason">
export type PosCashOperationType = WithData<"cash-operation-type">

function ofKind<Kind extends SettingRow["data"]["kind"]>(rows: SettingRow[] | undefined, kind: Kind): WithData<Kind>[] {
  return (rows ?? []).filter((row): row is WithData<Kind> => row.data.kind === kind)
}

export type PosRetailSettings = {
  /** False until the query answers; empty lists then mean «not seeded yet» (legacy mode). */
  loaded: boolean
  paymentTypes: PosPaymentType[]
  orderTypes: PosOrderType[]
  deletionReasons: PosDeletionReason[]
  /** Cash in / cash out types (W1-POS-19); empty → the legacy direction + reason form. */
  cashOperationTypes: PosCashOperationType[]
}

export function useRetailSettings(sessionToken: string | null): PosRetailSettings {
  const settings = useQuery(api.domains.retail.queries.activeForPos, sessionToken ? { sessionToken } : "skip")
  return useMemo(
    () => ({
      loaded: settings !== undefined,
      paymentTypes: ofKind(settings?.paymentTypes, "payment-type"),
      orderTypes: ofKind(settings?.orderTypes, "order-type"),
      deletionReasons: ofKind(settings?.deletionReasons, "deletion-reason"),
      cashOperationTypes: ofKind(settings?.cashOperationTypes, "cash-operation-type"),
    }),
    [settings],
  )
}
