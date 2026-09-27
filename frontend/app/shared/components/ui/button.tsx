import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn, focusRingClass } from "@/shared/lib/utils"

// POS-DESIGN §5 Button: one primary per screen; radius is always --radius-control. A press sinks the
// button by 1px (150ms, touch feedback); under prefers-reduced-motion it stays put.
const buttonVariants = cva(
  cn(
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control font-semibold transition-[color,background-color,border-color,opacity,translate] duration-150 ease-out active:translate-y-px motion-reduce:transition-colors motion-reduce:active:translate-y-0 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0",
    focusRingClass,
  ),
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary: "border border-input bg-card text-foreground hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
        danger: "border border-destructive bg-card text-destructive hover:bg-muted",
        "danger-solid": "bg-destructive text-destructive-foreground hover:opacity-90",
        link: "h-auto px-0 text-accent underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-9 px-3 text-body-sm",
        md: "h-11 px-4 text-body-sm",
        lg: "h-14 px-6 text-body",
        icon: "size-11",
        "icon-sm": "size-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, type, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} type={asChild ? type : (type ?? "button")} {...props} />
})
Button.displayName = "Button"

export { Button, buttonVariants }
