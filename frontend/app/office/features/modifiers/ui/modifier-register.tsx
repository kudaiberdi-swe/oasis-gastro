import { Plus } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import {
  Banner,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  loadMoreFromPaginated,
  Select,
  TonePill,
  useToast,
  type Column,
} from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatQuantity, formatTenge } from "@/shared/lib/format"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { MODIFIERS_PAGE_SIZE, useModifierGroups, useModifierMutations, useModifiers, type ModifierGroup, type ModifierRow, type ModifierSort } from "../data/use-modifiers"
import { ModifierEditorPanel } from "./modifier-editor-panel"

const ALL_GROUPS = "__all"
const SEARCH_DEBOUNCE_MS = 250

const SORT_OPTIONS: { value: ModifierSort; label: string }[] = [
  { value: "name", label: "По названию" },
  { value: "price", label: "По цене" },
]

export const MODIFIER_COLUMNS: Column<ModifierRow>[] = [
  {
    key: "name",
    header: "Название",
    cell: (row) => (
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden className="size-10 shrink-0 rounded-control bg-muted" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold text-foreground">{row.name}</span>
          {row.nameKk ? <span className="truncate text-caption text-muted-foreground">{row.nameKk}</span> : null}
        </div>
      </div>
    ),
  },
  { key: "group", header: "Группа", cell: (row) => row.groupName ?? "—" },
  { key: "price", header: "Цена", numeric: true, cell: (row) => (row.price > 0 ? formatTenge(row.price) : "Бесплатно") },
  { key: "ingredient", header: "Состав", cell: (row) => `${row.ingredientName} · ${formatQuantity(row.ingredientQuantity, row.unit)}` },
  { key: "status", header: "Статус", cell: (row) => (row.available ? <TonePill tone="success">В продаже</TonePill> : <TonePill>Недоступен</TonePill>) },
]

type Selection = { kind: "new" } | { kind: "edit"; row: ModifierRow } | null

/** «Справочник модификаторов»: groups on the left, the register, the editor in the right panel. */
export function ModifierRegister() {
  const canEdit = useCan("office.modifiers.edit")
  const groups = useModifierGroups()
  const [group, setGroup] = useState(ALL_GROUPS)
  const [sort, setSort] = useState<ModifierSort>("name")
  const [searchText, setSearchText] = useState("")
  const [search, setSearch] = useState("")
  const [selection, setSelection] = useState<Selection>(null)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const list = useModifiers({ groupExternalId: group === ALL_GROUPS ? undefined : group, search, sort })

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchText), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchText])

  const openNew = () => setSelection({ kind: "new" })

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col gap-4 lg:flex-row lg:items-start">
        <section aria-label="Группы модификаторов" className="flex w-full shrink-0 flex-col gap-2 lg:w-60">
          <GroupList groups={groups} value={group} onChange={setGroup} />
          {canEdit ? (
            <Button variant="secondary" size="sm" onClick={() => setCreatingGroup(true)}>
              <Plus aria-hidden />
              Группа
            </Button>
          ) : null}
        </section>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="search"
              aria-label="Поиск"
              placeholder="Модификатор, ингредиент или группа"
              className="w-full sm:w-[380px]"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
            <Select aria-label="Сортировка" className="w-full sm:w-44" value={sort} onValueChange={(value) => setSort(value as ModifierSort)} options={SORT_OPTIONS} />
            {canEdit ? (
              <Button className="sm:ml-auto" onClick={openNew}>
                <Plus aria-hidden />
                Новый модификатор
              </Button>
            ) : null}
          </div>
          {list.status === "LoadingFirstPage" ? (
            <OfficeStatePage state={{ kind: "loading" }} />
          ) : list.results.length === 0 && !search.trim() && group === ALL_GROUPS ? (
            <OfficeStatePage
              state={{
                kind: "empty",
                title: "Модификаторов пока нет",
                description: groups?.length ? "Создайте первый модификатор — добавку, соус или гарнир." : "Сначала создайте группу, например «Соусы».",
                action: canEdit ? (
                  <Button variant="secondary" onClick={() => (groups?.length ? openNew() : setCreatingGroup(true))}>
                    {groups?.length ? "Новый модификатор" : "Новая группа"}
                  </Button>
                ) : undefined,
              }}
            />
          ) : (
            <DataTable
              caption="Модификаторы"
              columns={MODIFIER_COLUMNS}
              rows={list.results}
              getRowId={(row) => row.externalId}
              selectedId={selection?.kind === "edit" ? selection.row.externalId : null}
              onRowClick={(row) => setSelection({ kind: "edit", row })}
              empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Ничего не найдено по выбранным фильтрам</p>}
              loadMore={loadMoreFromPaginated(list, MODIFIERS_PAGE_SIZE)}
            />
          )}
          {list.status === "Exhausted" && list.results.length > 0 ? <p className="text-caption text-muted-foreground">Все записи загружены</p> : null}
        </div>
      </div>

      {selection ? (
        <ModifierEditorPanel
          key={selection.kind === "edit" ? selection.row.externalId : "new"}
          modifier={selection.kind === "edit" ? selection.row : null}
          groups={groups ?? []}
          defaultGroup={group === ALL_GROUPS ? undefined : group}
          canEdit={canEdit}
          onClose={() => setSelection(null)}
        />
      ) : null}
      {creatingGroup ? <NewGroupDialog groups={groups ?? []} onClose={() => setCreatingGroup(false)} onCreated={setGroup} /> : null}
    </div>
  )
}

function GroupList({ groups, value, onChange }: { groups: readonly ModifierGroup[] | undefined; value: string; onChange: (value: string) => void }) {
  const items = [{ externalId: ALL_GROUPS, name: "Все группы", active: true }, ...(groups ?? [])]
  return (
    <ul className="flex flex-col overflow-hidden rounded-card border border-border bg-card">
      {items.map((item) => {
        const active = item.externalId === value
        return (
          <li key={item.externalId} className="border-b border-border last:border-b-0">
            <button
              type="button"
              aria-current={active ? "true" : undefined}
              onClick={() => onChange(item.externalId)}
              className={cn("flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left text-body-sm hover:bg-muted", active && "bg-muted font-semibold shadow-[inset_2px_0_0_var(--gold)]", focusRingClass)}
            >
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              {!item.active ? <span className="text-caption text-muted-foreground">неактивна</span> : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function NewGroupDialog({ groups, onClose, onCreated }: { groups: readonly ModifierGroup[]; onClose: () => void; onCreated: (externalId: string) => void }) {
  const { saveGroup } = useModifierMutations()
  const toast = useToast()
  const [name, setName] = useState("")
  const [nameKk, setNameKk] = useState("")
  const [nameError, setNameError] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    if (!name.trim()) {
      setNameError("Укажите название группы")
      return
    }
    setNameError(undefined)
    setSubmitting(true)
    setError(null)
    try {
      const sortOrder = (Math.max(0, ...groups.map((group) => group.sortOrder)) || 0) + 10
      const externalId = await saveGroup({ name: name.trim(), ...(nameKk.trim() ? { nameKk: nameKk.trim() } : {}), sortOrder })
      toast("Группа создана", "success")
      onCreated(externalId)
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось создать группу"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Новая группа модификаторов</DialogTitle>
          <DialogDescription>Например «Соусы» или «Гарниры». Лимиты выбора задаются для каждого блюда отдельно.</DialogDescription>
        </DialogHeader>
        <form aria-label="Новая группа модификаторов" noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
          {error ? (
            <Banner tone="danger" title="Не удалось создать">
              {error}
            </Banner>
          ) : null}
          <Field label="Название" error={nameError}>
            {(control) => <Input {...control} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />}
          </Field>
          <Field label="Атауы (қаз)">{(control) => <Input {...control} value={nameKk} onChange={(event) => setNameKk(event.target.value)} autoComplete="off" />}</Field>
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
