import { motion, useReducedMotion } from "framer-motion"

import { Picture } from "@/components/Picture"
import { site } from "@/config/site"

const { hero } = site.home

/** Photo hero with a bottom-to-top dark gradient; copy pinned bottom-left. */
export function HomeHero() {
  const reduce = useReducedMotion()
  const fade = (delay: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] as const } }

  return (
    <section aria-labelledby="home-hero-title" className="relative isolate flex flex-col items-start justify-end overflow-hidden px-[6%] pt-[140px] pb-[60px] md:px-[10%] md:pt-[460px] md:pb-[100px]">
      <Picture image={hero.image} priority sizes="100vw" className="absolute inset-0 -z-20 h-full w-full object-cover object-bottom md:object-center" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[image:var(--hero-overlay)]" />
      <motion.h1
        id="home-hero-title"
        {...fade(0.1)}
        className="text-shadow-hero m-0 mb-[1.2rem] w-full max-w-[1200px] text-[2rem] leading-[1.15] font-bold text-white md:mb-[1.8rem] md:text-[4.2rem]"
      >
        {hero.title}
      </motion.h1>
      <motion.p {...fade(0.25)} className="text-shadow-hero m-0 w-full max-w-[850px] text-[1.05rem] leading-normal text-white md:text-xl">
        {hero.lead}
      </motion.p>
    </section>
  )
}
