import { Button } from "@/shared/components/ui/button"

// Mirrors scripts/seed-sandyq.mjs's RESTAURANTS list — Sandyq has a small, fixed set of branches
// for this pilot, so a hardcoded picker is simpler than adding a public terminal-listing query.
const BRANCHES = [
  { externalId: "sandyq-almaty-01", label: "Алматы" },
  { externalId: "sandyq-shymkent-01", label: "Шымкент" },
  { externalId: "sandyq-turkistan-01", label: "Түркістан" },
]

export function BranchPicker() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-nav px-6">
      <div className="flex flex-col items-center gap-3 text-nav-foreground">
        <img src="/branding/sandyq-kz-logo.svg" alt="Sandyq" className="h-12" />
        <p className="text-sm text-nav-foreground/65">Выберите филиал</p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3 rounded-[var(--radius-panel)] bg-card p-8 shadow-[var(--shadow-float)]">
        {BRANCHES.map((branch) => (
          <Button
            key={branch.externalId}
            type="button"
            size="lg"
            variant="outline"
            className="w-full"
            onClick={() => {
              const url = new URL(window.location.href)
              url.searchParams.set("terminal", branch.externalId)
              window.location.href = url.toString()
            }}
          >
            {branch.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
