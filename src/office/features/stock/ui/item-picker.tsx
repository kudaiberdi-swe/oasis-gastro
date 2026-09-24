import { useState } from "react"

import { useCan } from "@/office/components/can"
import { Combobox } from "@/shared/components/ui"

import { ITEM_KIND_LABELS, useInventoryItemSearch, type InventoryItem } from "../data/use-stock-master"

/** «Позиция» for document lines: searches active inventory items on the server as the user types. */
export function ItemPicker({ onPick, label = "Добавить позицию", className }: { onPick: (item: InventoryItem) => void; label?: string; className?: string }) {
  const [search, setSearch] = useState("")
  const items = useInventoryItemSearch(search, useCan("office.stock.view"))
  const options = (items ?? []).map((item) => ({ value: item.externalId, label: item.name, hint: [item.kind ? ITEM_KIND_LABELS[item.kind] : null, item.unit].filter(Boolean).join(" · ") }))
  return (
    <Combobox
      aria-label={label}
      className={className}
      value={undefined}
      onValueChange={(externalId) => {
        const item = items?.find((candidate) => candidate.externalId === externalId)
        if (item) onPick(item)
      }}
      onSearchChange={setSearch}
      options={options}
      placeholder={label}
      searchPlaceholder="Название позиции"
      emptyText={items === undefined ? "Загрузка…" : "Ничего не найдено"}
    />
  )
}
