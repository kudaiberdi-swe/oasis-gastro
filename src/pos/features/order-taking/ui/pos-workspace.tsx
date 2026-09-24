import { useState } from "react"

import type { Id } from "../../../../../convex/_generated/dataModel"
import { AppHeader } from "@/pos/components/app-header"
import { CatalogPanel } from "@/pos/features/catalog/ui/catalog-panel"
import { PaymentDialog } from "@/pos/features/checkout/ui/payment-dialog"
import { useKitchenBoard } from "@/pos/features/kitchen-display/data/use-kitchen"
import { KitchenBoard } from "@/pos/features/kitchen-display/ui/kitchen-board"
import { useCheck, useOpenChecks, useOrderMutations } from "@/pos/features/order-taking/data/use-orders"
import { DiscountDialog } from "@/pos/features/order-taking/ui/discount-dialog"
import { OpenChecksList } from "@/pos/features/order-taking/ui/open-checks-list"
import { useOrderDraft } from "@/pos/features/order-taking/model/use-order-draft"
import { OrderPanel } from "@/pos/components/order-panel"
import { useLoyaltyMutations, useOrderGuest } from "@/pos/features/loyalty/data/use-loyalty"
import { GuestDialog } from "@/pos/features/loyalty/ui/guest-dialog"
import { BranchPicker } from "@/pos/features/session/ui/branch-picker"
import { LoginScreen } from "@/pos/features/session/ui/login-screen"
import { useManagerApproval } from "@/pos/features/session/ui/manager-approval-dialog"
import { usePosSession } from "@/pos/features/session/model/use-pos-session"
import { CloseShiftDialog, OpenShiftDialog } from "@/pos/features/shifts/ui/shift-dialog"
import { useClosePreview, useCurrentShift, useShiftMutations } from "@/pos/features/shifts/data/use-shifts"
import { Button } from "@/shared/components/ui/button"
import { errorMessage } from "@/shared/lib/error-message"

export function PosWorkspace() {
  const session = usePosSession()

  if (!session.terminalExternalId) {
    return <BranchPicker />
  }

  if (!session.access) {
    return <LoginScreen onLogin={session.signIn} />
  }

  return <AuthenticatedPos sessionToken={session.access.sessionToken} access={session.access} onLock={session.lock} terminalExternalId={session.terminalExternalId} />
}

function AuthenticatedPos({
  sessionToken,
  access,
  onLock,
  terminalExternalId,
}: {
  sessionToken: string
  access: NonNullable<ReturnType<typeof usePosSession>["access"]>
  onLock: () => void
  terminalExternalId: string
}) {
  const shift = useCurrentShift(sessionToken)
  const { open: openShift, close: closeShift, createXReport } = useShiftMutations()
  const { hold, checkout } = useOrderMutations()
  const { requestApproval, dialog: managerDialog } = useManagerApproval(terminalExternalId)
  const { attachGuest, detachGuest } = useLoyaltyMutations()

  const [selectedOrderId, setSelectedOrderId] = useState<Id<"orders"> | null>(null)
  const [pendingTableLabel, setPendingTableLabel] = useState("")
  const [selectionNonce, setSelectionNonce] = useState(0)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [paymentSubmitting, setPaymentSubmitting] = useState(false)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [closeShiftOpen, setCloseShiftOpen] = useState(false)
  const [showKitchen, setShowKitchen] = useState(false)
  const [guestOpen, setGuestOpen] = useState(false)
  const [xReportSubmitting, setXReportSubmitting] = useState(false)
  const [xReportError, setXReportError] = useState<string | null>(null)

  const openChecks = useOpenChecks(sessionToken)
  const hydrated = useCheck(sessionToken, selectedOrderId)
  const closePreview = useClosePreview(sessionToken, closeShiftOpen)
  const kitchenTickets = useKitchenBoard(sessionToken)

  const draft = useOrderDraft({
    sessionToken,
    terminalExternalId,
    orderType: "dine-in",
    hydrated: hydrated ?? undefined,
    initialOrderId: selectedOrderId,
    initialTableLabel: pendingTableLabel,
    selectionKey: selectionNonce,
  })
  const guest = useOrderGuest(sessionToken, draft.orderId)

  if (shift === undefined) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Загрузка…</div>
  }

  if (!shift) {
    return <OpenShiftDialog open onOpen={(openingCash, note) => openShift({ sessionToken, openingCash, note })} />
  }

  function selectCheck(orderId: string | null, tableLabel = "") {
    setSelectedOrderId(orderId as Id<"orders"> | null)
    setPendingTableLabel(tableLabel)
    setSelectionNonce((current) => current + 1)
  }

  async function handleHold() {
    if (!draft.orderId) return
    await hold({ sessionToken, orderId: draft.orderId })
    selectCheck(null)
  }

  async function handleXReport() {
    setXReportSubmitting(true)
    setXReportError(null)
    try {
      let managerApprovalToken: string | undefined
      if (access.employee.role === "cashier") {
        const token = await requestApproval("Формирование X-отчёта требует подтверждения менеджера")
        if (!token) return
        managerApprovalToken = token
      }
      await createXReport({ sessionToken, idempotencyKey: crypto.randomUUID(), managerApprovalToken })
    } catch (caught) {
      setXReportError(errorMessage(caught, "Не удалось сформировать отчёт"))
    } finally {
      setXReportSubmitting(false)
    }
  }

  async function handleCheckoutSubmit(payments: Array<{ method: "cash" | "card" | "qr"; amount: number; tendered?: number }>) {
    if (!draft.orderId) return
    setPaymentSubmitting(true)
    setPaymentError(null)
    try {
      await checkout({ sessionToken, orderId: draft.orderId, idempotencyKey: crypto.randomUUID(), payments })
      setPaymentOpen(false)
      selectCheck(null)
    } catch (caught) {
      setPaymentError(errorMessage(caught, "Не удалось провести оплату"))
    } finally {
      setPaymentSubmitting(false)
    }
  }

  if (showKitchen) {
    return (
      <div className="flex h-full flex-col gap-2 p-2">
        <div className="flex items-center justify-between">
          <AppHeader restaurantName={access.restaurant.name} employeeName={access.employee.displayName} shiftNumber={shift.number} onOpenShiftInfo={() => {}} onLock={onLock} />
        </div>
        <div className="min-h-0 flex-1">
          <KitchenBoard sessionToken={sessionToken} />
        </div>
        <Button variant="outline" onClick={() => setShowKitchen(false)}>
          Назад к кассе
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <AppHeader restaurantName={access.restaurant.name} employeeName={access.employee.displayName} shiftNumber={shift.number} onOpenShiftInfo={() => setCloseShiftOpen(true)} onLock={onLock} />
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setShowKitchen(true)}>
          Экран кухни {kitchenTickets.length > 0 && `(${kitchenTickets.length})`}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setCloseShiftOpen(true)}>
          Закрыть смену
        </Button>
        <Button variant="outline" size="sm" onClick={handleXReport} disabled={xReportSubmitting}>
          {xReportSubmitting ? "Формирование…" : "X-отчёт"}
        </Button>
        {xReportError && <span className="text-xs font-semibold text-destructive">{xReportError}</span>}
        <Button variant="outline" size="sm" onClick={() => setGuestOpen(true)} disabled={!draft.orderId}>
          {guest ? `${guest.name || guest.phone} · ${guest.points} б.` : "Гость"}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 gap-3">
        <OpenChecksList
          checks={openChecks.map((c) => ({ orderId: c.orderId, tableLabel: c.tableLabel, status: c.status, total: c.total, itemCount: c.itemCount }))}
          activeOrderId={selectedOrderId}
          onSelect={(orderId) => selectCheck(orderId)}
          onNew={() => {
            const label = window.prompt("Номер стола (необязательно)") ?? ""
            selectCheck(null, label)
          }}
        />
        <CatalogPanel sessionToken={sessionToken} onAddProduct={draft.addItem} />
        <OrderPanel
          tableLabel={draft.tableLabel}
          lines={draft.lines}
          subtotal={draft.subtotal}
          discountPercent={draft.discountPercent}
          discountAmount={draft.discountAmount}
          serviceChargeAmount={draft.serviceChargeAmount}
          total={draft.total}
          saving={draft.saving}
          error={draft.error}
          onIncrement={(id) => draft.setQuantity(id, (draft.lines.find((l) => l.clientLineId === id)?.quantity ?? 0) + 1)}
          onDecrement={(id) => draft.setQuantity(id, (draft.lines.find((l) => l.clientLineId === id)?.quantity ?? 0) - 1)}
          onHold={handleHold}
          onCheckout={() => setPaymentOpen(true)}
          onDiscount={() => setDiscountOpen(true)}
        />
      </div>

      <PaymentDialog open={paymentOpen} onOpenChange={setPaymentOpen} total={draft.total} submitting={paymentSubmitting} error={paymentError} onSubmit={handleCheckoutSubmit} />
      <GuestDialog
        open={guestOpen}
        onOpenChange={setGuestOpen}
        currentGuest={guest}
        sessionToken={sessionToken}
        onAttach={(phone, name) => {
          if (!draft.orderId) return Promise.resolve()
          return attachGuest({ sessionToken, orderId: draft.orderId, phone, name })
        }}
        onDetach={() => {
          if (!draft.orderId) return Promise.resolve()
          return detachGuest({ sessionToken, orderId: draft.orderId })
        }}
      />
      <DiscountDialog
        open={discountOpen}
        onOpenChange={setDiscountOpen}
        currentPercent={draft.discountPercent}
        onApply={(percent, reason, token) => draft.applyDiscount(percent, reason, token)}
        onManagerRequired={requestApproval}
      />
      <CloseShiftDialog
        open={closeShiftOpen}
        onOpenChange={setCloseShiftOpen}
        expectedCash={closePreview?.expectedCash ?? 0}
        blockers={closePreview?.blockers ?? []}
        onClose={async (countedCash, note, managerApprovalToken) => {
          await closeShift({ sessionToken, countedCash, note, managerApprovalToken })
          setCloseShiftOpen(false)
        }}
        onManagerRequired={requestApproval}
      />
      {managerDialog}
    </div>
  )
}
