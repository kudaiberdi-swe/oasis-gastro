// Cloud API contract as the office shows it (docs/07-CLOUD-API.md, convex/lib/hmac.ts). Only placeholders:
// the real secret lives in the CLOUD_API_SECRET env variable and is never shown or copied here.

export const CLOUD_API_ENDPOINTS: { method: "GET" | "POST"; path: string; description: string }[] = [
  { method: "GET", path: "/api/v1/menu?restaurant=<ресторан>&channel=website", description: "Меню ресторана: категории, позиции, размеры, модификаторы, цены по приказам" },
  { method: "GET", path: "/api/v1/stop-lists?restaurant=<ресторан>", description: "Стоп-лист ресторана на текущий момент" },
  { method: "POST", path: "/api/v1/delivery/orders", description: "Новый заказ доставки; повтор с тем же orderId возвращает уже созданный" },
  { method: "POST", path: "/api/v1/webhooks/<провайдер>", description: "Входящее событие в очередь интеграций, один раз на eventId" },
]

export const CHANNEL_LABELS = { website: "Сайт", "mobile-app": "Мобильное приложение", aggregators: "Агрегаторы", all: "Все каналы" } as const
export const MODE_LABELS = { published: "Опубликованная версия", live: "Живое меню" } as const

export const EXTERNAL_MENU_TABS = [
  { value: "all", label: "Все" },
  { value: "draft", label: "Черновики" },
  { value: "published", label: "Опубликованные" },
  { value: "inactive", label: "Неактивные" },
] as const

export type ExternalMenuTab = (typeof EXTERNAL_MENU_TABS)[number]["value"]

/**
 * A shell example of one signed request: HMAC-SHA256 of `${timestamp}.${METHOD}.${path}.${body}` with the
 * secret from the caller's own environment. The deployment URL is a placeholder the reader replaces.
 */
export function signedCurlExample(restaurantExternalId = "<ресторан>") {
  const path = `/api/v1/menu?restaurant=${restaurantExternalId}&channel=website`
  return [
    `TS=$(($(date +%s) * 1000))`,
    `SIG=$(printf '%s' "$TS.GET.${path}." | openssl dgst -sha256 -hmac "$CLOUD_API_SECRET" -hex | sed 's/^.* //')`,
    `curl -s "https://<деплой>.convex.site${path}" -H "x-sandyq-timestamp: $TS" -H "x-sandyq-signature: $SIG"`,
  ].join("\n")
}
