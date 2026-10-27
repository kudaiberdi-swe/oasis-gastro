import { useState } from "react"
import { Link } from "react-router"

import { Banner, Button, Combobox, Dialog, DialogContent, Field } from "@/shared/components/ui"

import { useUnprovisionedEmployees, useWorkforceBranches, useWorkforceMutations, type UnprovisionedCandidate } from "../../workforce/data/use-office-workforce"
import { CredentialsResult } from "../../workforce/ui/credentials"
import { ProvisionAccessFields, useProvisionAccessForm } from "../../workforce/ui/provision-access-form"
import { Panel } from "./panel"

// «Доступ сотрудников к POS»: the same provisioning form as «Сотрудники → Из iiko», inline. The iiko password
// is never used: the employee gets a local code and PIN (hashed on the server) for the chosen restaurants.

const CANDIDATE_OPTIONS_LIMIT = 500

export function PosAccessPanel() {
  const { candidates, loading } = useUnprovisionedEmployees()
  const branches = useWorkforceBranches()
  const { provisionPosAccess } = useWorkforceMutations()
  const [candidateId, setCandidateId] = useState<string | undefined>(undefined)
  const [issued, setIssued] = useState<{ name: string; code: string; pin: string } | null>(null)
  const candidate: UnprovisionedCandidate | null = candidates.find((row) => row._id === candidateId) ?? null
  const form = useProvisionAccessForm({ candidate, onProvision: provisionPosAccess })

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!candidate) return
    const result = await form.submit()
    if (!result) return
    setIssued({ name: candidate.displayName, ...result })
    setCandidateId(undefined)
    form.reset()
  }

  const employeeField = (
    <Field label="Сотрудник" hint={loading ? "Загрузка…" : candidates.length ? `Без доступа к кассе: ${candidates.length}` : "Все сотрудники iiko уже подключены"}>
      {(control) => (
        <Combobox
          {...control}
          disabled={loading || candidates.length === 0}
          value={candidateId}
          onValueChange={(value) => {
            setCandidateId(value)
            form.reset()
          }}
          options={candidates.slice(0, CANDIDATE_OPTIONS_LIMIT).map((row) => ({
            value: row._id,
            label: row.displayName,
            hint: [row.code, row.branches.map((branch) => branch.name).join(", ")].filter(Boolean).join(" · ") || undefined,
          }))}
          placeholder="Выберите сотрудника"
          searchPlaceholder="Имя или табельный №"
        />
      )}
    </Field>
  )

  return (
    <Panel
      title="Доступ сотрудников к кассе OASIS Gastro"
      description="Профиль связывает сотрудника iiko с локальным кодом, PIN и ресторанами; пароль iiko в POS не используется"
      actions={
        <Button asChild variant="link" size="sm">
          <Link to="/office/employees?view=iiko">Все сотрудники из iiko</Link>
        </Button>
      }
    >
      <form onSubmit={handleSubmit} autoComplete="off" aria-label="Выдача доступа к POS" className="flex flex-col gap-4 p-4">
        <ProvisionAccessFields form={form} branches={branches} variant="inline" employeeField={employeeField} />
        {form.error ? <Banner tone="danger" title={form.error} /> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={!candidate || form.submitting}>
            {form.submitting ? "Сохранение…" : "Создать доступ"}
          </Button>
        </div>
      </form>

      <Dialog open={issued !== null} onOpenChange={(open) => !open && setIssued(null)}>
        <DialogContent aria-describedby={undefined}>
          {issued ? <CredentialsResult title={`Доступ выдан: ${issued.name}`} code={issued.code} pin={issued.pin} onClose={() => setIssued(null)} /> : null}
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
