import { motion, useReducedMotion } from "framer-motion"
import type { ReactNode } from "react"

type RevealProps = { children: ReactNode; className?: string; delay?: number; as?: "div" | "section" | "li" }

/**
 * Fades content up once when it scrolls into view (build addition, DESIGN.md §5).
 * Renders a plain element under prefers-reduced-motion.
 */
export function Reveal({ children, className, delay = 0, as = "div" }: RevealProps) {
  const reduce = useReducedMotion()
  if (reduce) {
    const Tag = as
    return <Tag className={className}>{children}</Tag>
  }
  const MotionTag = motion[as]
  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </MotionTag>
  )
}
