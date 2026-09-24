import { Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { Banner, Button, Checkbox, Combobox, Field, Input, Select, StatusPill, Switch, useToast, type ComboboxOption } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { cn } from "@/shared/lib/utils"

import { editorCanAssign, useAccessControlMutations, type AccessControlData, type AccessUser } from "../data/use-access-control"
import { MasterList, MasterListItem, SplitLayout } from "./access-control-layout"

const ALL = "*"

/** «Пользователи» (W1-ACL-06): user list on the left, «Учётная запись Office» on the right. */
export function UsersEditor({ data, canEdit }: { data: AccessControlData; canEdit: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(data.users.length === 0 && canEdit)
  const selected = creating ? null : (data.users.find((user) => user.externalId === selectedId) ?? data.users[0] ?? null)

  return (
    <SplitLayout
      list={
        <MasterList
          label="Пользователи"
          action={
            canEdit ? (
              <Button variant="secondary" onClick={() => setCreating(true)}>
                <Plus aria-hidden />
                Новый пользователь
              </Button>
            ) : null
          }
          empty={data.users.length === 0 ? { title: "Пользователей пока нет", description: "Добавьте учётную запись Office и назначьте ей роль." } : null}
        >
          {data.users.map((user) => (
            <MasterListItem
              key={user.externalId}
              active={!creating && selected?.externalId === user.externalId}
              title={user.name}
              meta={user.email}
              trailing={<StatusPill domain="document" status={user.active ? "active" : "inactive"} />}
              onSelect={() => {
                setCreating(false)
                setSelectedId(user.externalId)
              }}
            />
          ))}
        </MasterList>
      }
    >
      {creating || selected ? (
        <UserCard
          key={creating ? "new" : selected!.externalId}
          user={selected}
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

function UserCard({ user, data, canEdit, onSaved }: { user: AccessUser | null; data: AccessControlData; canEdit: boolean; onSaved: (externalId: string) => void }) {
  const { saveUser } = useAccessControlMutations()
  const toast = useToast()
  const { editor, roles, restaurants, catalog } = data
  const [code, setCode] = useState(user?.externalId ?? "")
  const [name, setName] = useState(user?.name ?? "")
  const [email, setEmail] = useState(user?.email ?? "")
  const [roleExternalId, setRoleExternalId] = useState<string | undefined>(user?.roleExternalId)
  const [restaurantScopes, setRestaurantScopes] = useState<ReadonlySet<string>>(() => new Set(user?.restaurantScopes ?? []))
  const [warehouseScopes, setWarehouseScopes] = useState<string[]>(user?.warehouseScopes ?? [])
  const [active, setActive] = useState(user?.active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isSelf = user !== null && user.externalId === editor.externalId
  const readOnly = !canEdit
  const allRestaurants = restaurantScopes.has(ALL)

  const roleOptions = useMemo(
    () => roles.map((role) => ({ value: role.externalId, label: role.name, disabled: !editorCanAssign(editor, role, catalog) })),
    [roles, editor, catalog],
  )
  const warehouseOptions = useMemo<ComboboxOption[]>(() => {
    const values = [...new Set([...editor.warehouseScopes.filter((scope) => scope !== ALL), ...(user?.warehouseScopes ?? [])])]
    return values.map((value) => ({ value, label: value === ALL ? "Все склады" : value }))
  }, [editor.warehouseScopes, user])

  function toggleRestaurant(externalId: string, checked: boolean) {
    setRestaurantScopes((current) => {
      const next = new Set(current)
      if (checked) next.add(externalId)
      else next.delete(externalId)
      return next
    })
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!roleExternalId) {
      setError("Выберите роль")
      return
    }
    setSubmitting(true)
    try {
      const externalId = await saveUser({
        externalId: code,
        email,
        name,
        roleExternalId,
        restaurantScopes: allRestaurants ? [ALL] : [...restaurantScopes],
        warehouseScopes,
        active: isSelf ? true : active,
      })
      toast("Пользователь сохранён", "success")
      onSaved(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить пользователя"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-full flex-col" aria-label="Учётная запись Office">
      <div className="flex flex-1 flex-col gap-6 p-6 xl:p-8">
        <div className="flex flex-col gap-1">
          <h2 className="text-title-sm font-semibold text-foreground">{user ? user.name : "Новый пользователь"}</h2>
          <p className="text-body-sm text-muted-foreground">Учётная запись Office. При подключённой аутентификации email сопоставляется с этой записью</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Код" hint={user ? undefined : "Латиница, цифры и дефис"}>
            {(control) => <Input {...control} name="user-code" autoComplete="off" value={code} onChange={(event) => setCode(event.target.value)} readOnly={user !== null || readOnly} required />}
          </Field>
          <Field label="Имя">
            {(control) => <Input {...control} name="user-name" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} readOnly={readOnly} required />}
          </Field>
          <Field label="Email">
            {(control) => <Input {...control} type="email" name="user-email" value={email} onChange={(event) => setEmail(event.target.value)} readOnly={readOnly} required />}
          </Field>
          <Field label="Роль">
            {(control) => <Select {...control} value={roleExternalId} onValueChange={setRoleExternalId} options={roleOptions} placeholder="Выберите роль" disabled={readOnly} />}
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-body-sm font-medium text-muted-foreground">Доступные рестораны</legend>
          {restaurants.length === 0 && !allRestaurants ? <p className="text-body-sm text-muted-foreground">В вашей области доступа нет ресторанов</p> : null}
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {allRestaurants || (user?.restaurantScopes.includes(ALL) ?? false) ? (
              <RestaurantCard label="Все рестораны" checked={allRestaurants} disabled={readOnly} onCheckedChange={(checked) => toggleRestaurant(ALL, checked)} />
            ) : null}
            {restaurants.map((restaurant) => (
              <RestaurantCard
                key={restaurant.externalId}
                label={restaurant.name}
                checked={allRestaurants || restaurantScopes.has(restaurant.externalId)}
                disabled={readOnly || allRestaurants}
                onCheckedChange={(checked) => toggleRestaurant(restaurant.externalId, checked)}
              />
            ))}
          </div>
        </fieldset>

        <Field label="Склады" hint={warehouseOptions.length === 0 ? "Склады появятся после настройки склада" : "Без выбора — нет доступа к складам"}>
          {(control) => (
            <Combobox
              {...control}
              multiple
              value={warehouseScopes}
              onValueChange={setWarehouseScopes}
              options={warehouseOptions}
              placeholder="Выберите склады"
              searchPlaceholder="Поиск склада"
              disabled={readOnly || warehouseOptions.length === 0}
            />
          )}
        </Field>

        {isSelf ? null : (
          <label className="flex items-center gap-3 text-body-sm text-foreground">
            <Switch checked={active} onCheckedChange={setActive} disabled={readOnly} />
            Учётная запись активна
          </label>
        )}

        {error ? <Banner tone="danger" title={error} /> : null}
      </div>

      {canEdit ? (
        <div className="sticky bottom-0 flex justify-end border-t border-border bg-card px-6 py-3 xl:px-8">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Сохранение…" : "Сохранить пользователя"}
          </Button>
        </div>
      ) : null}
    </form>
  )
}

function RestaurantCard({ label, checked, disabled, onCheckedChange }: { label: string; checked: boolean; disabled: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <label
      className={cn(
        "flex min-h-[var(--control-h)] items-center gap-3 rounded-card border border-border bg-card px-3 py-2 text-body-sm text-foreground",
        checked && "border-primary bg-muted",
        disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-muted",
      )}
    >
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => onCheckedChange(value === true)} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </label>
  )
}
