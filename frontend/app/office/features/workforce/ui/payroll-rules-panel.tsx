import { useEffect, useState } from "react"

import { useCan } from "@/office/components/can"
import { MasterPanel } from "@/office/features/stock/ui/master-panel"
import { Banner, Button, Field, Input, MoneyInput, StatusPill, useToast } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"

import { usePayrollMutations, type PayrollRulesRow } from "../data/use-workforce-w2"
import { RULE_FIELDS, RULE_GROUP_LABEL, rulesArgs, rulesDraftOf, validateRules, type DraftErrors, type RuleKey, type RulesDraft } from "../model/w2"
import { FormSection } from "./reference-parts"

// «Правила РК» (W2-HR-06): a version of the statutory payroll rules. Rates are fractions on the server,
// percents here. Only a draft is edited; «Активировать» (office.payroll.approve) makes it apply from its date.

const GROUPS = ["base", "employee", "employer", "ipn"] as const

export function PayrollRulesPanel({ rules, template, onClose, onSaved }: { rules: PayrollRulesRow | null; template?: PayrollRulesRow; onClose: () => void; onSaved: (externalId: string) => void }) {
  const canEdit = useCan("office.payroll.edit")
  const canApprove = useCan("office.payroll.approve")
  const { saveRules, activateRules } = usePayrollMutations()
  const toast = useToast()
  const editable = canEdit && (rules === null || rules.status === "draft")
  const [baseline, setBaseline] = useState<RulesDraft>(() => rulesDraftOf(rules, template))
  const [draft, setDraft] = useState(baseline)
  const [errors, setErrors] = useState<DraftErrors<RuleKey | "version" | "effectiveFrom">>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [activating, setActivating] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)

  useEffect(() => {
    if (savedId && !dirty && savedId !== rules?.externalId) onSaved(savedId)
  }, [savedId, dirty, rules?.externalId, onSaved])

  const clear = (key: string) =>
    setErrors((current) => {
      const next = { ...current }
      delete next[key as RuleKey]
      return next
    })
  const setMoney = (key: RuleKey, value: number | null) => {
    setDraft((current) => ({ ...current, money: { ...current.money, [key]: value } }))
    clear(key)
  }
  const setText = (key: RuleKey, value: string) => {
    setDraft((current) => ({ ...current, text: { ...current.text, [key]: value.replace(/[^\d,.]/g, "").slice(0, 8) } }))
    clear(key)
  }

  async function submit() {
    if (!editable || saving) return
    const found = validateRules(draft)
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setError(null)
    try {
      const externalId = await saveRules(rulesArgs(rules, draft))
      setBaseline(draft)
      toast("Правила сохранены", "success")
      setSavedId(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить правила"))
    } finally {
      setSaving(false)
    }
  }

  async function activate() {
    if (!rules || activating) return
    setActivating(true)
    setError(null)
    try {
      await activateRules({ externalId: rules.externalId })
      toast(`Правила ${rules.version} активированы`, "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось активировать правила"))
    } finally {
      setActivating(false)
    }
  }

  return (
    <MasterPanel title={rules ? `Правила ${rules.version}` : "Новая версия правил"} formLabel="Правила РК" dirty={dirty} saving={saving} canEdit={editable} isNew={!rules} error={error} onSubmit={() => void submit()} onClose={onClose}>
      {rules && rules.status !== "draft" ? (
        <Banner tone="info" title={rules.status === "active" ? "Версия действует — только чтение" : "Версия неактивна — только чтение"}>
          Изменить можно только черновик. Для новых ставок создайте следующую версию с датой начала.
        </Banner>
      ) : null}
      <FormSection title="Версия">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Версия правил" error={errors.version}>
            {(control) => <Input {...control} value={draft.version} onChange={(event) => setDraft((current) => ({ ...current, version: event.target.value }))} disabled={!editable} autoComplete="off" placeholder="РК 2026" />}
          </Field>
          <Field label="Действует с" error={errors.effectiveFrom}>
            {(control) => <Input {...control} type="date" value={draft.effectiveFrom} onChange={(event) => setDraft((current) => ({ ...current, effectiveFrom: event.target.value }))} disabled={!editable} />}
          </Field>
        </div>
      </FormSection>
      {GROUPS.map((group) => (
        <FormSection key={group} title={RULE_GROUP_LABEL[group]}>
          <div className="grid gap-4 sm:grid-cols-2">
            {RULE_FIELDS.filter((field) => field.group === group).map((field) => (
              <Field key={field.key} label={field.label} error={errors[field.key]}>
                {(control) =>
                  field.kind === "money" ? (
                    <MoneyInput {...control} value={draft.money[field.key] ?? null} onValueChange={(value) => setMoney(field.key, value)} disabled={!editable} />
                  ) : (
                    <div className="relative">
                      <Input {...control} inputMode="decimal" autoComplete="off" className="pr-14 text-right tabular-nums" value={draft.text[field.key] ?? ""} onChange={(event) => setText(field.key, event.target.value)} disabled={!editable} />
                      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-body-sm text-muted-foreground">
                        {field.kind === "percent" ? "%" : field.unit}
                      </span>
                    </div>
                  )
                }
              </Field>
            ))}
          </div>
        </FormSection>
      ))}
      {rules ? (
        <FormSection title="Статус и аудит">
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-body-sm">
            <dt className="text-muted-foreground">Статус</dt>
            <dd>
              <StatusPill domain="document" status={rules.status} />
            </dd>
            <dt className="text-muted-foreground">Создано</dt>
            <dd>{formatAlmatyDateTime(rules.createdAt)}</dd>
            <dt className="text-muted-foreground">Изменено</dt>
            <dd>{formatAlmatyDateTime(rules.updatedAt)}</dd>
          </dl>
          {canApprove && rules.status !== "active" ? (
            <div className="flex flex-col gap-1">
              <Button type="button" variant="secondary" size="sm" className="self-start" disabled={dirty || activating} onClick={() => void activate()}>
                {activating ? "Активация…" : "Активировать"}
              </Button>
              <p className="text-caption text-muted-foreground">Версия начнёт применяться к ведомостям с {draft.effectiveFrom.split("-").reverse().join(".")}; другая активная версия с той же датой отключится.</p>
            </div>
          ) : null}
        </FormSection>
      ) : null}
    </MasterPanel>
  )
}
