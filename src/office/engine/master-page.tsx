import { Plus } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { Button, Input, StatusPill, useToast } from "@/shared/components/ui"
import { useBreakpoint } from "@/shared/hooks/use-breakpoint"
import { errorMessage } from "@/shared/lib/error-message"
import { cn, focusRingClass } from "@/shared/lib/utils"

import type { ModuleApi } from "./define-module-api"
import { DomainForm, useDomainForm, type FormValues } from "./domain-form"
import type { ModuleConfig } from "./module-config"

export interface MasterPageProps<Row> {
  config: ModuleConfig<Row>
  api: ModuleApi<Row>
  getRowId: (row: Row) => string
  toValues: (row: Row | null) => FormValues
}

/**
 * Master data and Settings (OFFICE-DESIGN §3.2/§3.3): list 360px + form. `publish` lifecycles get
 * «Сохранить черновик / Опубликовать»; below 1280px the form slides in from the right.
 */
export function MasterPage<Row>({ config, api, getRowId, toValues }: MasterPageProps<Row>) {
  const list = api.useList({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState("")
  const breakpoint = useBreakpoint()
  const inline = breakpoint === "laptop" || breakpoint === "desktop"

  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru")
    return query ? list.results.filter((row) => (config.searchText?.(row) ?? config.titleOf(row)).toLocaleLowerCase("ru").includes(query)) : list.results
  }, [list.results, search, config])
  const selected = rows.find((row) => getRowId(row) === selectedId) ?? null
  const editing = creating || selected !== null

  const form = (
    <MasterForm
      key={creating ? "new" : (selectedId ?? "none")}
      config={config}
      api={api}
      initial={toValues(creating ? null : selected)}
      id={creating ? undefined : (selectedId ?? undefined)}
      onSaved={(id) => {
        setCreating(false)
        setSelectedId(id)
      }}
    />
  )

  return (
    <div className="flex min-h-0 flex-col gap-4 lg:flex-row">
      <section aria-label="Список" className="flex w-full shrink-0 flex-col gap-3 lg:w-[360px]">
        <div className="flex gap-2">
          <Input type="search" aria-label="Поиск" placeholder="Поиск" value={search} onChange={(event) => setSearch(event.target.value)} />
          <Button
            variant="secondary"
            size="icon"
            aria-label={`Новая запись: ${config.entityLabel}`}
            onClick={() => {
              setSelectedId(null)
              setCreating(true)
            }}
          >
            <Plus />
          </Button>
        </div>
        {list.status === "LoadingFirstPage" ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : rows.length === 0 ? (
          <OfficeStatePage state={{ kind: "empty", action: <Button onClick={() => setCreating(true)}>Создать</Button> }} />
        ) : (
          <ul className="flex flex-col overflow-hidden rounded-card border border-border bg-card">
            {rows.map((row) => {
              const id = getRowId(row)
              const active = id === selectedId && !creating
              return (
                <li key={id} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => {
                      setCreating(false)
                      setSelectedId(id)
                    }}
                    className={cn("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted", active && "bg-muted shadow-[inset_2px_0_0_var(--gold)]", focusRingClass)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm font-semibold">{config.titleOf(row)}</span>
                      {config.metaOf ? <span className="block truncate text-caption text-muted-foreground">{config.metaOf(row)}</span> : null}
                    </span>
                    {config.statusOf ? <StatusPill domain={config.statusDomain ?? "document"} status={config.statusOf(row)} /> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      {inline ? (
        <section aria-label={config.entityLabel} className="min-w-0 flex-1 rounded-card border border-border bg-card p-5">
          {editing ? form : <p className="py-10 text-center text-body-sm text-muted-foreground">Выберите запись слева или создайте новую.</p>}
        </section>
      ) : (
        <RightPanel
          open={editing}
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false)
              setSelectedId(null)
            }
          }}
          title={creating ? `Новая запись: ${config.entityLabel}` : selected ? config.titleOf(selected) : ""}
        >
          {form}
        </RightPanel>
      )}
    </div>
  )
}

function MasterForm<Row>({ config, api, initial, id, onSaved }: { config: ModuleConfig<Row>; api: ModuleApi<Row>; initial: FormValues; id?: string; onSaved: (id: string) => void }) {
  const form = useDomainForm(config.fields, initial)
  const save = api.useSave()
  const toast = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const publishable = config.lifecycle === "publish"
  useEffect(() => setError(null), [id])

  async function submit(publish: boolean) {
    if (!form.check()) return
    setSubmitting(true)
    setError(null)
    try {
      const savedId = await save({ ...form.values, id, publish })
      form.markSaved()
      toast(publish ? "Опубликовано" : "Сохранено", "success")
      onSaved(savedId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        void submit(publishable)
      }}
    >
      <DomainForm fields={config.fields} values={form.values} errors={form.errors} onChange={form.setValue} />
      {error ? (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        {form.dirty ? (
          <Button variant="ghost" onClick={() => form.reset()} disabled={submitting}>
            Сброс
          </Button>
        ) : null}
        {publishable ? (
          <Button variant="secondary" onClick={() => void submit(false)} disabled={submitting}>
            Сохранить черновик
          </Button>
        ) : null}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Сохранение…" : publishable ? "Опубликовать" : "Сохранить"}
        </Button>
      </div>
    </form>
  )
}

/** Settings is the master-detail page with a publish lifecycle. */
export const SettingsPage = MasterPage
