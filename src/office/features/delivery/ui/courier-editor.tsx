import { useState, type FormEvent } from "react"

import { useCan } from "@/office/components/can"
import { Banner, Button, Combobox, Field, Input, Select, Switch, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { useCourierMutations, useRestaurantEmployees, type Courier, type CourierTransport } from "../data/use-delivery"
import { isMaskedPhone } from "../model/order-draft"
import { TRANSPORT_OPTIONS } from "../model/statuses"

export const COURIER_FORM_ID = "courier-editor"

type CourierErrors = Partial<Record<"employeeCode" | "restaurant" | "phone", string>>

/** «Карточка курьера»: the courier is an employee of the restaurant, found by code (employees.by_code). */
export function CourierEditor({ courier, restaurants, readOnly, onSaved }: { courier: Courier | null; restaurants: { externalId: string; name: string }[]; readOnly: boolean; onSaved: (externalId: string) => void }) {
  const { saveCourier } = useCourierMutations()
  const toast = useToast()
  const canSeeEmployees = useCan("office.employees.view")
  const maskedPhone = courier ? isMaskedPhone(courier.phone) : false
  const [restaurant, setRestaurant] = useState<string | undefined>(courier?.restaurantExternalId ?? (restaurants.length === 1 ? restaurants[0].externalId : undefined))
  const [employeeCode, setEmployeeCode] = useState(courier?.employeeCode ?? "")
  const [name, setName] = useState(courier?.name ?? "")
  // A masked phone (no PII right) is sent back as is: saveCourier keeps the stored number.
  const [phone, setPhone] = useState(courier?.phone ?? "")
  const keepsMasked = maskedPhone && phone === courier?.phone
  const [transport, setTransport] = useState<CourierTransport>(courier?.transport ?? "foot")
  const [active, setActive] = useState(courier?.active ?? true)
  const [employeeSearch, setEmployeeSearch] = useState("")
  const [errors, setErrors] = useState<CourierErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const employees = useRestaurantEmployees(restaurant, employeeSearch, canSeeEmployees && !readOnly)

  const restaurantOptions = restaurantSelectOptions(restaurants)
  if (courier && !restaurantOptions.some((option) => option.value === courier.restaurantExternalId)) restaurantOptions.push({ value: courier.restaurantExternalId, label: courier.restaurantExternalId })
  const employeeOptions = employees.results.map((row) => ({ value: row.code, label: row.displayName, hint: `Код ${row.code}` }))
  if (employeeCode && !employeeOptions.some((option) => option.value === employeeCode)) employeeOptions.unshift({ value: employeeCode, label: courier?.name ?? employeeCode, hint: `Код ${employeeCode}` })

  function pickEmployee(code: string) {
    setEmployeeCode(code)
    const employee = employees.results.find((row) => row.code === code)
    if (!employee) return
    setName(employee.displayName)
    if (employee.phone && !isMaskedPhone(employee.phone)) setPhone(employee.phone)
  }

  function validate(): CourierErrors {
    const next: CourierErrors = {}
    if (!restaurant) next.restaurant = "Выберите ресторан"
    if (!employeeCode.trim()) next.employeeCode = "Выберите сотрудника"
    const digits = phone.replace(/\D/g, "")
    if (!keepsMasked && (digits.length < 10 || digits.length > 15)) next.phone = "Телефон — от 10 до 15 цифр"
    return next
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (readOnly || submitting) return
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) return
    setSubmitting(true)
    setError(null)
    try {
      const externalId = await saveCourier({
        ...(courier ? { externalId: courier.externalId } : {}),
        employeeCode: employeeCode.trim(),
        restaurantExternalId: restaurant!,
        name: name.trim(),
        phone: phone.trim(),
        transport,
        active,
      })
      toast("Курьер сохранён", "success")
      if (!courier) onSaved(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить курьера"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form id={COURIER_FORM_ID} aria-label="Курьер" noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      {error ? (
        <Banner tone="danger" title="Не удалось сохранить">
          {error}
        </Banner>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Код сотрудника" error={errors.employeeCode} hint={canSeeEmployees ? (restaurant ? undefined : "Сначала выберите ресторан") : "Список сотрудников — с правом «Сотрудники — просмотр»"}>
          {(control) =>
            canSeeEmployees ? (
              <Combobox
                {...control}
                value={employeeCode || undefined}
                onValueChange={pickEmployee}
                onSearchChange={setEmployeeSearch}
                options={employeeOptions}
                disabled={readOnly || !restaurant}
                placeholder="Выберите сотрудника"
                searchPlaceholder="ФИО или код"
                emptyText={employees.status === "LoadingFirstPage" ? "Загрузка…" : "Сотрудник не найден в ресторане"}
              />
            ) : (
              <Input {...control} inputMode="numeric" autoComplete="off" value={employeeCode} onChange={(event) => setEmployeeCode(event.target.value)} disabled={readOnly} />
            )
          }
        </Field>
        <Field label="Имя" hint="Пусто — имя сотрудника">
          {(control) => <Input {...control} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} disabled={readOnly} />}
        </Field>
        <div className="flex flex-col gap-1.5">
          <Field label="Телефон" error={errors.phone} hint={keepsMasked ? "Номер скрыт — при сохранении останется прежний" : undefined}>
            {(control) => <Input {...control} type="tel" inputMode="tel" autoComplete="off" placeholder="+7 700 000 00 00" value={phone} readOnly={keepsMasked} onChange={(event) => setPhone(event.target.value)} disabled={readOnly} />}
          </Field>
          {keepsMasked && !readOnly ? (
            <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setPhone("")}>
              Ввести новый номер
            </Button>
          ) : null}
        </div>
        <Field label="Транспорт">
          {(control) => <Select {...control} value={transport} onValueChange={(value) => setTransport(value as CourierTransport)} options={TRANSPORT_OPTIONS} disabled={readOnly} />}
        </Field>
        <Field label="Ресторан" error={errors.restaurant}>
          {(control) => (
            <Select
              {...control}
              value={restaurant}
              onValueChange={(value) => {
                setRestaurant(value)
                if (!courier) setEmployeeCode("")
              }}
              options={restaurantOptions}
              disabled={readOnly}
              placeholder="Выберите ресторан"
            />
          )}
        </Field>
        <div className="flex items-center justify-between gap-3 self-end rounded-card border border-border px-4 py-3">
          <label htmlFor="courier-active" className="text-body-sm font-medium">
            Активен
          </label>
          <Switch id="courier-active" checked={active} onCheckedChange={setActive} disabled={readOnly} />
        </div>
      </div>
    </form>
  )
}
