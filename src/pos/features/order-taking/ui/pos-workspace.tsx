import { useRef, useState } from "react"
import { ChefHat } from "lucide-react"

import type { Id } from "../../../../../convex/_generated/dataModel"
import { AppHeader } from "@/pos/components/app-header"
import { LiveSyncIndicator } from "@/pos/components/live-sync-indicator"
import { CatalogPanel, type CatalogPanelControl } from "@/pos/features/catalog/ui/catalog-panel"
import { useBarcodeLookup } from "@/pos/features/hotkeys/data/use-barcode-lookup"
import { useBarcodeScanner, usePosHotkeys } from "@/pos/features/hotkeys/ui/use-pos-hotkeys"
import { precheckFromDraft } from "@/pos/features/checkout/model/order-receipt"
import { useCheckoutAttempt } from "@/pos/features/checkout/model/use-checkout-attempt"
import { PaymentComplete, paidCheckFrom, type PaidCheck } from "@/pos/features/checkout/ui/payment-complete"
import { PaymentDialog, type CheckoutPayment } from "@/pos/features/checkout/ui/payment-dialog"
import { useKitchenBoard } from "@/kitchen/features/board/data/use-kitchen-board"
import { KitchenBoard } from "@/kitchen/features/board/ui/kitchen-board"
import type { HistoryOrder } from "@/pos/features/history/data/use-order-history"
import { receiptFromOrder } from "@/pos/features/history/model/history-receipt"
import { HistoryDialog } from "@/pos/features/history/ui/history-dialog"
import type { RefundInput } from "@/pos/features/history/ui/refund-panel"
import { useNotifications } from "@/pos/features/notifications/data/use-notifications"
import { NotificationsDialog } from "@/pos/features/notifications/ui/notifications-dialog"
import { useCheck, useFloor, useOpenChecks, useOrderMutations, useSuggestion, useTransferTargets } from "@/pos/features/order-taking/data/use-orders"
import { CancelOrderDialog } from "@/pos/features/order-taking/ui/cancel-dialog"
import { CommentDialog } from "@/pos/features/order-taking/ui/comment-dialog"
import { DiscountDialog } from "@/pos/features/order-taking/ui/discount-dialog"
import { ChecksSwitcher } from "@/pos/features/order-taking/ui/checks-switcher"
import { FloorGrid } from "@/pos/features/order-taking/ui/floor-grid"
import { GuestCountControl } from "@/pos/features/order-taking/ui/guest-count-control"
import { OrderActionsDialog, type ActionBlocks, type OrderAction } from "@/pos/features/order-taking/ui/order-actions-dialog"
import { SplitDialog } from "@/pos/features/order-taking/ui/split-dialog"
import { TransferDialog } from "@/pos/features/order-taking/ui/transfer-dialog"
import { useOrderDraft, type TableSeat } from "@/pos/features/order-taking/model/use-order-draft"
import type { OrderDraftLine } from "@/pos/features/order-taking/model/draft-lines"
import { OrderPanel, type OrderTypeOption } from "@/pos/components/order-panel"
import { VoidLineDialog } from "@/pos/features/order-taking/ui/void-line-dialog"
import { printHtml } from "@/pos/features/print/print-document"
import { usePosPrinter } from "@/pos/features/print/template-print"
import { useRetailSettings, type PosOrderType } from "@/pos/features/retail/data/use-retail-settings"
import { useLoyaltyMutations, useLoyaltyQuote, useOrderGuest } from "@/pos/features/loyalty/data/use-loyalty"
import { GuestDialog } from "@/pos/features/loyalty/ui/guest-dialog"
import { useAttendance } from "@/pos/features/session/data/use-attendance"
import { useTerminalOptions } from "@/pos/features/session/data/use-terminal-options"
import { LoginScreen } from "@/pos/features/session/ui/login-screen"
import { MainMenuDialog } from "@/pos/features/session/ui/main-menu-dialog"
import { useManagerApproval } from "@/pos/features/session/ui/manager-approval-dialog"
import { ProfileDialog, roleLabel } from "@/pos/features/session/ui/profile-dialog"
import { usePosSession } from "@/pos/features/session/model/use-pos-session"
import { TerminalPicker } from "@/pos/features/session/ui/terminal-picker"
import type { CashMovementInput } from "@/pos/features/shifts/model/cash-operations"
import { OpenShiftDialog, ShiftDialog, type ShiftTab } from "@/pos/features/shifts/ui/shift-dialog"
import { useClosePreview, useCurrentShift, useShiftMutations, useZReportLoader } from "@/pos/features/shifts/data/use-shifts"
import { useServerOffline } from "@/pos/model/use-connection"
import { posErrorMessage, ruT, useT, type Translator } from "@/pos/i18n"
import { Button } from "@/shared/components/ui/button"
import { useToast } from "@/shared/components/ui/toast"
import { formatTenge } from "@/shared/lib/format"
import type { OrderType } from "@/shared/types/pos"

// «Касса / Офис» in the header (POS-DESIGN §10): only for roles that also work in the office.
const OFFICE_ROLES = new Set(["manager", "administrator"])

const LEGACY_ORDER_TYPES: OrderType[] = ["dine-in", "takeaway", "delivery"]

/** The order-type switch: published order types (their names are data), or the three legacy modes while the list is empty. */
export function orderTypeOptions(orderTypes: PosOrderType[], t: Translator = ruT): OrderTypeOption[] {
  return orderTypes.length
    ? orderTypes.map((type) => ({ value: type.externalId, label: type.name, mode: type.data.serviceMode }))
    : LEGACY_ORDER_TYPES.map((mode) => ({ value: mode, label: t(`orderType.${mode}`), mode }))
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

  return (
    <AuthenticatedPos
      sessionToken={session.access.sessionToken}
      access={session.access}
      onLock={session.lock}
      onLogout={session.signOut}
      terminalExternalId={session.terminalExternalId}
    />
  )
}

/** «Sandyq · <филиал> · <касса>» without repeating the brand or branch already in the names. */
export function terminalLabel(restaurantName: string, terminalName: string) {
  const branch = restaurantName.startsWith("Sandyq") ? restaurantName : `Sandyq · ${restaurantName}`
  const terminal = terminalName.startsWith(restaurantName) ? terminalName.slice(restaurantName.length).replace(/^\s*[·—-]\s*/, "") : terminalName
  return terminal ? `${branch} · ${terminal}` : branch
}

/** Dialogs of the cashier screen that replace each other (one at a time). */
type PosDialog = "menu" | "profile" | "notifications" | "history" | "shift" | "floor" | Exclude<OrderAction, "void" | "precheck"> | "actions" | null

/** Unavailable order actions with the reason shown on their tile (W1-POS-15). */
export function orderActionBlocks(input: { orderId: string | null; lines: OrderDraftLine[]; transferTargets: unknown[] | undefined }, t: Translator = ruT): ActionBlocks {
  const active = input.lines.filter((line) => !line.voidedAt)
  const saved = active.filter((line) => line.serverLineId)
  const portions = saved.reduce((sum, line) => sum + line.quantity, 0)
  const notSaved = t("blocks.notSaved")
  return {
    ...(!input.orderId && !active.length ? { comment: notSaved } : {}),
    ...(!input.orderId ? { split: notSaved } : portions < 2 ? { split: t("blocks.split") } : {}),
    ...(!input.orderId ? { transfer: notSaved } : input.transferTargets && input.transferTargets.length === 0 ? { transfer: t("blocks.transfer") } : {}),
    ...(!active.length ? { precheck: t("blocks.precheck") } : {}),
    ...(!saved.length ? { void: t("blocks.void") } : {}),
    ...(!input.orderId ? { cancel: t("blocks.cancel") } : {}),
  }
}

function AuthenticatedPos({
  sessionToken,
  access,
  onLock,
  onLogout,
  terminalExternalId,
}: {
  sessionToken: string
  access: NonNullable<ReturnType<typeof usePosSession>["access"]>
  onLock: () => void
  onLogout: () => void
  terminalExternalId: string
}) {
  const t = useT()
  const toast = useToast()
  const shift = useCurrentShift(sessionToken)
  const { open: openShift, close: closeShift, reconcileCount, createXReport, recordCashMovement } = useShiftMutations()
  const { hold, checkout, resume, refund, transfer } = useOrderMutations()
  const retail = useRetailSettings(sessionToken)
  const { requestApproval, dialog: managerDialog } = useManagerApproval(terminalExternalId)
  const { attachGuest, detachGuest, setRedemption } = useLoyaltyMutations()
  const loadZReport = useZReportLoader(sessionToken)
  // Check, pre-check, X and Z by the office's published templates (W3-ADM-10), else the built-in forms.
  const printer = usePosPrinter(sessionToken)

  const [selectedOrderId, setSelectedOrderId] = useState<Id<"orders"> | null>(null)
  const [pendingSeat, setPendingSeat] = useState<TableSeat>({})
  const [selectionNonce, setSelectionNonce] = useState(0)
  const [dialog, setDialog] = useState<PosDialog>(null)
  const [shiftTab, setShiftTab] = useState<ShiftTab>("summary")
  const [paymentOpen, setPaymentOpen] = useState(false)
  // One idempotency key per payment attempt of an order, a 10 s answer timeout, then «Оплачено».
  const payment = useCheckoutAttempt<Awaited<ReturnType<typeof checkout>>>()
  const [paid, setPaid] = useState<(PaidCheck & { print: () => boolean }) | null>(null)
  const offline = useServerOffline()
  const [discountOpen, setDiscountOpen] = useState(false)
  const [showKitchen, setShowKitchen] = useState(false)
  const [guestOpen, setGuestOpen] = useState(false)
  const [voidingLineId, setVoidingLineId] = useState<string | null>(null)
  const [sendingToKitchen, setSendingToKitchen] = useState(false)
  const [lastClosed, setLastClosed] = useState<{ shiftId: string; shiftNumber: number; zReportNumber: string } | null>(null)

  const openChecks = useOpenChecks(sessionToken)
  const hydrated = useCheck(sessionToken, selectedOrderId)
  const closePreview = useClosePreview(sessionToken, dialog === "shift")
  const kitchenTickets = useKitchenBoard(sessionToken)
  const notifications = useNotifications(sessionToken)
  const attendance = useAttendance(sessionToken, dialog === "profile")
  const transferTargets = useTransferTargets(sessionToken, dialog === "actions" || dialog === "transfer")
  const floor = useFloor(sessionToken, dialog === "floor" || dialog === "move-table")

  const draft = useOrderDraft({
    sessionToken,
    terminalExternalId,
    orderType: "dine-in",
    orderTypes: retail.orderTypes,
    hydrated: hydrated ?? undefined,
    initialOrderId: selectedOrderId,
    initialTableLabel: pendingSeat.tableLabel ?? "",
    initialSeat: pendingSeat,
    selectionKey: selectionNonce,
  })
  const guest = useOrderGuest(sessionToken, draft.orderId)
  // Points planned at the POS pay part of the check (W1-POS-16); checkout takes total − planned in money.
  const loyaltyQuote = useLoyaltyQuote(sessionToken, draft.orderId, { enabled: Boolean(guest) })
  const plannedRedemption = guest ? (loyaltyQuote?.planned ?? 0) : 0
  const redemptionStale = loyaltyQuote && plannedRedemption > loyaltyQuote.maxRedemption ? t("pos.redemptionStale") : null
  const suggestion = useSuggestion(sessionToken, draft.orderId)
  const typeOptions = orderTypeOptions(retail.orderTypes, t)
  const place = { restaurantName: access.restaurant.name, terminalName: access.terminal.name }

  // W3-POS-01: F2 search, F4 payment, F8 hold, Esc close; the scanner adds a dish by its barcode. Each
  // key does what its button does and only when the button is enabled (OrderPanel: active lines, not saving).
  const catalogRef = useRef<CatalogPanelControl>(null)
  const findByBarcode = useBarcodeLookup(sessionToken)
  const orderReady = draft.lines.some((line) => !line.voidedAt) && !draft.saving
  usePosHotkeys(
    {
      search: () => {
        if (showKitchen) return false
        catalogRef.current?.focusSearch()
      },
      pay: () => {
        if (showKitchen || !orderReady || offline) return false
        setPaymentOpen(true)
      },
      hold: () => {
        if (showKitchen || !orderReady || !draft.orderId) return false
        void handleHold().catch((caught) => toast(posErrorMessage(t, caught, t("pos.holdFailed")), "error"))
      },
      close: () => {
        if (!showKitchen) return false
        setShowKitchen(false)
      },
    },
    Boolean(shift),
  )
  useBarcodeScanner((code, source) => void handleScan(code, source.fromField), Boolean(shift) && !showKitchen)

  if (shift === undefined) {
    return <div className="flex h-full items-center justify-center text-body-sm text-muted-foreground">{t("common.loadingEllipsis")}</div>
  }

  if (!shift) {
    return (
      <OpenShiftDialog
        open
        lastClosed={lastClosed}
        onOpenShift={async (openingCash, note) => {
          await openShift({ sessionToken, openingCash, note })
          setLastClosed(null)
        }}
        onPrintZ={printZReport}
      />
    )
  }
  const currentShift = shift

  function selectCheck(orderId: string | null, seat: TableSeat = {}) {
    setSelectedOrderId(orderId as Id<"orders"> | null)
    setPendingSeat(seat)
    setSelectionNonce((current) => current + 1)
  }

  function openShiftDialog(tab: ShiftTab = "summary") {
    setShiftTab(tab)
    setDialog("shift")
  }

  async function handleScan(code: string, fromSearch: boolean) {
    if (fromSearch) catalogRef.current?.removeFromSearch(code)
    try {
      const product = await findByBarcode(code)
      if (!product) return toast(t("pos.barcodeNotFound", { code }), "error")
      if (product.available === false) return toast(t("pos.stopList", { name: t.locale === "kk" && product.nameKk?.trim() ? product.nameKk : product.name }), "error")
      catalogRef.current?.addProduct(product)
    } catch (caught) {
      toast(posErrorMessage(t, caught, t("pos.barcodeFailed")), "error")
    }
  }

  async function handleHold() {
    if (!draft.orderId) return
    await draft.settle()
    await hold({ sessionToken, orderId: draft.orderId })
    selectCheck(null)
  }

  /** X-report: a cashier needs a manager PIN (shifts/mutations.ts createXReport). */
  async function printXReport() {
    let managerApprovalToken: string | undefined
    if (access.employee.role === "cashier") {
      const token = await requestApproval(t("pos.xApproval"))
      if (!token) return
      managerApprovalToken = token
    }
    const report = await createXReport({ sessionToken, idempotencyKey: crypto.randomUUID(), managerApprovalToken })
    printHtml(printer.xReport(report))
  }

  async function printZReport(shiftId: string) {
    const report = await loadZReport(shiftId)
    if (!report) throw new Error(t("pos.zNotFound"))
    printHtml(printer.zReport(report, place))
  }

  async function handleCashMovement(input: CashMovementInput & { idempotencyKey: string; managerApprovalToken?: string }) {
    await recordCashMovement({ sessionToken, ...input })
    const direction = input.direction ?? retail.cashOperationTypes.find((type) => type.externalId === input.cashOperationTypeExternalId)?.data.direction
    toast(t(direction === "cash-out" ? "pos.cashOutSaved" : "pos.cashInSaved", { amount: formatTenge(input.amount) }), "success")
  }

  async function handleCloseShift(countedCash: number, note: string, managerApprovalToken?: string) {
    const result = await closeShift({ sessionToken, countedCash, note, managerApprovalToken })
    setLastClosed({ shiftId: result.shiftId, shiftNumber: currentShift.number, zReportNumber: result.zReportNumber })
    setDialog(null)
    selectCheck(null)
    // «Закрыть смену и напечатать Z-отчёт»: the Z prints at once; the opening screen can print it again.
    void printZReport(result.shiftId).catch((caught) => toast(posErrorMessage(t, caught, t("pos.zPrintFailed")), "error"))
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
    const orderId = draft.orderId
    if (!orderId) return
    // A retry of the same order reuses the attempt's key: orders.checkout answers a repeat with the first result.
    await payment.submit(
      orderId,
      async (idempotencyKey) => {
        await draft.settle()
        return checkout({ sessionToken, orderId, idempotencyKey, payments })
      },
      (result) => {
        setPaymentOpen(false)
        setPaid({ ...paidCheckFrom(result, t), print: () => printHtml(printer.order(receiptFromOrder(result.receipt, place))) })
        selectCheck(null)
      },
    )
  }

  function handlePaymentOpenChange(open: boolean) {
    // An attempt in flight cannot be dismissed; after its timeout the cashier may retry or cancel.
    if (!open && payment.submitting) return
    if (!open) payment.reset()
    setPaymentOpen(open)
  }

  function printPrecheck() {
    // Printed documents stay as they are (bilingual where required): the legacy order type in Russian.
    const orderTypeName = orderTypeOptions(retail.orderTypes).find((option) => option.value === (draft.orderType.externalId ?? draft.orderType.mode))?.label
    printHtml(printer.order(precheckFromDraft(draft, { ...place, operatorName: access.employee.displayName, orderTypeName })))
  }

  function handleAction(action: Exclude<OrderAction, "void">) {
    if (action === "precheck") printPrecheck()
    else setDialog(action)
  }

  async function handleTransfer(input: { targetTerminalId: string; reason: string; managerApprovalToken: string }) {
    if (!draft.orderId) return
    const orderId = draft.orderId
    await draft.settle()
    // Only a held check moves between terminals: an open one is put on hold first.
    if (openChecks.find((check) => check.orderId === orderId)?.status !== "held") await hold({ sessionToken, orderId })
    await transfer({ sessionToken, orderId, targetTerminalId: input.targetTerminalId as Id<"posTerminals">, reason: input.reason, managerApprovalToken: input.managerApprovalToken })
    selectCheck(null)
    toast(draft.orderNumber !== undefined ? t("pos.transferredNumber", { number: draft.orderNumber }) : t("pos.transferred"), "success")
  }

  async function handleRefund(input: RefundInput) {
    await refund({
      sessionToken,
      orderId: input.orderId as Id<"orders">,
      idempotencyKey: input.idempotencyKey,
      amount: input.amount,
      ...input.target,
      ...(input.lines ? { lines: input.lines.map((line) => ({ orderLineId: line.orderLineId as Id<"orderLines">, quantity: line.quantity })) } : {}),
      reason: input.reason,
      managerApprovalToken: input.managerApprovalToken,
    })
    toast(t("pos.refunded", { amount: formatTenge(input.amount) }), "success")
  }

  async function handleContinue(order: HistoryOrder) {
    if (order.status === "held") await resume({ sessionToken, orderId: order._id })
    selectCheck(order._id)
  }

  const voidableLines = draft.lines.filter((line) => !line.voidedAt && line.serverLineId)
  const blocks = orderActionBlocks({ orderId: draft.orderId, lines: draft.lines, transferTargets }, t)
  const guestLabel = guest ? [guest.name || t("common.guest"), t("guest.points", { points: loyaltyQuote?.balance ?? guest.points }), plannedRedemption ? `−${plannedRedemption}` : ""].filter(Boolean).join(" · ") : undefined
  // The header is shown over the kitchen board too; its dialogs live on the cashier screen.
  const fromHeader = (open: () => void) => {
    setShowKitchen(false)
    open()
  }
  const header = (
    <AppHeader
      restaurantName={access.restaurant.name}
      terminalName={access.terminal.name}
      city={access.restaurant.city}
      showOfficeSwitch={OFFICE_ROLES.has(access.employee.role)}
      syncIndicator={<LiveSyncIndicator />}
      employeeName={access.employee.displayName}
      employeeRole={roleLabel(access.employee.role, t)}
      shiftNumber={shift.number}
      shiftOpenedAt={shift.openedAt}
      shiftWarning={shift.openedOver24h}
      unreadNotifications={notifications.unread}
      onMenu={() => fromHeader(() => setDialog("menu"))}
      onOpenShiftInfo={() => fromHeader(() => openShiftDialog())}
      onNotifications={() => fromHeader(() => setDialog("notifications"))}
      onProfile={() => fromHeader(() => setDialog("profile"))}
      onLock={onLock}
    />
  )

  if (showKitchen) {
    return (
      <div className="flex h-full flex-col gap-2 p-2">
        {header}
        <div className="min-h-0 flex-1">
          <KitchenBoard sessionToken={sessionToken} />
        </div>
        <Button variant="secondary" size="lg" onClick={() => setShowKitchen(false)}>
          {t("pos.backToPos")}
        </Button>
      </div>
    )
  }

  const closeDialog = (open: boolean) => !open && setDialog(null)

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      {header}
      {offline && (
        <p role="status" className="shrink-0 rounded-card border border-destructive/40 bg-destructive/10 px-4 py-2 text-body-sm font-semibold text-foreground">
          {t("error.offline")}
        </p>
      )}
      <div className="flex min-h-0 flex-1 gap-2 overflow-x-clip">
        <OrderPanel
          tableLabel={draft.tableLabel}
          orderNumber={draft.orderNumber}
          orderStatus={openChecks.find((check) => check.orderId === draft.orderId)?.status ?? "draft"}
          titleSlot={
            <ChecksSwitcher tableLabel={draft.tableLabel} orderNumber={draft.orderNumber} openCount={openChecks.length} onOpenFloor={() => setDialog("floor")} />
          }
          guestSlot={
            draft.orderType.mode === "dine-in" ? <GuestCountControl value={draft.guestCount} onChange={(count) => void draft.setGuestCount(count).catch(() => undefined)} /> : undefined
          }
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
          offlineReason={offline ? t("error.offline") : null}
          onIncrement={(id) => {
            const line = draft.lines.find((candidate) => candidate.clientLineId === id)
            if (!line) return
            // A sent line is fixed; another portion of it goes to a new line.
            if (line.sentToKitchenAt)
              draft.addItem({ productId: line.productId, name: line.name, nameKk: line.nameKk, price: line.unitPrice, sizeExternalId: line.sizeExternalId, sizeLabel: line.sizeLabel, modifierSelections: line.modifierSelections, modifierLabels: line.modifierLabels, modifierLabelsKk: line.modifierLabelsKk })
            else draft.setQuantity(id, line.quantity + 1)
          }}
          onDecrement={(id) => draft.setQuantity(id, (draft.lines.find((l) => l.clientLineId === id)?.quantity ?? 0) - 1)}
          onRemove={(id) => draft.setQuantity(id, 0)}
          onVoid={setVoidingLineId}
          onSendToKitchen={handleSendToKitchen}
          onHold={() => void handleHold().catch((caught) => toast(posErrorMessage(t, caught, t("pos.holdFailed")), "error"))}
          onCheckout={() => setPaymentOpen(true)}
          onDiscount={() => setDiscountOpen(true)}
          guestLabel={guestLabel}
          loyaltyRedemption={plannedRedemption}
          onGuest={() => (draft.orderId ? setGuestOpen(true) : toast(t("pos.orderSaving")))}
          onMore={() => setDialog("actions")}
          comment={draft.comment}
          suggestion={suggestion}
          onAddSuggestion={suggestion ? () => draft.addItem({ productId: suggestion.productId, name: suggestion.name, nameKk: suggestion.nameKk, price: suggestion.price }) : undefined}
        />
        <CatalogPanel
          controlRef={catalogRef}
          sessionToken={sessionToken}
          onAddProduct={draft.addItem}
          recentStorageKey={`sandyq-pos-recent:${terminalExternalId}:${access.employee.id}`}
          toolbarAction={
            <Button variant="ghost" className="h-12 px-3" onClick={() => setShowKitchen(true)}>
              <ChefHat /> {t("pos.kitchenScreen")}{kitchenTickets.length > 0 ? ` · ${kitchenTickets.length}` : ""}
            </Button>
          }
        />
      </div>

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={handlePaymentOpenChange}
        total={draft.total}
        loyaltyRedemption={plannedRedemption}
        blockedReason={redemptionStale ?? (offline ? t("error.offline") : null)}
        orderNumber={draft.orderNumber}
        itemCount={draft.itemCount}
        paymentTypes={retail.paymentTypes}
        submitting={payment.submitting}
        error={payment.error}
        onSubmit={handleCheckoutSubmit}
      />
      <PaymentComplete
        paid={paid}
        onOpenChange={(open) => !open && setPaid(null)}
        onPrint={() => paid?.print() ?? false}
        onNewTable={() => {
          setPaid(null)
          selectCheck(null)
        }}
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
        orderId={draft.orderId}
        total={draft.total}
        onRedeem={async (redemption) => {
          if (!draft.orderId) return
          // The order total the server checks against must be the one on screen.
          await draft.settle()
          await setRedemption({ sessionToken, orderId: draft.orderId, redemption })
        }}
        onAttach={(target, name) => {
          if (!draft.orderId) return Promise.resolve()
          return attachGuest({ sessionToken, orderId: draft.orderId, ...target, name })
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
        subtotal={draft.subtotal}
        serviceChargePercent={draft.serviceChargePercent}
        onApply={(percent, reason, token) => draft.applyDiscount(percent, reason, token)}
        onManagerRequired={requestApproval}
      />

      <MainMenuDialog
        open={dialog === "menu"}
        onOpenChange={closeDialog}
        onNewOrder={() => selectCheck(null)}
        onHistory={() => setDialog("history")}
        onShift={() => openShiftDialog()}
        onLock={onLock}
        onLogout={onLogout}
      />
      <ProfileDialog
        open={dialog === "profile"}
        onOpenChange={closeDialog}
        access={access}
        attendance={attendance.current}
        onClockIn={async () => {
          const result = await attendance.clockIn({ sessionToken })
          toast(result.alreadyOpen ? t("profile.clockedInAlready") : t("profile.clockedIn"), "success")
        }}
        onClockOut={async () => {
          await attendance.clockOut({ sessionToken })
          toast(t("profile.clockedOut"), "success")
        }}
        onLock={onLock}
        onLogout={onLogout}
      />
      <NotificationsDialog
        open={dialog === "notifications"}
        onOpenChange={closeDialog}
        items={notifications.items}
        canLoadMore={notifications.status === "CanLoadMore"}
        onLoadMore={notifications.loadMore}
        onRead={(notificationId) => notifications.markRead({ sessionToken, notificationId })}
        onOpenShift={() => openShiftDialog()}
      />
      <HistoryDialog
        open={dialog === "history"}
        onOpenChange={closeDialog}
        sessionToken={sessionToken}
        onContinue={handleContinue}
        onRefund={handleRefund}
        onPrint={(order) => printHtml(printer.order(receiptFromOrder(order, place)))}
        onManagerRequired={requestApproval}
      />
      <ShiftDialog
        open={dialog === "shift"}
        onOpenChange={closeDialog}
        tab={shiftTab}
        onTabChange={setShiftTab}
        sessionToken={sessionToken}
        shift={shift}
        restaurantName={access.restaurant.name}
        closePreview={closePreview}
        cashOperationTypes={retail.cashOperationTypes}
        onCashMovement={handleCashMovement}
        onReconcile={(countedCash) => reconcileCount({ sessionToken, countedCash })}
        onCloseShift={handleCloseShift}
        onPrintX={printXReport}
        onPrintZ={printZReport}
        onOpenOrderHistory={() => setDialog("history")}
        onManagerRequired={requestApproval}
      />

      <FloorGrid
        open={dialog === "floor"}
        onOpenChange={closeDialog}
        floor={floor}
        activeOrderId={draft.orderId}
        onOpenTable={(seat) => selectCheck(null, seat)}
        onSelectCheck={(orderId) => selectCheck(orderId)}
      />
      <OrderActionsDialog
        open={dialog === "actions"}
        onOpenChange={closeDialog}
        blocks={blocks}
        lines={voidableLines}
        onAction={handleAction}
        onVoidLine={setVoidingLineId}
      />
      <CommentDialog open={dialog === "comment"} onOpenChange={closeDialog} comment={draft.comment} onSave={draft.saveComment} />
      <SplitDialog
        open={dialog === "split"}
        onOpenChange={closeDialog}
        lines={voidableLines}
        onSplit={async (rows) => {
          const created = await draft.split(rows)
          toast([t("pos.splitCreated", { number: created.number }), created.tableLabel].filter(Boolean).join(" · "), "success")
        }}
      />
      <TransferDialog
        open={dialog === "transfer"}
        onOpenChange={closeDialog}
        targets={transferTargets}
        orderNumber={draft.orderNumber}
        onTransfer={handleTransfer}
        onManagerRequired={requestApproval}
      />
      <FloorGrid
        open={dialog === "move-table"}
        onOpenChange={closeDialog}
        mode="move"
        floor={floor}
        activeOrderId={draft.orderId}
        currentTable={{ tableLabel: draft.tableLabel, hallLabel: draft.hallLabel }}
        onOpenTable={() => {}}
        onSelectCheck={() => {}}
        onMove={(seat) => draft.moveToTable(seat)}
      />
      <CancelOrderDialog
        open={dialog === "cancel"}
        onOpenChange={closeDialog}
        orderNumber={draft.orderNumber}
        sentToKitchen={draft.lines.some((line) => line.sentToKitchenAt && !line.voidedAt)}
        reasons={retail.deletionReasons}
        onCancel={async (input) => {
          await draft.cancel(input)
          selectCheck(null)
          toast(draft.orderNumber !== undefined ? t("pos.cancelledNumber", { number: draft.orderNumber }) : t("pos.cancelled"), "success")
        }}
        onManagerRequired={requestApproval}
      />
      {managerDialog}
    </div>
  )
}
