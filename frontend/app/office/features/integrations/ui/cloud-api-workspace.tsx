import { Check, Copy, KeyRound } from "lucide-react"
import { useEffect, useState } from "react"

import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary, usePlatformScope } from "@/office/features/platform/data/use-platform"
import { Banner, Button, DataTable, StatusPill, TonePill, useToast, type Column } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { formatTenge } from "@/shared/lib/format"

import { useCloudApiStatus, type CloudApiStatus } from "../data/use-integrations"
import { CLOUD_API_ENDPOINTS, signedCurlExample } from "../model/cloud-api"

// «Cloud API» (/office/integration-cloud-api, W3-INT-03, decision Г-9): the state of the signed API for
// the restaurant's website — whether the secret and the webhook address are set (never their values), the routes,
// the «Проверка подписи» example and the last orders that came through the API.

export function CloudApiWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <CloudApiContent />
    </PlatformErrorBoundary>
  )
}

type RecentOrder = CloudApiStatus["recentOrders"][number]

function CloudApiContent() {
  const status = useCloudApiStatus()
  const scope = usePlatformScope()
  if (status === undefined) return <OfficeStatePage state={{ kind: "loading" }} />

  const orderColumns: Column<RecentOrder>[] = [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold">{row.number}</span> },
    { key: "source", header: "Заказ сайта", cell: (row) => <span className="font-mono text-caption">{row.sourceOrderId}</span> },
    { key: "restaurant", header: "Ресторан", cell: (row) => scope.restaurantName(row.restaurantExternalId) },
    { key: "total", header: "Сумма", numeric: true, cell: (row) => formatTenge(row.total) },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="delivery" status={row.status} /> },
    { key: "time", header: "Получен", numeric: true, cell: (row) => <span className="whitespace-nowrap text-muted-foreground">{formatAlmatyDateTime(row.createdAt)}</span> },
  ]

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="flex flex-col gap-5 px-6 py-5 xl:px-8">
        {!status.secretConfigured ? (
          <Banner tone="warning" title="Cloud API не подключён">
            Переменная окружения {status.secretEnv} не задана — все маршруты отвечают 503 и данные не отдают. Секрет задаёт администратор деплоя; в Office он не вводится и не показывается.
          </Banner>
        ) : null}

        <section aria-label="Подключение" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-title-sm font-semibold">Подключение сайта ресторана</h3>
            <p className="text-caption text-muted-foreground">Подпись HMAC-SHA256, окно ±5 минут, каждая подпись принимается один раз.</p>
          </div>
          <dl className="grid gap-3 md:grid-cols-3">
            <Fact label="Секрет подписи" value={<SecretState name={status.secretEnv} configured={status.secretConfigured} />} />
            <Fact label="Вебхуки статусов" value={<SecretState name={status.webhookEnv} configured={status.webhookConfigured} />} />
            <Fact
              label="Источник заказов"
              value={status.source ? <span className="flex flex-wrap items-center gap-2">{status.source.name}<TonePill tone={status.source.active ? "success" : "neutral"}>{status.source.active ? "Активен" : "Выключен"}</TonePill></span> : <TonePill tone="warning">Не создан</TonePill>}
            />
          </dl>
        </section>

        <section aria-label="Маршруты" className="flex flex-col gap-3 rounded-card border border-border bg-card p-5">
          <h3 className="text-title-sm font-semibold">Маршруты</h3>
          <ul className="flex flex-col divide-y divide-border">
            {CLOUD_API_ENDPOINTS.map((endpoint) => (
              <li key={endpoint.path} className="flex flex-col gap-1 py-2.5 md:flex-row md:items-baseline md:gap-4">
                <code className="shrink-0 font-mono text-body-sm text-foreground md:w-[420px]">
                  <span className="font-semibold text-accent">{endpoint.method}</span> {endpoint.path}
                </code>
                <span className="text-body-sm text-muted-foreground">{endpoint.description}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Проверка подписи" className="flex flex-col gap-3 rounded-card border border-border bg-card p-5">
          <div className="flex flex-col gap-0.5">
            <h3 className="flex items-center gap-2 text-title-sm font-semibold">
              <KeyRound aria-hidden className="size-4 text-accent" />
              Проверка подписи
            </h3>
            <p className="text-caption text-muted-foreground">Пример запроса меню. Секрет подставляется из окружения того, кто выполняет команду — в примере его нет.</p>
          </div>
          <CodeBlock code={signedCurlExample(scope.restaurants[0]?.externalId)} />
        </section>

        <section aria-label="Последние заказы через API" className="flex flex-col gap-3">
          <h3 className="text-title-sm font-semibold">Последние заказы через API</h3>
          {status.recentOrders.length === 0 ? (
            <OfficeStatePage state={{ kind: "empty", title: "Заказов через API пока нет", description: "Заказы сайта появятся здесь и в разделе «Заказы доставки»." }} />
          ) : (
            <DataTable caption="Последние заказы через API" columns={orderColumns} rows={status.recentOrders} getRowId={(row) => row.externalId} />
          )}
        </section>
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-card bg-muted px-3 py-2">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-body-sm font-semibold text-foreground">{value}</dd>
    </div>
  )
}

function SecretState({ name, configured }: { name: string; configured: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <code className="font-mono text-caption">{name}</code>
      <TonePill tone={configured ? "success" : "warning"}>{configured ? "Задан" : "Не задан"}</TonePill>
    </span>
  )
}

/** The example in a code block with «Скопировать» (as the iiko command on «Обмен данными с iiko»). */
function CodeBlock({ code }: { code: string }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      toast("Пример скопирован", "success")
    } catch {
      toast("Не удалось скопировать — выделите текст вручную", "error")
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-muted p-3 md:flex-row md:items-start">
      <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-body-sm whitespace-pre text-foreground">{code}</pre>
      <Button size="sm" variant="secondary" onClick={() => void copy()} className="self-end md:self-start">
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? "Скопировано" : "Скопировать"}
      </Button>
    </div>
  )
}
