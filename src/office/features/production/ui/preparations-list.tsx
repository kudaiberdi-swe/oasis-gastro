import { Plus } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import { Banner, Button, Combobox, DataTable, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, loadMoreFromPaginated, RadioGroup, Select, StatusPill, TonePill, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatAmount, formatQuantity } from "@/shared/lib/format"

import { PRODUCTION_PAGE_SIZE, usePreparationCosts, usePreparations, useProductSearch, useSavePreparation, type PreparationRow } from "../data/use-production"
import { OUTPUT_UNITS, WRITE_OFF_METHODS, writeOffLabel, type OutputUnit, type WriteOffMethod } from "../model/production"

export const preparationPath = (productExternalId: string) => `/office/production/preparations/${encodeURIComponent(productExternalId)}`

/** «Заготовки» tab of /office/production (W2-PRD-01, Register §3.1). */
export function PreparationsList() {
  const navigate = useNavigate()
  const canEdit = useCan("office.production.edit")
  const canViewNomenclature = useCan("office.nomenclature.view")
  const [searchText, setSearchText] = useState("")
  const search = useDebounced(searchText)
  const [creating, setCreating] = useState(false)
  const list = usePreparations(search)
  const costs = usePreparationCosts(
    list.results.map((row) => row.productExternalId),
    canViewNomenclature,
  )

  const columns: Column<PreparationRow>[] = [
    { key: "name", header: "Название", cell: (row) => <span className="font-semibold">{row.name}</span> },
    { key: "unit", header: "Ед. выпуска", cell: (row) => row.unit ?? "—" },
    { key: "yield", header: "Выход", numeric: true, cell: (row) => (row.recipeVersion ? formatQuantity(row.recipeVersion.batchYield, row.unit ?? undefined) : "—") },
    { key: "method", header: "Метод списания", cell: (row) => writeOffLabel(row.writeOffMethod) },
    { key: "cost", header: "Себестоимость ед., ₸", numeric: true, cell: (row) => (costs[row.productExternalId] ? formatAmount(costs[row.productExternalId]!.costPerPortion) : "—") },
    { key: "onHand", header: "Остаток", numeric: true, cell: (row) => formatQuantity(row.onHand, row.unit ?? undefined) },
    { key: "status", header: "Статус", cell: (row) => (row.recipeVersion ? <StatusPill domain="document" status={row.recipeVersion.status} /> : <TonePill tone="warning">Нет техкарты</TonePill>) },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input type="search" aria-label="Поиск заготовок" placeholder="Название заготовки" className="w-full sm:w-[420px]" value={searchText} onChange={(event) => setSearchText(event.target.value)} />
        {canEdit && canViewNomenclature ? (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            Новая заготовка
          </Button>
        ) : null}
      </div>
      {list.status === "LoadingFirstPage" ? (
        <OfficeStatePage state={{ kind: "loading" }} />
      ) : list.results.length === 0 && !search.trim() && list.status === "Exhausted" ? (
        <OfficeStatePage state={{ kind: "empty", title: "Заготовок пока нет", description: "Отметьте позицию номенклатуры как заготовку — её можно будет выпускать актами приготовления." }} />
      ) : (
        <DataTable
          caption="Заготовки"
          columns={columns}
          rows={list.results}
          getRowId={(row) => row.productExternalId}
          onRowClick={(row) => navigate(preparationPath(row.productExternalId))}
          empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Ничего не найдено</p>}
          loadMore={loadMoreFromPaginated(list, PRODUCTION_PAGE_SIZE)}
        />
      )}
      {creating ? <NewPreparationDialog onClose={() => setCreating(false)} onCreated={(productExternalId) => navigate(preparationPath(productExternalId))} /> : null}
    </div>
  )
}

/** A product of the nomenclature becomes a preparation with its own stock item (savePreparation). */
function NewPreparationDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (productExternalId: string) => void }) {
  const [search, setSearch] = useState("")
  const products = useProductSearch(search, true)
  const save = useSavePreparation()
  const [product, setProduct] = useState<string | undefined>()
  const [unit, setUnit] = useState<OutputUnit>("кг")
  const [method, setMethod] = useState<WriteOffMethod>("finished-product")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const options = (products ?? []).map((row) => ({ value: row.externalId, label: row.name, hint: row.itemType === "preparation" ? "Уже заготовка" : row.category.label }))

  async function submit() {
    if (!product || busy) return
    setBusy(true)
    setError(null)
    try {
      await save({ productExternalId: product, unit, writeOffMethod: method })
      onCreated(product)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить заготовку"))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Новая заготовка</DialogTitle>
          <DialogDescription>Позиция номенклатуры станет заготовкой, для неё появится складская позиция.</DialogDescription>
        </DialogHeader>
        <Field label="Позиция номенклатуры">
          {(control) => (
            <Combobox
              {...control}
              value={product}
              onValueChange={setProduct}
              onSearchChange={setSearch}
              options={options}
              placeholder="Выберите позицию"
              searchPlaceholder="Название"
              emptyText={products === undefined ? "Загрузка…" : "Ничего не найдено"}
            />
          )}
        </Field>
        <Field label="Единица выпуска">{(control) => <Select {...control} value={unit} onValueChange={(value) => setUnit(value as OutputUnit)} options={[...OUTPUT_UNITS]} />}</Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-body-sm font-medium">Метод списания</span>
          <RadioGroup aria-label="Метод списания" value={method} onValueChange={(value) => setMethod(value as WriteOffMethod)} options={WRITE_OFF_METHODS.map((option) => ({ value: option.value, label: option.label, description: option.hint }))} />
        </div>
        {error ? (
          <Banner tone="danger" title="Не удалось сохранить">
            {error}
          </Banner>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} disabled={!product || busy}>
            {busy ? "Сохранение…" : "Сделать заготовкой"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
