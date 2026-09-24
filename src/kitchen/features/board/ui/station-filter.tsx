import { STATIONS } from "@/kitchen/features/board/model/ticket"
import { Chip } from "@/shared/components/ui"

export interface StationFilterProps {
  value: string | undefined
  onChange: (prepArea: string | undefined) => void
}

/** Station chips on the dark board: the active one keeps --nav, outlined in --nav-accent to stand out. */
export function StationFilter({ value, onChange }: StationFilterProps) {
  return (
    <div role="group" aria-label="Станция" className="flex flex-wrap items-center gap-2">
      {STATIONS.map((station) => {
        const active = station.value === value
        return (
          <Chip key={station.label} size="lg" active={active} className={active ? "border-nav-accent" : undefined} onClick={() => onChange(station.value)}>
            {station.label}
          </Chip>
        )
      })}
    </div>
  )
}
