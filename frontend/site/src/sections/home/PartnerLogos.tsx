import { Picture } from "@/components/Picture"
import { site } from "@/config/site"

/** Strip of partner brand logos, spaced between (stacked on mobile). */
export function PartnerLogos() {
  return (
    <section aria-label="Бренды-партнёры" className="mx-auto max-w-content px-5">
      <ul className="m-0 flex list-none flex-col items-center justify-between gap-[30px] p-0 py-10 md:flex-row">
        {site.home.partners.map((logo) => (
          <li key={logo.name}>
            <Picture image={logo} sizes="150px" className="block h-auto max-h-[100px] w-auto" />
          </li>
        ))}
      </ul>
    </section>
  )
}
