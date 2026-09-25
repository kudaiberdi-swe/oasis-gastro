import { Download, Plus } from "lucide-react"
import { useId, useMemo, useState, type FormEvent } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import {
  Banner,
  Button,
  Combobox,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FilterTabs,
  Input,
  Select,
  StatusPill,
  useToast,
  type Column,
} from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import type { Id } from "../../../../../convex/_generated/dataModel"
import {
  useCorporationScope,
  useDepartmentMutations,
  useDepartments,
  useEmployeeOptions,
  useIikoDepartments,
  type DepartmentRow,
  type ScopeOption,
  type ScopeRestaurant,
} from "../data/use-corporation"
import { DEPARTMENT_KIND_LABELS, descendantsOf, MASTER_TABS, matchesSearch, matchesStatus, recordCount, type DepartmentKind, type StatusTab } from "../model/corporation"
import { ActiveSwitch, EditorBlock, Facts, SearchBox, WithErrorBoundary } from "./corporation-parts"

const ALL = "all"
const NONE = "none"

const KIND_OPTIONS = (Object.keys(DEPARTMENT_KIND_LABELS) as DepartmentKind[]).map((value) => ({ value, label: DEPARTMENT_KIND_LABELS[value] }))

/** «Подразделения» (/office/departments, W2-ADM-08): the department tree per organization, master lifecycle. */
export function DepartmentsWorkspace() {
  return <WithErrorBoundary>{() => <DepartmentsContent />}</WithErrorBoundary>
}

type Selection = { kind: "new" } | { kind: "edit"; externalId: string } | null

function DepartmentsContent() {
  const [tab, setTab] = useState<StatusTab>("all")
  const [search, setSearch] = useState("")
  const [organization, setOrganization] = useState(ALL)
  const [selection, setSelection] = useState<Selection>(null)
  const [importOpen, setImportOpen] = useState(false)
  const canEdit = useCan("office.departments.edit")
  const canImport = useCan("office.data-exchange.view") && canEdit
  const scope = useCorporationScope()
  const panelId = useId()
  const list = useDepartments({ organizationExternalId: organization === ALL ? undefined : organization })
  const searching = search.trim() !== ""
  const rows = useMemo(
    () => (list ?? []).filter((row) => matchesStatus(row.active, tab) && matchesSearch(search, row.name, row.code, row.costCenter, row.managerName)),
    [list, tab, search],
  )
  const selected = selection?.kind === "edit" ? list?.find((row) => row.externalId === selection.externalId) : undefined
  const panelOpen = selection?.kind === "new" || selected !== undefined
  const canCreate = canEdit && scope.organizations.length > 0
  const openNew = () => setSelection({ kind: "new" })
  const tabs = MASTER_TABS.map((item) => ({ ...item, count: list ? list.filter((row) => matchesStatus(row.active, item.value)).length : undefined }))
  const defaultOrganization = organization === ALL ? scope.organizations[0]?.externalId : organization

  const columns = useMemo<Column<DepartmentRow>[]>(
    () => [
      {
        key: "name",
        header: "Название",
        cell: (row) => (
          // The tree indents by level, like product groups; a search shows the matches flat.
          <span className="flex flex-col" style={{ paddingLeft: searching ? 0 : `${Math.min(row.level, 8) * 20}px` }}>
            <span className="font-semibold">{row.name}</span>
            <span className="text-caption text-muted-foreground">
              {row.code} · {DEPARTMENT_KIND_LABELS[row.kind]}
            </span>
          </span>
        ),
      },
      { key: "restaurant", header: "Ресторан", cell: (row) => scope.restaurantName(row.restaurantExternalId) ?? "—" },
      { key: "manager", header: "Ответственный", cell: (row) => row.managerName ?? "—" },
      { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.active ? "active" : "inactive"} /> },
    ],
    [scope, searching],
  )

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
        {canCreate ? (
          <div className="flex flex-wrap justify-end gap-2">
            {canImport ? (
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                <Download aria-hidden />
                Создать из iiko
              </Button>
            ) : null}
            <Button variant={panelOpen ? "secondary" : "primary"} onClick={openNew}>
              <Plus aria-hidden />
              Новое подразделение
            </Button>
          </div>
        ) : null}
        <FilterTabs aria-label="Статус подразделения" value={tab} onValueChange={(value) => setTab(value as StatusTab)} items={tabs} panelId={panelId} />
        <div id={panelId} role="tabpanel" aria-label={MASTER_TABS.find((item) => item.value === tab)?.label} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <SearchBox label="Поиск подразделений" placeholder="Поиск: название, код, ответственный" value={search} onChange={setSearch} />
            {scope.organizations.length > 1 ? (
              <Select
                aria-label="Организация"
                className="w-full sm:w-64"
                value={organization}
                onValueChange={setOrganization}
                options={[{ value: ALL, label: "Все организации" }, ...scope.organizations.map((item) => ({ value: item.externalId, label: item.name }))]}
              />
            ) : null}
            <span className="ml-auto text-caption text-muted-foreground">{list ? recordCount(rows.length) : ""}</span>
          </div>
          {list === undefined ? (
            <OfficeStatePage state={{ kind: "loading" }} />
          ) : list.length === 0 && organization === ALL ? (
            <OfficeStatePage
              state={{
                kind: "empty",
                title: "Подразделений пока нет",
                description: "Создайте структуру: цеха, склады, офис и доставку — или перенесите подразделение из iiko.",
                action: canCreate ? (
                  <Button variant="secondary" onClick={openNew}>
                    Новое подразделение
                  </Button>
                ) : undefined,
              }}
            />
          ) : (
            <DataTable
              caption="Подразделения"
              columns={columns}
              rows={rows}
              getRowId={(row) => row.externalId}
              onRowClick={(row) => setSelection({ kind: "edit", externalId: row.externalId })}
              selectedId={selected?.externalId ?? null}
              empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Нет подразделений по выбранным фильтрам</p>}
            />
          )}
        </div>
      </div>
      <RightPanel
        open={panelOpen}
        onOpenChange={(open) => {
          if (!open) setSelection(null)
        }}
        title={selected ? selected.name : "Новое подразделение"}
        footer={
          canEdit ? (
            <Button type="submit" form="department-editor">
              Сохранить
            </Button>
          ) : undefined
        }
      >
        {panelOpen ? (
          <DepartmentEditor
            key={selected ? `${selected.externalId}:${selected.version}` : "new"}
            department={selected ?? null}
            departments={list ?? []}
            organizations={scope.organizations}
            restaurants={scope.restaurants}
            organizationName={scope.organizationName}
            defaultOrganization={defaultOrganization}
            canEdit={canEdit}
            onCreated={(externalId) => setSelection({ kind: "edit", externalId })}
          />
        ) : null}
      </RightPanel>
      {canImport ? (
        <CreateFromIikoDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          organizations={scope.organizations}
          defaultOrganization={defaultOrganization}
          onCreated={(externalId) => {
            setImportOpen(false)
            setSelection({ kind: "edit", externalId })
          }}
        />
      ) : null}
    </div>
  )
}

type FieldErrors = Partial<Record<"code" | "name" | "organization", string>>

export function DepartmentEditor({
  department,
  departments,
  organizations,
  restaurants,
  organizationName,
  defaultOrganization,
  canEdit,
  onCreated,
}: {
  department: DepartmentRow | null
  departments: DepartmentRow[]
  organizations: ScopeOption[]
  restaurants: ScopeRestaurant[]
  organizationName: (externalId: string | undefined | null) => string | undefined
  defaultOrganization: string | undefined
  canEdit: boolean
  onCreated: (externalId: string) => void
}) {
  const { saveDepartment, setDepartmentActive } = useDepartmentMutations()
  const canViewEmployees = useCan("office.employees.view")
  const toast = useToast()
  const [organizationExternalId, setOrganizationExternalId] = useState<string | undefined>(department?.organizationExternalId ?? defaultOrganization)
  const [code, setCode] = useState(department?.code ?? "")
  const [name, setName] = useState(department?.name ?? "")
  const [parent, setParent] = useState(department?.parentExternalId ?? NONE)
  const [restaurant, setRestaurant] = useState(department?.restaurantExternalId ?? NONE)
  const [kind, setKind] = useState<DepartmentKind>(department?.kind ?? "production")
  const [manager, setManager] = useState<string>(department?.managerEmployeeId ?? NONE)
  const [costCenter, setCostCenter] = useState(department?.costCenter ?? "")
  const [errors, setErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const employees = useEmployeeOptions(canViewEmployees && canEdit)

  const readOnly = !canEdit
  const fromIiko = department?.sourceSystem === "iiko-server"

  // A parent from the same organization that is not this department or one of its children (no cycles).
  const excluded = useMemo(() => (department ? descendantsOf(departments, department.externalId) : new Set<string>()), [department, departments])
  const parentOptions = [
    { value: NONE, label: "Без родителя (верхний уровень)" },
    ...departments
      .filter((row) => row.organizationExternalId === organizationExternalId && !excluded.has(row.externalId))
      .map((row) => ({ value: row.externalId, label: `${"· ".repeat(Math.min(row.level, 6))}${row.name}`, hint: row.code })),
  ]
  const restaurantOptions = [
    { value: NONE, label: "Не привязано к ресторану" },
    ...restaurants.filter((row) => row.organizationExternalId === organizationExternalId).map((row) => ({ value: row.externalId, label: row.name })),
  ]
  if (restaurant !== NONE && !restaurantOptions.some((option) => option.value === restaurant)) restaurantOptions.push({ value: restaurant, label: restaurant })
  const managerOptions = [{ value: NONE, label: "Не назначен" }, ...employees.employees.map((row) => ({ value: row.id, label: row.name, hint: row.hint }))]
  if (department?.managerEmployeeId && !managerOptions.some((option) => option.value === department.managerEmployeeId)) {
    managerOptions.push({ value: department.managerEmployeeId, label: department.managerName ?? "Сотрудник", hint: undefined })
  }
  const organizationOptions =
    department && !organizations.some((item) => item.externalId === department.organizationExternalId)
      ? [{ externalId: department.organizationExternalId, name: organizationName(department.organizationExternalId) ?? department.organizationExternalId }, ...organizations]
      : organizations

  function changeOrganization(value: string) {
    setOrganizationExternalId(value)
    // Parent and restaurant belong to the organization: a new one resets them.
    setParent(NONE)
    setRestaurant(NONE)
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {}
    if (!code.trim()) next.code = "Укажите код"
    if (!name.trim()) next.name = "Укажите название"
    if (!organizationExternalId) next.organization = "Выберите организацию"
    return next
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (readOnly || submitting) return
    setError(null)
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSubmitting(true)
    try {
      const externalId = await saveDepartment({
        ...(department ? { externalId: department.externalId, expectedVersion: department.version } : {}),
        organizationExternalId: organizationExternalId!,
        restaurantExternalId: restaurant === NONE ? undefined : restaurant,
        code: code.trim(),
        name: name.trim(),
        parentExternalId: parent === NONE ? undefined : parent,
        kind,
        managerEmployeeId: manager === NONE ? undefined : (manager as Id<"employees">),
        costCenter: costCenter.trim() || undefined,
      })
      toast("Подразделение сохранено", "success")
      if (!department) onCreated(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить подразделение"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form id="department-editor" aria-label="Подразделение" noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
      {fromIiko ? (
        <Banner tone="info" title="Создано из iiko">
          Подразделение скопировано из зеркала iiko один раз; дальнейшие импорты его не меняют, а Sandyq ничего не пишет в iiko.
        </Banner>
      ) : null}
      {error ? (
        <Banner tone="danger" title="Не удалось сохранить">
          {error}
        </Banner>
      ) : null}

      <EditorBlock title="Основные реквизиты">
        <Field label="Организация" error={errors.organization} hint={department ? "Организацию подразделения менять нельзя" : undefined}>
          {(control) => (
            <Select
              {...control}
              value={organizationExternalId}
              onValueChange={changeOrganization}
              disabled={readOnly || department !== null}
              placeholder="Выберите организацию"
              options={organizationOptions.map((item) => ({ value: item.externalId, label: item.name }))}
            />
          )}
        </Field>
        <Field label="Код" error={errors.code}>
          {(control) => <Input {...control} value={code} onChange={(event) => setCode(event.target.value)} disabled={readOnly} autoComplete="off" />}
        </Field>
        <Field label="Название" error={errors.name}>
          {(control) => <Input {...control} value={name} onChange={(event) => setName(event.target.value)} disabled={readOnly} autoComplete="off" />}
        </Field>
        <Field label="Родительское подразделение">
          {(control) => <Combobox {...control} value={parent} onValueChange={setParent} disabled={readOnly || !organizationExternalId} options={parentOptions} searchPlaceholder="Поиск подразделения" />}
        </Field>
        <Field label="Тип">
          {(control) => <Select {...control} value={kind} onValueChange={(value) => setKind(value as DepartmentKind)} disabled={readOnly} options={KIND_OPTIONS} />}
        </Field>
      </EditorBlock>

      <EditorBlock title="Параметры">
        <Field label="Ресторан">
          {(control) => <Select {...control} value={restaurant} onValueChange={setRestaurant} disabled={readOnly || !organizationExternalId} options={restaurantOptions} />}
        </Field>
        <Field label="Ответственный" hint={canViewEmployees ? undefined : "Список сотрудников доступен с правом «Сотрудники — просмотр»"}>
          {(control) => (
            <Combobox
              {...control}
              value={manager}
              onValueChange={setManager}
              disabled={readOnly || (!canViewEmployees && manager === NONE)}
              options={managerOptions}
              searchPlaceholder="ФИО или код сотрудника"
              emptyText={employees.loading ? "Загрузка…" : "Сотрудник не найден"}
              onSearchChange={employees.setSearch}
            />
          )}
        </Field>
        <Field label="Центр затрат">
          {(control) => <Input {...control} value={costCenter} onChange={(event) => setCostCenter(event.target.value)} disabled={readOnly} autoComplete="off" />}
        </Field>
        {department ? (
          <ActiveSwitch
            id="department-active"
            label="Подразделение активно"
            active={department.active}
            disabled={readOnly}
            confirmTitle="Отключить подразделение?"
            confirmDescription={`«${department.name}» пропадёт из выбора в новых документах. Дочерние подразделения останутся как есть.`}
            onChange={async (active) => {
              await setDepartmentActive({ externalId: department.externalId, active })
              toast(active ? "Подразделение включено" : "Подразделение отключено", "success")
            }}
          />
        ) : null}
      </EditorBlock>

      {department ? (
        <EditorBlock title="Проведение и аудит">
          <Facts
            items={[
              ["Источник", fromIiko ? "iiko" : "Sandyq"],
              ["Уровень", <span className="tabular-nums">{department.level + 1}</span>],
              ["Версия записи", <span className="tabular-nums">{department.version}</span>],
            ]}
          />
        </EditorBlock>
      ) : null}
      {submitting ? (
        <p className="sr-only" role="status">
          Сохранение…
        </p>
      ) : null}
    </form>
  )
}

/** «Создать из iiko»: one department from the read-only iiko mirror, copied once (no import runs from here). */
export function CreateFromIikoDialog({
  open,
  onOpenChange,
  organizations,
  defaultOrganization,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizations: ScopeOption[]
  defaultOrganization: string | undefined
  onCreated: (externalId: string) => void
}) {
  const { createFromIiko } = useDepartmentMutations()
  const toast = useToast()
  const iikoDepartments = useIikoDepartments(open)
  const [organizationChoice, setOrganizationExternalId] = useState<string | undefined>(undefined)
  // The scope may load after the dialog mounts: until the user picks, the default follows it.
  const organizationExternalId = organizationChoice ?? defaultOrganization
  const [source, setSource] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const options = (iikoDepartments ?? []).map((row) => ({ value: row.externalId, label: row.name, hint: row.code ?? undefined }))

  async function submit() {
    if (!organizationExternalId || !source || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const externalId = await createFromIiko({ iikoDepartmentExternalId: source, organizationExternalId })
      toast("Подразделение создано из iiko", "success")
      setSource(undefined)
      onCreated(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось создать подразделение"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null)
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Создать из iiko</DialogTitle>
          <DialogDescription>Подразделение копируется из зеркала iiko один раз. В iiko ничего не записывается.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {organizations.length > 1 ? (
            <Field label="Организация">
              {(control) => (
                <Select
                  {...control}
                  value={organizationExternalId}
                  onValueChange={setOrganizationExternalId}
                  placeholder="Выберите организацию"
                  options={organizations.map((item) => ({ value: item.externalId, label: item.name }))}
                />
              )}
            </Field>
          ) : null}
          <Field label="Подразделение iiko" hint={iikoDepartments && iikoDepartments.length === 0 ? "В зеркале iiko нет подразделений — сначала запустите импорт" : undefined}>
            {(control) => (
              <Combobox
                {...control}
                value={source}
                onValueChange={setSource}
                disabled={iikoDepartments === undefined}
                placeholder={iikoDepartments === undefined ? "Загрузка…" : "Выберите подразделение"}
                options={options}
                searchPlaceholder="Название или код"
              />
            )}
          </Field>
          {error ? (
            <p role="alert" className="text-body-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} disabled={!organizationExternalId || !source || submitting}>
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
