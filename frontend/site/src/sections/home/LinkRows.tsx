import { ButtonLink } from "@/components/Button"
import { Reveal } from "@/components/Reveal"
import { site } from "@/config/site"

/** "Новости" / "Партнёрам": serif heading on the left, outline pill on the right. */
export function LinkRows() {
  return (
    <div className="mx-auto flex max-w-boxed flex-col gap-10 px-5 py-10 md:gap-[60px]">
      {site.home.rows.map((row) => (
        <Reveal
          as="section"
          key={row.id}
          className="flex scroll-mt-[calc(var(--spacing-header)+20px)] flex-col items-center gap-5 md:flex-row md:justify-between md:px-2.5"
        >
          <h2 id={row.id} className="m-0 font-serif text-2xl font-bold text-ink">
            {row.title}
          </h2>
          <ButtonLink variant="outline" href={row.cta.href}>
            {row.cta.label} <span aria-hidden="true">→</span>
          </ButtonLink>
        </Reveal>
      ))}
    </div>
  )
}
