import { Component, useId, useState, type ReactNode } from "react"
import { useNavigate, useParams } from "react-router"

import { OfficeStatePage } from "@/office/components/state-page"
import { allowsCapability } from "@/office/model/capabilities"
import { FilterTabs } from "@/shared/components/ui"

import { useAccessControl } from "../data/use-access-control"
import { RolesEditor } from "./roles-editor"
import { UsersEditor } from "./users-editor"

type AccessSection = "roles" | "users"

const TABS: { value: AccessSection; label: string }[] = [
  { value: "roles", label: "Роли" },
  { value: "users", label: "Пользователи" },
]

/**
 * «Роли и права» (/office/roles) and «Пользователи» (/office/users), W1-ACL-05/06: one screen with
 * the «Роли / Пользователи» tabs; the tab is the URL section, so deep links and F5 keep it.
 */
export function AccessControlWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <QueryErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <AccessControlContent />
    </QueryErrorBoundary>
  )
}

function AccessControlContent() {
  const { section: rawSection } = useParams()
  const section: AccessSection = rawSection === "users" ? "users" : "roles"
  const navigate = useNavigate()
  const data = useAccessControl()
  const panelId = useId()

  if (data === undefined) {
    return (
      <div className="p-6 xl:p-8">
        <OfficeStatePage state={{ kind: "loading" }} />
      </div>
    )
  }

  const can = (capability: string) => data.editor.fullAccess || allowsCapability(data.editor.capabilities, capability)
  // Hide a tab the editor cannot open (OFFICE-DESIGN §7); the router shows «Нет доступа» on a direct URL.
  const tabs = TABS.filter((tab) => tab.value === section || can(`office.${tab.value}.view`))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-6 xl:px-8">
        <FilterTabs aria-label="Роли и пользователи" value={section} onValueChange={(value) => navigate(`/office/${value}`)} items={tabs} panelId={panelId} />
      </div>
      <div id={panelId} role="tabpanel" aria-label={section === "roles" ? "Роли" : "Пользователи"} className="flex min-h-0 flex-1 flex-col">
        {section === "roles" ? <RolesEditor data={data} canEdit={can("office.roles.edit")} /> : <UsersEditor data={data} canEdit={can("office.users.edit")} />}
      </div>
    </div>
  )
}

/** A failed listAccessControl (useQuery throws) becomes the error state with «Повторить» (OFFICE-DESIGN §7). */
class QueryErrorBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { error: unknown }> {
  state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6 xl:p-8">
          <OfficeStatePage state={{ kind: "error", error: this.state.error, onRetry: this.props.onRetry }} />
        </div>
      )
    }
    return this.props.children
  }
}
