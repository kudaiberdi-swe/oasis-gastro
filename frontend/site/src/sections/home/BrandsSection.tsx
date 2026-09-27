import { SmartLink } from "@/components/Button"
import { Picture } from "@/components/Picture"
import { Reveal } from "@/components/Reveal"
import { site } from "@/config/site"

const { brands } = site.home

export function BrandsSection() {
  return (
    <section aria-labelledby={brands.id} className="mx-auto max-w-boxed p-5 py-12">
      <h2 id={brands.id} className="m-0 mb-[30px] pl-2.5 text-[26px] font-semibold text-ink md:mb-10 md:pl-0 md:text-[32px]">
        {brands.title}
      </h2>
      <ul className="m-0 flex list-none flex-col items-center gap-12 p-0 md:flex-row md:items-start md:gap-16">
        {brands.items.map((brand, i) => (
          <Reveal as="li" key={brand.name} delay={i * 0.1} className="w-full max-w-[280px] md:w-[240px]">
            <SmartLink href={brand.href} className="group flex flex-col items-center gap-3 text-center no-underline">
              <span className="flex h-[130px] w-full items-center justify-center md:h-[140px]">
                <Picture image={brand.logo} sizes="120px" className="h-auto w-[120px] object-contain transition-transform duration-300 ease-out group-hover:scale-105" />
              </span>
              <span className="text-[32px] leading-[1.2] font-medium text-ink md:text-4xl">{brand.name}</span>
              <span className="text-base leading-[1.4] text-muted-2 md:text-lg">{brand.description}</span>
            </SmartLink>
          </Reveal>
        ))}
      </ul>
    </section>
  )
}
