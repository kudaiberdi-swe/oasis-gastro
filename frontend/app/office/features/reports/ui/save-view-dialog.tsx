import { Heart } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"

import { useCan } from "@/office/components/can"
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import { useReportViewActions, useReportViews, type ReportConfig } from "../data/use-reports"
import type { ReportDefinition } from "../model/catalog"

// «В избранное» in the viewer (W1-RPT-05): not a favorite yet → Dialog «Название представления» saves the
// report with its current filters; «В избранном ♥» removes the report's favorite views. Hidden without
// `office.report-favorites.edit` (OFFICE-DESIGN §7), the server checks the right and the scope again.

export const FAVORITE_ADDED = "Отчёт добавлен в избранное вместе с текущими фильтрами."

export function FavoriteButton({ report, config }: { report: ReportDefinition; config: ReportConfig | null }) {
  const canView = useCan("office.report-favorites.view")
  const canEdit = useCan("office.report-favorites.edit")
  const views = useReportViews({ reportId: report.id }, canView && canEdit)
  const { toggleFavorite } = useReportViewActions()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!canView || !canEdit) return null

  const favorite = views?.some((view) => view.favorite) ?? false
  const remove = async () => {
    if (!config) return
    setBusy(true)
    try {
      await toggleFavorite({ reportId: report.id, config })
      toast("Отчёт убран из избранного", "success")
    } catch (error) {
      toast(errorMessage(error, "Не удалось убрать из избранного"), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {favorite ? (
        <Button variant="secondary" size="sm" aria-pressed disabled={!config || busy} onClick={() => void remove()}>
          <Heart aria-hidden className="fill-current text-primary" />
          В избранном ♥
        </Button>
      ) : (
        <Button variant="secondary" size="sm" aria-pressed={false} disabled={!config || views === undefined} onClick={() => setOpen(true)}>
          <Heart aria-hidden />
          В избранное
        </Button>
      )}
      {config ? <SaveViewDialog open={open} onOpenChange={setOpen} report={report} config={config} /> : null}
    </>
  )
}

export function SaveViewDialog({ open, onOpenChange, report, config }: { open: boolean; onOpenChange: (open: boolean) => void; report: ReportDefinition; config: ReportConfig }) {
  const { save } = useReportViewActions()
  const toast = useToast()
  const [name, setName] = useState(report.title)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) {
      setName(report.title)
      setError(null)
    }
  }, [open, report.title])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      setError("Укажите название представления")
      return
    }
    setSaving(true)
    try {
      await save({ reportId: report.id, name: name.trim(), favorite: true, config })
      toast(FAVORITE_ADDED, "success")
      onOpenChange(false)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить представление"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Название представления</DialogTitle>
            <DialogDescription>Сохранятся период, рестораны и фильтр строк. Представление видите только вы.</DialogDescription>
          </DialogHeader>
          <Field label="Название" error={error ?? undefined}>
            {(control) => <Input {...control} value={name} maxLength={120} autoComplete="off" onChange={(event) => setName(event.target.value)} autoFocus />}
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
              Отмена
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Сохранение…" : "Добавить в избранное"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
