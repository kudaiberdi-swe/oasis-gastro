import { useState } from "react"

import { OfficeStatePage } from "@/office/components/state-page"
import { usePlatformScope } from "@/office/features/platform/data/use-platform"
import { DataTable, type Column } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { formatTenge } from "@/shared/lib/format"

import { useExternalMenuPreview, type ExternalMenuCard, type ExternalMenuPreview, type ExternalMenuVersionRow } from "../data/use-integrations"

// Version history of an external menu (W3-INT-04): date, author, restaurant, content hash, and the
// positions of the chosen version exactly as the website receives them.

type PreviewItem = ExternalMenuPreview["items"][number]

const PREVIEW_COLUMNS: Column<PreviewItem>[] = [
  { key: "name", header: "Позиция", cell: (row) => <span className="flex flex-col"><span className="font-medium">{row.name}</span>{row.nameKk ? <span className="text-caption text-muted-foreground">{row.nameKk}</span> : null}</span>, sortValue: (row) => row.name },
  { key: "category", header: "Категория", cell: (row) => row.category, sortValue: (row) => row.category },
  { key: "options", header: "Размеры · модификаторы", numeric: true, cell: (row) => `${row.sizes} · ${row.modifierGroups}` },
  { key: "price", header: "Цена", numeric: true, cell: (row) => formatTenge(row.price), sortValue: (row) => row.price },
]

export function ExternalMenuVersions({ card }: { card: ExternalMenuCard }) {
  const scope = usePlatformScope()
  const [selectedId, setSelectedId] = useState<string | null>(card.versions[0]?.id ?? null)
  const preview = useExternalMenuPreview(selectedId)

  if (card.mode === "live") {
    return <p className="rounded-card border border-border bg-muted px-4 py-3 text-body-sm text-muted-foreground">Режим «Живое меню»: сайт получает текущий каталог, версии не сохраняются.</p>
  }

  const columns: Column<ExternalMenuVersionRow>[] = [
    { key: "date", header: "Дата", cell: (row) => <span className="whitespace-nowrap">{formatAlmatyDateTime(row.publishedAt)}</span>, sortValue: (row) => row.publishedAt },
    { key: "restaurant", header: "Ресторан", cell: (row) => scope.restaurantName(row.restaurantExternalId) },
    { key: "version", header: "Версия", cell: (row) => <code className="font-mono text-caption">{row.version}</code> },
    { key: "items", header: "Позиций", numeric: true, cell: (row) => row.itemCount },
    { key: "author", header: "Автор", cell: (row) => <span className="text-muted-foreground">{row.publishedBy}</span> },
  ]

  return (
    <section aria-label="История версий" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-title-sm font-semibold">История версий</h3>
        <p className="text-caption text-muted-foreground">Новая версия появляется, только если каталог или цены изменились.</p>
      </div>
      {card.versions.length === 0 ? (
        <OfficeStatePage state={{ kind: "empty", title: "Версий ещё нет", description: card.status === "published" ? "Снимки меню готовятся — обновится сам." : "Нажмите «Опубликовать меню»." }} />
      ) : (
        <DataTable caption="История версий" columns={columns} rows={card.versions} getRowId={(row) => row.id} onRowClick={(row) => setSelectedId(row.id)} selectedId={selectedId} />
      )}
      {selectedId ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-body-sm font-semibold">Превью позиций</h4>
          {preview === undefined ? <OfficeStatePage state={{ kind: "loading" }} /> : preview === null ? <p className="text-body-sm text-muted-foreground">Версия недоступна.</p> : <DataTable caption="Превью позиций" columns={PREVIEW_COLUMNS} rows={preview.items} getRowId={(row) => row.externalId} />}
        </div>
      ) : null}
    </section>
  )
}
