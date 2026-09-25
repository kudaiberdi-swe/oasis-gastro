// Russian labels for audit action codes (W1-ADM-04, closes L-9 for «Журнал событий»): the raw code
// never reaches the screen as the label — it stays in the pill's `title`. tests/pos/admin-screens.test.tsx
// checks that every action string written by convex/** has a label here.

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  // Касса: сессия, заказы, смены, кухня.
  "session.login": "Вход в кассу",
  "session.lock": "Блокировка кассы",
  "session.logout": "Выход из кассы",
  "order.checkout": "Оплата заказа",
  "order.hold": "Заказ отложен",
  "order.resume": "Заказ возобновлён",
  "order.cancel": "Отмена заказа",
  "order.refund": "Возврат заказа",
  "order.split": "Разделение чека",
  "order.move-table": "Перенос на другой стол",
  "order.transfer": "Перенос заказа",
  "order.manager-override": "Подтверждение менеджера",
  "shift.open": "Открытие смены",
  "shift.close": "Закрытие смены",
  "shift.x-report": "X-отчёт",
  "shift.cash-in": "Внесение наличных",
  "shift.cash-out": "Изъятие наличных",
  "kitchen.bump-back": "Кухня: возврат статуса",
  "order.send-to-kitchen": "Отправка на кухню",
  "order.void-line": "Удаление позиции",
  "kitchen.status": "Статус на кухне",

  // Офис.
  "catalog.category.create": "Создание категории",
  "catalog.category.update": "Изменение категории",
  "catalog.product.create": "Создание блюда",
  "catalog.product.update": "Изменение блюда",
  "catalog.product.image": "Изменение изображения блюда",
  "catalog.group.save": "Сохранение группы товаров",
  "size-scale.create": "Создание шкалы размеров",
  "size-scale.update": "Изменение шкалы размеров",
  "price-order.create": "Создание приказа о ценах",
  "price-order.update": "Изменение приказа о ценах",
  "price-order.publish": "Публикация приказа о ценах",
  "price-order.cancel": "Отмена приказа о ценах",
  "modifier-group.save": "Сохранение группы модификаторов",
  "modifier.save": "Сохранение модификатора",
  "modifier.assign": "Назначение модификаторов блюду",
  "modifier.unassign": "Снятие модификаторов с блюда",
  "modifier.rules": "Правила модификаторов блюда",
  "catalog.stop-list": "Стоп-лист",
  "recipe.save": "Сохранение техкарты",
  "unit.create": "Создание единицы измерения",
  "unit.update": "Изменение единицы измерения",
  "warehouse.create": "Создание склада",
  "warehouse.update": "Изменение склада",
  "supplier.create": "Создание поставщика",
  "supplier.update": "Изменение поставщика",
  "inventory-item.create": "Создание складской позиции",
  "inventory-item.update": "Изменение складской позиции",
  "stock-document.create": "Создание складского документа",
  "stock-document.update": "Изменение складского документа",
  "stock-document.post": "Проведение складского документа",
  "stock-document.reverse": "Сторно складского документа",
  "receipt.create": "Создание приходной накладной",
  "receipt.update": "Изменение приходной накладной",
  "receipt.post": "Проведение приходной накладной",
  "receipt.reverse": "Сторно приходной накладной",
  "retail.setting.save": "Сохранение справочника розницы",
  "retail.setting.publish": "Публикация справочника розницы",
  "recipe.activate": "Активация версии техкарты",
  "pos.favorite.add": "Добавлено в избранное кассира",
  "pos.favorite.remove": "Убрано из избранного кассира",
  "catalog.price.set": "Изменение цены",
  "stock.item.create": "Создание складского товара",
  "stock.receipt": "Приход на склад",
  "stock.writeoff": "Списание со склада",
  "stock.adjustment": "Корректировка остатка",
  "finance.expense.record": "Запись расхода",
  "loyalty.adjust": "Корректировка баллов гостя",
  "finance.shift.accept": "Принятие смены",
  "finance.shift.reverse": "Сторно приёмки смены",
  "iiko.restaurant.link": "Сопоставление филиала с iiko",
  "loyalty.guest.create": "Новый гость",
  "loyalty.guest.update": "Изменение карточки гостя",
  "loyalty.guest.status": "Статус гостя",
  "loyalty.consent": "Согласие гостя",
  "loyalty.program.save": "Сохранение программы лояльности",
  "loyalty.program.publish": "Публикация программы лояльности",
  "loyalty.program.deactivate": "Отключение программы лояльности",
  "loyalty.category.save": "Категория гостей",
  "organization.save": "Сохранение организации",
  "organization.status": "Статус организации",
  "restaurant.save": "Сохранение ресторана",
  "restaurant.status": "Статус ресторана",
  "department.save": "Сохранение подразделения",
  "department.status": "Статус подразделения",
  "payments.allocate": "Распределение платежа",
  "position.save": "Сохранение должности",
  "position.status": "Статус должности",
  "shift-type.save": "Сохранение типа смены",
  "shift-type.status": "Статус типа смены",
  "schedule.save": "Смена в расписании",
  "schedule.remove": "Снятие смены",
  "schedule.copy": "Копирование недели",
  "schedule.publish": "Публикация расписания",
  "payroll.rules.save": "Правила расчёта зарплаты",
  "payroll.rules.activate": "Активация правил РК",
  "payroll.adjustment": "Корректировка зарплаты",
  "payroll.calculate": "Расчёт ведомости",
  "payroll.post": "Проведение ведомости",
  "payroll.reverse": "Сторно ведомости",
  "production.preparation": "Настройка заготовки",
  "price-list.save": "Сохранение прайс-листа",
  "price-list.publish": "Публикация прайс-листа",
  "delivery-order.save": "Сохранение заказа доставки",
  "delivery-order.status": "Смена статуса доставки",
  "delivery-order.assign": "Назначение курьера",
  "delivery-zone.save": "Сохранение зоны доставки",
  "courier.save": "Сохранение курьера",
  "courier.status": "Смена курьера",
  "delivery-source.save": "Сохранение источника заказов",
  "reservation.table": "Стол на схеме зала",
  "report-schedule.save": "Сохранение рассылки отчёта",
  "office-user.password-reset": "Запрос восстановления пароля",
  "report-schedule.active": "Включение / отключение рассылки",
  "report-schedule.delete": "Удаление рассылки",
  "reservation.save": "Сохранение брони",
  "reservation.submit": "Бронь на согласование",
  "reservation.approve": "Согласование брони",
  "reservation.complete": "Бронь завершена",
  "reservation.cancel": "Отмена брони",
  "purchase-orders.receipt": "Приходная накладная по заказу",
  "payroll.payout": "Выплата зарплаты",
  "workforce.create": "Создание сотрудника кассы",
  "workforce.profile.update": "Изменение карточки сотрудника",
  "attendance.clock-in": "Отметка прихода",
  "attendance.clock-out": "Отметка ухода",
  "attendance.create": "Новая запись явки",
  "attendance.correct": "Корректировка явки",
  "attendance.submit": "Явка на согласование",
  "attendance.approve": "Согласование явки",
  "attendance.cancel": "Отмена записи явки",
  "workforce.provision": "Выдача доступа к кассе",
  "workforce.pin.reset": "Сброс PIN сотрудника",
  "workforce.assignment.update": "Изменение назначения сотрудника",
  "workforce.activate": "Включение сотрудника",
  "workforce.deactivate": "Отключение сотрудника",
  "office-role.create": "Создание роли",
  "office-role.update": "Изменение роли",
  "office-user.create": "Создание пользователя офиса",
  "office-user.update": "Изменение пользователя офиса",
  "office-user.password-set": "Установка пароля офиса",
  "terminal.create": "Создание терминала",
  "terminal.update": "Изменение терминала",
  "period-lock.create": "Закрытие периода",
  "period-lock.reopen": "Повторное открытие периода",
  "integration-job.retry": "Повтор задания обмена",
  "integration-job.cancel": "Отмена задания обмена",
}

/**
 * Suffixes of the dynamic `${moduleId}.<action>` codes written by the domain-record engine
 * (convex/lib/domainRecords.ts): record create/update and the lifecycle transitions.
 */
export const AUDIT_ACTION_SUFFIX_LABELS: Record<string, string> = {
  create: "Создание записи",
  update: "Изменение записи",
  post: "Проведение",
  reverse: "Сторно",
  cancel: "Отмена",
  submit: "Отправка на согласование",
  approve: "Согласование",
  publish: "Публикация",
  activate: "Активация",
  deactivate: "Деактивация",
  expire: "Завершение действия",
  save: "Сохранение черновика",
}

export type AuditActionLabel = {
  label: string
  known: boolean
  /** For a dynamic `${moduleId}.<action>` code: the office section it belongs to. */
  moduleId?: string
}

export function describeAuditAction(action: string): AuditActionLabel {
  const exact = AUDIT_ACTION_LABELS[action]
  if (exact) return { label: exact, known: true }
  const dot = action.lastIndexOf(".")
  const suffix = dot > 0 ? AUDIT_ACTION_SUFFIX_LABELS[action.slice(dot + 1)] : undefined
  if (suffix) return { label: suffix, known: true, moduleId: action.slice(0, dot) }
  return { label: action, known: false }
}

export type AuditSource = "pos" | "office" | "system"

/** Where an event came from: the CLI maintenance account, a cashier on a terminal, or the office. */
export function auditSource(event: { actorKey: string; action: string }): AuditSource {
  if (event.actorKey === "system-cli") return "system"
  if (/^(order|shift|session|kitchen)\./.test(event.action)) return "pos"
  return "office"
}

export const SYSTEM_ACTOR_KEY = "system-cli"
