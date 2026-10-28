import { useParams } from "react-router"

import { OfficePage, OfficeShell } from "@/office/components/office-shell"
import { findOfficeGroup, findOfficeItem, officeNavigation } from "@/office/model/navigation"
import { Button, DataTable, Money, StatusPill } from "@/shared/components/ui"

const ROWS = [
  { id: "1", number: "ПН-000124", supplier: "ТОО «Алтын Ет»", status: "posted", total: 1_284_500 },
  { id: "2", number: "ПН-000125", supplier: "ИП Сейткали", status: "draft", total: 86_300 },
  { id: "3", number: "ПН-000126", supplier: "ТОО «Шұбат Өнім»", status: "pending-approval", total: 412_000 },
]

/** The office shell without Convex or sign-in, for screenshot checks. Dev builds only. */
export function OfficeShowcase() {
  const { section = "receipts" } = useParams()
  const item = findOfficeItem(section) ?? findOfficeItem("receipts")!
  const group = findOfficeGroup(item.id)
  return (
    <OfficeShell groups={officeNavigation} activeItemId={item.id} userName="Администратор" footerLine="Ресторанная сеть · Asia/Almaty · KZT" onSignOut={() => {}}>
      <OfficePage
        group={group}
        title={item.label}
        description={item.description}
        status={<span className="text-success">● Все изменения сохранены</span>}
        actions={
          <>
            <Button variant="secondary">Экспорт</Button>
            <Button>Создать</Button>
          </>
        }
      >
        <DataTable
          caption={item.label}
          columns={[
            { key: "number", header: "Номер", cell: (row) => row.number, sortValue: (row) => row.number },
            { key: "supplier", header: "Поставщик", cell: (row) => row.supplier },
            { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
            { key: "total", header: "Сумма", numeric: true, cell: (row) => <Money value={row.total} size="sm" className="text-foreground" />, sortValue: (row) => row.total },
          ]}
          rows={ROWS}
          getRowId={(row) => row.id}
          onRowClick={() => {}}
          loadMore={{ loaded: 3, total: 3, canLoadMore: false, onLoadMore: () => {} }}
        />
      </OfficePage>
    </OfficeShell>
  )
}
