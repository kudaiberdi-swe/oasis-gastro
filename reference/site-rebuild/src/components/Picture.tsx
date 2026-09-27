import type { ImgHTMLAttributes } from "react"

import type { ImageRef } from "@/config/site"
import { imageSource } from "@/lib/images"

type PictureProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "alt" | "width" | "height"> & {
  image: ImageRef
  /** `sizes` attribute — how wide the image renders, so the browser can pick a srcset entry. */
  sizes?: string
  /** Above-the-fold images load eagerly with high priority; everything else is lazy. */
  priority?: boolean
}

/** Responsive <img> with intrinsic width/height (no layout shift) and WebP srcset. */
export function Picture({ image, sizes = "100vw", priority = false, ...rest }: PictureProps) {
  const source = imageSource(image.name)
  return (
    <img
      {...source}
      sizes={"srcSet" in source ? sizes : undefined}
      alt={image.alt}
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? "sync" : "async"}
      fetchPriority={priority ? "high" : undefined}
      {...rest}
    />
  )
}
