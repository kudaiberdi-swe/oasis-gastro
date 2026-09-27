import { Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { Banner, Button, Checkbox, Field, Input, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import {
  countLabel,
  editorGrants,
  explicitRights,
  specialRights,
  useAccessControlMutations,
  type AccessControlData,
  type AccessRole,
} from "../data/use-access-control"
import { MasterList, MasterListItem, SplitLayout } from "./access-control-layout"
import { PermissionMatrix } from "./permission-matrix"

const PERMISSION_FORMS: [string, string, string] = ["разрешение", "разрешения", "разрешений"]
const ADMINISTRATOR = "administrator"

/** «Роли и права» (W1-ACL-05): role list 360 px, role card and the permission matrix. */
export function RolesEditor({ data, canEdit }: { data: AccessControlData; canEdit: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(data.roles.length === 0)
  const selected = creating ? null : (data.roles.find((role) => role.externalId === selectedId) ?? data.roles[0] ?? null)

  return (
    <SplitLayout
      list={
        <MasterList
          label="Роли"
          action={
            canEdit ? (
              <Button variant="secondary" onClick={() => setCreating(true)}>
                <Plus aria-hidden />
                Новая роль
              </Button>
            ) : null
          }
          empty={data.roles.length === 0 ? { title: "Ролей пока нет", description: "Создайте первую роль и отметьте её права в матрице." } : null}
        >
          {data.roles.map((role) => (
            <MasterListItem
              key={role.externalId}
              active={!creating && selected?.externalId === role.externalId}
              title={role.name}
              meta={role.fullAccess ? "Полный доступ" : countLabel(role.sectionCount, PERMISSION_FORMS)}
              onSelect={() => {
                setCreating(false)
                setSelectedId(role.externalId)
              }}
            />
          ))}
        </MasterList>
      }
    >
      {creating || selected ? (
        <RoleCard
          key={creating ? "new" : selected!.externalId}
          role={selected}
          data={data}
          canEdit={canEdit}
          onSaved={(externalId) => {
            setCreating(false)
            setSelectedId(externalId)
          }}
        />
      ) : null}
    </SplitLayout>
  )
}

function RoleCard({ role, data, canEdit, onSaved }: { role: AccessRole | null; data: AccessControlData; canEdit: boolean; onSaved: (externalId: string) => void }) {
  const { saveRole } = useAccessControlMutations()
  const toast = useToast()
  const { editor, catalog } = data
  const [code, setCode] = useState(role?.externalId ?? "")
  const [name, setName] = useState(role?.name ?? "")
  const [fullAccess, setFullAccess] = useState(role?.fullAccess ?? false)
  // Existing roles (including legacy office.<module>.* and office.<section>.* rights) open as explicit rights.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(role && !role.fullAccess ? explicitRights(role.capabilities, catalog) : []))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const special = useMemo(() => (role ? specialRights(role.capabilities) : []), [role])

  const isAdministrator = role?.externalId === ADMINISTRATOR
  const readOnly = !canEdit

  function toggle(right: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(right)
      else next.delete(right)
      return next
    })
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      // Always explicit office.<section>.<action> rights, in catalog order; never module wildcards.
      const rights = catalog.flatMap((section) => section.actions.map((action) => `office.${section.id}.${action}`).filter((right) => selected.has(right)))
      const externalId = await saveRole({ externalId: code, name, fullAccess, capabilities: fullAccess ? [] : [...rights, ...special] })
      toast("Роль сохранена", "success")
      onSaved(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить роль"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-full flex-col" aria-label="Карточка роли">
      <div className="flex flex-1 flex-col gap-6 p-6 xl:p-8">
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-title-sm font-semibold text-foreground">{role ? role.name : "Новая роль"}</h2>
            <p className="text-body-sm text-muted-foreground">Системные роли можно настраивать, но администратор всегда сохраняет полный доступ</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Код" hint={role ? undefined : "Латиница, цифры и дефис"}>
              {(control) => (
                <Input
                  {...control}
                  name="role-code"
                  autoComplete="off"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  readOnly={role !== null || readOnly}
                  required
                />
              )}
            </Field>
            <Field label="Название">
              {(control) => <Input {...control} name="role-name" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} readOnly={readOnly} required />}
            </Field>
          </div>
          <label className="flex items-center gap-3 text-body-sm text-foreground">
            <Checkbox
              checked={fullAccess}
              onCheckedChange={(checked) => setFullAccess(checked === true)}
              disabled={readOnly || isAdministrator || (!editor.fullAccess && !fullAccess)}
            />
            Полный доступ ко всем функциям и будущим модулям
          </label>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="permission-matrix-title">
          <div className="flex flex-col gap-1">
            <h2 id="permission-matrix-title" className="text-title-sm font-semibold text-foreground">
              Матрица разрешений
            </h2>
            <p className="text-body-sm text-muted-foreground">
              {fullAccess ? "Полный доступ включён — все права выданы, матрица не редактируется" : "Каждый раздел поддерживает независимые права просмотра, изменения и проведения"}
            </p>
          </div>
          <PermissionMatrix catalog={catalog} selected={selected} onToggle={toggle} fullAccess={fullAccess} readOnly={readOnly} canGrant={(right) => editorGrants(editor, right)} />
        </section>

        {error ? <Banner tone="danger" title={error} /> : null}
      </div>

      {canEdit ? (
        <div className="sticky bottom-0 flex justify-end border-t border-border bg-card px-6 py-3 xl:px-8">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Сохранение…" : "Сохранить роль"}
          </Button>
        </div>
      ) : null}
    </form>
  )
}
