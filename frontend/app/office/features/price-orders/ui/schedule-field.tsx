import { Chip, Field, Input, Switch } from "@/shared/components/ui"

import { minutesToTime, timeToMinutes, WEEKDAYS, type ScheduleDraft } from "../model/use-price-order-draft"

/** «Расписание»: the order works only on the chosen weekdays between the two times (Almaty). */
export function ScheduleField({ value, onChange, readOnly, error }: { value: ScheduleDraft; onChange: (patch: Partial<ScheduleDraft>) => void; readOnly: boolean; error?: string }) {
  if (readOnly) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-body-sm font-medium text-muted-foreground">Расписание</span>
        <span className="text-body-sm text-foreground">{describeSchedule(value)}</span>
      </div>
    )
  }
  const toggleDay = (day: number) => onChange({ weekdays: value.weekdays.includes(day) ? value.weekdays.filter((item) => item !== day) : [...value.weekdays, day].sort((a, b) => a - b) })
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">Расписание</legend>
      <label className="flex items-center gap-3 text-body-sm font-medium text-foreground">
        <Switch checked={value.enabled} onCheckedChange={(enabled) => onChange({ enabled })} />
        Действует по расписанию
        <span className="font-normal text-muted-foreground">— только в выбранные дни и часы</span>
      </label>
      {value.enabled ? (
        <>
          <div role="group" aria-label="Дни недели" className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((day) => (
              <Chip key={day.value} active={value.weekdays.includes(day.value)} onClick={() => toggleDay(day.value)}>
                {day.label}
              </Chip>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="С">{(control) => <Input {...control} type="time" value={value.start} onChange={(event) => onChange({ start: event.target.value })} />}</Field>
            <Field label="По">{(control) => <Input {...control} type="time" value={value.end} onChange={(event) => onChange({ end: event.target.value })} />}</Field>
            <Field label="Название расписания">
              {(control) => <Input {...control} value={value.name} onChange={(event) => onChange({ name: event.target.value })} placeholder="Завтраки" autoComplete="off" />}
            </Field>
          </div>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}

/** «Пн, Вт, Ср · 07:00–11:00» or «Весь день, все дни». */
export function describeSchedule(value: ScheduleDraft) {
  if (!value.enabled) return "Весь день, все дни"
  const days = WEEKDAYS.filter((day) => value.weekdays.includes(day.value)).map((day) => day.label).join(", ")
  const start = timeToMinutes(value.start)
  const end = timeToMinutes(value.end)
  return `${days} · ${start === null ? value.start : minutesToTime(start)}–${end === null ? value.end : minutesToTime(end)}`
}
