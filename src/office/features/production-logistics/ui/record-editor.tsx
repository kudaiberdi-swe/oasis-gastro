import { ArrowLeft, Trash2 } from "lucide-react"
import { useState, type ReactNode } from "react"
import { useNavigate } from "react-router"

import { useCapabilities } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { ReadOnlyField } from "@/office/features/stock-documents/ui/document-editor"
import { ReverseDialog } from "@/office/features/stock-documents/ui/reverse-dialog"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { allowsCapability } from "@/office/model/capabilities"
import { Banner, Button, ConfirmDialog, DataTable, EmptyState, Field, Input, KpiCard, Select, StatusPill, Textarea, useToast, type Column } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatQuantity } from "@/shared/lib/format"

import { formatBusinessDate, parsePlanned, type LogisticsConfig, type RecordAction } from "../config"
import { useLogisticsMutations, useRecord, type ProductionRecordDoc } from "../data/use-production-logistics"

/** /office/<kitchen-plan|semi-finished-sheet>/:id — a plan or a sheet (Editor §3.4): lines from the forecast. */
export function RecordEditor({ config, externalId }: { config: LogisticsConfig; externalId: string }) {
  const navigate = useNavigate()
  const record = useRecord(externalId)
  const back = () => navigate(`/office/${config.moduleId}`)
  if (record === undefined) return <Padded><OfficeStatePage state={{ kind: "loading" }} /></Padded>
  if (record === null || record.moduleId !== config.moduleId) {
    return (
      <Padded>
        <EmptyState
          title="Запись не найдена"
          description="Возможно, она относится к ресторану вне вашего доступа или ссылка устарела."
          action={
            <Button variant="secondary" onClick={back}>
              <ArrowLeft aria-hidden />К списку
            </Button>
          }
        />
      </Padded>
    )
  }
  // A new server version (a save, a transition, an act made from the sheet) re-reads the form.
  return <RecordForm key={`${record.externalId}:${record.version}`} config={config} record={record} onBack={back} />
}

function Padded({ children }: { children: ReactNode }) {
  return <div className="px-6 py-5 xl:px-8">{children}</div>
}

type Line = ProductionRecordDoc["lines"][number]
type Busy = RecordAction | "save" | "refresh" | "act" | null

function RecordForm({ config, record, onBack }: { config: LogisticsConfig; record: ProductionRecordDoc; onBack: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const capabilities = useCapabilities()
  const can = (capability: string) => allowsCapability(capabilities, capability)
  const canEdit = can(`office.${config.moduleId}.edit`)
  const mutations = useLogisticsMutations()
  const sheet = config.moduleId === "semi-finished-sheet"
  const editable = record.status === "draft" && canEdit

  const initialPlanned = () => Object.fromEntries(record.lines.map((line) => [line.productExternalId, String(line.plannedQuantity)]))
  const [planned, setPlanned] = useState<Record<string, string>>(initialPlanned)
  const [removed, setRemoved] = useState<string[]>([])
  const [comment, setComment] = useState(record.comment)
  const dirty = comment !== record.comment || removed.length > 0 || record.lines.some((line) => parsePlanned(planned[line.productExternalId] ?? "") !== line.plannedQuantity)
  const blocker = useUnsavedChanges(dirty && editable)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<"cancel" | "reverse" | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const warehouses = record.warehouses.map((warehouse) => ({ value: warehouse.externalId, label: warehouse.name }))
  const [source, setSource] = useState(warehouses[0]?.value ?? "")
  const [destination, setDestination] = useState(warehouses[0]?.value ?? "")

  const lines = record.lines.filter((line) => !removed.includes(line.productExternalId))
  const invalid = lines.filter((line) => parsePlanned(planned[line.productExternalId] ?? "") === null).map((line) => line.productExternalId)
  const plannedOf = (line: Line) => (editable ? (parsePlanned(planned[line.productExternalId] ?? "") ?? 0) : line.plannedQuantity)
  const left = (line: Line) => Math.max(0, plannedOf(line) - (line.actualQuantity ?? 0))
  const producible = lines.filter((line) => line.canProduce && left(line) > 1e-6)

  async function run(action: Exclude<Busy, null>, work: () => Promise<void>) {
    if (busy) return
    setBusy(action)
    setError(null)
    try {
      await work()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось выполнить действие"))
    } finally {
      setBusy(null)
    }
  }

  /** Saves the draft's edits when there are any; returns the version the next call expects. */
  async function persist() {
    if (!dirty) return record.version
    if (invalid.length) throw new Error("Укажите план числом не меньше нуля")
    await mutations.saveRecord({ externalId: record.externalId, expectedVersion: record.version, comment, lines: lines.map((line) => ({ productExternalId: line.productExternalId, plannedQuantity: parsePlanned(planned[line.productExternalId] ?? "")! })) })
    return record.version + 1
  }

  function perform(action: RecordAction) {
    if (action === "cancel" || action === "reverse") {
      setCancelError(null)
      setDialog(action)
      return
    }
    void run(action, async () => {
      const expectedVersion = record.status === "draft" ? await persist() : record.version
      await mutations.transitionRecord({ externalId: record.externalId, action, expectedVersion })
      toast(action === "approve" ? "План утверждён" : "Ведомость проведена — факт зафиксирован", "success")
    })
  }

  const actions = config.actions.filter((entry) => entry.from.includes(record.status) && can(`office.${config.moduleId}.${entry.right}`))
  const primary = actions.find((entry) => entry.kind === "primary")
  const plannedTotal = lines.reduce((sum, line) => sum + plannedOf(line), 0)
  const forecastTotal = lines.reduce((sum, line) => sum + line.forecastQuantity, 0)
  const doneCount = lines.filter((line) => plannedOf(line) > 0 && left(line) <= 1e-6).length

  const columns: Column<Line>[] = [
    { key: "no", header: "№", cell: (line) => <span className="tabular-nums text-muted-foreground">{line.lineNo}</span> },
    { key: "name", header: config.itemLabel, cell: (line) => <span className="font-medium">{line.name}</span> },
    { key: "forecast", header: sheet ? "Потребность" : "Прогноз", numeric: true, cell: (line) => formatQuantity(line.forecastQuantity, line.unit ?? undefined) },
    ...(sheet ? [{ key: "onHand", header: "Остаток", numeric: true, cell: (line: Line) => formatQuantity(line.onHand ?? 0, line.unit ?? undefined) }] : []),
    {
      key: "planned",
      header: "План",
      numeric: true,
      cell: (line) =>
        editable ? (
          <div className="flex flex-col items-end gap-1">
            <Input
              aria-label={`План: ${line.name}`}
              inputMode="decimal"
              className="h-10 w-28 text-right tabular-nums"
              value={planned[line.productExternalId] ?? ""}
              aria-invalid={invalid.includes(line.productExternalId) || undefined}
              onChange={(event) => setPlanned((current) => ({ ...current, [line.productExternalId]: event.target.value }))}
            />
            {invalid.includes(line.productExternalId) ? <span className="text-caption text-destructive">Число ≥ 0</span> : null}
          </div>
        ) : (
          <span className="font-semibold">{formatQuantity(line.plannedQuantity, line.unit ?? undefined)}</span>
        ),
    },
    ...(sheet
      ? [
          { key: "actual", header: "Факт", numeric: true, cell: (line: Line) => formatQuantity(line.actualQuantity ?? 0, line.unit ?? undefined) },
          { key: "left", header: "Осталось", numeric: true, cell: (line: Line) => (line.canProduce ? formatQuantity(left(line), line.unit ?? undefined) : <span className="text-muted-foreground">по составу</span>) },
        ]
      : []),
    ...(editable
      ? [
          {
            key: "remove",
            header: <span className="sr-only">Удалить</span>,
            cell: (line: Line) =>
              lines.length > 1 ? (
                <Button variant="ghost" size="icon-sm" aria-label={`Убрать «${line.name}»`} onClick={() => setRemoved((current) => [...current, line.productExternalId])}>
                  <Trash2 aria-hidden />
                </Button>
              ) : null,
          },
        ]
      : []),
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5 xl:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-title font-semibold">
                {config.entityLabel} {record.number}
              </h2>
              <StatusPill domain="document" status={record.status} />
            </div>
            <p className="text-body-sm text-muted-foreground">
              {record.restaurantName} · {formatBusinessDate(record.businessDate)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {editable ? <SaveStatus state={busy === "save" ? "saving" : dirty ? "dirty" : "clean"} /> : null}
            <Button variant="secondary" onClick={onBack}>
              <ArrowLeft aria-hidden />К списку
            </Button>
            {actions
              .filter((entry) => entry.kind === "danger")
              .map((entry) => (
                <Button key={entry.action} variant="danger" onClick={() => perform(entry.action)} disabled={busy !== null}>
                  {entry.label}
                </Button>
              ))}
            {editable ? (
              <>
                <Button variant="secondary" disabled={busy !== null || dirty} onClick={() => void run("refresh", async () => {
                  await mutations.refreshRecord({ externalId: record.externalId, expectedVersion: record.version })
                  toast("Пересчитано по прогнозу", "success")
                })}>
                  {busy === "refresh" ? "Пересчёт…" : "Пересчитать по прогнозу"}
                </Button>
                <Button variant="secondary" disabled={busy !== null || !dirty} onClick={() => void run("save", async () => {
                  await persist()
                  toast("Черновик сохранён", "success")
                })}>
                  {busy === "save" ? "Сохранение…" : "Сохранить"}
                </Button>
              </>
            ) : null}
            {primary ? (
              <Button onClick={() => perform(primary.action)} disabled={busy !== null || invalid.length > 0}>
                {busy === primary.action ? "Выполняется…" : primary.label}
              </Button>
            ) : null}
          </div>
        </header>

        {record.status === "posted" ? (
          <Banner tone="info" title="Ведомость проведена — только чтение">
            {record.postedAt ? `Проведена ${formatAlmatyDateTime(record.postedAt)}; ` : ""}факт зафиксирован на момент проведения. Изменить её можно только сторнированием.
          </Banner>
        ) : null}
        {record.status === "active" ? <Banner tone="info" title="План утверждён">Изменить его нельзя; для другого плана на этот день отмените этот.</Banner> : null}
        {record.status === "reversed" ? <Banner tone="warning" title="Ведомость сторнирована">{record.reason ?? "Причина не указана."}</Banner> : null}
        {record.status === "cancelled" ? <Banner tone="info" title="Запись отменена">{record.reason ?? "Причина не указана."}</Banner> : null}
        {error ? (
          <Banner tone="danger" title="Не удалось выполнить действие">
            {error}
          </Banner>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <KpiCard label={sheet ? "Заготовок" : "Блюд"} value={lines.length} />
          {sheet ? (
            <>
              <KpiCard label="Выпущено по плану" value={`${doneCount} из ${lines.filter((line) => plannedOf(line) > 0).length}`} hint="Проведённые акты приготовления за дату" />
              <KpiCard label="Актов приготовления" value={record.acts.length} />
            </>
          ) : (
            <>
              <KpiCard label="Порций по плану" value={formatQuantity(plannedTotal)} />
              <KpiCard label="Порций по прогнозу" value={formatQuantity(forecastTotal)} hint="Средний спрос в этот день недели за шесть недель" />
            </>
          )}
        </div>

        <section aria-label="Основные реквизиты" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
          <h3 className="text-title-sm font-semibold">Основные реквизиты</h3>
          <div className="grid gap-4 md:grid-cols-3">
            <ReadOnlyField label="Номер" value={record.number} />
            <ReadOnlyField label="Дата" value={formatBusinessDate(record.businessDate)} />
            <ReadOnlyField label="Ресторан" value={record.restaurantName} />
            {editable ? (
              <Field label="Комментарий" className="md:col-span-3">
                {(control) => <Textarea {...control} value={comment} onChange={(event) => setComment(event.target.value)} />}
              </Field>
            ) : (
              <ReadOnlyField label="Комментарий" value={record.comment || "—"} className="md:col-span-3" />
            )}
          </div>
        </section>

        <section aria-label={config.linesTitle} className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-title-sm font-semibold">
              {config.linesTitle} <span className="text-body-sm font-normal text-muted-foreground tabular-nums">{lines.length}</span>
            </h3>
            <p className="text-caption text-muted-foreground">
              {sheet
                ? "Потребность — прогноз блюд × техкарты; план = потребность − остаток ресторана на момент расчёта; факт — проведённые акты приготовления за дату."
                : "Прогноз — средний спрос в этот день недели за шесть недель, в порциях; план можно поправить до утверждения."}
            </p>
          </div>
          <DataTable caption={config.linesTitle} columns={columns} rows={lines} getRowId={(line) => line.productExternalId} />
        </section>

        {sheet ? (
          <ProductionActsSection
            record={record}
            canCreate={can("office.production.edit") && canEdit && (record.status === "draft" || record.status === "posted")}
            canOpen={can("office.production.view")}
            dirty={dirty}
            busy={busy === "act"}
            disabled={busy !== null}
            producible={producible.length}
            warehouses={warehouses}
            source={source}
            destination={destination}
            onSource={setSource}
            onDestination={setDestination}
            onOpen={(externalId) => navigate(`/office/production/${encodeURIComponent(externalId)}`)}
            onCreate={() =>
              void run("act", async () => {
                const result = await mutations.createProductionAct({ externalId: record.externalId, sourceWarehouseExternalId: source, destinationWarehouseExternalId: destination })
                toast(result.skipped.length ? `Акт создан: ${result.lines} поз.; по составу готовятся: ${result.skipped.join(", ")}` : `Акт приготовления создан: ${result.lines} поз.`, "success")
              })
            }
          />
        ) : null}

        <section aria-label="Проведение и аудит" className="flex flex-col gap-3 rounded-card border border-border bg-card p-5">
          <h3 className="text-title-sm font-semibold">Проведение и аудит</h3>
          <div className="grid gap-4 md:grid-cols-3">
            <ReadOnlyField label="Создал" value={`${record.createdBy} · ${formatAlmatyDateTime(record.createdAt)}`} />
            <ReadOnlyField label={sheet ? "Проведена" : "Изменён"} value={sheet ? (record.postedAt ? formatAlmatyDateTime(record.postedAt) : "—") : formatAlmatyDateTime(record.updatedAt)} />
            <ReadOnlyField label={sheet ? "Сторнирована" : "Версия"} value={sheet ? (record.reversedAt ? formatAlmatyDateTime(record.reversedAt) : "—") : record.version} />
          </div>
        </section>
      </div>

      <ReverseDialog
        open={dialog === "reverse"}
        onOpenChange={(open) => setDialog(open ? "reverse" : null)}
        title={`Сторнировать ведомость ${record.number}?`}
        onReverse={async (reason) => {
          await mutations.transitionRecord({ externalId: record.externalId, action: "reverse", expectedVersion: record.version, reason })
          toast("Ведомость сторнирована", "success")
        }}
      />
      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title={`Отменить ${config.entityLabel.toLocaleLowerCase("ru")} ${record.number}?`}
        description="Отменённая запись остаётся в истории; на этот день можно будет создать новую по прогнозу."
        confirmLabel="Отменить запись"
        cancelLabel="Не отменять"
        reasonLabel="Причина отмены"
        submitting={busy === "cancel"}
        error={cancelError}
        onConfirm={async (reason) => {
          if (reason.trim().length < 3) {
            setCancelError("Опишите причину — хотя бы несколько слов")
            return
          }
          setBusy("cancel")
          setCancelError(null)
          try {
            await mutations.transitionRecord({ externalId: record.externalId, action: "cancel", expectedVersion: record.version, reason: reason.trim() })
            setDialog(null)
            toast("Запись отменена", "success")
          } catch (caught) {
            setCancelError(errorMessage(caught, "Не удалось отменить"))
          } finally {
            setBusy(null)
          }
        }}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}

function ProductionActsSection(props: {
  record: ProductionRecordDoc
  canCreate: boolean
  canOpen: boolean
  dirty: boolean
  busy: boolean
  disabled: boolean
  producible: number
  warehouses: { value: string; label: string }[]
  source: string
  destination: string
  onSource: (value: string) => void
  onDestination: (value: string) => void
  onOpen: (externalId: string) => void
  onCreate: () => void
}) {
  const { record } = props
  return (
    <section aria-label="Акты приготовления" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-title-sm font-semibold">Акты приготовления</h3>
        <p className="text-caption text-muted-foreground">Черновик акта берёт то, что осталось выпустить по плану; проводится он в разделе «Приготовление».</p>
      </div>
      {props.canCreate ? (
        props.warehouses.length === 0 ? (
          <Banner tone="warning" title="У ресторана нет активного склада">Добавьте склад кухни, чтобы создавать акты приготовления.</Banner>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Со склада · списать ингредиенты" className="w-full sm:w-64">
              {(control) => <Select {...control} value={props.source || undefined} onValueChange={props.onSource} options={props.warehouses} />}
            </Field>
            <Field label="На склад · оприходовать заготовку" className="w-full sm:w-64">
              {(control) => <Select {...control} value={props.destination || undefined} onValueChange={props.onDestination} options={props.warehouses} />}
            </Field>
            <Button onClick={props.onCreate} disabled={props.disabled || props.dirty || props.producible === 0 || !props.source || !props.destination}>
              {props.busy ? "Создание…" : "Создать акт приготовления"}
            </Button>
            {props.dirty ? <span className="text-caption text-muted-foreground">Сначала сохраните изменения плана</span> : props.producible === 0 ? <span className="text-caption text-muted-foreground">Всё по плану выпущено или готовится по составу</span> : null}
          </div>
        )
      ) : null}
      {record.acts.length ? (
        <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
          {record.acts.map((act) => (
            <li key={act.externalId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold">{act.number}</span>
                <span className="text-body-sm text-muted-foreground">
                  {formatAlmatyDateTime(act.date)} · {act.positions} поз.
                </span>
                <StatusPill domain="document" status={act.status} />
              </div>
              {props.canOpen ? (
                <Button size="sm" variant="ghost" onClick={() => props.onOpen(act.externalId)}>
                  Открыть акт
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-sm text-muted-foreground">По ведомости ещё нет актов.</p>
      )}
    </section>
  )
}
