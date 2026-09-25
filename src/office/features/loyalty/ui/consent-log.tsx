import { useState } from "react"

import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, TonePill, useToast } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"

import { useGuestMutations, type ConsentChannel, type GuestCard } from "../data/use-office-loyalty"
import { CONSENT_CHANNELS, latestConsents } from "../model/loyalty-model"

const SOURCE_LABELS: Record<string, string> = {
  office: "Офис",
  pos: "Касса",
  web: "Сайт",
}
const channelLabel = (channel: ConsentChannel) => CONSENT_CHANNELS.find((row) => row.channel === channel)?.label ?? channel

/**
 * «Согласия» of the guest card: the current decision per channel and the append-only journal. Every
 * «Дать согласие / Отозвать» adds a row (recordConsent); earlier rows never change.
 */
export function ConsentLog({ card, canEdit }: { card: GuestCard; canEdit: boolean }) {
  const latest = latestConsents(card.consents)
  const [pending, setPending] = useState<{
    channel: ConsentChannel
    granted: boolean
  } | null>(null)
  const journal = [...card.consents].sort((a, b) => b.recordedAt - a.recordedAt)

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
        {CONSENT_CHANNELS.map(({ channel, label }) => {
          const current = latest[channel]
          return (
            <li key={channel} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body-sm font-medium">{label}</span>
                <span className="text-caption text-muted-foreground">{current ? formatAlmatyDateTime(current.recordedAt) : "Решение не записано"}</span>
              </span>
              <TonePill tone={current ? (current.granted ? "success" : "danger") : "neutral"}>{current ? (current.granted ? "Дано" : "Отозвано") : "Нет данных"}</TonePill>
              {canEdit ? (
                current?.granted ? (
                  <Button size="sm" variant="ghost" onClick={() => setPending({ channel, granted: false })} aria-label={`Отозвать: ${label}`}>
                    Отозвать
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setPending({ channel, granted: true })} aria-label={`Дать согласие: ${label}`}>
                    Дать согласие
                  </Button>
                )
              ) : null}
            </li>
          )
        })}
      </ul>
      <div className="flex flex-col gap-2">
        <h4 className="text-caption font-semibold text-muted-foreground">Журнал согласий</h4>
        {journal.length ? (
          <ol aria-label="Журнал согласий" className="flex max-h-56 flex-col gap-2 overflow-y-auto">
            {journal.map((row) => (
              <li key={row._id} className="flex flex-col text-body-sm">
                <span>
                  <span className="font-medium">{channelLabel(row.channel)}</span> — <span className={row.granted ? "text-success" : "text-destructive"}>{row.granted ? "дано" : "отозвано"}</span>
                </span>
                <span className="text-caption text-muted-foreground">
                  {[formatAlmatyDateTime(row.recordedAt), SOURCE_LABELS[row.source] ?? row.source, row.actorKey, row.documentRef ? `документ ${row.documentRef}` : null].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-body-sm text-muted-foreground">Записей нет — гость пришёл из кассы или до журнала согласий.</p>
        )}
      </div>
      <ConsentDialog guestId={card.guest._id} pending={pending} onClose={() => setPending(null)} />
    </div>
  )
}

function ConsentDialog({ guestId, pending, onClose }: { guestId: GuestCard["guest"]["_id"]; pending: { channel: ConsentChannel; granted: boolean } | null; onClose: () => void }) {
  const { recordConsent } = useGuestMutations()
  const toast = useToast()
  const [documentRef, setDocumentRef] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    setDocumentRef("")
    setError(null)
    onClose()
  }

  async function confirm() {
    if (!pending) return
    setBusy(true)
    setError(null)
    try {
      await recordConsent({
        guestId,
        channel: pending.channel,
        granted: pending.granted,
        ...(documentRef.trim() ? { documentRef: documentRef.trim() } : {}),
      })
      toast(pending.granted ? "Согласие записано" : "Отзыв согласия записан", "success")
      close()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось записать согласие"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{pending?.granted ? "Записать согласие" : "Записать отзыв согласия"}</DialogTitle>
          <DialogDescription>{pending ? `${channelLabel(pending.channel)}. В журнал добавится новая запись, прежние не меняются.` : ""}</DialogDescription>
        </DialogHeader>
        <Field label="Документ-основание (необязательно)" hint="Номер заявления или ссылка на подписанную форму">
          {(control) => <Input {...control} value={documentRef} onChange={(event) => setDocumentRef(event.target.value)} autoComplete="off" />}
        </Field>
        {error ? (
          <p role="alert" className="text-body-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Отмена
          </Button>
          <Button variant={pending?.granted ? "primary" : "danger-solid"} onClick={() => void confirm()} disabled={busy}>
            {busy ? "Сохранение…" : pending?.granted ? "Записать согласие" : "Отозвать согласие"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
