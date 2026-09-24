import {
  Bike,
  Boxes,
  Building2,
  ChartColumn,
  ChefHat,
  HeartHandshake,
  House,
  Plug,
  Settings,
  ShoppingBag,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react"

// Office navigation: 12 groups and 91 items in the same order and with the same ids as bahandi-pos
// (src/features/office-platform/model/navigation.ts). Capabilities are `office.<id>.view`, except the
// sections that already have a sandyq backend module, which use that module's capability.
// ЕГАИС is always listed (decision D4: its page says it is not used in Kazakhstan).

export type OfficeNavigationItem = {
  id: string
  label: string
  description: string
  capability: string
  /** report/integration: catalog-style pages; link: opens another app surface (/pos, /kitchen). */
  kind?: "report" | "integration" | "link"
}

export type OfficeNavigationGroup = {
  id: string
  label: string
  /** The small line above page titles in this group. */
  whisper: string
  icon: LucideIcon
  items: OfficeNavigationItem[]
}

const item = (
  id: string,
  label: string,
  description: string,
  capability = `office.${id}.view`,
  kind?: OfficeNavigationItem["kind"],
): OfficeNavigationItem => ({ id, label, description, capability, kind })

export const officeNavigation: OfficeNavigationGroup[] = [
  {
    id: "home",
    label: "Главная",
    icon: House,
    whisper: "Обзор",
    items: [
      item("dashboard", "Стартовая страница", "Показатели, задачи и состояние ресторанов"),
      item("favorites", "Избранное", "Закреплённые разделы и отчёты"),
    ],
  },
  {
    id: "sales",
    label: "Розничные продажи",
    icon: ShoppingBag,
    whisper: "Продажи",
    items: [
      item("pos", "Касса", "Рабочее место кассира", undefined, "link"),
      item("orders", "Заказы и чеки", "Открытые и оплаченные заказы, возвраты и чеки"),
      item("cash-shifts", "Кассовые смены", "Открытие, принятие и закрытие кассовых смен"),
      item("payment-types", "Типы оплат", "Наличные, карты, QR, без выручки и внешние оплаты"),
      item("order-types", "Типы заказов", "В зале, навынос, доставка и пользовательские типы"),
      item("discount-types", "Скидки и надбавки", "Правила скидок, надбавок и сервисного сбора"),
      item("deletion-reasons", "Причины удалений", "Причины отмен и удалений позиций"),
      item("cash-operations", "Внесения и изъятия", "Кассовые операции и основания"),
    ],
  },
  {
    id: "stock",
    label: "Товары и склады",
    icon: Boxes,
    whisper: "Учёт",
    items: [
      item("nomenclature", "Номенклатура", "Блюда, товары, рецептуры и правила продажи", "office.catalog.view"),
      item("product-groups", "Группы товаров", "Иерархия номенклатурных групп и категорий"),
      item("modifiers", "Модификаторы", "Группы модификаторов и правила выбора"),
      item("size-scales", "Шкалы размеров", "Размеры, коэффициенты и кухонные названия"),
      item("price-orders", "Приказы об изменении цен", "Датированные изменения прейскуранта"),
      item("price-lists", "Прайс-листы", "Внутренние и поставщицкие прайс-листы"),
      item("warehouses", "Склады", "Места хранения и материально ответственные"),
      item("stock", "Остатки", "Текущие остатки, стоимость и контроль минимумов", "office.stock.view"),
      item("receipts", "Приходные накладные", "Поступления поставщиков и складские партии"),
      item("outgoing-invoices", "Расходные накладные", "Отгрузки контрагентам и списание партий"),
      item("supplier-returns", "Возвраты поставщикам", "Возврат товаров и корректировка задолженности"),
      item("inventories", "Инвентаризации", "Фактические остатки и сличительные ведомости"),
      item("transfers", "Внутренние перемещения", "Перемещения между складами и ресторанами"),
      item("writeoffs", "Акты списания", "Порча, недостача и прочее списание"),
      item("suppliers", "Поставщики", "Контрагенты, договоры и условия поставки"),
      item("units", "Единицы измерения", "Базовые единицы и коэффициенты пересчёта"),
    ],
  },
  {
    id: "production",
    label: "Производство и логистика",
    icon: ChefHat,
    whisper: "Кухня",
    items: [
      item("production", "Приготовление", "Акты приготовления и заготовки"),
      item("processing-acts", "Акты переработки", "Преобразование сырья и выход продукции"),
      item("assembly-acts", "Акты разбора", "Разбор продукции на составляющие"),
      item("sales-acts", "Акты реализации", "Документирование реализации со склада"),
      item("purchase-orders", "Заказы поставщикам", "Планирование и контроль закупок"),
      item("internal-orders", "Внутренние заказы", "Заказы между ресторанами и складами"),
      item("kitchen-plan", "План на кухню", "План приготовления по прогнозу продаж"),
      item("kitchen-board", "Экран кухни", "Очередь заказов на кухне в реальном времени", "office.kitchen-plan.view", "link"),
      item("semi-finished-sheet", "Ведомость полуфабрикатов", "Потребность и выпуск заготовок"),
    ],
  },
  {
    id: "finance",
    label: "Финансы",
    icon: Wallet,
    whisper: "Деньги",
    items: [
      item("cashflow-categories", "Статьи ДДС", "Категории движения денежных средств"),
      item("chart-of-accounts", "План счетов", "Финансовые, складские и расчётные счета"),
      item("transactions", "Проводки", "Ручные и системные финансовые операции", "office.finance.view"),
      item("shift-acceptance", "Принятие смен", "Сверка и принятие кассовой выручки"),
      item("services", "Акты услуг", "Полученные и оказанные услуги"),
      item("counterparties", "Контрагенты", "Юридические лица и договорные реквизиты"),
      item("accounts-payable", "Задолженность", "Дебиторская и кредиторская задолженность"),
      item("payments", "Платежи", "Входящие, исходящие и распределённые платежи"),
      item("bank-statements", "Банковские выписки", "Импорт, сопоставление и проведение выписок"),
      item("payment-calendar", "Платёжный календарь", "Планирование и согласование денежных потоков"),
      item("budgets", "Бюджеты", "Финансовые планы и план-факт"),
    ],
  },
  {
    id: "employees",
    label: "Сотрудники",
    icon: Users,
    whisper: "Команда",
    items: [
      item("employees", "Сотрудники", "Карточки, подразделения, ставки и доступ", "office.workforce.view"),
      item("positions", "Должности", "Должности, тарифы и нормативы"),
      item("shift-types", "Типы смен", "Рабочие смены и правила оплаты"),
      item("schedule", "Расписание", "Планирование рабочих смен"),
      item("attendance", "Журнал явки", "Фактическое рабочее время и отклонения"),
      item("payroll", "Начисления и удержания", "Зарплата, авансы, премии и штрафы"),
      item("motivation", "Мотивационные программы", "Показатели и правила вознаграждений"),
      item("medical-records", "Медкнижки и анализы", "Сроки документов и допуск к работе"),
    ],
  },
  {
    id: "guests",
    label: "Гости и лояльность",
    icon: HeartHandshake,
    whisper: "Гости",
    items: [
      item("guests", "Гости", "Профили, контакты, согласия и история", "office.loyalty.view"),
      item("loyalty-programs", "Программы лояльности", "Бонусные и депозитные программы"),
      item("guest-categories", "Категории гостей", "Сегменты, условия и уровни"),
      item("campaigns", "Рассылки и акции", "Кампании, аудитории и коммуникации"),
      item("reservations", "Банкеты и резервы", "Бронирования столов и банкетные заказы"),
    ],
  },
  {
    id: "delivery",
    label: "Доставка и колл-центр",
    icon: Bike,
    whisper: "Доставка",
    items: [
      item("delivery-orders", "Заказы доставки", "Приём, подтверждение и исполнение доставок"),
      item("delivery-zones", "Зоны доставки", "География, тарифы и нормативы времени"),
      item("couriers", "Курьеры", "Смены, маршруты и статусы курьеров"),
      item("call-center", "Колл-центр", "Очередь заказов и рабочее место оператора"),
      item("telephony", "Телефония", "Линии, звонки и сопоставление с гостями"),
      item("delivery-sources", "Источники заказов", "Сайт, приложения, агрегаторы и телефон"),
    ],
  },
  {
    id: "corporation",
    label: "Корпорация",
    icon: Building2,
    whisper: "Структура",
    items: [
      item("organizations", "Организации", "Юридическая и управленческая структура"),
      item("restaurants", "Рестораны", "Торговые предприятия и настройки точек"),
      item("departments", "Подразделения", "Отделения, концепции и зоны ответственности"),
      item("data-exchange", "Обмен между точками", "Репликация справочников и документов"),
      item("document-locks", "Закрытие периода", "Предварительная и окончательная блокировка"),
    ],
  },
  {
    id: "exchange",
    label: "Обмен и интеграции",
    icon: Plug,
    whisper: "Обмен",
    items: [
      item("integration-1c", "1С", "Выгрузка документов и справочников", undefined, "integration"),
      item("integration-edi", "EDI", "Заказы и накладные поставщиков", undefined, "integration"),
      item("integration-bank", "Банк-клиент", "Выписки и платёжные поручения", undefined, "integration"),
      item("integration-fiscal", "Фискальные сервисы", "ККМ, ОФД и локальные требования", undefined, "integration"),
      item("integration-egais", "ЕГАИС", "Алкогольный учёт через УТМ", undefined, "integration"),
      item("integration-loyalty", "Лояльность", "Бонусные провайдеры и iikoCard", undefined, "integration"),
      item("integration-messaging", "SMS и email", "Провайдеры уведомлений и рассылок", undefined, "integration"),
      item("integration-maps", "Карты и курьеры", "Геокодирование, маршруты и трекинг", undefined, "integration"),
      item("integration-cloud-api", "Cloud API", "Внешние приложения, ключи и вебхуки", undefined, "integration"),
      item("external-menu", "Внешнее меню", "Публикация меню для сайтов и агрегаторов", undefined, "integration"),
    ],
  },
  {
    id: "admin",
    label: "Администрирование",
    icon: Settings,
    whisper: "Система",
    items: [
      item("users", "Пользователи", "Учётные записи и область ответственности"),
      item("roles", "Роли и права", "Гранулярные разрешения и ресурсные области"),
      item("terminals", "Терминалы", "Кассовые и кухонные рабочие места"),
      item("equipment", "Оборудование", "Принтеры, весы, экраны и процессинг"),
      item("print-templates", "Шаблоны печати", "Чеки, этикетки и печатные формы"),
      item("audit-log", "Журнал событий", "Аудит действий и системных событий"),
      item("system-settings", "Настройки системы", "Учёт, нумерация, налоги и уведомления"),
      item("integration-jobs", "Очередь интеграций", "Повторы, ошибки и сверка обмена"),
    ],
  },
  {
    id: "reports",
    label: "Отчёты",
    icon: ChartColumn,
    whisper: "Аналитика",
    items: [
      item("reports", "Все отчёты", "Полный каталог iiko и конструктор OLAP", "office.reports.view", "report"),
      item("report-favorites", "Избранные отчёты", "Закреплённые представления", undefined, "report"),
      item("report-schedules", "Рассылки отчётов", "Расписание XLSX, CSV и PDF", undefined, "report"),
    ],
  },
]

export const officeItems = officeNavigation.flatMap((group) => group.items)

export function findOfficeItem(id: string | undefined) {
  return officeItems.find((candidate) => candidate.id === id)
}

export function findOfficeGroup(itemId: string | undefined) {
  return officeNavigation.find((group) => group.items.some((candidate) => candidate.id === itemId))
}

/** Where the non-office items lead. */
export const OFFICE_LINKS: Record<string, string> = { pos: "/pos", "kitchen-board": "/kitchen" }

export const DEFAULT_OFFICE_DESTINATION = "nomenclature"

/** Section ids of the first sandyq office (before the 12-group shell) → their new ids. */
export const LEGACY_OFFICE_SECTIONS: Record<string, string> = {
  catalog: "nomenclature",
  finance: "transactions",
  workforce: "employees",
  loyalty: "guests",
}
