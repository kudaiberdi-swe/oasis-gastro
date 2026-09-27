import type { ReactNode } from "react"

import { Banner, Button, EmptyState, Skeleton, SkeletonRows } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

export type OfficeState =
  | { kind: "loading" }
  | { kind: "empty"; title?: ReactNode; description?: ReactNode; action?: ReactNode }
  | { kind: "error"; error: unknown; onRetry?: () => void }
  | { kind: "denied" }

/** The four non-content states every office page renders the same way (OFFICE-DESIGN §7). */
export function OfficeStatePage({ state }: { state: OfficeState }) {
  switch (state.kind) {
    case "loading":
      return (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <SkeletonRows rows={6} />
        </div>
      )
    case "empty":
      return (
        <EmptyState
          title={state.title ?? "Записей пока нет"}
          description={state.description ?? "Создайте первую рабочую запись."}
          action={state.action}
        />
      )
    case "error":
      return (
        <Banner tone="danger" title="Не удалось загрузить" action={state.onRetry ? <Button size="sm" variant="secondary" onClick={state.onRetry}>Повторить</Button> : undefined}>
          {errorMessage(state.error, "Попробуйте ещё раз через минуту.")}
        </Banner>
      )
    case "denied":
      return <EmptyState size="lg" title="Нет доступа" description="У вашей роли нет права на этот раздел. Обратитесь к администратору." />
  }
}

/** For editors with many lines on a phone-width screen (OFFICE-DESIGN §8). */
export function DesktopOnlyNotice() {
  return <EmptyState title="Откройте на компьютере" description="Этот документ слишком большой для экрана телефона — его можно только просматривать." />
}
