import { Picture } from "@/components/Picture"
import { Reveal } from "@/components/Reveal"
import { site } from "@/config/site"

const { values } = site.home

/** Two centered lists divided by a thin line, framed by carving ornaments. */
export function ValuesSection() {
  return (
    <section aria-label="Ценности и принципы" className="relative mx-auto my-20 flex max-w-content flex-col items-center justify-center px-5 md:flex-row md:px-4">
      <ValueList {...values.left} />
      <span aria-hidden="true" className="my-8 mb-6 block h-px w-[130px] border-b border-ink md:mx-[66px] md:my-0 md:h-[130px] md:w-0 md:border-b-0 md:border-l" />
      <ValueList {...values.right} />
      <Picture image={values.ornament} sizes="52px" className="absolute top-1/2 left-4 hidden w-[52px] -translate-y-1/2 md:block" />
      <Picture image={values.ornament} sizes="52px" className="absolute top-1/2 right-4 hidden w-[52px] -translate-y-1/2 -scale-x-100 md:block" />
    </section>
  )
}

function ValueList({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <Reveal className="relative w-full flex-1 text-center">
      <h2 className="m-0 mb-[22px] text-2xl leading-[29px] font-semibold text-brown md:text-4xl md:leading-[43px]">{title}</h2>
      <ul className="m-0 flex list-none flex-col gap-[22px] p-0">
        {items.map((item) => (
          <li key={item} className="text-base leading-[19px] font-medium text-brown md:text-2xl md:leading-7">
            {item}
          </li>
        ))}
      </ul>
      <Picture image={values.ornament} sizes="32px" className="absolute top-1/2 left-0 w-8 -translate-y-1/2 md:hidden" />
      <Picture image={values.ornament} sizes="32px" className="absolute top-1/2 right-0 w-8 -translate-y-1/2 -scale-x-100 md:hidden" />
    </Reveal>
  )
}
