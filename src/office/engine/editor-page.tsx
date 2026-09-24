import { ArrowLeft } from "lucide-react"
import { useState } from "react"

import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { Button, ConfirmDialog, DataTable, KpiCard, StatusPill, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { cn } from "@/shared/lib/utils"

import type { ModuleApi } from "./define-module-api"
import { DomainForm, useDomainForm, type FormValues } from "./domain-form"
import { formatValue } from "./format-value"
import { isReadOnlyStatus, type ModuleConfig } from "./module-config"
import { columnsFromConfig } from "./register-page"

export interface EditorPageProps<Row> {
  config: ModuleConfig<Row>
  api: ModuleApi<Row>
  record: Row
  id: string
  toValues: (row: Row) => FormValues
  onBack: () => void
}

/**
 * Document/entity editor (OFFICE-DESIGN §3.4): header with number, status and the one main action,
 * KPI tiles, requisites, line tabs with counts and a total, sticky footer. Posted documents are
 * read-only with a danger «Сторно» (L-18).
 */
export function EditorPage<Row>({ config, api, record, id, toValues, onBack }: EditorPageProps<Row>) {
  const status = config.statusOf?.(record)
  const readOnly = isReadOnlyStatus(config.lifecycle, status)
  const form = useDomainForm(config.fields, toValues(record))
  const blocker = useUnsavedChanges(form.dirty && !readOnly)
  const save = api.useSave()
  const transition = api.useTransition?.()
  const toast = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reversing, setReversing] = useState(false)
  const isDocument = config.lifecycle === "document" || config.lifecycle === "approval"

  async function run(action: () => Promise<unknown>, done: string) {
    setSubmitting(true)
    setError(null)
    try {
      await action()
      form.markSaved()
      toast(done, "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось выполнить действие"))
    } finally {
      setSubmitting(false)
    }
  }

  const saveDraft = () => {
    if (!form.check()) return
    void run(() => save({ ...form.values, id }), "Сохранено")
  }
  const post = () => {
    if (!form.check() || !transition) return
    void run(async () => {
      await save({ ...form.values, id })
      await transition({ id, to: "posted" })
    }, "Документ проведён")
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-col gap-5 pb-24">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-title font-semibold">
                {config.entityLabel} {config.titleOf(record)}
              </h2>
              {status ? <StatusPill domain={config.statusDomain ?? "document"} status={status} /> : null}
            </div>
            {config.metaOf ? <p className="text-body-sm text-muted-foreground">{config.metaOf(record)}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SaveStatus state={readOnly ? "clean" : form.dirty ? "dirty" : "clean"} />
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft />К списку
            </Button>
            {readOnly ? (
              status === "posted" && transition ? (
                <Button variant="danger" onClick={() => setReversing(true)}>
                  Сторно
                </Button>
              ) : null
            ) : (
              <>
                {form.dirty ? (
                  <Button variant="secondary" onClick={() => form.reset()} disabled={submitting}>
                    Сброс
                  </Button>
                ) : null}
                {isDocument && transition ? (
                  <Button onClick={post} disabled={submitting}>
                    Провести
                  </Button>
                ) : (
                  <Button onClick={saveDraft} disabled={submitting}>
                    Сохранить
                  </Button>
                )}
              </>
            )}
          </div>
        </header>

        {error ? (
          <p role="alert" className="text-body-sm text-destructive">
            {error}
          </p>
        ) : null}

        {config.kpis?.length ? (
          <div className={cn("grid gap-4", config.kpis.length >= 3 ? "md:grid-cols-4" : "md:grid-cols-2")}>
            {config.kpis.map((kpi) => (
              <KpiCard key={kpi.key} label={kpi.label} value={formatValue(kpi.kind, kpi.compute([record]), { unit: kpi.unit })} />
            ))}
          </div>
        ) : null}

        <section aria-label="Реквизиты" className="rounded-card border border-border bg-card p-5">
          <DomainForm fields={config.fields} values={form.values} errors={form.errors} onChange={form.setValue} readOnly={readOnly} />
        </section>

        {config.lines ? <LinesSection config={config} record={record} /> : null}
      </div>

      {readOnly ? null : (
        <footer className="sticky bottom-0 -mx-6 flex items-center justify-between gap-3 border-t border-border bg-card px-6 py-3 shadow-panel xl:-mx-8 xl:px-8">
          <p className="text-caption text-muted-foreground">{isDocument ? "Проведённый документ можно изменить только сторнированием." : "Изменения сохраняются кнопкой «Сохранить»."}</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => form.reset()} disabled={!form.dirty || submitting}>
              Отменить изменения
            </Button>
            {isDocument ? (
              <Button variant="secondary" onClick={saveDraft} disabled={submitting}>
                Сохранить черновик
              </Button>
            ) : null}
          </div>
        </footer>
      )}

      <ConfirmDialog
        open={reversing}
        onOpenChange={setReversing}
        title="Сторнировать документ?"
        description="Будет создана обратная запись; сам документ останется в истории."
        confirmLabel="Сторнировать"
        reasonLabel="Причина сторно"
        submitting={submitting}
        onConfirm={(reason) => {
          if (!transition) return
          void run(() => transition({ id, to: "reversed", reason }), "Документ сторнирован").then(() => setReversing(false))
        }}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}

function LinesSection<Row>({ config, record }: { config: ModuleConfig<Row>; record: Row }) {
  const lines = config.lines!
  const [tab, setTab] = useState(lines.tabs[0]?.key)
  const columns = columnsFromConfig(lines.columns)
  return (
    <section aria-label="Строки" className="flex flex-col gap-3">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {lines.tabs.map((candidate) => (
            <TabsTrigger key={candidate.key} value={candidate.key} count={candidate.rows(record).length}>
              {candidate.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {lines.tabs.map((candidate) => (
          <TabsContent key={candidate.key} value={candidate.key}>
            <DataTable caption={candidate.label} columns={columns} rows={candidate.rows(record)} getRowId={(row) => String(row.id ?? JSON.stringify(row))} />
          </TabsContent>
        ))}
      </Tabs>
      {lines.total ? (
        <p className="text-right text-body-sm">
          {lines.total.label}: <span className="sq-price text-title-sm font-semibold">{formatValue(lines.total.kind, lines.total.compute(record))}</span>
        </p>
      ) : null}
    </section>
  )
}
