import { Keyboard, ScanBarcode } from "lucide-react"

import { POS_HOTKEYS } from "../model/hotkeys"

/** «Горячие клавиши» in the employee profile (W3-POS-01): the key map and how the scanner works. */
export function HotkeyHints() {
  return (
    <section aria-labelledby="pos-hotkeys" className="flex flex-col gap-3 rounded-card border border-border p-4">
      <h3 id="pos-hotkeys" className="flex items-center gap-2 text-body font-semibold">
        <Keyboard aria-hidden className="size-5 text-muted-foreground" /> Горячие клавиши
      </h3>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-body-sm">
        {POS_HOTKEYS.map((hotkey) => (
          <div key={hotkey.key} className="contents">
            <dt>
              <kbd className="inline-grid min-w-11 place-items-center rounded-control border border-border bg-muted px-2 py-0.5 font-sans text-body-sm font-semibold text-foreground">{hotkey.keyLabel}</kbd>
            </dt>
            <dd className="text-foreground">{hotkey.label}</dd>
          </div>
        ))}
      </dl>
      <p className="text-body-sm text-muted-foreground">Клавиши не срабатывают, пока курсор в поле ввода или открыто окно.</p>
      <p className="flex items-start gap-2 text-body-sm text-muted-foreground">
        <ScanBarcode aria-hidden className="mt-0.5 size-4 shrink-0" />
        Сканер штрихкодов: наведите на код товара — позиция добавится в текущий заказ.
      </p>
    </section>
  )
}
