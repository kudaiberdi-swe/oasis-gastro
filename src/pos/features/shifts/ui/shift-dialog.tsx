import { useRef, useState } from "react"
import { ArrowDownToLine, ArrowUpFromLine, Clock3, FileText, Printer, RotateCcw } from "lucide-react"

import type { PosCashOperationType } from "@/pos/features/retail/data/use-retail-settings"
import type { CurrentShift } from "@/pos/features/shifts/data/use-shifts"
import { cashMovementProblem, cashNeedsManager, toCashMovement, typesFor, type CashDirection, type CashMovementInput } from "@/pos/features/shifts/model/cash-operations"
import { ShiftHistoryPanel } from "@/pos/features/shifts/ui/shift-history"
import {
  Banner,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Money,
  MoneyInput,
  SegmentedControl,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatTenge } from "@/shared/lib/utils"

/** Mirrors convex/lib/policy.ts VARIANCE_APPROVAL_KZT until closePreview answers. */
const DEFAULT_VARIANCE_THRESHOLD = 1000

export function OpenShiftDialog({
  open,
  onOpenShift,
  lastClosed,
  onPrintZ,
}: {
  open: boolean
  onOpenShift: (openingCash: number, note: string) => Promise<unknown>
  /** The shift this terminal just closed: its Z-report can still be printed from here. */
  lastClosed?: { shiftId: string; shiftNumber: number; zReportNumber: string } | null
  onPrintZ?: (shiftId: string) => Promise<unknown>
}) {
  const [openingCash, setOpeningCash] = useState<number | null>(0)
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      await onOpenShift(Math.max(0, Math.round(openingCash ?? 0)), note)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось открыть смену"))
    } finally {
      setSubmitting(false)
    }
  }

  async function printZ() {
    if (!lastClosed || !onPrintZ) return
    setPrinting(true)
    setError(null)
    try {
      await onPrintZ(lastClosed.shiftId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось напечатать Z-отчёт"))
    } finally {
      setPrinting(false)
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent hideClose className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Открытие смены</DialogTitle>
          <DialogDescription>Пересчитайте наличность в денежном ящике до первой продажи.</DialogDescription>
        </DialogHeader>
        {lastClosed && (
          <Banner
            tone="info"
            title={`Смена №${lastClosed.shiftNumber} закрыта`}
            action={
              onPrintZ ? (
                <Button variant="secondary" size="sm" onClick={printZ} disabled={printing}>
                  <Printer /> {printing ? "Печать…" : "Z-отчёт"}
                </Button>
              ) : undefined
            }
          >
            {lastClosed.zReportNumber}
          </Banner>
        )}
        <Field label="Наличность в кассе на начало смены">
          {(control) => <MoneyInput {...control} value={openingCash} onValueChange={setOpeningCash} className="h-[var(--control-h-pos)] text-body font-semibold" />}
        </Field>
        <Field label="Комментарий">
          {(control) => <Input {...control} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Например, пересчитано кассиром" className="h-[var(--control-h-pos)]" />}
        </Field>
        {error && (
          <p role="alert" className="text-body-sm font-semibold text-destructive">
            {error}
          </p>
        )}
        <Button size="lg" onClick={submit} disabled={submitting}>
          {submitting ? "Открытие…" : "Открыть смену"}
        </Button>
      </DialogContent>
    </Dialog>
  )
}

export type ShiftTab = "summary" | "cash" | "close" | "history"

export type CloseResult = { shiftId: string; zReportId: string; zReportNumber: string }

/**
 * «Кассовая смена №N» (W1-POS-19): current summary with the X-report, cash in / out by operation
 * type, the blind close with a Z-report, and the terminal's shift history with Z printing.
 */
export function ShiftDialog({
  open,
  onOpenChange,
  tab,
  onTabChange,
  sessionToken,
  shift,
  restaurantName,
  closePreview,
  cashOperationTypes,
  onCashMovement,
  onCloseShift,
  onPrintX,
  onPrintZ,
  onOpenOrderHistory,
  onManagerRequired,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tab: ShiftTab
  onTabChange: (tab: ShiftTab) => void
  sessionToken: string
  shift: CurrentShift
  restaurantName: string
  closePreview: { expectedCash: number; blockers: Array<{ number: number; tableLabel?: string }>; managerThreshold: number } | null | undefined
  cashOperationTypes: PosCashOperationType[]
  onCashMovement: (input: CashMovementInput & { idempotencyKey: string; managerApprovalToken?: string }) => Promise<unknown>
  onCloseShift: (countedCash: number, note: string, managerApprovalToken?: string) => Promise<unknown>
  onPrintX: () => Promise<unknown>
  onPrintZ: (shiftId: string) => Promise<unknown>
  onOpenOrderHistory: () => void
  onManagerRequired: (reason: string) => Promise<string | null>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-4">
        <DialogHeader>
          <DialogTitle>Кассовая смена №{shift.number}</DialogTitle>
          <DialogDescription>
            Открыта {formatAlmatyDateTime(shift.openedAt)} · {shift.openedByName} · {restaurantName}
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(value) => onTabChange(value as ShiftTab)}>
          <TabsList aria-label="Разделы смены">
            <TabsTrigger value="summary">Текущая смена</TabsTrigger>
            <TabsTrigger value="cash">Внести / изъять</TabsTrigger>
            <TabsTrigger value="close">Закрыть смену</TabsTrigger>
            <TabsTrigger value="history">История смен</TabsTrigger>
          </TabsList>
          <TabsContent value="summary">
            <ShiftSummary shift={shift} onPrintX={onPrintX} onHistory={() => onTabChange("history")} />
          </TabsContent>
          <TabsContent value="cash">
            <CashMovementForm types={cashOperationTypes} expectedCash={shift.summary.expectedCash} onSubmit={onCashMovement} onManagerRequired={onManagerRequired} onDone={() => onTabChange("summary")} />
          </TabsContent>
          <TabsContent value="close">
            <CloseShiftPanel
              expectedCash={closePreview?.expectedCash ?? shift.summary.expectedCash}
              blockers={closePreview?.blockers ?? []}
              managerThreshold={closePreview?.managerThreshold ?? DEFAULT_VARIANCE_THRESHOLD}
              onClose={onCloseShift}
              onManagerRequired={onManagerRequired}
              onOpenOrderHistory={onOpenOrderHistory}
            />
          </TabsContent>
          <TabsContent value="history">
            <ShiftHistoryPanel sessionToken={sessionToken} onPrintX={onPrintX} onPrintZ={onPrintZ} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-border bg-card p-4">
      <p className="text-body-sm text-muted-foreground">{label}</p>
      <Money value={value} size="lg" className="text-foreground" />
    </div>
  )
}

function SummaryLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-control bg-muted px-3 py-2 text-body-sm">
      <span>{label}</span>
      <span className="font-semibold tabular-nums">{formatTenge(value)}</span>
    </div>
  )
}

function ShiftSummary({ shift, onPrintX, onHistory }: { shift: CurrentShift; onPrintX: () => Promise<unknown>; onHistory: () => void }) {
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const summary = shift.summary

  async function printX() {
    setPrinting(true)
    setError(null)
    try {
      await onPrintX()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сформировать X-отчёт"))
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {shift.openedOver24h && <Banner tone="warning" title="Смена открыта более 24 часов">Завершите расчёты, закройте смену и снимите Z-отчёт.</Banner>}
      <div className="grid grid-cols-3 gap-3">
        <Metric label="Выручка" value={summary.netSales} />
        <Metric label="Наличные" value={summary.cashSales - summary.cashRefunds} />
        <Metric label="Ожидается в кассе" value={summary.expectedCash} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SummaryLine label="Карта" value={summary.card} />
        <SummaryLine label="QR" value={summary.qr} />
        <SummaryLine label="Внесения" value={summary.cashIn} />
        <SummaryLine label="Изъятия" value={summary.cashOut} />
      </div>
      <div className="rounded-card border border-border bg-muted/40 p-3 text-body-sm">
        <p className="font-semibold">X-отчёт не закрывает смену и не обнуляет итоги.</p>
        <p className="text-muted-foreground">Кассиру печать X-отчёта подтверждает менеджер разовым PIN.</p>
      </div>
      {error && (
        <p role="alert" className="text-body-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" size="lg" onClick={printX} disabled={printing}>
          <Printer /> {printing ? "Формирование…" : "Печать X-отчёта"}
        </Button>
        <Button variant="secondary" size="lg" onClick={onHistory}>
          <Clock3 /> История смен
        </Button>
      </div>
    </div>
  )
}

export function CashMovementForm({
  types,
  expectedCash,
  onSubmit,
  onManagerRequired,
  onDone,
}: {
  types: PosCashOperationType[]
  expectedCash?: number
  onSubmit: (input: CashMovementInput & { idempotencyKey: string; managerApprovalToken?: string }) => Promise<unknown>
  onManagerRequired: (reason: string) => Promise<string | null>
  onDone: () => void
}) {
  const legacy = types.length === 0
  const [direction, setDirection] = useState<CashDirection>("cash-in")
  const available = typesFor(types, direction)
  const [typeId, setTypeId] = useState<string | undefined>(available.length === 1 ? available[0].externalId : undefined)
  const [amount, setAmount] = useState<number | null>(null)
  const [comment, setComment] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const idempotencyKey = useRef(crypto.randomUUID())
  const type = available.find((candidate) => candidate.externalId === typeId)
  const problem = cashMovementProblem({ legacy, type, amount, comment, expectedCash, direction })
  const needsManager = cashNeedsManager(direction, type)

  function chooseDirection(next: CashDirection) {
    setDirection(next)
    const nextTypes = typesFor(types, next)
    setTypeId(nextTypes.length === 1 ? nextTypes[0].externalId : undefined)
    setError(null)
  }

  async function submit() {
    if (problem || !amount || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      let managerApprovalToken: string | undefined
      if (needsManager) {
        const what = direction === "cash-out" ? "Изъятие" : "Внесение"
        const token = await onManagerRequired(`${what} ${formatTenge(amount)}${type ? ` (${type.name})` : ""} требует подтверждения менеджера`)
        if (!token) return
        managerApprovalToken = token
      }
      await onSubmit({ ...toCashMovement({ legacy, type, direction, amount, comment }), idempotencyKey: idempotencyKey.current, managerApprovalToken })
      idempotencyKey.current = crypto.randomUUID()
      setAmount(null)
      setComment("")
      onDone()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить операцию"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        aria-label="Направление"
        size="pos"
        className="grid w-full grid-cols-2"
        value={direction}
        onValueChange={chooseDirection}
        options={[
          { value: "cash-in", label: "Внести наличные", icon: <ArrowDownToLine aria-hidden /> },
          { value: "cash-out", label: "Изъять наличные", icon: <ArrowUpFromLine aria-hidden /> },
        ]}
      />
      {!legacy &&
        (available.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">
            Для {direction === "cash-in" ? "внесения" : "изъятия"} не опубликованы типы операций. Добавьте их в Office → «Кассовые операции».
          </p>
        ) : (
          <Field label="Тип операции" hint={type ? [`лимит ${formatTenge(type.data.maximumAmount)}`, needsManager && "подтверждает менеджер"].filter(Boolean).join(" · ") : undefined}>
            {(control) => (
              <Select
                {...control}
                value={typeId}
                onValueChange={(value) => {
                  setTypeId(value)
                  setError(null)
                }}
                placeholder="Выберите тип"
                options={available.map((candidate) => ({ value: candidate.externalId, label: candidate.name }))}
                className="h-[var(--control-h-pos)] text-body"
              />
            )}
          </Field>
        ))}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Сумма">
          {(control) => <MoneyInput {...control} value={amount} onValueChange={(value) => { setAmount(value); setError(null) }} className="h-[var(--control-h-pos)] text-body font-semibold" />}
        </Field>
        <Field label={legacy ? "Причина" : "Комментарий"}>
          {(control) => <Input {...control} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={direction === "cash-in" ? "Например, размен" : "Например, инкассация"} className="h-[var(--control-h-pos)] text-body" />}
        </Field>
      </div>
      {needsManager && (
        <p className="text-body-sm text-muted-foreground">
          {direction === "cash-out" ? "Каждое изъятие" : "Это внесение"} подтверждает менеджер: после «Сохранить операцию» он вводит свой PIN.
        </p>
      )}
      {error ? (
        <p role="alert" className="text-body-sm font-semibold text-destructive">
          {error}
        </p>
      ) : amount && problem ? (
        <p className="text-body-sm text-muted-foreground">{problem}</p>
      ) : null}
      <Button size="lg" onClick={submit} disabled={Boolean(problem) || submitting}>
        {submitting ? "Сохранение…" : "Сохранить операцию"}
      </Button>
    </div>
  )
}

export function CloseShiftPanel({
  expectedCash,
  blockers,
  managerThreshold = DEFAULT_VARIANCE_THRESHOLD,
  onClose,
  onManagerRequired,
  onOpenOrderHistory,
}: {
  expectedCash: number
  blockers: Array<{ number: number; tableLabel?: string }>
  managerThreshold?: number
  onClose: (countedCash: number, note: string, managerApprovalToken?: string) => Promise<unknown>
  onManagerRequired: (reason: string) => Promise<string | null>
  onOpenOrderHistory?: () => void
}) {
  // Blind count (POS-DESIGN §6.2, S-12): step «count» shows neither the expected cash nor the variance;
  // «Сверить» fixes the count and reveals them («review»); «Пересчитать» is the only way back and clears
  // it. The irreversible close asks once more («confirm»).
  const [step, setStep] = useState<"count" | "review" | "confirm">("count")
  const [counted, setCounted] = useState<number | null>(null)
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const variance = counted === null ? 0 : counted - expectedCash
  const needsManager = counted !== null && Math.abs(variance) >= managerThreshold
  const noteRequired = counted !== null && variance !== 0

  function reconcile() {
    if (counted === null) {
      setError("Введите фактическую наличность")
      return
    }
    setError(null)
    setStep("review")
  }

  function recount() {
    setCounted(null)
    setNote("")
    setError(null)
    setStep("count")
  }

  function askConfirm() {
    if (blockers.length) {
      setError("Закройте или отложите все открытые заказы")
      return
    }
    if (noteRequired && note.trim().length < 3) {
      setError("При расхождении укажите комментарий")
      return
    }
    setError(null)
    setStep("confirm")
  }

  async function submit() {
    if (counted === null || blockers.length) return
    setSubmitting(true)
    setError(null)
    try {
      let managerApprovalToken: string | undefined
      if (needsManager) {
        const token = await onManagerRequired(`Подтвердите расхождение ${formatTenge(variance, { explicitPlus: true })}`)
        if (!token) return
        managerApprovalToken = token
      }
      await onClose(counted, note, managerApprovalToken)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось закрыть смену"))
      setStep("review")
    } finally {
      setSubmitting(false)
    }
  }

  const blockersBanner = blockers.length > 0 && (
    <Banner
      tone="danger"
      title={`Открытых заказов: ${blockers.length}`}
      action={
        onOpenOrderHistory ? (
          <Button variant="link" onClick={onOpenOrderHistory}>
            Открыть историю
          </Button>
        ) : undefined
      }
    >
      {blockers.map((blocker) => blocker.tableLabel || `№${blocker.number}`).join(", ")}
    </Banner>
  )
  const errorLine = error && (
    <p role="alert" className="text-body-sm font-semibold text-destructive">
      {error}
    </p>
  )

  if (step === "count") {
    return (
      <div className="flex flex-col gap-4">
        <Banner tone="info" title="Пересчитайте наличные в ящике">
          Введите сумму, которую насчитали. Ожидаемая сумма появится после сверки. Открытые и отложенные заказы блокируют закрытие.
        </Banner>
        <Field id="close-shift-counted" label="Фактическая наличность">
          {(control) => <MoneyInput {...control} value={counted} onValueChange={setCounted} className="h-[var(--control-h-pos)] text-body font-semibold" />}
        </Field>
        {blockersBanner}
        {errorLine}
        <Button size="lg" onClick={reconcile} disabled={counted === null}>
          Сверить
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1 rounded-card border border-border bg-card p-4">
          <dt className="text-body-sm text-muted-foreground">Насчитано</dt>
          <dd>
            <Money value={counted ?? 0} size="lg" className="text-foreground" />
          </dd>
        </div>
        <div className="flex flex-col gap-1 rounded-card border border-border bg-card p-4">
          <dt className="text-body-sm text-muted-foreground">Ожидается в кассе</dt>
          <dd>
            <Money value={expectedCash} size="lg" className="text-foreground" />
          </dd>
        </div>
        <div className="flex flex-col gap-1 rounded-card border border-border bg-card p-4">
          <dt className="text-body-sm text-muted-foreground">Расхождение</dt>
          <dd>
            <Money value={variance} size="lg" signed />
          </dd>
        </div>
      </dl>
      {needsManager && (
        <p className="text-body-sm font-semibold text-warning">
          Расхождение {formatTenge(managerThreshold)} и больше: закрытие подтверждает менеджер своим PIN.
        </p>
      )}
      {blockersBanner}
      <Field id="close-shift-note" label={noteRequired ? "Комментарий (обязательно при расхождении)" : "Комментарий"}>
        {(control) => <Input {...control} value={note} onChange={(event) => setNote(event.target.value)} disabled={step === "confirm"} className="h-[var(--control-h-pos)]" />}
      </Field>
      {errorLine}
      {step === "confirm" ? (
        <div role="group" aria-label="Подтверждение закрытия" className="flex flex-col gap-3 rounded-card border border-input bg-muted p-4">
          <p className="text-body font-semibold">Закрыть смену и напечатать Z-отчёт? Действие необратимо.</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" className="flex-1" onClick={() => setStep("review")} disabled={submitting}>
              Отмена
            </Button>
            <Button size="lg" className="flex-1" onClick={submit} disabled={submitting}>
              <FileText /> {submitting ? "Закрытие…" : "Закрыть смену"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button variant="secondary" size="lg" className="flex-1" onClick={recount}>
            <RotateCcw /> Пересчитать
          </Button>
          <Button size="lg" className="flex-[1.6]" onClick={askConfirm} disabled={blockers.length > 0}>
            <FileText /> Закрыть смену и Z-отчёт
          </Button>
        </div>
      )}
    </div>
  )
}
