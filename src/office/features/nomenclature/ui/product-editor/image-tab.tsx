import { ImageUp } from "lucide-react"
import { useRef, useState, type DragEvent } from "react"

import { Banner, Button, useToast } from "@/shared/components/ui"
import { useImageUpload } from "@/shared/lib/use-image-upload"
import { cn } from "@/shared/lib/utils"

import { useNomenclatureMutations, type ProductCard } from "../../data/use-nomenclature"
import { Block } from "./main-tab"

/** «Изображение»: 4:3 preview with drag-and-drop; the file is saved at once, not with the card. */
export function ImageTab({ card, canEdit }: { card: ProductCard; canEdit: boolean }) {
  const { attachProductImage } = useNomenclatureMutations()
  const { upload, uploading, error } = useImageUpload()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  async function send(file: File | undefined) {
    if (!file || !canEdit) return
    const done = await upload(file, (storageId) => attachProductImage({ productExternalId: card.externalId, storageId }))
    if (done) toast("Изображение сохранено", "success")
  }

  const dropHandlers = canEdit
    ? {
        onDragOver: (event: DragEvent) => {
          event.preventDefault()
          setDragging(true)
        },
        onDragLeave: () => setDragging(false),
        onDrop: (event: DragEvent) => {
          event.preventDefault()
          setDragging(false)
          void send(event.dataTransfer.files[0])
        },
      }
    : {}

  return (
    <Block title="Изображение">
      {error ? (
        <Banner tone="danger" title="Не удалось загрузить">
          {error}
        </Banner>
      ) : null}
      <div
        {...dropHandlers}
        aria-busy={uploading || undefined}
        className={cn("relative aspect-[4/3] w-full max-w-lg overflow-hidden rounded-card border border-border bg-muted", dragging && "border-accent")}
      >
        {card.imageUrl ? (
          <img src={card.imageUrl} alt={card.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
            <ImageUp aria-hidden className="size-8" />
            <p className="text-body-sm">{canEdit ? "Перетащите изображение сюда" : "Изображения пока нет"}</p>
          </div>
        )}
        {uploading ? <div className="absolute inset-0 grid place-items-center bg-card/70 text-body-sm font-medium">Загрузка…</div> : null}
      </div>
      <p className="text-caption text-muted-foreground">Рекомендуемый размер — 550×550 px, JPG, PNG или WebP до 2 МБ.</p>
      {canEdit ? (
        <div>
          <input
            ref={input}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              void send(event.target.files?.[0])
              event.target.value = ""
            }}
          />
          <Button variant="secondary" onClick={() => input.current?.click()} disabled={uploading}>
            {card.imageUrl ? "Заменить изображение" : "Загрузить изображение"}
          </Button>
        </div>
      ) : null}
    </Block>
  )
}
