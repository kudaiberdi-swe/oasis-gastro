import { Settings2 } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"

import { OfficeStatePage } from "@/office/components/state-page"
import { formatCoefficient, useScaleByProduct, useSizeScaleMutations, type SizeOption } from "@/office/features/size-scales/data/use-size-scales"
import { Banner, Button, DataTable, EmptyState, Field, Select, Switch, useToast, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatTenge } from "@/shared/lib/format"

import type { ProductCard } from "../../data/use-nomenclature"
import { Block } from "./main-tab"

const NO_SCALE = "__none"

/** «Шкала размеров» tab of the product card (W1-CAT-09): pick a scale, see its sizes. */
export function SizeScaleTab({ card, canEdit, canEditScales, canViewScales }: { card: ProductCard; canEdit: boolean; canEditScales: boolean; canViewScales: boolean }) {
  const { loading, scales, byProduct } = useScaleByProduct(canViewScales)
  const { assignScale, setAvailability } = useSizeScaleMutations()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const scale = byProduct.get(card.externalId) ?? null

  if (!canViewScales) return <EmptyState title="Нет доступа к шкалам размеров" description="У вашей роли нет права просматривать справочник шкал." />
  if (loading) return <OfficeStatePage state={{ kind: "loading" }} />

  async function choose(value: string) {
    setBusy(true)
    setError(null)
    try {
      await assignScale({ productExternalId: card.externalId, scaleExternalId: value === NO_SCALE ? null : value })
      toast(value === NO_SCALE ? "Шкала снята" : "Шкала назначена", "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось назначить шкалу"))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(option: SizeOption, available: boolean) {
    setError(null)
    try {
      await setAvailability({ optionExternalId: option.externalId, available })
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось изменить размер"))
    }
  }

  const columns: Column<SizeOption>[] = [
    {
      key: "label",
      header: "Для кассира",
      cell: (option) => (
        <span className="inline-flex items-center gap-2 font-semibold">
          {option.label}
          {option.isDefault ? <span className="text-caption font-normal text-muted-foreground">по умолчанию</span> : null}
        </span>
      ),
    },
    { key: "kk", header: "Қаз", cell: (option) => option.labelKk ?? "—" },
    { key: "kitchen", header: "Для кухни", cell: (option) => option.kitchenLabel },
    { key: "coefficient", header: "Коэффициент", numeric: true, cell: (option) => formatCoefficient(option.coefficient) },
    { key: "price", header: "Цена", numeric: true, cell: (option) => formatTenge(card.basePrice * option.coefficient) },
    {
      key: "available",
      header: "Доступен",
      cell: (option) => <Switch checked={option.available} onCheckedChange={(checked) => void toggle(option, checked)} disabled={!canEditScales} aria-label={`Доступен — ${option.label}`} />,
    },
  ]

  const selectOptions = [{ value: NO_SCALE, label: "Без шкалы" }, ...scales.map((item) => ({ value: item.externalId, label: item.name }))]

  return (
    <Block title="Шкала размеров">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-body-sm text-muted-foreground">Размеры одной позиции отображаются отдельными кнопками на кассе.</p>
        <div className="flex flex-wrap items-end gap-2">
          {canEdit ? (
            <Field label="Шкала" className="w-64">
              {(control) => <Select {...control} value={scale?.externalId ?? NO_SCALE} onValueChange={(value) => void choose(value)} options={selectOptions} disabled={busy} />}
            </Field>
          ) : null}
          <Button variant="secondary" asChild>
            <Link to="/office/size-scales">
              <Settings2 aria-hidden />
              Настроить шкалу
            </Link>
          </Button>
        </div>
      </div>
      {error ? (
        <Banner tone="danger" title="Не удалось сохранить">
          {error}
        </Banner>
      ) : null}
      {scale ? (
        <>
          <DataTable caption={`Шкала «${scale.name}»`} columns={columns} rows={[...scale.options].sort((a, b) => a.sortOrder - b.sortOrder)} getRowId={(option) => option.externalId} />
          <p className="text-caption text-muted-foreground">
            Цена — базовая цена × коэффициент. Своя цена филиала и строки приказа о ценах по размеру применяются на кассе поверх неё.
          </p>
        </>
      ) : (
        <EmptyState title={`Для «${card.name}» шкала не назначена`} description="Создайте шкалу и привяжите к ней блюдо в отдельном справочнике." />
      )}
    </Block>
  )
}
