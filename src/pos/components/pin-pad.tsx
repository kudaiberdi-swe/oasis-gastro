import { Delete } from "lucide-react"

import { Button } from "@/shared/components/ui/button"

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "backspace"] as const

export function PinPad({ onDigit, onBackspace, disabled }: { onDigit: (digit: string) => void; onBackspace: () => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {KEYS.map((key, index) =>
        key === "" ? (
          <div key={`spacer-${index}`} />
        ) : key === "backspace" ? (
          <Button key={key} type="button" variant="secondary" size="lg" disabled={disabled} onClick={onBackspace} aria-label="Стереть">
            <Delete />
          </Button>
        ) : (
          <Button key={key} type="button" variant="secondary" size="lg" disabled={disabled} onClick={() => onDigit(key)} className="text-lg">
            {key}
          </Button>
        ),
      )}
    </div>
  )
}
