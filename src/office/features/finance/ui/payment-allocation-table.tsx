import { Link } from "react-router"

import { useCan } from "@/office/components/can"
import { Button, MoneyInput, Skeleton } from "@/shared/components/ui"
import { formatAmount, formatTenge } from "@/shared/lib/format"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { useFinanceRecord } from "../data/use-finance-records"
import type { OpenObligation } from "../data/use-obligations"
import { formatBusinessDate } from "../model/modules"
import { allocatedTotal, autoAllocate, isOverdue, OVER_ALLOCATED, overAllocation, withAllocation, type Allocation } from "../model/settlements"

const linkClass = cn("rounded-control text-accent underline-offset-4 hover:underline", focusRingClass)

export interface PaymentAllocationTableProps {
  /** Open obligations of the payment's counterparty; undefined while loading, null before a counterparty is chosen. */
  obligations: OpenObligation[] | undefined | null
  allocations: Allocation[]
  paymentAmount: number
  editable: boolean
  onChange: (allocations: Allocation[]) => void
  error?: string
}

/**
 * «Распределение» of a payment (W2-FIN-10): which obligations it settles and by how much. Several
 * obligations per payment; the rest of the payment stays an advance on the counterparty's account.
 */
export function PaymentAllocationTable({ obligations, allocations, paymentAmount, editable, onChange, error }: PaymentAllocationTableProps) {
  const known = obligations ?? []
  const amountOf = (externalId: string) => allocations.find((row) => row.obligationExternalId === externalId)?.amount ?? null
  // A draft lists every open obligation; a read-only card only what the payment settles.
  const listed = editable ? known : known.filter((row) => amountOf(row.externalId) !== null)
  const extra = allocations.filter((row) => !known.some((obligation) => obligation.externalId === row.obligationExternalId))
  const allocated = allocatedTotal(allocations)
  // Allocated above the payment is an error to fix, never a negative «Аванс».
  const over = overAllocation(paymentAmount, allocations)
  const advance = Math.max(0, paymentAmount - allocated)
  const shownError = error ?? (editable && over > 0 ? OVER_ALLOCATED : undefined)

  return (
    <div className="flex flex-col gap-3">
      {obligations === null && editable ? (
        <p className="text-body-sm text-muted-foreground">Выберите контрагента — здесь появятся его открытые обязательства.</p>
      ) : obligations === undefined && editable ? (
        <Skeleton className="h-20 w-full" />
      ) : listed.length === 0 && extra.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">{editable ? "Открытых обязательств нет — весь платёж станет авансом." : "Платёж не распределён по обязательствам."}</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-body-sm">
            <caption className="sr-only">Распределение платежа</caption>
            <thead className="bg-muted text-caption text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Обязательство
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">
                  Остаток, ₸
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">
                  К погашению, ₸
                </th>
              </tr>
            </thead>
            <tbody>
              {listed.map((row) => {
                const due = typeof row.dueDate === "string" ? row.dueDate : ""
                const amount = amountOf(row.externalId)
                return (
                  <tr key={row.externalId} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <div className="flex min-w-0 flex-col">
                        <span className="font-semibold">{row.number}</span>
                        <span className="text-caption text-muted-foreground">{[row.name, typeof row.sourceNumber === "string" ? row.sourceNumber : null].filter(Boolean).join(" · ")}</span>
                        {due ? <span className={cn("text-caption", isOverdue(due, row.open) ? "text-destructive" : "text-muted-foreground")}>Срок {formatBusinessDate(due)}</span> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatAmount(row.open)}</td>
                    <td className="w-36 px-3 py-2 text-right tabular-nums">
                      {editable ? (
                        <MoneyInput
                          aria-label={`К погашению по ${row.number}`}
                          aria-invalid={amount !== null && amount > row.open ? true : undefined}
                          value={amount}
                          onValueChange={(value) => onChange(withAllocation(allocations, row.externalId, value))}
                        />
                      ) : (
                        formatAmount(amount ?? 0)
                      )}
                    </td>
                  </tr>
                )
              })}
              {extra.map((row) => (
                <tr key={row.obligationExternalId} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <ObligationName externalId={row.obligationExternalId} />
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                  <td className="w-36 px-3 py-2 text-right tabular-nums">
                    {editable ? (
                      <Button variant="ghost" size="sm" onClick={() => onChange(withAllocation(allocations, row.obligationExternalId, null))}>
                        Убрать {formatAmount(row.amount)}
                      </Button>
                    ) : (
                      formatAmount(row.amount)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shownError ? (
        <p role="alert" className="text-caption text-destructive">
          {shownError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-body-sm tabular-nums">
          <div className="flex gap-1">
            <dt className="text-muted-foreground">Распределено</dt>
            <dd className={cn("font-semibold", over > 0 && "text-destructive")}>{formatTenge(allocated)}</dd>
          </div>
          {over > 0 ? (
            <div className="flex gap-1">
              <dt className="text-muted-foreground">Сверх суммы</dt>
              <dd className="font-semibold text-destructive">{formatTenge(over)}</dd>
            </div>
          ) : (
            <div className="flex gap-1">
              <dt className="text-muted-foreground">Аванс</dt>
              <dd className="font-semibold">{formatTenge(advance)}</dd>
            </div>
          )}
        </dl>
        {editable && known.length > 0 ? (
          <Button variant="secondary" size="sm" disabled={paymentAmount <= 0} onClick={() => onChange(autoAllocate(paymentAmount, known))}>
            Распределить по срокам
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** An obligation no longer open (settled or reversed): its number when the user may see «Задолженность». */
function ObligationName({ externalId }: { externalId: string }) {
  const canView = useCan("office.accounts-payable.view")
  const record = useFinanceRecord("accounts-payable", canView ? externalId : null)
  if (canView && record === undefined) return <Skeleton className="h-4 w-24" />
  if (!record) return <span className="text-muted-foreground">Обязательство закрыто</span>
  return (
    <div className="flex min-w-0 flex-col">
      <Link to={`/office/accounts-payable/${encodeURIComponent(record.externalId)}`} className={cn(linkClass, "font-semibold")}>
        {record.number}
      </Link>
      <span className="text-caption text-muted-foreground">{record.name}</span>
    </div>
  )
}
