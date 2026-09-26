import type { PrintLine } from "../../../../../convex/lib/printTemplate"
import { cn } from "@/shared/lib/utils"

/**
 * The paper tape of a print template (W3-ADM-10): 58 or 80 mm on --card, monospace, the same lines the
 * printer gets. Lines are React text — a template cannot inject markup into the office.
 */
export function PrintPreview({ lines, widthMm, className }: { lines: PrintLine[]; widthMm: number; className?: string }) {
  return (
    <div role="img" aria-label={`Превью печати, лента ${widthMm} мм`} className={cn("mx-auto max-w-full overflow-hidden rounded-control border border-border bg-card px-3 py-4 font-mono text-body-sm text-foreground shadow-panel", className)} style={{ width: `${widthMm}mm` }}>
      {lines.length === 0 ? <p className="text-center text-caption text-muted-foreground">Пустой шаблон</p> : null}
      {lines.map((line, index) => {
        if (line.kind === "logo") return <img key={index} src="/branding/sandyq-kz-hidden-menu-logo.svg" alt="Sandyq" className="mx-auto my-1 h-14 dark:invert" />
        if (line.kind === "divider") return <hr key={index} className={cn("my-2 border-0 border-t border-foreground", line.style === "dashed" && "border-dashed")} />
        const classes = cn(
          "min-h-5 break-words",
          line.align === "center" && "text-center",
          line.align === "right" && "text-right",
          line.bold && "font-semibold",
          line.size === "small" && "text-caption text-muted-foreground",
          line.size === "large" && "text-title-sm",
          line.box && "my-1 border-2 border-foreground px-1 py-0.5 text-center font-semibold",
          line.total && "mt-1 border-t-2 border-foreground pt-1",
        )
        if (line.right !== undefined) {
          return (
            <div key={index} className={cn("flex items-start justify-between gap-2", classes)}>
              <span className="min-w-0">{line.left}</span>
              <span className="shrink-0 text-right whitespace-nowrap">{line.right}</span>
            </div>
          )
        }
        return (
          <p key={index} className={classes}>
            {line.left || " "}
          </p>
        )
      })}
    </div>
  )
}
