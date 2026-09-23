import { useCallback, useEffect, useRef, useState } from "react"

import type { Id } from "../../../../../convex/_generated/dataModel"
import { useOrderMutations } from "../data/use-orders"
import type { DraftLine } from "@/shared/types/pos"

type HydratedCheck = {
  _id: Id<"orders">
  version?: number
  tableLabel?: string
  discountPercent: number
  discountReason?: string
  comment?: string
  lines: Array<{ productId: Id<"products">; productName: string; unitPrice: number; quantity: number; modifiers: string[]; product: { nameKk: string } | null }>
}

/**
 * Owns the cart for one open check — local-first, persisted to the server on every change.
 *
 * `selectionKey` must change every time the caller makes a new explicit selection (picking a
 * different check, or starting a new one) — including reselecting "new" twice in a row. Syncing
 * off `initialOrderId` alone isn't enough: it stays `null` across two consecutive "new check"
 * selections, so a second "Новый стол" wouldn't otherwise clear whatever the cashier was still
 * mid-editing on the first one. The caller (pos-workspace.tsx) bumps a counter on every
 * selectCheck() call and passes it through as this key.
 */
export function useOrderDraft(args: {
  sessionToken: string
  terminalExternalId: string
  orderType: "dine-in" | "takeaway"
  hydrated: HydratedCheck | null | undefined
  initialOrderId: Id<"orders"> | null
  initialTableLabel?: string
  selectionKey: number
}) {
  const { saveDraft } = useOrderMutations()
  const [orderId, setOrderId] = useState<Id<"orders"> | null>(args.initialOrderId)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [tableLabel, setTableLabel] = useState(args.initialTableLabel ?? "")
  const [discountPercent, setDiscountPercent] = useState(0)
  const [discountReason, setDiscountReason] = useState("")
  const [comment, setComment] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const version = useRef<number | undefined>(undefined)
  const clientOrderId = useRef(crypto.randomUUID())
  const syncedSelectionKey = useRef<number | null>(null)

  useEffect(() => {
    if (syncedSelectionKey.current === args.selectionKey) return

    if (args.initialOrderId === null) {
      syncedSelectionKey.current = args.selectionKey
      clientOrderId.current = crypto.randomUUID()
      setOrderId(null)
      version.current = undefined
      setTableLabel(args.initialTableLabel ?? "")
      setDiscountPercent(0)
      setDiscountReason("")
      setComment("")
      setLines([])
      return
    }

    // A real check was selected — wait for its hydrated data to actually arrive before syncing,
    // so we never flash the previous check's contents under the new check's id.
    if (!args.hydrated || args.hydrated._id !== args.initialOrderId) return
    syncedSelectionKey.current = args.selectionKey
    setOrderId(args.hydrated._id)
    version.current = args.hydrated.version
    setTableLabel(args.hydrated.tableLabel ?? "")
    setDiscountPercent(args.hydrated.discountPercent)
    setDiscountReason(args.hydrated.discountReason ?? "")
    setComment(args.hydrated.comment ?? "")
    setLines(
      args.hydrated.lines.map((line) => ({
        clientLineId: crypto.randomUUID(),
        productId: line.productId,
        name: line.productName,
        nameKk: line.product?.nameKk ?? line.productName,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        modifiers: line.modifiers,
      })),
    )
  }, [args.selectionKey, args.initialOrderId, args.hydrated, args.initialTableLabel])

  const persist = useCallback(
    async (next: { lines: DraftLine[]; tableLabel: string; discountPercent: number; discountReason: string; comment: string }, managerApprovalToken?: string) => {
      setSaving(true)
      setError(null)
      try {
        const result = await saveDraft({
          sessionToken: args.sessionToken,
          clientOrderId: clientOrderId.current,
          orderId: orderId ?? undefined,
          expectedVersion: version.current,
          orderType: args.orderType,
          tableLabel: next.tableLabel || undefined,
          discountPercent: next.discountPercent,
          discountReason: next.discountReason || undefined,
          managerApprovalToken,
          comment: next.comment,
          lines: next.lines.map((line) => ({ clientLineId: line.clientLineId, productId: line.productId as Id<"products">, quantity: line.quantity, modifiers: line.modifiers })),
        })
        if ("outcome" in result) {
          setError("Заказ больше нельзя редактировать")
          return
        }
        setOrderId(result._id)
        version.current = result.version
        return result
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Не удалось сохранить заказ")
        throw caught
      } finally {
        setSaving(false)
      }
    },
    [args.orderType, args.sessionToken, orderId, saveDraft],
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
    (product: { productId: string; name: string; nameKk: string; price: number }) => {
      setLines((current) => {
        const existing = current.find((line) => line.productId === product.productId)
        const next = existing
          ? current.map((line) => (line.productId === product.productId ? { ...line, quantity: line.quantity + 1 } : line))
          : [...current, { clientLineId: crypto.randomUUID(), productId: product.productId, name: product.name, nameKk: product.nameKk, unitPrice: product.price, quantity: 1, modifiers: [] }]
        void persist({ lines: next, tableLabel, discountPercent, discountReason, comment })
        return next
      })
    },
    [comment, discountPercent, discountReason, persist, tableLabel],
  )

  const setQuantity = useCallback(
    (clientLineId: string, quantity: number) => {
      setLines((current) => {
        const next = quantity <= 0 ? current.filter((line) => line.clientLineId !== clientLineId) : current.map((line) => (line.clientLineId === clientLineId ? { ...line, quantity } : line))
        void persist({ lines: next, tableLabel, discountPercent, discountReason, comment })
        return next
      })
    },
    [comment, discountPercent, discountReason, persist, tableLabel],
  )

  const applyDiscount = useCallback(
    async (percent: number, reason: string, managerApprovalToken?: string) => {
      setDiscountPercent(percent)
      setDiscountReason(reason)
      await persist({ lines, tableLabel, discountPercent: percent, discountReason: reason, comment }, managerApprovalToken)
    },
    [comment, lines, persist, tableLabel],
  )

  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
  const discountAmount = Math.round(subtotal * (discountPercent / 100))
  const serviceChargeAmount = Math.round((subtotal - discountAmount) * 0.15)
  const total = subtotal - discountAmount + serviceChargeAmount

  return { orderId, lines, tableLabel, setTableLabel, discountPercent, discountReason, comment, setComment, addItem, setQuantity, applyDiscount, subtotal, discountAmount, serviceChargeAmount, total, saving, error }
}
