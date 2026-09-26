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
import { posErrorMessage, useT } from "@/pos/i18n"
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
  const t = useT()
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
      setError(posErrorMessage(t, caught, t("shift.openFailed")))
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
      setError(posErrorMessage(t, caught, t("shift.zPrintFailed")))
    } finally {
      setPrinting(false)
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent hideClose className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("shift.openTitle")}</DialogTitle>
          <DialogDescription>{t("shift.openDescription")}</DialogDescription>
        </DialogHeader>
        {lastClosed && (
          <Banner
            tone="info"
            title={t("shift.closedBanner", { number: lastClosed.shiftNumber })}
            action={
              onPrintZ ? (
                <Button variant="secondary" size="sm" onClick={printZ} disabled={printing}>
                  <Printer /> {printing ? t("common.printing") : t("shift.zReport")}
                </Button>
              ) : undefined
            }
          >
            {lastClosed.zReportNumber}
          </Banner>
        )}
        <Field label={t("shift.openingCash")}>
          {(control) => <MoneyInput {...control} value={openingCash} onValueChange={setOpeningCash} className="h-[var(--control-h-pos)] text-body font-semibold" />}
        </Field>
        <Field label={t("common.comment")}>
          {(control) => <Input {...control} value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("shift.openNotePlaceholder")} className="h-[var(--control-h-pos)]" />}
        </Field>
        {error && (
          <p role="alert" className="text-body-sm font-semibold text-destructive">
            {error}
          </p>
        )}
        <Button size="lg" onClick={submit} disabled={submitting}>
          {submitting ? t("shift.opening") : t("shift.open")}
        </Button>
      </DialogContent>
    </Dialog>
  )
}

export type ShiftTab = "summary" | "cash" | "close" | "history"

export type CloseResult = { shiftId: string; zReportId: string; zReportNumber: string }

/** shifts.reconcileCount: the expected cash revealed for a counted amount («Сверить»). */
export type Reconciliation = { expectedCash: number; variance: number; managerThreshold: number }

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
  onReconcile,
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
  /** Blockers and the threshold; the expected cash comes only from «Сверить» (onReconcile). */
  closePreview: { blockers: Array<{ number: number; tableLabel?: string }>; managerThreshold: number } | null | undefined
  cashOperationTypes: PosCashOperationType[]
  onCashMovement: (input: CashMovementInput & { idempotencyKey: string; managerApprovalToken?: string }) => Promise<unknown>
  onReconcile: (countedCash: number) => Promise<Reconciliation>
  onCloseShift: (countedCash: number, note: string, managerApprovalToken?: string) => Promise<unknown>
  onPrintX: () => Promise<unknown>
  onPrintZ: (shiftId: string) => Promise<unknown>
  onOpenOrderHistory: () => void
  onManagerRequired: (reason: string) => Promise<string | null>
}) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-4">
        <DialogHeader>
          <DialogTitle>{t("shift.title", { number: shift.number })}</DialogTitle>
          <DialogDescription>
            {t("shift.openedInfo", { time: formatAlmatyDateTime(shift.openedAt, t.intl), name: shift.openedByName, restaurant: restaurantName })}
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(value) => onTabChange(value as ShiftTab)}>
          <TabsList aria-label={t("shift.tabs")}>
            <TabsTrigger value="summary">{t("menu.shift")}</TabsTrigger>
            <TabsTrigger value="cash">{t("shift.tabCash")}</TabsTrigger>
            <TabsTrigger value="close">{t("shift.tabClose")}</TabsTrigger>
            <TabsTrigger value="history">{t("shift.tabHistory")}</TabsTrigger>
          </TabsList>
          <TabsContent value="summary">
            <ShiftSummary shift={shift} onPrintX={onPrintX} onHistory={() => onTabChange("history")} />
          </TabsContent>
          <TabsContent value="cash">
            <CashMovementForm types={cashOperationTypes} expectedCash={shift.summary.expectedCash ?? undefined} onSubmit={onCashMovement} onManagerRequired={onManagerRequired} onDone={() => onTabChange("summary")} />
          </TabsContent>
          <TabsContent value="close">
            <CloseShiftPanel
              blockers={closePreview?.blockers ?? []}
              managerThreshold={closePreview?.managerThreshold ?? DEFAULT_VARIANCE_THRESHOLD}
              onReconcile={onReconcile}
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
  const t = useT()
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const summary = shift.summary

  async function printX() {
    setPrinting(true)
    setError(null)
    try {
      await onPrintX()
    } catch (caught) {
      setError(posErrorMessage(t, caught, t("shift.xFailed")))
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {shift.openedOver24h && <Banner tone="warning" title={t("shift.over24Title")}>{t("shift.over24")}</Banner>}
      {/* Blind count (POS-DESIGN §6.2): a cashier's shift has no cash figures — shifts.current leaves them out. */}
      {summary.expectedCash !== null && summary.netSales !== null && summary.cashSales !== null && summary.cashRefunds !== null ? (
        <div className="grid grid-cols-3 gap-3">
          <Metric label={t("shift.revenue")} value={summary.netSales} />
          <Metric label={t("shift.cash")} value={summary.cashSales - summary.cashRefunds} />
          <Metric label={t("shift.expected")} value={summary.expectedCash} />
        </div>
      ) : (
        <p className="rounded-card border border-border bg-card p-4 text-body-sm text-muted-foreground">
          {t("shift.blind")}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <SummaryLine label={t("payment.methodCard")} value={summary.card} />
        <SummaryLine label={t("payment.methodQr")} value={summary.qr} />
        <SummaryLine label={t("shift.cashIn")} value={summary.cashIn} />
        <SummaryLine label={t("shift.cashOut")} value={summary.cashOut} />
      </div>
      <div className="rounded-card border border-border bg-muted/40 p-3 text-body-sm">
        <p className="font-semibold">{t("shift.xNote")}</p>
        <p className="text-muted-foreground">{t("shift.xManager")}</p>
      </div>
      {error && (
        <p role="alert" className="text-body-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" size="lg" onClick={printX} disabled={printing}>
          <Printer /> {printing ? t("shift.generating") : t("shift.printX")}
        </Button>
        <Button variant="secondary" size="lg" onClick={onHistory}>
          <Clock3 /> {t("shift.tabHistory")}
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
  const t = useT()
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
  const problem = cashMovementProblem({ legacy, type, amount, comment, expectedCash, direction }, t)
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
        const token = await onManagerRequired(t(direction === "cash-out" ? "cash.approvalOut" : "cash.approvalIn", { amount: formatTenge(amount), type: type ? ` (${type.name})` : "" }))
        if (!token) return
        managerApprovalToken = token
      }
      await onSubmit({ ...toCashMovement({ legacy, type, direction, amount, comment }), idempotencyKey: idempotencyKey.current, managerApprovalToken })
      idempotencyKey.current = crypto.randomUUID()
      setAmount(null)
      setComment("")
      onDone()
    } catch (caught) {
      setError(posErrorMessage(t, caught, t("cash.failed")))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        aria-label={t("cash.direction")}
        size="pos"
        className="grid w-full grid-cols-2"
        value={direction}
        onValueChange={chooseDirection}
        options={[
          { value: "cash-in", label: t("cash.in"), icon: <ArrowDownToLine aria-hidden /> },
          { value: "cash-out", label: t("cash.out"), icon: <ArrowUpFromLine aria-hidden /> },
        ]}
      />
      {!legacy &&
        (available.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">
            {direction === "cash-in" ? t("cash.noTypesIn") : t("cash.noTypesOut")}
          </p>
        ) : (
          <Field label={t("cash.type")} hint={type ? [t("cash.limit", { amount: formatTenge(type.data.maximumAmount) }), needsManager && t("void.hintManager")].filter(Boolean).join(" · ") : undefined}>
            {(control) => (
              <Select
                {...control}
                value={typeId}
                onValueChange={(value) => {
                  setTypeId(value)
                  setError(null)
                }}
                placeholder={t("cash.choosePlaceholder")}
                options={available.map((candidate) => ({ value: candidate.externalId, label: candidate.name }))}
                className="h-[var(--control-h-pos)] text-body"
              />
            )}
          </Field>
        ))}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("common.amount")}>
          {(control) => <MoneyInput {...control} value={amount} onValueChange={(value) => { setAmount(value); setError(null) }} className="h-[var(--control-h-pos)] text-body font-semibold" />}
        </Field>
        <Field label={legacy ? t("common.reason") : t("common.comment")}>
          {(control) => <Input {...control} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={direction === "cash-in" ? t("cash.placeholderIn") : t("cash.placeholderOut")} className="h-[var(--control-h-pos)] text-body" />}
        </Field>
      </div>
      {needsManager && (
        <p className="text-body-sm text-muted-foreground">
          {direction === "cash-out" ? t("cash.managerNoteOut") : t("cash.managerNoteIn")}
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
        {submitting ? t("common.saving") : t("cash.save")}
      </Button>
    </div>
  )
}

export function CloseShiftPanel({
  blockers,
  managerThreshold: previewThreshold = DEFAULT_VARIANCE_THRESHOLD,
  onReconcile,
  onClose,
  onManagerRequired,
  onOpenOrderHistory,
}: {
  blockers: Array<{ number: number; tableLabel?: string }>
  managerThreshold?: number
  /** «Сверить»: the server logs the count and only then answers with the expected cash. */
  onReconcile: (countedCash: number) => Promise<Reconciliation>
  onClose: (countedCash: number, note: string, managerApprovalToken?: string) => Promise<unknown>
  onManagerRequired: (reason: string) => Promise<string | null>
  onOpenOrderHistory?: () => void
}) {
  // Blind count (POS-DESIGN §6.2, S-12): step «count» shows neither the expected cash nor the variance —
  // the panel does not even have them. «Сверить» sends the count to shifts.reconcileCount, which logs it
  // and answers with the expected cash («review»); «Пересчитать» is the only way back and clears it. The
  // irreversible close asks once more («confirm»).
  const t = useT()
  const [step, setStep] = useState<"count" | "review" | "confirm">("count")
  const [counted, setCounted] = useState<number | null>(null)
  const [reconciled, setReconciled] = useState<Reconciliation | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const expectedCash = reconciled?.expectedCash ?? 0
  const managerThreshold = reconciled?.managerThreshold ?? previewThreshold
  const variance = counted === null || !reconciled ? 0 : counted - expectedCash
  const needsManager = counted !== null && Math.abs(variance) >= managerThreshold
  const noteRequired = counted !== null && variance !== 0

  async function reconcile() {
    if (counted === null) {
      setError(t("close.enterCounted"))
      return
    }
    setReconciling(true)
    setError(null)
    try {
      setReconciled(await onReconcile(counted))
      setStep("review")
    } catch (caught) {
      setError(posErrorMessage(t, caught, t("close.reconcileFailed")))
    } finally {
      setReconciling(false)
    }
  }

  function recount() {
    setCounted(null)
    setReconciled(null)
    setNote("")
    setError(null)
    setStep("count")
  }

  function askConfirm() {
    if (blockers.length) {
      setError(t("close.openOrders"))
      return
    }
    if (noteRequired && note.trim().length < 3) {
      setError(t("close.noteRequired"))
      return
    }
    setError(null)
    setStep("confirm")
  }

  async function submit() {
    if (counted === null || !reconciled || blockers.length) return
    setSubmitting(true)
    setError(null)
    try {
      let managerApprovalToken: string | undefined
      if (needsManager) {
        const token = await onManagerRequired(t("close.approval", { amount: formatTenge(variance, { explicitPlus: true }) }))
        if (!token) return
        managerApprovalToken = token
      }
      await onClose(counted, note, managerApprovalToken)
    } catch (caught) {
      setError(posErrorMessage(t, caught, t("close.failed")))
      setStep("review")
    } finally {
      setSubmitting(false)
    }
  }

  const blockersBanner = blockers.length > 0 && (
    <Banner
      tone="danger"
      title={t("close.openOrdersCount", { count: blockers.length })}
      action={
        onOpenOrderHistory ? (
          <Button variant="link" onClick={onOpenOrderHistory}>
            {t("close.openHistory")}
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
        <Banner tone="info" title={t("close.countTitle")}>
          {t("close.countHint")}
        </Banner>
        <Field id="close-shift-counted" label={t("close.counted")}>
          {(control) => <MoneyInput {...control} value={counted} onValueChange={setCounted} className="h-[var(--control-h-pos)] text-body font-semibold" />}
        </Field>
        {blockersBanner}
        {errorLine}
        <Button size="lg" onClick={() => void reconcile()} disabled={counted === null || reconciling}>
          {reconciling ? t("close.reconciling") : t("close.reconcile")}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1 rounded-card border border-border bg-card p-4">
          <dt className="text-body-sm text-muted-foreground">{t("close.countedShort")}</dt>
          <dd>
            <Money value={counted ?? 0} size="lg" className="text-foreground" />
          </dd>
        </div>
        <div className="flex flex-col gap-1 rounded-card border border-border bg-card p-4">
          <dt className="text-body-sm text-muted-foreground">{t("shift.expected")}</dt>
          <dd>
            <Money value={expectedCash} size="lg" className="text-foreground" />
          </dd>
        </div>
        <div className="flex flex-col gap-1 rounded-card border border-border bg-card p-4">
          <dt className="text-body-sm text-muted-foreground">{t("close.variance")}</dt>
          <dd>
            <Money value={variance} size="lg" signed />
          </dd>
        </div>
      </dl>
      {needsManager && (
        <p className="text-body-sm font-semibold text-warning">
          {t("close.managerThreshold", { amount: formatTenge(managerThreshold) })}
        </p>
      )}
      {blockersBanner}
      <Field id="close-shift-note" label={noteRequired ? t("close.noteRequiredLabel") : t("common.comment")}>
        {(control) => <Input {...control} value={note} onChange={(event) => setNote(event.target.value)} disabled={step === "confirm"} className="h-[var(--control-h-pos)]" />}
      </Field>
      {errorLine}
      {step === "confirm" ? (
        <div role="group" aria-label={t("close.confirmAria")} className="flex flex-col gap-3 rounded-card border border-input bg-muted p-4">
          <p className="text-body font-semibold">{t("close.confirmText")}</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" className="flex-1" onClick={() => setStep("review")} disabled={submitting}>
              {t("common.cancel")}
            </Button>
            <Button size="lg" className="flex-1" onClick={submit} disabled={submitting}>
              <FileText /> {submitting ? t("close.closing") : t("shift.tabClose")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button variant="secondary" size="lg" className="flex-1" onClick={recount}>
            <RotateCcw /> {t("close.recount")}
          </Button>
          <Button size="lg" className="flex-[1.6]" onClick={askConfirm} disabled={blockers.length > 0}>
            <FileText /> {t("close.closeAndZ")}
          </Button>
        </div>
      )}
    </div>
  )
}
