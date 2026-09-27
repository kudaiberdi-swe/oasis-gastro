import { Picture } from "@/components/Picture"
import { site } from "@/config/site"

const { slogan } = site.home

/** Full-bleed photo band with one centered serif line (212px mobile, 564px desktop). */
export function SloganBand() {
  return (
    <section aria-label="Наши принципы" className="relative isolate flex h-[212px] items-center justify-center overflow-hidden md:h-[564px]">
      <Picture image={slogan.image} sizes="100vw" className="absolute inset-0 -z-20 h-full w-full object-cover" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[var(--band-overlay)]" />
      <p className="text-shadow-band m-0 px-5 text-center font-serif text-base leading-[1.2] font-semibold text-snow md:text-4xl">
        {slogan.text}
      </p>
    </section>
  )
}
