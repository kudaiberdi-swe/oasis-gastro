import { Reveal } from "@/components/Reveal"
import { site } from "@/config/site"

const { stats, concept, facts } = site.home

/** Six big figures, the two-column concept text and four expedition facts. */
export function StatsSection() {
  return (
    <section aria-labelledby={concept.id} className="bg-cream px-5 py-[50px] text-ink">
      <div className="mx-auto max-w-content">
        <ul className="m-0 mb-[70px] grid list-none grid-cols-2 gap-x-5 gap-y-10 p-0 text-center lg:grid-cols-3 lg:gap-x-10 lg:gap-y-[60px]">
          {stats.map((stat, i) => (
            <Reveal as="li" key={stat.label} delay={(i % 3) * 0.08}>
              <span className="block text-5xl leading-[1.1] font-semibold tracking-[-1px] lg:text-[4.2rem]">
                {stat.value}
                {"suffix" in stat && <small className="ml-1 text-[1.1rem] font-semibold tracking-normal">{stat.suffix}</small>}
              </span>
              <span className="mt-[5px] block text-[0.95rem] opacity-90">{stat.label}</span>
            </Reveal>
          ))}
        </ul>

        <Reveal>
          <h2 id={concept.id} className="m-0 mb-[25px] text-[1.8rem] font-semibold lg:text-[2.2rem]">
            {concept.title}
          </h2>
          <div className="grid grid-cols-1 gap-[25px] text-[1.05rem] leading-normal lg:grid-cols-2">
            {concept.paragraphs.map((p) => (
              <p key={p} className="m-0">
                {p}
              </p>
            ))}
          </div>
        </Reveal>

        <ul className="m-0 mt-[50px] grid list-none grid-cols-2 gap-x-5 gap-y-[30px] p-0 lg:grid-cols-4">
          {facts.map((fact, i) => (
            <Reveal as="li" key={fact.value} delay={i * 0.06}>
              <h3 className="m-0 mb-2 text-[1.4rem] font-semibold">{fact.value}</h3>
              <p className="m-0 text-[0.95rem] leading-[1.4]">{fact.label}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  )
}
