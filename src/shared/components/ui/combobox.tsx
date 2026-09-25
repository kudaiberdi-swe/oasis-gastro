import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { Command } from "cmdk"
import { Check, ChevronDown, X } from "lucide-react"

import { cn, focusRingClass } from "@/shared/lib/utils"

import { inputClass } from "./input"

export interface ComboboxOption {
  value: string
  label: string
  hint?: string
}

interface BaseProps {
  options: ComboboxOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  id?: string
  className?: string
  "aria-describedby"?: string
  "aria-invalid"?: boolean
  "aria-label"?: string
  /** Server-side search: called with the typed text (the list still filters what it gets). */
  onSearchChange?: (search: string) => void
}

export type ComboboxProps =
  | (BaseProps & { multiple?: false; value: string | undefined; onValueChange: (value: string) => void })
  | (BaseProps & { multiple: true; value: string[]; onValueChange: (value: string[]) => void })

/** Searchable choice; `multiple` shows the selection as removable chips instead of a <select multiple>. */
export function Combobox(props: ComboboxProps) {
  const { options, placeholder = "Выберите", searchPlaceholder = "Поиск", emptyText = "Ничего не найдено", disabled, id, className, onSearchChange, ...rest } = props
  const aria = { "aria-describedby": rest["aria-describedby"], "aria-invalid": rest["aria-invalid"], "aria-label": rest["aria-label"] }
  const [open, setOpenState] = React.useState(false)
  // The search box starts empty on every open, so a server-side search is reset on close too.
  const setOpen = (next: boolean) => {
    setOpenState(next)
    if (!next) onSearchChange?.("")
  }
  const selected = props.multiple ? props.value : props.value ? [props.value] : []
  const labelOf = (value: string) => options.find((option) => option.value === value)?.label ?? value

  const toggle = (value: string) => {
    if (props.multiple) {
      props.onValueChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value])
    } else {
      props.onValueChange(value)
      setOpen(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(inputClass, "flex items-center justify-between gap-2 text-left", selected.length === 0 && "text-muted-foreground")}
          {...aria}
        >
          <span className="truncate">
            {props.multiple ? (selected.length ? `Выбрано: ${selected.length}` : placeholder) : selected[0] ? labelOf(selected[0]) : placeholder}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            sideOffset={4}
            className="z-50 w-[var(--radix-popover-trigger-width)] min-w-56 rounded-card border border-border bg-popover text-popover-foreground shadow-float"
          >
            <Command loop>
              <Command.Input placeholder={searchPlaceholder} onValueChange={onSearchChange} className={cn(inputClass, "rounded-b-none border-0 border-b border-border")} />
              <Command.List className="max-h-72 overflow-y-auto p-1">
                <Command.Empty className="px-3 py-4 text-body-sm text-muted-foreground">{emptyText}</Command.Empty>
                {options.map((option) => (
                  <Command.Item
                    key={option.value}
                    value={`${option.label} ${option.hint ?? ""} ${option.value}`}
                    onSelect={() => toggle(option.value)}
                    className="flex min-h-[var(--control-h)] cursor-default items-center gap-2 rounded-control px-2 text-body-sm data-[selected=true]:bg-muted"
                  >
                    <Check className={cn("size-4 shrink-0 text-primary", !selected.includes(option.value) && "invisible")} />
                    <span className="flex-1 truncate">{option.label}</span>
                    {option.hint ? <span className="text-caption text-muted-foreground">{option.hint}</span> : null}
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>

      {props.multiple && selected.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Выбрано">
          {selected.map((value) => (
            <li key={value} className="inline-flex h-8 items-center gap-1 rounded-control border border-input bg-muted pr-1 pl-2 text-body-sm">
              {labelOf(value)}
              <button
                type="button"
                aria-label={`Убрать ${labelOf(value)}`}
                disabled={disabled}
                onClick={() => toggle(value)}
                className={cn("inline-flex size-6 items-center justify-center rounded-control text-muted-foreground hover:bg-card hover:text-foreground", focusRingClass)}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
