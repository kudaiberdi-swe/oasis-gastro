import { useState } from "react"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { Button, Combobox, ConfirmDialog, DataTable, TonePill, useToast, type Column } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"

import { useLinkRestaurant, useRestaurantLinkOptions, type IikoDepartmentOption, type RestaurantLinkRow } from "../data/use-iiko"
import { Panel } from "./panel"

// «Сопоставление филиалов» (W1-IIKO-02): which iiko department a restaurant is. Without a link the
// import skips that department's stores and terminals instead of attaching them to a random restaurant (B-24).

type Pending = { restaurant: RestaurantLinkRow; department: IikoDepartmentOption | null; takenFrom?: RestaurantLinkRow }

export function RestaurantLinks() {
  const options = useRestaurantLinkOptions()
  const link = useLinkRestaurant()
  const canEdit = useCan("office.data-exchange.edit")
  const toast = useToast()
  const [pending, setPending] = useState<Pending | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const restaurants = options?.restaurants ?? []
  const departments = options?.departments ?? []
  const linkedBy = (departmentExternalId: string) => restaurants.find((row) => row.iikoDepartmentExternalId === departmentExternalId)

  async function apply({ restaurant, department }: Pending) {
    setSaving(restaurant.restaurantExternalId)
    setError(null)
    try {
      await link({ restaurantExternalId: restaurant.restaurantExternalId, iikoDepartmentExternalId: department?.externalId })
      toast(department ? `«${restaurant.restaurantName}» сопоставлен с «${department.name}»` : `Сопоставление «${restaurant.restaurantName}» снято`, "success")
      setPending(null)
    } catch (caught) {
      const message = errorMessage(caught, "Не удалось сохранить сопоставление")
      if (pending) setError(message)
      else toast(message, "error")
    } finally {
      setSaving(null)
    }
  }

  function choose(restaurant: RestaurantLinkRow, departmentExternalId: string) {
    if (departmentExternalId === restaurant.iikoDepartmentExternalId) return
    const department = departments.find((row) => row.externalId === departmentExternalId) ?? null
    const takenFrom = linkedBy(departmentExternalId)
    // Relinking silently drops the other restaurant's link on the server — ask first.
    if (takenFrom && takenFrom.restaurantExternalId !== restaurant.restaurantExternalId) setPending({ restaurant, department, takenFrom })
    else void apply({ restaurant, department })
  }

  const columns: Column<RestaurantLinkRow>[] = [
    {
      key: "restaurant",
      header: "Ресторан",
      // Names repeat (a seed branch and the same branch from iiko): the code and the source tell them apart.
      cell: (row) => (
        <span className="flex flex-col">
          <span className="font-semibold">{row.restaurantName}</span>
          <span className="text-caption text-muted-foreground">
            код {row.restaurantExternalId.slice(0, 16)}
            {row.fromIiko ? " · из iiko" : ""}
          </span>
        </span>
      ),
      sortValue: (row) => row.restaurantName,
    },
    {
      key: "department",
      header: "Подразделение iiko",
      cell: (row) =>
        canEdit ? (
          <Combobox
            aria-label={`Подразделение iiko для «${row.restaurantName}»`}
            className="min-w-56"
            disabled={saving === row.restaurantExternalId || departments.length === 0}
            value={row.iikoDepartmentExternalId ?? undefined}
            onValueChange={(value) => choose(row, value)}
            options={departments.map((department) => {
              const owner = linkedBy(department.externalId)
              const hint = [department.code, owner && owner.restaurantExternalId !== row.restaurantExternalId ? `у «${owner.restaurantName}»` : null].filter(Boolean).join(" · ")
              return { value: department.externalId, label: department.name, hint: hint || undefined }
            })}
            placeholder="Не сопоставлено"
            searchPlaceholder="Название или код подразделения"
          />
        ) : (
          <span className={row.iikoDepartmentName ? undefined : "text-muted-foreground"}>{row.iikoDepartmentName ?? row.iikoDepartmentExternalId ?? "Не сопоставлено"}</span>
        ),
    },
    {
      key: "confirmed",
      header: "Подтверждено",
      cell: (row) =>
        row.confirmedAt ? (
          <div className="flex flex-col">
            <span>{row.confirmedBy}</span>
            <span className="text-caption text-muted-foreground">{formatAlmatyDateTime(row.confirmedAt)}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "status",
      header: "Статус",
      cell: (row) => (row.iikoDepartmentExternalId ? <TonePill tone="success">Сопоставлен</TonePill> : <TonePill tone="warning">Не сопоставлен</TonePill>),
    },
    ...(canEdit
      ? [
          {
            key: "actions",
            header: <span className="sr-only">Действия</span>,
            numeric: true,
            cell: (row: RestaurantLinkRow) =>
              row.iikoDepartmentExternalId ? (
                <Button size="sm" variant="ghost" disabled={saving === row.restaurantExternalId} onClick={() => setPending({ restaurant: row, department: null })}>
                  Снять
                </Button>
              ) : null,
          },
        ]
      : []),
  ]

  const unlinked = restaurants.filter((row) => !row.iikoDepartmentExternalId).length

  return (
    <Panel
      title="Сопоставление филиалов"
      description="Ресторан ↔ подразделение iiko. Склады и кассы подразделения без сопоставления импорт пропускает"
      actions={options && restaurants.length ? <TonePill tone={unlinked ? "warning" : "success"}>{unlinked ? `Не сопоставлено: ${unlinked}` : "Все сопоставлены"}</TonePill> : undefined}
    >
      {options === undefined ? (
        <div className="p-4">
          <OfficeStatePage state={{ kind: "loading" }} />
        </div>
      ) : restaurants.length === 0 ? (
        <OfficeStatePage state={{ kind: "empty", title: "Ресторанов нет", description: "В вашей зоне доступа нет действующих ресторанов." }} />
      ) : (
        <>
          {departments.length === 0 ? (
            <p className="border-b border-border px-4 py-3 text-body-sm text-muted-foreground">Подразделения iiko ещё не импортированы — сопоставление станет доступно после первого запуска импорта.</p>
          ) : null}
          <DataTable caption="Сопоставление филиалов" className="rounded-none border-0" columns={columns} rows={restaurants} getRowId={(row) => row.restaurantExternalId} />
        </>
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null)
            setError(null)
          }
        }}
        title={pending?.department ? `Перенести «${pending.department.name}»?` : `Снять сопоставление «${pending?.restaurant.restaurantName ?? ""}»?`}
        description={
          pending?.department
            ? `Подразделение сейчас сопоставлено с «${pending.takenFrom?.restaurantName}». После переноса его склады и кассы будут относиться к «${pending.restaurant.restaurantName}», а «${pending.takenFrom?.restaurantName}» останется без сопоставления.`
            : "При следующем импорте склады и кассы этого подразделения iiko будут пропущены, пока ресторан не сопоставят снова."
        }
        confirmLabel={pending?.department ? "Перенести" : "Снять сопоставление"}
        danger={!pending?.department}
        submitting={saving !== null}
        error={error}
        onConfirm={() => (pending ? apply(pending) : undefined)}
      />
    </Panel>
  )
}
