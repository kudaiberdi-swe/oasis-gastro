import { Plus } from "lucide-react"
import { useMemo, useState, type FormEvent } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { Banner, Button, Checkbox, Field, Input, Select, StatusPill, useToast } from "@/shared/components/ui"
import { useBreakpoint } from "@/shared/hooks/use-breakpoint"
import { errorMessage } from "@/shared/lib/error-message"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { descendantsOf, flattenGroupTree, groupOptions, useProductGroups, useSaveProductGroup, type ProductGroup, type ProductGroupNode } from "../data/use-product-groups"

const ROOT = "__root"
const DEFAULT_SORT_ORDER = 100
/** Indent per tree level in the list, px. */
const LEVEL_INDENT = 20

/** «Группы товаров» (/office/product-groups, W1-CAT-03): the Master template — tree list 360px + form. */
export function ProductGroupsWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <ProductGroupsContent />
    </PlatformErrorBoundary>
  )
}

type Selection = { kind: "new" } | { kind: "edit"; externalId: string } | null

function ProductGroupsContent() {
  const groups = useProductGroups()
  const canEdit = useCan("office.product-groups.edit")
  const [selection, setSelection] = useState<Selection>(null)
  const breakpoint = useBreakpoint()
  const inline = breakpoint === "laptop" || breakpoint === "desktop"
  const nodes = useMemo(() => flattenGroupTree(groups ?? []), [groups])
  const selected = selection?.kind === "edit" ? nodes.find((node) => node.externalId === selection.externalId) : undefined
  const editing = selection?.kind === "new" || selected !== undefined
  const openNew = () => setSelection({ kind: "new" })

  const form = editing ? (
    <GroupForm
      key={selected?.externalId ?? "new"}
      group={selected ?? null}
      groups={groups ?? []}
      nodes={nodes}
      canEdit={canEdit}
      onSaved={(externalId) => setSelection({ kind: "edit", externalId })}
    />
  ) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      {canEdit ? (
        <div className="flex justify-end">
          <Button onClick={openNew}>
            <Plus aria-hidden />
            Новая группа
          </Button>
        </div>
      ) : null}
      {groups === undefined ? (
        <OfficeStatePage state={{ kind: "loading" }} />
      ) : nodes.length === 0 && selection?.kind !== "new" ? (
        <OfficeStatePage
          state={{
            kind: "empty",
            title: "Групп пока нет",
            description: "Создайте первую группу номенклатуры.",
            action: canEdit ? (
              <Button variant="secondary" onClick={openNew}>
                Новая группа
              </Button>
            ) : undefined,
          }}
        />
      ) : (
        <div className="flex min-h-0 flex-col gap-4 lg:flex-row lg:items-start">
          <section aria-label="Группы" className="w-full shrink-0 lg:w-[360px]">
            <GroupTree nodes={nodes} selectedId={selected?.externalId ?? null} onSelect={(externalId) => setSelection({ kind: "edit", externalId })} />
          </section>
          {inline ? (
            <section aria-label={selected ? selected.label : "Новая группа"} className="min-w-0 flex-1 rounded-card border border-border bg-card p-5">
              {form ?? <p className="py-10 text-center text-body-sm text-muted-foreground">Выберите группу слева или создайте новую.</p>}
            </section>
          ) : (
            <RightPanel
              open={editing}
              onOpenChange={(open) => {
                if (!open) setSelection(null)
              }}
              title={selected ? selected.label : "Новая группа"}
            >
              {form}
            </RightPanel>
          )}
        </div>
      )}
    </div>
  )
}

export function GroupTree({ nodes, selectedId, onSelect }: { nodes: readonly ProductGroupNode[]; selectedId: string | null; onSelect: (externalId: string) => void }) {
  return (
    <ul className="flex flex-col overflow-hidden rounded-card border border-border bg-card">
      {nodes.map((node) => {
        const active = node.externalId === selectedId
        return (
          <li key={node.externalId} className="border-b border-border last:border-b-0">
            <button
              type="button"
              data-depth={node.depth}
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(node.externalId)}
              style={{ paddingLeft: 16 + node.depth * LEVEL_INDENT }}
              className={cn("flex w-full items-center gap-3 py-3 pr-4 text-left hover:bg-muted", active && "bg-muted shadow-[inset_2px_0_0_var(--gold)]", focusRingClass)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-sm font-semibold text-foreground">{node.label}</span>
                <span className="block truncate text-caption text-muted-foreground">
                  {node.shortLabel} · порядок {node.sortOrder}
                </span>
              </span>
              <StatusPill domain="document" status={node.active ? "active" : "inactive"} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

type FieldErrors = Partial<Record<"label" | "sortOrder", string>>

function GroupForm({
  group,
  groups,
  nodes,
  canEdit,
  onSaved,
}: {
  group: ProductGroup | null
  groups: readonly ProductGroup[]
  nodes: readonly ProductGroupNode[]
  canEdit: boolean
  onSaved: (externalId: string) => void
}) {
  const save = useSaveProductGroup()
  const toast = useToast()
  const [label, setLabel] = useState(group?.label ?? "")
  const [shortLabel, setShortLabel] = useState(group?.shortLabel ?? "")
  const [parent, setParent] = useState(group?.parentExternalId ?? ROOT)
  const [sortOrder, setSortOrder] = useState(String(group?.sortOrder ?? DEFAULT_SORT_ORDER))
  const [active, setActive] = useState(group?.active ?? true)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const readOnly = !canEdit

  // A group can't sit under itself or under one of its own subgroups (the server checks again).
  const parentOptions = useMemo(() => {
    const excluded = group ? descendantsOf(groups, group.externalId) : new Set<string>()
    return [{ value: ROOT, label: "Корневая группа" }, ...groupOptions(nodes.filter((node) => !excluded.has(node.externalId)))]
  }, [group, groups, nodes])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (readOnly || submitting) return
    const found: FieldErrors = {}
    if (!label.trim()) found.label = "Укажите название группы"
    const order = Number(sortOrder)
    if (sortOrder.trim() === "" || !Number.isInteger(order)) found.sortOrder = "Порядок — целое число"
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSubmitting(true)
    setError(null)
    try {
      const externalId = await save({
        ...(group ? { externalId: group.externalId } : {}),
        label: label.trim(),
        shortLabel: shortLabel.trim(),
        parentExternalId: parent === ROOT ? undefined : parent,
        sortOrder: order,
        active,
      })
      toast("Группа сохранена", "success")
      onSaved(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить группу"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form aria-label="Группа товаров" noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-title font-semibold">{group ? group.label : "Новая группа"}</h2>
        <p className="text-caption text-muted-foreground">Все изменения сохраняются в Sandyq и записываются в журнал аудита.</p>
      </div>
      {error ? (
        <Banner tone="danger" title="Не удалось сохранить">
          {error}
        </Banner>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Название" error={errors.label}>
          {(control) => <Input {...control} value={label} onChange={(event) => setLabel(event.target.value)} disabled={readOnly} autoComplete="off" />}
        </Field>
        <Field label="Короткое название" hint="Для чека и кассы; пусто — как название">
          {(control) => <Input {...control} value={shortLabel} onChange={(event) => setShortLabel(event.target.value)} disabled={readOnly} autoComplete="off" />}
        </Field>
        <Field label="Родительская группа">{(control) => <Select {...control} value={parent} onValueChange={setParent} options={parentOptions} disabled={readOnly} />}</Field>
        <Field label="Порядок" error={errors.sortOrder}>
          {(control) => <Input {...control} inputMode="numeric" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} disabled={readOnly} />}
        </Field>
      </div>
      <label className="flex items-center gap-2 text-body-sm font-medium text-foreground">
        <Checkbox checked={active} onCheckedChange={(value) => setActive(value === true)} disabled={readOnly} />
        Активна
      </label>
      {canEdit ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Сохранение…" : "Сохранить"}
          </Button>
        </div>
      ) : null}
    </form>
  )
}
