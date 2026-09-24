import { useMutation } from "convex/react"
import { useCallback, useState } from "react"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { errorMessage } from "./error-message"

// W1-CAT-06: office image upload. The upload URL is issued only to a user with the edit right, the
// file goes straight to Convex storage with its own Content-Type, and the attach mutation (product
// or modifier) checks type and size on the server and replaces the old file.

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024

/** Client-side pre-check, the same rule the server applies: an image up to 2 MB. */
export function imageFileProblem(file: File): string | null {
  if (!file.type.startsWith("image/")) return "Нужен файл изображения (JPG, PNG или WebP)"
  if (file.size > MAX_IMAGE_BYTES) return "Изображение больше 2 МБ — уменьшите его и попробуйте снова"
  return null
}

export type AttachImage = (storageId: Id<"_storage">) => Promise<unknown>

export function useImageUpload() {
  const generateUploadUrl = useMutation(api.domains.catalog.office.generateImageUploadUrl)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Uploads the file and attaches it; resolves true on success, false with `error` set otherwise. */
  const upload = useCallback(
    async (file: File, attach: AttachImage) => {
      const problem = imageFileProblem(file)
      if (problem) {
        setError(problem)
        return false
      }
      setUploading(true)
      setError(null)
      try {
        const url = await generateUploadUrl({})
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file })
        if (!response.ok) throw new Error("Не удалось загрузить файл")
        const { storageId } = (await response.json()) as { storageId: Id<"_storage"> }
        await attach(storageId)
        return true
      } catch (caught) {
        setError(errorMessage(caught, "Не удалось загрузить изображение"))
        return false
      } finally {
        setUploading(false)
      }
    },
    [generateUploadUrl],
  )

  return { upload, uploading, error, clearError: useCallback(() => setError(null), []) }
}
