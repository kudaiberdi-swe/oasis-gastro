import { useMemo, useState, type FormEvent } from "react"

import { flattenGroupTree, groupOptions, type ProductGroup } from "@/office/features/product-groups/data/use-product-groups"
import { Banner, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, MoneyInput, Select, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import { useNomenclatureMutations } from "../data/use-nomenclature"

type FieldErrors = Partial<Record<"name" | "group" | "basePrice", string>>

/** «+ Новое блюдо»: RU, KZ, группа, базовая цена, артикул; the rest is filled in the product card. */
export function NewProductDialog({ groups, defaultGroup, onClose }: { groups: readonly ProductGroup[]; defaultGroup?: string; onClose: () => void }) {
  const { createProduct } = useNomenclatureMutations()
  const toast = useToast()
  const [name, setName] = useState("")
  const [nameKk, setNameKk] = useState("")
  const [group, setGroup] = useState<string | undefined>(defaultGroup)
  const [basePrice, setBasePrice] = useState<number | null>(null)
  const [sku, setSku] = useState("")
  const [errors, setErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const options = useMemo(() => groupOptions(flattenGroupTree(groups.filter((candidate) => candidate.active))), [groups])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    const found: FieldErrors = {}
    if (!name.trim()) found.name = "Укажите название"
    if (!group) found.group = "Выберите группу"
    if (basePrice === null) found.basePrice = "Укажите базовую цену"
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSubmitting(true)
    setError(null)
    try {
      await createProduct({
        name: name.trim(),
        nameKk: nameKk.trim(),
        description: "",
        category: group!,
        categorySort: groups.find((candidate) => candidate.externalId === group)?.sortOrder ?? 0,
        basePrice: basePrice!,
        sku: sku.trim(),
        popular: false,
        baseUnit: "порц.",
      })
      toast("Блюдо создано", "success")
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось создать блюдо"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Новое блюдо</DialogTitle>
          <DialogDescription>Остальные свойства, цены филиалов и фото — в карточке блюда.</DialogDescription>
        </DialogHeader>
        <form aria-label="Новое блюдо" noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
          {error ? (
            <Banner tone="danger" title="Не удалось создать">
              {error}
            </Banner>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Название (рус)" error={errors.name}>
              {(control) => <Input {...control} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />}
            </Field>
            <Field label="Атауы (қаз)">{(control) => <Input {...control} value={nameKk} onChange={(event) => setNameKk(event.target.value)} autoComplete="off" />}</Field>
          </div>
          <Field label="Группа" error={errors.group}>
            {(control) => <Select {...control} value={group} onValueChange={setGroup} options={options} placeholder="Выберите группу" />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Базовая цена" error={errors.basePrice}>
              {(control) => <MoneyInput {...control} value={basePrice} onValueChange={setBasePrice} />}
            </Field>
            <Field label="Артикул">{(control) => <Input {...control} value={sku} onChange={(event) => setSku(event.target.value)} autoComplete="off" />}</Field>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Отмена
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Создание…" : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
