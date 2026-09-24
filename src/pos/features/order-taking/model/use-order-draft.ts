import { useCallback, useEffect, useRef, useState } from "react"

import type { Id } from "../../../../../convex/_generated/dataModel"
import { useOrderMutations } from "../data/use-orders"
import { errorMessage } from "@/shared/lib/error-message"
import type { OrderType } from "@/shared/types/pos"
import type { PosOrderType } from "@/pos/features/retail/data/use-retail-settings"
import {
  activeSubtotal,
  addCatalogItem,
  fromServerLine,
  hasUnsentLines,
  itemCount,
  mergeServerLines,
  setLineQuantity,
  toDraftLineInputs,
  type CatalogItem,
  type OrderDraftLine,
  type ServerOrderLine,
} from "./draft-lines"

/** The part of a hydrated order (getCheck, saveDraft, sendToKitchen, voidLine) the draft reads. */
type ServerOrder = {
  _id: Id<"orders">
  number?: number
  version?: number
  orderType?: OrderType
  orderTypeExternalId?: string
  serviceChargePercent?: number
  subtotal?: number
  discountAmount?: number
  serviceChargeAmount?: number
  total?: number
  tableLabel?: string
  hallLabel?: string
  guestCount?: number
  discountTypeExternalId?: string
  discountPercent: number
  discountReason?: string
  comment?: string
  lines: ServerOrderLine[]
}

/** Selected order type: the retail setting when the terminal has them, else the legacy service mode. */
export type DraftOrderType = { externalId?: string; mode: OrderType }

type ServerTotals = { subtotal: number; discountAmount: number; serviceChargeAmount: number; total: number; serviceChargePercent: number; orderType: DraftOrderType }

type Snapshot = { lines: OrderDraftLine[]; tableLabel: string; discountPercent: number; discountReason: string; comment: string; orderType: DraftOrderType }

/** Per-check server context. Replaced (not mutated) on every selection so a late answer never lands on another check. */
type CheckContext = { clientOrderId: string; orderId: Id<"orders"> | null; version: number | undefined; extras: { hallLabel?: string; guestCount?: number; discountTypeExternalId?: string } }

const newContext = (orderId: Id<"orders"> | null = null, version?: number): CheckContext => ({ clientOrderId: crypto.randomUUID(), orderId, version, extras: {} })

/** The default order type: the published one marked default, then «в зале», then the first. */
export function defaultOrderType(orderTypes: PosOrderType[] | undefined, fallback: OrderType): DraftOrderType {
  const types = orderTypes ?? []
  const chosen = types.find((type) => type.data.isDefault) ?? types.find((type) => type.data.serviceMode === fallback) ?? types[0]
  return chosen ? { externalId: chosen.externalId, mode: chosen.data.serviceMode } : { mode: fallback }
}

const sameOrderType = (a: DraftOrderType, b: DraftOrderType) => (a.externalId || b.externalId ? a.externalId === b.externalId : a.mode === b.mode)

/**
 * Owns the cart for one open check — local-first, persisted to the server on every change.
 *
 * `selectionKey` must change every time the caller makes a new explicit selection (picking a
 * different check, or starting a new one) — including reselecting "new" twice in a row. Syncing
 * off `initialOrderId` alone isn't enough: it stays `null` across two consecutive "new check"
 * selections, so a second "Новый стол" wouldn't otherwise clear whatever the cashier was still
 * mid-editing on the first one. The caller (pos-workspace.tsx) bumps a counter on every
 * selectCheck() call and passes it through as this key.
 *
 * Every server call (saveDraft, sendToKitchen, voidLine) goes through one chain, so each call sends
 * the version the previous one returned — two quick taps never race into a version conflict.
 */
export function useOrderDraft(args: {
  sessionToken: string
  terminalExternalId: string
  /** Service mode used when the terminal has no published order types (prod before seeding). */
  orderType: OrderType
  /** Published order types from activeForPos; empty or missing → the legacy `orderType` is sent. */
  orderTypes?: PosOrderType[]
  hydrated: ServerOrder | null | undefined
  initialOrderId: Id<"orders"> | null
  initialTableLabel?: string
  selectionKey: number
}) {
  const { saveDraft, sendToKitchen: sendToKitchenMutation, voidLine: voidLineMutation } = useOrderMutations()
  const [orderId, setOrderId] = useState<Id<"orders"> | null>(args.initialOrderId)
  const [orderNumber, setOrderNumber] = useState<number | undefined>(undefined)
  const [lines, setLines] = useState<OrderDraftLine[]>([])
  const [tableLabel, setTableLabel] = useState(args.initialTableLabel ?? "")
  const [discountPercent, setDiscountPercent] = useState(0)
  const [discountReason, setDiscountReason] = useState("")
  const [comment, setComment] = useState("")
  const [selectedOrderType, setSelectedOrderType] = useState<DraftOrderType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(0)
  const [serverTotals, setServerTotals] = useState<ServerTotals | null>(null)
  const check = useRef<CheckContext>(newContext(args.initialOrderId))
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const syncedSelectionKey = useRef<number | null>(null)

  const orderType = selectedOrderType ?? defaultOrderType(args.orderTypes, args.orderType)

  const applyServerOrder = useCallback((context: CheckContext, order: ServerOrder, version: number | undefined) => {
    context.orderId = order._id
    context.version = version
    if (check.current !== context) return
    setOrderId(order._id)
    if (order.number !== undefined) setOrderNumber(order.number)
    if (order.lines) setLines((current) => mergeServerLines(current, order.lines))
    if (order.total !== undefined && order.serviceChargePercent !== undefined) {
      setServerTotals({
        subtotal: order.subtotal ?? 0,
        discountAmount: order.discountAmount ?? 0,
        serviceChargeAmount: order.serviceChargeAmount ?? 0,
        total: order.total,
        serviceChargePercent: order.serviceChargePercent,
        orderType: { externalId: order.orderTypeExternalId, mode: order.orderType ?? "dine-in" },
      })
    }
  }, [])

  useEffect(() => {
    if (syncedSelectionKey.current === args.selectionKey) return

    if (args.initialOrderId === null) {
      syncedSelectionKey.current = args.selectionKey
      check.current = newContext()
      setOrderId(null)
      setOrderNumber(undefined)
      setTableLabel(args.initialTableLabel ?? "")
      setDiscountPercent(0)
      setDiscountReason("")
      setComment("")
      setSelectedOrderType(null)
      setServerTotals(null)
      setError(null)
      setLines([])
      return
    }

    // A real check was selected — wait for its hydrated data to actually arrive before syncing,
    // so we never flash the previous check's contents under the new check's id.
    if (!args.hydrated || args.hydrated._id !== args.initialOrderId) return
    const hydrated = args.hydrated
    syncedSelectionKey.current = args.selectionKey
    const context = newContext(hydrated._id, hydrated.version)
    context.extras = { hallLabel: hydrated.hallLabel, guestCount: hydrated.guestCount, discountTypeExternalId: hydrated.discountTypeExternalId }
    check.current = context
    setOrderId(hydrated._id)
    setOrderNumber(hydrated.number)
    setSelectedOrderType(hydrated.orderType ? { externalId: hydrated.orderTypeExternalId, mode: hydrated.orderType } : null)
    setServerTotals(null)
    setTableLabel(hydrated.tableLabel ?? "")
    setDiscountPercent(hydrated.discountPercent)
    setDiscountReason(hydrated.discountReason ?? "")
    setComment(hydrated.comment ?? "")
    setError(null)
    setLines(hydrated.lines.map((line) => fromServerLine(line)))
    applyServerOrder(context, hydrated, hydrated.version)
  }, [args.selectionKey, args.initialOrderId, args.hydrated, args.initialTableLabel, applyServerOrder])

  /** Runs server calls one after another; `saving` stays true while anything is queued. */
  const enqueue = useCallback(<T,>(operation: () => Promise<T>) => {
    setPending((count) => count + 1)
    const run = chain.current.then(operation).finally(() => setPending((count) => count - 1))
    chain.current = run.catch(() => undefined)
    return run
  }, [])

  const persist = useCallback(
    (next: Snapshot, managerApprovalToken?: string) => {
      const context = check.current
      return enqueue(async () => {
        if (check.current === context) setError(null)
        try {
          const legacy = !next.orderType.externalId
          const result = await saveDraft({
            sessionToken: args.sessionToken,
            clientOrderId: context.clientOrderId,
            orderId: context.orderId ?? undefined,
            expectedVersion: context.version,
            ...(legacy ? { orderType: next.orderType.mode } : { orderTypeExternalId: next.orderType.externalId }),
            tableLabel: next.tableLabel || undefined,
            ...context.extras,
            discountPercent: next.discountPercent,
            discountReason: next.discountReason || undefined,
            managerApprovalToken,
            comment: next.comment,
            lines: toDraftLineInputs(next.lines),
          })
          if ("outcome" in result) {
            if (check.current === context) setError("Заказ больше нельзя редактировать")
            return
          }
          applyServerOrder(context, result as ServerOrder, result.version)
          return result
        } catch (caught) {
          if (check.current === context) setError(errorMessage(caught, "Не удалось сохранить заказ"))
          throw caught
        }
      })
    },
    [applyServerOrder, args.sessionToken, enqueue, saveDraft],
  )

  const snapshot = useCallback(
    (patch: Partial<Snapshot>): Snapshot => ({ lines, tableLabel, discountPercent, discountReason, comment, orderType, ...patch }),
    [comment, discountPercent, discountReason, lines, orderType, tableLabel],
  )

  // addItem/setQuantity compute the next lines AND call persist(next) from inside the setLines
  // updater — that's a side effect in a functional updater, which looks like a code smell (and is
  // exactly what React 18 StrictMode's dev-only double-invoke is designed to flag), but reading
  // the computed value back out of the updater into an outer variable is worse: setState updaters
  // aren't guaranteed to run synchronously, so persist() would read that variable before the
  // updater ever populated it and silently save an empty order. The functional-updater form is
  // required here specifically so a rapid double-click always builds on the latest pending
  // `current`, not a stale `lines` closure — don't "clean up" this shape without solving that.
  const addItem = useCallback(
    (item: CatalogItem) => {
      setLines((current) => {
        const next = addCatalogItem(current, item)
        void persist({ lines: next, tableLabel, discountPercent, discountReason, comment, orderType }).catch(() => undefined)
        return next
      })
    },
    [comment, discountPercent, discountReason, orderType, persist, tableLabel],
  )

  const setQuantity = useCallback(
    (clientLineId: string, quantity: number) => {
      setLines((current) => {
        const next = setLineQuantity(current, clientLineId, quantity)
        if (next === current) {
          if (current.some((line) => line.clientLineId === clientLineId)) setError("Позиция уже на кухне — изменить её можно только через «Удалить позицию»")
          return current
        }
        void persist({ lines: next, tableLabel, discountPercent, discountReason, comment, orderType }).catch(() => undefined)
        return next
      })
    },
    [comment, discountPercent, discountReason, orderType, persist, tableLabel],
  )

  const changeOrderType = useCallback(
    (next: DraftOrderType) => {
      if (sameOrderType(next, orderType)) return
      setSelectedOrderType(next)
      if (lines.length > 0 || check.current.orderId) void persist(snapshot({ orderType: next })).catch(() => undefined)
    },
    [lines.length, orderType, persist, snapshot],
  )

  const applyDiscount = useCallback(
    async (percent: number, reason: string, managerApprovalToken?: string) => {
      setDiscountPercent(percent)
      setDiscountReason(reason)
      // A free percent replaces a discount type the check may carry from another screen.
      check.current.extras = { ...check.current.extras, discountTypeExternalId: undefined }
      await persist(snapshot({ discountPercent: percent, discountReason: reason }), managerApprovalToken)
    },
    [persist, snapshot],
  )

  /** «На кухню»: a ticket for every line not sent yet; the answer's version keeps the next save valid. */
  const sendToKitchen = useCallback(() => {
    const context = check.current
    return enqueue(async () => {
      if (!context.orderId) throw new Error("Сначала добавьте позиции в заказ")
      if (check.current === context) setError(null)
      try {
        const result = await sendToKitchenMutation({ sessionToken: args.sessionToken, orderId: context.orderId, expectedVersion: context.version })
        applyServerOrder(context, result.order as ServerOrder, result.version)
        return result.ticketId
      } catch (caught) {
        if (check.current === context) setError(errorMessage(caught, "Не удалось отправить на кухню"))
        throw caught
      }
    })
  }, [applyServerOrder, args.sessionToken, enqueue, sendToKitchenMutation])

  /** «Удалить позицию» with a deletion reason; errors are thrown to the dialog that asked. */
  const voidLine = useCallback(
    (clientLineId: string, input: { deletionReasonExternalId: string; comment?: string; managerApprovalToken?: string }) => {
      const context = check.current
      return enqueue(async () => {
        const line = lines.find((candidate) => candidate.clientLineId === clientLineId)
        if (!context.orderId || !line?.serverLineId) throw new Error("Позиция ещё не сохранена")
        const result = await voidLineMutation({
          sessionToken: args.sessionToken,
          orderId: context.orderId,
          orderLineId: line.serverLineId as Id<"orderLines">,
          expectedVersion: context.version,
          deletionReasonExternalId: input.deletionReasonExternalId,
          comment: input.comment?.trim() || undefined,
          managerApprovalToken: input.managerApprovalToken,
        })
        applyServerOrder(context, result.order as ServerOrder, result.version)
      })
    },
    [applyServerOrder, args.sessionToken, enqueue, lines, voidLineMutation],
  )

  const saving = pending > 0
  const subtotal = activeSubtotal(lines)
  const discountAmount = Math.round(subtotal * (discountPercent / 100))
  const typeSetting = args.orderTypes?.find((type) => type.externalId === orderType.externalId)
  const servicePercent =
    serverTotals && sameOrderType(serverTotals.orderType, orderType)
      ? serverTotals.serviceChargePercent
      : (typeSetting?.data.serviceChargePercent ?? (orderType.mode === "dine-in" ? 15 : 0))
  const serviceChargeAmount = Math.max(0, Math.round((subtotal - discountAmount) * (servicePercent / 100)))
  const estimate = { subtotal, discountAmount, serviceChargeAmount, total: subtotal - discountAmount + serviceChargeAmount }
  // Once nothing is queued, the server's own numbers are shown — they are what checkout must match.
  const totals = !saving && serverTotals ? serverTotals : estimate

  return {
    orderId,
    orderNumber,
    lines,
    tableLabel,
    setTableLabel,
    discountPercent,
    discountReason,
    comment,
    setComment,
    orderType,
    changeOrderType,
    addItem,
    setQuantity,
    applyDiscount,
    sendToKitchen,
    voidLine,
    hasUnsentLines: hasUnsentLines(lines),
    itemCount: itemCount(lines),
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    serviceChargePercent: servicePercent,
    serviceChargeAmount: totals.serviceChargeAmount,
    total: totals.total,
    saving,
    error,
  }
}
