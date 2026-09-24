import { useState } from "react"

import type { Id } from "../../../../../convex/_generated/dataModel"
import { AppHeader } from "@/pos/components/app-header"
import { CatalogPanel } from "@/pos/features/catalog/ui/catalog-panel"
import { PaymentDialog, type CheckoutPayment } from "@/pos/features/checkout/ui/payment-dialog"
import { useKitchenBoard } from "@/kitchen/features/board/data/use-kitchen-board"
import { KitchenBoard } from "@/kitchen/features/board/ui/kitchen-board"
import { useCheck, useOpenChecks, useOrderMutations } from "@/pos/features/order-taking/data/use-orders"
import { DiscountDialog } from "@/pos/features/order-taking/ui/discount-dialog"
import { OpenChecksList } from "@/pos/features/order-taking/ui/open-checks-list"
import { useOrderDraft } from "@/pos/features/order-taking/model/use-order-draft"
import { OrderPanel, type OrderTypeOption } from "@/pos/components/order-panel"
import { VoidLineDialog } from "@/pos/features/order-taking/ui/void-line-dialog"
import { useRetailSettings, type PosOrderType } from "@/pos/features/retail/data/use-retail-settings"
import { useLoyaltyMutations, useOrderGuest } from "@/pos/features/loyalty/data/use-loyalty"
import { GuestDialog } from "@/pos/features/loyalty/ui/guest-dialog"
import { useTerminalOptions } from "@/pos/features/session/data/use-terminal-options"
import { LoginScreen } from "@/pos/features/session/ui/login-screen"
import { useManagerApproval } from "@/pos/features/session/ui/manager-approval-dialog"
import { usePosSession } from "@/pos/features/session/model/use-pos-session"
import { TerminalPicker } from "@/pos/features/session/ui/terminal-picker"
import { CloseShiftDialog, OpenShiftDialog } from "@/pos/features/shifts/ui/shift-dialog"
import { useClosePreview, useCurrentShift, useShiftMutations } from "@/pos/features/shifts/data/use-shifts"
import { Button } from "@/shared/components/ui/button"
import { errorMessage } from "@/shared/lib/error-message"
import type { OrderType } from "@/shared/types/pos"

// Cashier touch targets (POS-DESIGN §5): the action row uses the POS control height.
const TOOLBAR_BUTTON = "h-[var(--control-h-pos)]"

const LEGACY_ORDER_TYPES: OrderTypeOption[] = [
  { value: "dine-in", label: "В зале", mode: "dine-in" },
  { value: "takeaway", label: "С собой", mode: "takeaway" },
  { value: "delivery", label: "Доставка", mode: "delivery" },
]

/** The order-type switch: published order types, or the three legacy modes while the list is empty. */
export function orderTypeOptions(orderTypes: PosOrderType[]): OrderTypeOption[] {
  return orderTypes.length ? orderTypes.map((type) => ({ value: type.externalId, label: type.name, mode: type.data.serviceMode })) : LEGACY_ORDER_TYPES
}

export function PosWorkspace() {
  const session = usePosSession()
  const terminalOptions = useTerminalOptions()

  if (!session.terminalExternalId) {
    return <TerminalPicker options={terminalOptions} onChoose={session.chooseTerminal} />
  }

  const branch = terminalOptions?.find((option) => option.terminals.some((terminal) => terminal.externalId === session.terminalExternalId))
  const terminal = branch?.terminals.find((candidate) => candidate.externalId === session.terminalExternalId)
  // A remembered terminal that was disabled or removed: pick again instead of failing at login.
  if (terminalOptions && !terminal && !session.access) {
    return <TerminalPicker options={terminalOptions} onChoose={session.chooseTerminal} staleTerminal={session.terminalExternalId} />
  }

  if (!session.access) {
    return (
      <LoginScreen
        onLogin={session.signIn}
        locked={session.locked}
        terminalLabel={branch && terminal ? terminalLabel(branch.restaurantName, terminal.name) : undefined}
        onChangeTerminal={() => session.chooseTerminal(null)}
      />
    )
  }

  return <AuthenticatedPos sessionToken={session.access.sessionToken} access={session.access} onLock={session.lock} terminalExternalId={session.terminalExternalId} />
}

/** «Sandyq · <филиал> · <касса>» without repeating the brand or branch already in the names. */
export function terminalLabel(restaurantName: string, terminalName: string) {
  const branch = restaurantName.startsWith("Sandyq") ? restaurantName : `Sandyq · ${restaurantName}`
  const terminal = terminalName.startsWith(restaurantName) ? terminalName.slice(restaurantName.length).replace(/^\s*[·—-]\s*/, "") : terminalName
  return terminal ? `${branch} · ${terminal}` : branch
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
  const retail = useRetailSettings(sessionToken)
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
  const [voidingLineId, setVoidingLineId] = useState<string | null>(null)
  const [sendingToKitchen, setSendingToKitchen] = useState(false)

  const openChecks = useOpenChecks(sessionToken)
  const hydrated = useCheck(sessionToken, selectedOrderId)
  const closePreview = useClosePreview(sessionToken, closeShiftOpen)
  const kitchenTickets = useKitchenBoard(sessionToken)

  const draft = useOrderDraft({
    sessionToken,
    terminalExternalId,
    orderType: "dine-in",
    orderTypes: retail.orderTypes,
    hydrated: hydrated ?? undefined,
    initialOrderId: selectedOrderId,
    initialTableLabel: pendingTableLabel,
    selectionKey: selectionNonce,
  })
  const guest = useOrderGuest(sessionToken, draft.orderId)
  const typeOptions = orderTypeOptions(retail.orderTypes)

  if (shift === undefined) {
    return <div className="flex h-full items-center justify-center text-body-sm text-muted-foreground">Загрузка…</div>
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

  async function handleSendToKitchen() {
    setSendingToKitchen(true)
    try {
      await draft.sendToKitchen()
    } catch {
      // The draft shows the error under the totals.
    } finally {
      setSendingToKitchen(false)
    }
  }

  async function handleCheckoutSubmit(payments: CheckoutPayment[]) {
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
        <Button variant="secondary" size="lg" onClick={() => setShowKitchen(false)}>
          Назад к кассе
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <AppHeader restaurantName={access.restaurant.name} employeeName={access.employee.displayName} shiftNumber={shift.number} onOpenShiftInfo={() => setCloseShiftOpen(true)} onLock={onLock} />
      <div className="flex items-center gap-2">
        <Button variant="secondary" className={TOOLBAR_BUTTON} onClick={() => setShowKitchen(true)}>
          Экран кухни {kitchenTickets.length > 0 && `(${kitchenTickets.length})`}
        </Button>
        <Button variant="ghost" className={TOOLBAR_BUTTON} onClick={() => setCloseShiftOpen(true)}>
          Закрыть смену
        </Button>
        <Button variant="secondary" className={TOOLBAR_BUTTON} onClick={handleXReport} disabled={xReportSubmitting}>
          {xReportSubmitting ? "Формирование…" : "X-отчёт"}
        </Button>
        {xReportError && (
          <span role="alert" className="text-caption font-semibold text-destructive">
            {xReportError}
          </span>
        )}
        <Button variant="secondary" className={TOOLBAR_BUTTON} onClick={() => setGuestOpen(true)} disabled={!draft.orderId}>
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
          orderNumber={draft.orderNumber}
          lines={draft.lines}
          itemCount={draft.itemCount}
          orderTypeOptions={typeOptions}
          orderTypeValue={draft.orderType.externalId ?? draft.orderType.mode}
          onOrderTypeChange={(value) => {
            const option = typeOptions.find((candidate) => candidate.value === value)
            if (option) draft.changeOrderType({ externalId: retail.orderTypes.length ? option.value : undefined, mode: option.mode })
          }}
          subtotal={draft.subtotal}
          discountPercent={draft.discountPercent}
          discountAmount={draft.discountAmount}
          serviceChargePercent={draft.serviceChargePercent}
          serviceChargeAmount={draft.serviceChargeAmount}
          total={draft.total}
          saving={draft.saving}
          error={draft.error}
          canSendToKitchen={draft.hasUnsentLines}
          sendingToKitchen={sendingToKitchen}
          onIncrement={(id) => {
            const line = draft.lines.find((candidate) => candidate.clientLineId === id)
            if (!line) return
            // A sent line is fixed; another portion of it goes to a new line.
            if (line.sentToKitchenAt)
              draft.addItem({ productId: line.productId, name: line.name, nameKk: line.nameKk, price: line.unitPrice, sizeExternalId: line.sizeExternalId, sizeLabel: line.sizeLabel, modifierSelections: line.modifierSelections, modifierLabels: line.modifierLabels })
            else draft.setQuantity(id, line.quantity + 1)
          }}
          onDecrement={(id) => draft.setQuantity(id, (draft.lines.find((l) => l.clientLineId === id)?.quantity ?? 0) - 1)}
          onRemove={(id) => draft.setQuantity(id, 0)}
          onVoid={setVoidingLineId}
          onSendToKitchen={handleSendToKitchen}
          onHold={handleHold}
          onCheckout={() => setPaymentOpen(true)}
          onDiscount={() => setDiscountOpen(true)}
        />
      </div>

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        total={draft.total}
        orderNumber={draft.orderNumber}
        itemCount={draft.itemCount}
        paymentTypes={retail.paymentTypes}
        submitting={paymentSubmitting}
        error={paymentError}
        onSubmit={handleCheckoutSubmit}
      />
      <VoidLineDialog
        line={draft.lines.find((line) => line.clientLineId === voidingLineId) ?? null}
        reasons={retail.deletionReasons}
        onOpenChange={(open) => !open && setVoidingLineId(null)}
        onVoid={(input) => draft.voidLine(voidingLineId!, input)}
        onManagerRequired={requestApproval}
      />
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
