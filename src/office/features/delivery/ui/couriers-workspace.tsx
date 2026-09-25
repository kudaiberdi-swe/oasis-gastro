import { Plus } from "lucide-react"
import { useState } from "react"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary, usePlatformScope } from "@/office/features/platform/data/use-platform"
import { Button, StatusPill, useToast } from "@/shared/components/ui"
import { describeStatus } from "@/shared/lib/status-dictionary"
import { errorMessage } from "@/shared/lib/error-message"

import { useCourierMutations, useCouriers, type Courier } from "../data/use-delivery"
import { COURIER_FORM_ID, CourierEditor } from "./courier-editor"
import { MasterDetail, MasterListBlock, MasterRow, MasterRows } from "./master-detail"

/** «Курьеры» (/office/couriers, W2-DLV-07, office/61): shift buttons in the row, the card on the right. */
export function CouriersWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <CouriersContent />
    </PlatformErrorBoundary>
  )
}

type Selection = { kind: "new" } | { kind: "edit"; externalId: string } | null

function CouriersContent() {
  const couriers = useCouriers()
  const scope = usePlatformScope()
  const canEdit = useCan("office.couriers.edit")
  const [selection, setSelection] = useState<Selection>(null)
  const selected = selection?.kind === "edit" ? couriers?.find((courier) => courier.externalId === selection.externalId) : undefined
  const editing = selection?.kind === "new" || selected !== undefined

  return (
    <MasterDetail
      toolbar={
        canEdit ? (
          <Button variant={editing ? "secondary" : "primary"} onClick={() => setSelection({ kind: "new" })}>
            <Plus aria-hidden />
            Новый курьер
          </Button>
        ) : null
      }
      list={
        couriers === undefined ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : (
          <MasterListBlock title="Курьерская служба" caption="Оперативный статус обновляется без изменения карточки">
            {couriers.length === 0 ? (
              <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">Курьеров пока нет — создайте карточку для сотрудника ресторана.</p>
            ) : (
              <MasterRows>
                {couriers.map((courier) => (
                  <MasterRow
                    key={courier.externalId}
                    active={courier.externalId === selected?.externalId}
                    onSelect={() => setSelection({ kind: "edit", externalId: courier.externalId })}
                    title={courier.name}
                    meta={`${courier.phone} · ${describeStatus("transport", courier.transport).label}${scope.restaurants.length > 1 ? ` · ${scope.restaurantName(courier.restaurantExternalId)}` : ""}`}
                    trailing={courier.active ? <StatusPill domain="courier" status={courier.status} /> : <StatusPill domain="document" status="inactive" />}
                    actions={
                      <>
                        {canEdit && courier.active ? <ShiftButton courier={courier} /> : null}
                        <Button size="sm" variant="ghost" onClick={() => setSelection({ kind: "edit", externalId: courier.externalId })}>
                          Изменить
                        </Button>
                      </>
                    }
                  />
                ))}
              </MasterRows>
            )}
          </MasterListBlock>
        )
      }
      cardTitle={selected ? selected.name : "Карточка курьера"}
      cardCaption="Сотрудник должен существовать в разделе Сотрудники"
      cardActions={
        canEdit ? (
          <Button type="submit" form={COURIER_FORM_ID}>
            Сохранить
          </Button>
        ) : null
      }
      editing={editing}
      onClose={() => setSelection(null)}
      card={
        editing ? (
          <CourierEditor
            key={selected?.externalId ?? "new"}
            courier={selected ?? null}
            restaurants={scope.restaurants}
            readOnly={!canEdit}
            onSaved={(externalId) => setSelection({ kind: "edit", externalId })}
          />
        ) : null
      }
    />
  )
}

/** «Закрыть смену» / «Открыть смену»: a courier on an order keeps the shift until it ends. */
function ShiftButton({ courier }: { courier: Courier }) {
  const { setCourierStatus } = useCourierMutations()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const offline = courier.status === "offline"
  const onOrder = courier.status === "assigned" || courier.status === "on-delivery"
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={busy || onOrder}
      title={onOrder ? "Курьер на заказе — смену можно закрыть после его завершения" : undefined}
      onClick={async () => {
        setBusy(true)
        try {
          await setCourierStatus({ externalId: courier.externalId, status: offline ? "available" : "offline" })
          toast(offline ? `Смена открыта: ${courier.name}` : `Смена закрыта: ${courier.name}`, "success")
        } catch (caught) {
          toast(errorMessage(caught, "Не удалось изменить смену"), "error")
        } finally {
          setBusy(false)
        }
      }}
    >
      {offline ? "Открыть смену" : "Закрыть смену"}
    </Button>
  )
}
