import { useNavigate, useParams } from "react-router"

import { OfficePage, OfficeShell } from "@/office/components/office-shell"
import { EditorPage } from "@/office/engine/editor-page"
import { MasterPage } from "@/office/engine/master-page"
import {
  cashflowCategoriesApi,
  cashflowCategoriesConfig,
  cashflowCategoryValues,
  transactionsApi,
  transactionsConfig,
  transactionValues,
} from "@/office/engine/reference-configs"
import { RegisterPage } from "@/office/engine/register-page"
import { findOfficeGroup, findOfficeItem, officeNavigation } from "@/office/model/navigation"

/** The register engine on its two reference configs, without Convex. Dev builds only. */
export function EngineShowcase() {
  const { module = "transactions", id } = useParams()
  const navigate = useNavigate()
  const item = findOfficeItem(module)!
  const group = findOfficeGroup(module)
  const record = transactionsApi.useGet(module === "transactions" && id ? id : null)

  return (
    <OfficeShell groups={officeNavigation} activeItemId={module} userName="Администратор" footerLine="Ресторанная сеть · Asia/Almaty · KZT">
      <OfficePage group={group} title={record ? `${item.label} · ${record.number}` : item.label} description={item.description}>
        {module === "cashflow-categories" ? (
          <MasterPage config={cashflowCategoriesConfig} api={cashflowCategoriesApi} getRowId={(row) => row.id} toValues={cashflowCategoryValues} />
        ) : record ? (
          <EditorPage key={record.id + record.status} config={transactionsConfig} api={transactionsApi} record={record} id={record.id} toValues={transactionValues} onBack={() => navigate("/dev/engine/transactions")} />
        ) : (
          <RegisterPage config={transactionsConfig} api={transactionsApi} getRowId={(row) => row.id} onOpen={(row) => navigate(`/dev/engine/transactions/${row.id}`)} />
        )}
      </OfficePage>
    </OfficeShell>
  )
}
