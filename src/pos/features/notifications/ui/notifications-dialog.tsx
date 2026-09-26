import { useState } from "react"
import { AlertTriangle, Bell, OctagonAlert } from "lucide-react"

import type { PosNotification } from "@/pos/features/notifications/data/use-notifications"
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, EmptyState, TonePill } from "@/shared/components/ui"
import { useT } from "@/pos/i18n"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { cn } from "@/shared/lib/utils"

const SEVERITY_ICON = { info: Bell, warning: AlertTriangle, critical: OctagonAlert } as const

/** A long-shift notice (pos/internal.ts flagLongShifts) opens the shift dialog. */
export const opensShift = (item: Pick<PosNotification, "dedupeKey">) => Boolean(item.dedupeKey?.startsWith("long-shift:"))

/**
 * «Уведомления кассы» (W1-POS-14): system events of this terminal. Reading is per employee: marking
 * one read leaves it unread for colleagues on the same terminal.
 */
export function NotificationsDialog({
  open,
  onOpenChange,
  items,
  canLoadMore,
  onLoadMore,
  onRead,
  onOpenShift,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: PosNotification[]
  canLoadMore: boolean
  onLoadMore: () => void
  onRead: (notificationId: PosNotification["_id"]) => Promise<unknown>
  onOpenShift: () => void
}) {
  const t = useT()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function read(item: PosNotification) {
    setBusyId(item._id)
    try {
      await onRead(item._id)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("notifications.title")}</DialogTitle>
          <DialogDescription>{t("notifications.description")}</DialogDescription>
        </DialogHeader>
        {items.length === 0 ? (
          <EmptyState title={t("notifications.emptyTitle")} description={t("notifications.emptyHint")} />
        ) : (
          <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto" aria-label={t("header.notifications")}>
            {items.map((item) => {
              const Icon = SEVERITY_ICON[item.severity]
              return (
                <li key={item._id} className={cn("flex gap-3 rounded-card border p-3", item.read ? "border-border bg-card" : "border-warning/40 bg-warning/10")}>
                  <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", item.severity === "critical" ? "text-destructive" : item.severity === "warning" ? "text-warning" : "text-accent")} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-body font-semibold">{item.title}</p>
                      {!item.read && <TonePill tone="warning">{t("notifications.new")}</TonePill>}
                    </div>
                    <p className="text-body-sm text-muted-foreground">{item.message}</p>
                    <p className="text-body-sm text-muted-foreground">{formatAlmatyDateTime(item.createdAt, t.intl)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {opensShift(item) && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          if (!item.read) void read(item)
                          onOpenChange(false)
                          onOpenShift()
                        }}
                      >
                        {t("notifications.open")}
                      </Button>
                    )}
                    {!item.read && (
                      <Button variant="ghost" onClick={() => void read(item)} disabled={busyId === item._id}>
                        {t("notifications.read")}
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {canLoadMore && (
          <div className="flex justify-center">
            <Button variant="secondary" onClick={onLoadMore}>
              {t("common.showMore")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
