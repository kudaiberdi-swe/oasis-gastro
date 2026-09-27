import { useState, type ReactNode } from "react"

import { useCan } from "@/office/components/can"
import { Banner, Button, Combobox, Field, Skeleton, StatusPill, Textarea, TonePill, useToast } from "@/shared/components/ui"
import { formatAmount, formatTenge } from "@/shared/lib/format"
import { errorMessage } from "@/shared/lib/error-message"

import { useBankStatementMutations, useMatchCandidates, type MatchCandidate } from "../data/use-bank-statements"
import type { FinanceRecord, FinanceReferences } from "../data/use-finance-records"
import { bankLineOf, bankName, groupIban, MATCH_STATUS_LABELS, MATCH_STATUS_TONES } from "../model/bank-lines"
import { categoriesForRestaurant, formatBusinessDate } from "../model/modules"
import { FormSection, RecordAudit } from "./record-parts"
import { counterpartyName, ReadOnlyRows, RecordEditorPanel, useRecordEditor } from "./record-editor"

const MODULE = "bank-statements"

interface LineDraft {
  counterpartyExternalId: string
  cashflowCategoryExternalId: string
  comment: string
}

export interface BankMatchPanelProps {
  record: FinanceRecord
  references: FinanceReferences
  onClose: () => void
  onSaved: (externalId: string) => void
}

/**
 * The card of a bank statement line (W3-FIN-11): what the bank says, what it matches (the suggestion of
 * «Сопоставить автоматически» or any candidate of the counterparty) and «Провести» — a matched payment is
 * reconciled; otherwise the line becomes a bank payment (a counterparty and a cashflow category needed).
 */
export function BankMatchPanel({ record, references, onClose, onSaved }: BankMatchPanelProps) {
  const line = bankLineOf(record)
  const editor = useRecordEditor<LineDraft>({
    moduleId: MODULE,
    lifecycle: "document",
    record,
    baseline: { counterpartyExternalId: record.counterpartyExternalId ?? "", cashflowCategoryExternalId: record.cashflowCategoryExternalId ?? "", comment: line.comment },
    validate: () => ({}),
    toArgs: (draft) => ({
      moduleId: MODULE,
      externalId: record.externalId,
      expectedVersion: record.version,
      name: record.name,
      restaurantExternalId: record.restaurantExternalId,
      businessDate: record.businessDate,
      amount: record.amount,
      ...(draft.counterpartyExternalId ? { counterpartyExternalId: draft.counterpartyExternalId } : {}),
      ...(draft.cashflowCategoryExternalId ? { cashflowCategoryExternalId: draft.cashflowCategoryExternalId } : {}),
      data: { comment: draft.comment.trim() },
    }),
    onSaved,
  })
  const { draft, set, editable } = editor
  const matchedPayment = Boolean(line.matchedPaymentExternalId)
  const categoryOptions = categoriesForRestaurant(references.cashflowCategories, references.restaurants, record.restaurantExternalId, record.cashflowCategoryExternalId)
    .filter((row) => !row.direction || row.direction === "both" || row.direction === line.direction)
    .map((row) => ({ value: row.externalId, label: row.name }))
  const categoryName = references.cashflowCategories.find((row) => row.externalId === draft.cashflowCategoryExternalId)?.name ?? "—"

  const bankRows: [string, ReactNode][] = [
    ["Дата", formatBusinessDate(record.businessDate)],
    ["Банк", bankName(line.bank)],
    ["Счёт", groupIban(line.accountIban) || "—"],
    ["Направление", line.direction === "incoming" ? "Приход" : "Расход"],
    ["Сумма", <span className="font-semibold">{formatTenge(record.amount)}</span>],
    ["Номер документа", line.documentNumber || "—"],
    ["Контрагент", line.counterparty || "—"],
    ["БИН / ИИН", line.bin || "—"],
    ["Назначение", line.purpose || "—"],
  ]

  return (
    <RecordEditorPanel editor={editor} title={`Строка выписки ${record.number}`} formLabel="Строка выписки" onClose={onClose}>
      <FormSection title="Данные банка">
        <ReadOnlyRows rows={bankRows} />
      </FormSection>
      <FormSection title="Сопоставление">
        <MatchSection record={record} dirty={editor.dirty} />
      </FormSection>
      <FormSection title="Проведение">
        {editable ? (
          <>
            <p className="text-caption text-muted-foreground">
              {matchedPayment ? "Строка сопоставлена с платежом: при проведении он будет отмечен как оплаченный по банку." : "Без сопоставленного платежа строка при проведении станет платежом по банку — по сопоставленному обязательству или авансом контрагенту."}
            </p>
            {line.matchStatus !== "matched" ? (
              <Field label="Контрагент" hint={record.counterpartyExternalId ? undefined : line.bin ? `Контрагент с БИН ${line.bin} не найден — выберите или добавьте его в «Контрагенты»` : "В строке нет БИН — выберите контрагента"}>
                {(control) => (
                  <Combobox
                    {...control}
                    value={draft.counterpartyExternalId || undefined}
                    onValueChange={(counterpartyExternalId) => set({ counterpartyExternalId })}
                    options={references.counterparties.map((row) => ({ value: row.externalId, label: row.name }))}
                    placeholder="Не выбран"
                    searchPlaceholder="Название контрагента"
                  />
                )}
              </Field>
            ) : (
              <ReadOnlyRows rows={[["Контрагент", counterpartyName(references.counterparties, record.counterpartyExternalId)]]} />
            )}
            {!matchedPayment ? (
              <Field label="Статья ДДС" hint={categoryOptions.length ? "Статья нового платежа" : "Нет активных статей этого направления — добавьте в «Статьи ДДС»"}>
                {(control) => <Combobox {...control} value={draft.cashflowCategoryExternalId || undefined} onValueChange={(cashflowCategoryExternalId) => set({ cashflowCategoryExternalId })} options={categoryOptions} placeholder="Выберите статью" searchPlaceholder="Название статьи" />}
              </Field>
            ) : null}
            <Field label="Комментарий">{(control) => <Textarea {...control} value={draft.comment} onChange={(event) => set({ comment: event.target.value })} />}</Field>
          </>
        ) : (
          <ReadOnlyRows
            rows={[
              ["Контрагент", counterpartyName(references.counterparties, record.counterpartyExternalId)],
              ["Статья ДДС", categoryName],
              ["Платёж", line.matchedNumber || "—"],
              ["Комментарий", line.comment || "—"],
            ]}
          />
        )}
      </FormSection>
      <RecordAudit record={record}>{editor.cancelAction}</RecordAudit>
    </RecordEditorPanel>
  )
}

const KIND_LABELS: Record<MatchCandidate["kind"], string> = { payment: "Платёж", obligation: "Обязательство" }

/** Status of the match, the suggestion to confirm, the candidates to pick and «Снять сопоставление». */
function MatchSection({ record, dirty }: { record: FinanceRecord; dirty: boolean }) {
  const canEdit = useCan(`office.${MODULE}.edit`)
  const line = bankLineOf(record)
  const draft = record.status === "draft"
  const candidates = useMatchCandidates(draft ? record.externalId : null)
  const { confirmMatch, unmatch } = useBankStatementMutations()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const actionable = canEdit && draft && !dirty

  async function run(key: string, action: () => Promise<unknown>, done: string) {
    setBusy(key)
    setError(null)
    try {
      await action()
      toast(done, "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось изменить сопоставление"))
    } finally {
      setBusy(null)
    }
  }
  const pick = (candidate: { externalId: string; number: string }) => run(candidate.externalId, () => confirmMatch({ lineExternalId: record.externalId, targetExternalId: candidate.externalId }), `Сопоставлено с ${candidate.number}`)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <TonePill tone={MATCH_STATUS_TONES[line.matchStatus]}>{MATCH_STATUS_LABELS[line.matchStatus]}</TonePill>
        {line.matchedNumber ? <span className="text-body-sm font-semibold">{line.matchedNumber}</span> : null}
        {record.status !== "draft" ? <StatusPill domain="document" status={record.status} /> : null}
      </div>
      {dirty && draft ? <p className="text-caption text-muted-foreground">Сохраните изменения строки, чтобы менять сопоставление.</p> : null}
      {line.matchStatus === "suggested" && line.suggestedExternalId ? (
        <Banner
          tone="info"
          title={`Предложено: ${line.suggestedKind === "payment" ? "платёж" : "обязательство"} ${line.suggestedNumber}`}
          action={
            actionable ? (
              <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void pick({ externalId: line.suggestedExternalId, number: line.suggestedNumber })}>
                Подтвердить
              </Button>
            ) : undefined
          }
        >
          Совпали БИН, сумма и дата (± 3 дня).
        </Banner>
      ) : null}
      {line.matchStatus === "matched" && actionable ? (
        <Button variant="ghost" size="sm" className="self-start" disabled={busy !== null} onClick={() => void run("unmatch", () => unmatch({ lineExternalId: record.externalId }), "Сопоставление снято")}>
          Снять сопоставление
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      ) : null}
      {draft && line.matchStatus !== "matched" ? (
        candidates === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : !candidates.counterparty ? (
          <p className="text-body-sm text-muted-foreground">Контрагент строки не определён — выберите его ниже, и здесь появятся его платежи и обязательства.</p>
        ) : candidates.candidates.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">У «{candidates.counterparty.name}» нет открытых обязательств и платежей по банку в этом направлении.</p>
        ) : (
          <ul aria-label="Кандидаты на сопоставление" className="flex flex-col divide-y divide-border rounded-card border border-border">
            {candidates.candidates.map((candidate) => (
              <li key={candidate.externalId} className="flex items-start justify-between gap-3 p-3">
                <div className="flex min-w-0 flex-col">
                  <span className="text-body-sm font-semibold">
                    {KIND_LABELS[candidate.kind]} {candidate.number}
                  </span>
                  <span className="truncate text-caption text-muted-foreground">{candidate.name}</span>
                  <span className="text-caption text-muted-foreground">
                    {candidate.kind === "obligation" ? "Срок" : "Дата"} {formatBusinessDate(candidate.date)} · {formatAmount(candidate.amount)} ₸
                  </span>
                  {candidate.exact ? (
                    <TonePill tone="success" className="mt-1 self-start">
                      Точное совпадение
                    </TonePill>
                  ) : candidate.amount !== record.amount ? (
                    <span className="text-caption text-muted-foreground">
                      Сумма отличается на {formatTenge(Math.abs(candidate.amount - record.amount))}
                      {candidate.kind === "payment" ? " — платёж другой суммы не сопоставить" : ""}
                    </span>
                  ) : null}
                </div>
                {actionable && !(candidate.kind === "payment" && candidate.amount !== record.amount) ? (
                  <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void pick(candidate)}>
                    Сопоставить
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  )
}
