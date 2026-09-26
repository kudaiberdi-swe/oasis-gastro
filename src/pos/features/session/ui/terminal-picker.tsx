import { MonitorSmartphone } from "lucide-react"
import { useState } from "react"

import type { TerminalOption } from "@/pos/features/session/data/use-terminal-options"
import { useT } from "@/pos/i18n"
import { LanguageLink } from "@/pos/i18n/language-switch"
import { Banner, Button, Field, OrnamentPair, RadioGroup, Select, SkeletonRows } from "@/shared/components/ui"

export interface TerminalPickerProps {
  options: TerminalOption[] | undefined
  onChoose: (terminalExternalId: string) => void
  /** A remembered terminal that no longer exists or is disabled. */
  staleTerminal?: string | null
}

/** «Выберите рабочее место»: branch, then one of its active terminals (POS-DESIGN §11.1). */
export function TerminalPicker({ options, onChoose, staleTerminal }: TerminalPickerProps) {
  const t = useT()
  const [restaurant, setRestaurant] = useState<string | undefined>(() => (options?.length === 1 ? options[0].restaurantExternalId : undefined))
  const [terminal, setTerminal] = useState<string>("")
  const current = options?.find((option) => option.restaurantExternalId === restaurant)

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-nav px-6">
      <div className="flex flex-col items-center gap-3 text-nav-foreground">
        <img src="/branding/sandyq-kz-logo.svg" alt="Sandyq" className="h-12" />
        <OrnamentPair className="text-nav-accent" />
      </div>

      <div className="flex w-full max-w-md flex-col gap-5 rounded-panel bg-card p-8 shadow-float">
        <div className="flex items-start gap-3">
          <MonitorSmartphone aria-hidden className="mt-1 size-6 shrink-0 text-accent" />
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-title font-semibold">{t("picker.title")}</h1>
            <p className="text-body-sm text-muted-foreground">{t("picker.subtitle")}</p>
          </div>
        </div>

        {staleTerminal ? <Banner tone="warning" title={t("picker.staleTitle")}>{t("picker.stale", { name: staleTerminal })}</Banner> : null}

        {options === undefined ? (
          <SkeletonRows rows={3} />
        ) : options.length === 0 ? (
          <Banner tone="danger" title={t("picker.noneTitle")}>{t("picker.none")}</Banner>
        ) : (
          <>
            <Field label={t("picker.department")}>
              {(control) => (
                <Select
                  {...control}
                  value={restaurant}
                  onValueChange={(next) => {
                    setRestaurant(next)
                    setTerminal("")
                  }}
                  placeholder={t("picker.departmentPlaceholder")}
                  options={options.map((option) => ({ value: option.restaurantExternalId, label: option.restaurantName }))}
                />
              )}
            </Field>
            {current ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 text-body-sm font-medium text-muted-foreground">{t("picker.terminal")}</legend>
                <RadioGroup
                  aria-label={t("picker.terminal")}
                  value={terminal}
                  onValueChange={setTerminal}
                  options={current.terminals.map((option) => ({
                    value: option.externalId,
                    label: option.name,
                    description: [current.restaurantName, current.city].filter(Boolean).join(" · "),
                  }))}
                />
              </fieldset>
            ) : null}
          </>
        )}

        <Button size="lg" className="w-full" disabled={!terminal} onClick={() => onChoose(terminal)}>
          {t("picker.continue")}
        </Button>
        <LanguageLink label={t("common.switchLanguage")} />
      </div>
    </div>
  )
}
