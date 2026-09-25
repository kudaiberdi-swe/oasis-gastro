import { useState } from "react"
import { useParams } from "react-router"

import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"

import type { DeliveryChannel } from "../data/use-delivery"
import { DeliveryOrderEditor } from "./delivery-order-editor"
import { DeliveryOrdersRegister } from "./delivery-orders-register"

/** /office/<section> — the register; /<section>/new — a new order; /<section>/:id — the order card. */
function OrdersSection({ channel, basePath }: { channel: DeliveryChannel; basePath: string }) {
  const { id } = useParams()
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={`${id ?? "list"}-${attempt}`} onRetry={() => setAttempt((value) => value + 1)}>
      {id ? <DeliveryOrderEditor externalId={id === "new" ? null : id} channel={channel} backPath={basePath} /> : <DeliveryOrdersRegister mode={channel} basePath={basePath} />}
    </PlatformErrorBoundary>
  )
}

/** «Заказы доставки» (W2-DLV-02/05). */
export function DeliveryOrdersWorkspace() {
  return <OrdersSection channel="delivery" basePath="/office/delivery-orders" />
}

/** «Колл-центр» (W2-DLV-04): the same register and card, operator's queue and the «Телефон» source. */
export function CallCenterWorkspace() {
  return <OrdersSection channel="call-center" basePath="/office/call-center" />
}
