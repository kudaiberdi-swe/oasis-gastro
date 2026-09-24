import { useState } from "react"

import { Banner, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, MoneyInput, Select } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import { useSuggestedCredentials, useWorkforceBranches, useWorkforceMutations, type EmployeeId } from "../data/use-office-workforce"
import { EMPLOYEE_CODE_PATTERN, EMPTY_HR, hrArgs, PAY_TYPE_OPTIONS, PIN_PATTERN, rateUnitLabel, ROLE_OPTIONS, validateHr, type HrDraft, type PayType, type ProfileErrors, type Role } from "../model/modules"
import { CredentialsResult, EmployeeCodeInput, PinInput, RestaurantsField } from "./credentials"

/** «+ Новый сотрудник» (W1-HR-01): a POS employee without iiko — code, PIN, role, restaurants and the main HR fields. */
export function CreateEmployeeDialog({ onClose, onOpenCard, defaultRestaurantExternalId }: { onClose: () => void; onOpenCard: (employeeId: EmployeeId) => void; defaultRestaurantExternalId?: string }) {
  const branches = useWorkforceBranches()
  const suggested = useSuggestedCredentials(true)
  const { createPosEmployee } = useWorkforceMutations()
  const [displayName, setDisplayName] = useState("")
  const [code, setCode] = useState<string | null>(null)
  const [pin, setPin] = useState<string | null>(null)
  const [role, setRole] = useState<Role>("cashier")
  const [pickedRestaurants, setRestaurants] = useState<string[] | null>(() => (defaultRestaurantExternalId ? [defaultRestaurantExternalId] : null))
  const [hr, setHr] = useState<HrDraft>(EMPTY_HR)
  const [errors, setErrors] = useState<ProfileErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<{ employeeId: EmployeeId; code: string; pin: string } | null>(null)

  const effectiveCode = code ?? suggested?.code ?? ""
  const effectivePin = pin ?? suggested?.pin ?? ""
  // One restaurant in scope: it is preselected.
  const restaurants = pickedRestaurants ?? (branches.length === 1 ? [branches[0].externalId] : [])
  const setField = (patch: Partial<HrDraft>) => setHr((current) => ({ ...current, ...patch }))

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const found = validateHr({ ...hr, displayName })
    if (!EMPLOYEE_CODE_PATTERN.test(effectiveCode)) found.employeeCode = "Код — от 3 до 12 цифр"
    if (!PIN_PATTERN.test(effectivePin)) found.pin = "PIN — от 4 до 6 цифр"
    if (restaurants.length === 0) found.restaurants = "Выберите хотя бы один ресторан"
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await createPosEmployee({ displayName: displayName.trim(), employeeCode: effectiveCode, pin: effectivePin, role, restaurantExternalIds: restaurants, ...hrArgs(hr) })
      setCreated({ employeeId: result.employeeId, code: result.code, pin: effectivePin })
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось создать сотрудника"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="max-w-2xl">
        {created ? (
          <CredentialsResult
            title={`Сотрудник создан: ${displayName.trim()}`}
            code={created.code}
            pin={created.pin}
            onClose={onClose}
            secondary={
              <Button variant="secondary" onClick={() => onOpenCard(created.employeeId)}>
                Открыть карточку
              </Button>
            }
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Новый сотрудник</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} autoComplete="off" className="flex flex-col gap-4">
              <Field label="ФИО" error={errors.displayName}>
                {(control) => <Input {...control} name="employee-full-name" autoComplete="off" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Код для входа на кассу" error={errors.employeeCode} hint="3–12 цифр; предложен свободный">
                  {(control) => <EmployeeCodeInput control={control} value={effectiveCode} onValueChange={setCode} />}
                </Field>
                <Field label="PIN" error={errors.pin} hint="4–6 цифр; предложен случайный">
                  {(control) => <PinInput control={control} value={effectivePin} onValueChange={setPin} />}
                </Field>
                <Field label="Роль на кассе">{(control) => <Select {...control} value={role} onValueChange={(value) => setRole(value as Role)} options={ROLE_OPTIONS} />}</Field>
                <Field label="Табельный номер" error={errors.personnelNumber}>
                  {(control) => <Input {...control} autoComplete="off" value={hr.personnelNumber} onChange={(event) => setField({ personnelNumber: event.target.value })} />}
                </Field>
              </div>
              <RestaurantsField options={branches} value={restaurants} onValueChange={setRestaurants} error={errors.restaurants} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Должность">{(control) => <Input {...control} autoComplete="off" value={hr.positionExternalId} onChange={(event) => setField({ positionExternalId: event.target.value })} />}</Field>
                <Field label="Тип оплаты">
                  {(control) => <Select {...control} value={hr.payType || undefined} onValueChange={(value) => setField({ payType: value as PayType })} options={PAY_TYPE_OPTIONS} placeholder="Не указан" />}
                </Field>
                <Field label="Ставка" error={errors.baseRate} hint={rateUnitLabel(hr.payType)}>
                  {(control) => <MoneyInput {...control} value={hr.baseRate} onValueChange={(baseRate) => setField({ baseRate })} />}
                </Field>
              </div>
              {error ? <Banner tone="danger" title={error} /> : null}
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={onClose}>
                  Отмена
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Создание…" : "Создать сотрудника"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
