import { Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"

import { useCan } from "@/office/components/can"
import { FormSection, RecordAudit } from "@/office/features/finance/ui/record-parts"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { MasterPanel, useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { Button, Field, Input, Select, StatusPill, useToast, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import { scopeLabel, scopeOptions, usePlatformRecord, usePlatformRecordMutations, usePlatformReferences, type PlatformRecord, type PlatformReferences, type RoutingRule } from "../data/use-platform-records"
import { EQUIPMENT_TYPE_LABELS, equipmentDraftOf, equipmentSaveArgs, NO_TERMINAL, ROUTING_DEVICES, SELF_TARGET, validateEquipment, type EquipmentDraft, type EquipmentErrors, type EquipmentType } from "../model/equipment"
import { MASTER_TABS, MissingRecordPanel, PlatformRegister, PlatformStatusActions } from "./platform-records"

const MODULE = "equipment"

const text = (value: unknown) => (typeof value === "string" ? value : "")

/** «Оборудование» (/office/equipment/:id?, W3-ADM-11): printers, KKM, scales, KDS and payment terminals of a restaurant. */
export function EquipmentWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <Equipment />
    </PlatformErrorBoundary>
  )
}

function Equipment() {
  const canEdit = useCan(`office.${MODULE}.edit`)
  const selection = useMasterSelection(MODULE)
  const references = usePlatformReferences(MODULE)
  const record = usePlatformRecord(MODULE, selection.selectedId)
  const formOpen = (selection.isNew && canEdit) || selection.selectedId !== null
  const terminalName = (externalId: string) => references?.terminals.find((terminal) => terminal.externalId === externalId)?.name ?? externalId

  const columns: Column<PlatformRecord>[] = [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.number}</span> },
    {
      key: "name",
      header: "Название",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{row.name}</span>
          <span className="truncate text-caption text-muted-foreground">{scopeLabel(references, row.restaurantExternalId)}</span>
        </div>
      ),
    },
    { key: "type", header: "Тип", cell: (row) => EQUIPMENT_TYPE_LABELS[text(row.data.type) as EquipmentType] ?? "—" },
    { key: "terminal", header: "Терминал", cell: (row) => (text(row.data.terminalExternalId) ? terminalName(text(row.data.terminalExternalId)) : <span className="text-muted-foreground">—</span>) },
    { key: "endpoint", header: "Адрес / порт", cell: (row) => (text(row.data.endpoint) ? <span className="font-mono text-body-sm">{text(row.data.endpoint)}</span> : <span className="text-muted-foreground">—</span>) },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]

  return (
    <div className="flex min-h-0 flex-1">
      <PlatformRegister
        moduleId={MODULE}
        caption="Оборудование"
        tabs={MASTER_TABS}
        columns={columns}
        searchPlaceholder="Поиск: оборудование"
        createLabel={canEdit ? "Новое устройство" : undefined}
        onCreate={selection.openNew}
        formOpen={formOpen}
        selectedId={selection.selectedId}
        onSelect={selection.select}
        emptyTitle="Оборудования пока нет"
        emptyDescription="Добавьте принтер чеков, кухонный принтер или экран кухни и укажите, какие станции на него печатаются."
        scopes={references ? scopeOptions(references, { organizations: false }) : []}
      />
      {selection.isNew && canEdit && references ? <EquipmentForm key="new" record={null} references={references} canEdit={canEdit} onClose={selection.close} onSaved={selection.select} /> : null}
      {selection.selectedId !== null && record && references ? <EquipmentForm key={record.externalId} record={record} references={references} canEdit={canEdit} onClose={selection.close} onSaved={selection.select} /> : null}
      {selection.selectedId !== null && (!record || !references) ? <MissingRecordPanel title="Оборудование" missing={record === null} onClose={selection.close} /> : null}
    </div>
  )
}

function EquipmentForm({ record, references, canEdit, onClose, onSaved }: { record: PlatformRecord | null; references: PlatformReferences; canEdit: boolean; onClose: () => void; onSaved: (externalId: string) => void }) {
  const [baseline, setBaseline] = useState(() => equipmentDraftOf(record, references.restaurants[0]?.externalId ?? ""))
  const [draft, setDraft] = useState(baseline)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const [errors, setErrors] = useState<EquipmentErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const { save } = usePlatformRecordMutations()
  const toast = useToast()
  const readOnly = !canEdit
  const set = (patch: Partial<EquipmentDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key as keyof EquipmentDraft]
      if ("routing" in patch) delete next.routingRows
      return next
    })
  }

  useEffect(() => {
    if (savedId && !dirty && savedId !== record?.externalId) onSaved(savedId)
  }, [savedId, dirty, record?.externalId, onSaved])

  const terminals = references.terminals.filter((terminal) => terminal.restaurantExternalId === draft.restaurantExternalId)
  const terminalOptions = [{ value: NO_TERMINAL, label: "Не привязано к терминалу" }, ...terminals.map((terminal) => ({ value: terminal.externalId, label: terminal.active ? terminal.name : `${terminal.name} (отключён)` }))]
  const printerOptions = [
    { value: SELF_TARGET, label: "Это устройство" },
    ...references.printers.filter((printer) => printer.restaurantExternalId === draft.restaurantExternalId && printer.externalId !== record?.externalId).map((printer) => ({ value: printer.externalId, label: printer.name })),
  ]
  const routes = ROUTING_DEVICES.includes(draft.type)
  const setRule = (index: number, patch: Partial<RoutingRule>) => set({ routing: draft.routing.map((rule, position) => (position === index ? { ...rule, ...patch } : rule)) })

  async function submit() {
    if (readOnly || saving) return
    const found = validateEquipment(draft)
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setError(null)
    try {
      const saved = await save(equipmentSaveArgs(draft, record))
      setBaseline(draft)
      toast("Устройство сохранено", "success")
      setSavedId(saved.externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить устройство"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <MasterPanel title={record ? record.name : "Новое устройство"} formLabel="Оборудование" dirty={dirty} saving={saving} canEdit={canEdit} isNew={!record} error={error} onSubmit={() => void submit()} onClose={onClose}>
      <FormSection title="Основные реквизиты">
        <Field label="Название" error={errors.name}>
          {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} disabled={readOnly} autoComplete="off" placeholder="Принтер горячего цеха" />}
        </Field>
        {!record && references.restaurants.length > 1 ? (
          <Field label="Ресторан" error={errors.restaurantExternalId}>
            {(control) => (
              <Select {...control} value={draft.restaurantExternalId || undefined} onValueChange={(restaurantExternalId) => set({ restaurantExternalId, terminalExternalId: "", routing: [] })} options={scopeOptions(references, { organizations: false })} disabled={readOnly} />
            )}
          </Field>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-body-sm font-medium text-muted-foreground">Ресторан</span>
            <span className="flex h-11 items-center text-body-sm text-foreground">{scopeLabel(references, draft.restaurantExternalId) || "—"}</span>
          </div>
        )}
        <Field label="Тип">
          {(control) => <Select {...control} value={draft.type} onValueChange={(type) => set({ type: type as EquipmentType })} options={Object.entries(EQUIPMENT_TYPE_LABELS).map(([value, label]) => ({ value, label }))} disabled={readOnly} />}
        </Field>
      </FormSection>
      <FormSection title="Параметры">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Серийный номер">
            {(control) => <Input {...control} value={draft.serial} onChange={(event) => set({ serial: event.target.value })} disabled={readOnly} autoComplete="off" />}
          </Field>
          <Field label="Драйвер / протокол">
            {(control) => <Input {...control} value={draft.driver} onChange={(event) => set({ driver: event.target.value })} disabled={readOnly} autoComplete="off" placeholder="ESC/POS" />}
          </Field>
        </div>
        <Field label="Адрес / порт" error={errors.endpoint} hint="IP и порт принтера или USB-путь, например 192.168.1.50:9100">
          {(control) => <Input {...control} className="font-mono" value={draft.endpoint} onChange={(event) => set({ endpoint: event.target.value })} disabled={readOnly} autoComplete="off" />}
        </Field>
        <Field label="Терминал" hint="Касса или экран, к которому подключено устройство">
          {(control) => <Select {...control} value={draft.terminalExternalId || NO_TERMINAL} onValueChange={(value) => set({ terminalExternalId: value === NO_TERMINAL ? "" : value })} options={terminalOptions} disabled={readOnly} />}
        </Field>
      </FormSection>
      {routes ? (
        <FormSection title="Маршрутизация печати">
          <p className="text-caption text-muted-foreground">Какая станция кухни печатается на каком принтере. Одна станция — одна строка.</p>
          {draft.routing.length ? (
            <table className="w-full text-body-sm">
              <caption className="sr-only">Станция → Принтер</caption>
              <thead>
                <tr className="text-left text-caption text-muted-foreground">
                  <th scope="col" className="pb-1 font-medium">
                    Станция
                  </th>
                  <th scope="col" className="pb-1 font-medium">
                    Принтер
                  </th>
                  {!readOnly ? (
                    <th scope="col" className="pb-1">
                      <span className="sr-only">Удалить</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {draft.routing.map((rule, index) => (
                  <tr key={index} className="align-top">
                    <td className="py-1 pr-2">
                      <Select aria-label={`Станция, строка ${index + 1}`} value={rule.station || undefined} onValueChange={(station) => setRule(index, { station })} options={stationOptions(references, rule.station)} disabled={readOnly} />
                      {errors.routingRows?.[index] ? (
                        <p role="alert" className="mt-1 text-caption text-destructive">
                          {errors.routingRows[index]}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-1 pr-2">
                      <Select aria-label={`Принтер, строка ${index + 1}`} value={rule.printerExternalId || undefined} onValueChange={(printerExternalId) => setRule(index, { printerExternalId })} options={withCurrent(printerOptions, rule.printerExternalId)} disabled={readOnly} />
                    </td>
                    {!readOnly ? (
                      <td className="w-11 py-1">
                        <Button variant="ghost" size="icon" aria-label={`Удалить строку ${index + 1}`} onClick={() => set({ routing: draft.routing.filter((_, position) => position !== index) })}>
                          <Trash2 aria-hidden />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-body-sm text-muted-foreground">Правил нет — устройство ничего не получает от кухни.</p>
          )}
          {!readOnly ? (
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => {
                const used = new Set(draft.routing.map((rule) => rule.station))
                const station = references.stations.find((candidate) => !used.has(candidate.value))?.value ?? ""
                set({ routing: [...draft.routing, { station, printerExternalId: SELF_TARGET }] })
              }}
            >
              <Plus aria-hidden />
              Добавить станцию
            </Button>
          ) : null}
        </FormSection>
      ) : null}
      {record ? (
        <RecordAudit record={record}>
          <PlatformStatusActions moduleId={MODULE} record={record} disabled={dirty} />
        </RecordAudit>
      ) : null}
    </MasterPanel>
  )
}

function stationOptions(references: PlatformReferences, current: string) {
  const options = references.stations.map((station) => ({ value: station.value, label: station.label }))
  return current && !options.some((option) => option.value === current) ? [...options, { value: current, label: current }] : options
}

function withCurrent(options: { value: string; label: string }[], current: string) {
  return current && !options.some((option) => option.value === current) ? [...options, { value: current, label: "Отключённый принтер" }] : options
}
