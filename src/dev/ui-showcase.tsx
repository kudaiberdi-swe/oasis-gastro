import { useState } from "react"
import { Coffee, Truck, Utensils } from "lucide-react"

import { ProductCard } from "@/pos/components/product-card"
import { useTheme } from "@/shared/components/theme-provider"
import {
  Banner,
  Breadcrumb,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  KpiCard,
  Money,
  PageHeader,
  PinPad,
  StatusPill,
  useToast,
  Checkbox,
  Chip,
  Combobox,
  Field,
  Input,
  MoneyInput,
  NumericCodeInput,
  RadioGroup,
  SegmentedControl,
  Select,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@/shared/components/ui"

const RESTAURANTS = [
  { value: "almaty", label: "Sandyq Алматы" },
  { value: "shymkent", label: "Sandyq Шымкент" },
  { value: "turkistan", label: "Sandyq Түркістан", hint: "Туркестан" },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-panel border border-border bg-card p-6 shadow-panel">
      <h2 className="font-display text-title">{title}</h2>
      {children}
    </section>
  )
}

/** Every primitive in every state, day and night — the screenshot baseline for W0-FND-03/04. Dev builds only. */
export function UiShowcase() {
  const { mode, setMode, density, setDensity } = useTheme()
  const [money, setMoney] = useState<number | null>(12500)
  const [pin, setPin] = useState("")
  const [code, setCode] = useState("")
  const [restaurant, setRestaurant] = useState<string>()
  const [restaurants, setRestaurants] = useState<string[]>(["almaty"])
  const [orderType, setOrderType] = useState<"hall" | "takeaway" | "delivery">("hall")
  const [payment, setPayment] = useState("cash")
  const [category, setCategory] = useState("meat")
  const [pinValue, setPinValue] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [selectedRow, setSelectedRow] = useState<string | null>("b")
  const toast = useToast()

  return (
    <main className="h-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="font-display text-display">Примитивы</h1>
          <div className="flex gap-3">
            <SegmentedControl aria-label="Тема" value={mode} onValueChange={setMode} options={[{ value: "day", label: "День" }, { value: "night", label: "Ночь" }]} />
            <SegmentedControl
              aria-label="Плотность"
              value={density}
              onValueChange={setDensity}
              options={[{ value: "comfortable", label: "Обычная" }, { value: "compact", label: "Плотная" }]}
            />
          </div>
        </header>

        <Section title="Карточки блюд (касса)">
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <ProductCard name="Бешбармак" nameKk="Бешбармақ" price={7990} tone="meat" imageUrl="/images/cymbal-3.jpg" onClick={() => {}} />
            <ProductCard name="Сорпа" nameKk="Сорпа" price={2450} tone="meat" imageUrl="/images/hero-block-main-2.jpg" onClick={() => {}} />
            <ProductCard name="Баурсаки" nameKk="Бауырсақ" price={900} tone="bread" imageUrl="/images/no-such-photo.jpg" onClick={() => {}} />
            <ProductCard name="Шұбат 0,2 л" nameKk="Шұбат" price={850} tone="dairy" onClick={() => {}} />
          </div>
        </Section>

        <Section title="Button">
          {(["primary", "secondary", "ghost", "danger", "danger-solid", "link"] as const).map((variant) => (
            <div key={variant} className="flex flex-wrap items-center gap-3">
              <span className="w-28 text-caption text-muted-foreground">{variant}</span>
              <Button variant={variant} size="sm">Маленькая</Button>
              <Button variant={variant}>Обычная</Button>
              <Button variant={variant} size="lg">Оплатить</Button>
              <Button variant={variant} disabled>Недоступна</Button>
            </div>
          ))}
        </Section>

        <Section title="Поля ввода">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Название блюда" hint="Как в меню, на русском">{(control) => <Input {...control} placeholder="Қазақ ет" />}</Field>
            <Field label="Email" error="Введите email">{(control) => <Input {...control} type="email" defaultValue="admin@" />}</Field>
            <Field label="Получено">{(control) => <MoneyInput {...control} value={money} onValueChange={setMoney} />}</Field>
            <Field label="Только чтение">{(control) => <Input {...control} readOnly value="Z-20260924-01-001" />}</Field>
            <Field label="Код сотрудника">{(control) => <NumericCodeInput {...control} value={code} onValueChange={setCode} maxLength={12} />}</Field>
            <Field label="PIN">{(control) => <NumericCodeInput {...control} secret value={pin} onValueChange={setPin} maxLength={6} />}</Field>
            <Field label="Комментарий" className="md:col-span-2">{(control) => <Textarea {...control} placeholder="Без лука" />}</Field>
          </div>
        </Section>

        <Section title="Select и Combobox">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Ресторан">{(control) => <Select {...control} value={restaurant} onValueChange={setRestaurant} options={RESTAURANTS} />}</Field>
            <Field label="Ресторан (поиск)">
              {(control) => <Combobox {...control} value={restaurant} onValueChange={setRestaurant} options={RESTAURANTS} />}
            </Field>
            <Field label="Рестораны">
              {(control) => <Combobox {...control} multiple value={restaurants} onValueChange={setRestaurants} options={RESTAURANTS} />}
            </Field>
          </div>
        </Section>

        <Section title="Флаги и выбор">
          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-body-sm"><Checkbox defaultChecked /> Отмечен</label>
            <label className="flex items-center gap-2 text-body-sm"><Checkbox /> Не отмечен</label>
            <label className="flex items-center gap-2 text-body-sm"><Checkbox checked="indeterminate" /> Частично</label>
            <label className="flex items-center gap-2 text-body-sm"><Checkbox disabled /> Недоступен</label>
            <label className="flex items-center gap-2 text-body-sm"><Switch defaultChecked /> Активен</label>
            <label className="flex items-center gap-2 text-body-sm"><Switch /> Выключен</label>
          </div>
          <SegmentedControl
            aria-label="Тип заказа"
            size="pos"
            value={orderType}
            onValueChange={setOrderType}
            options={[
              { value: "hall", label: "В зале", icon: <Utensils /> },
              { value: "takeaway", label: "Навынос", icon: <Coffee /> },
              { value: "delivery", label: "Доставка", icon: <Truck /> },
            ]}
          />
          <RadioGroup
            value={payment}
            onValueChange={setPayment}
            className="md:grid-cols-3"
            options={[
              { value: "cash", label: "Наличные", description: "Сдача считается автоматически" },
              { value: "card", label: "Карта" },
              { value: "kaspi", label: "Kaspi QR", disabled: true, description: "Скоро" },
            ]}
          />
        </Section>

        <Section title="Chip и Tabs">
          <div className="flex flex-wrap gap-2">
            {([["meat", "Ет тағамдары", 12], ["dairy", "Сүт", 5], ["bread", "Нан", 4], ["green", "Салаттар", 9], ["tea", "Шай", 7], ["turkistan", "Туркестан", 3]] as const).map(
              ([tone, label, count]) => (
                <Chip key={tone} tone={tone} active={category === tone} count={count} onClick={() => setCategory(tone)}>
                  {label}
                </Chip>
              ),
            )}
            <Chip size="lg">Без полоски 44</Chip>
          </div>
          <Tabs defaultValue="open">
            <TabsList>
              <TabsTrigger value="open" count={4}>Открытые</TabsTrigger>
              <TabsTrigger value="held" count={1}>Отложенные</TabsTrigger>
              <TabsTrigger value="closed">Закрытые</TabsTrigger>
              <TabsTrigger value="off" disabled>Недоступно</TabsTrigger>
            </TabsList>
            <TabsContent value="open" className="text-body-sm">Стол 4, стол 7, стол 12, навынос.</TabsContent>
            <TabsContent value="held" className="text-body-sm">Стол 2.</TabsContent>
            <TabsContent value="closed" className="text-body-sm">Сегодня закрыто 38 чеков.</TabsContent>
          </Tabs>
        </Section>

        <Section title="Страница и статусы">
          <PageHeader
            breadcrumb={<Breadcrumb items={[{ label: "Офис", href: "#" }, { label: "Склад", href: "#" }, { label: "Приходные накладные" }]} />}
            title="Приходные накладные"
            description="Поступления от поставщиков"
            actions={<><Button variant="secondary">Экспорт</Button><Button>Новая накладная</Button></>}
          />
          <Banner tone="warning" title="Смена открыта более 24 часов" action={<Button size="sm" variant="secondary">Закрыть смену</Button>}>
            Закройте смену и откройте новую, чтобы отчёты сходились.
          </Banner>
          <Banner tone="danger" title="Не удалось загрузить данные">Проверьте соединение.</Banner>
          <div className="flex flex-wrap gap-2">
            {["draft", "PENDING_APPROVAL", "approved", "POSTED", "reversed", "cancelled", "published", "unknown_value"].map((status) => (
              <StatusPill key={status} domain="document" status={status} />
            ))}
            {["draft", "held", "paid", "partially_refunded", "refunded"].map((status) => (
              <StatusPill key={`o-${status}`} domain="order" status={status} />
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <KpiCard label="Выручка" value={<Money value={1279652.3} size="xl" className="text-foreground" />} hint="+12 % к прошлой неделе" hintTone="success" />
            <KpiCard label="Средний чек" value={<Money value={8450} size="xl" className="text-foreground" />} />
            <KpiCard label="Расхождение" value={<Money value={-300} signed size="xl" />} hint="Требует подтверждения" hintTone="danger" />
          </div>
        </Section>

        <Section title="Таблица">
          <DataTable
            caption="Чеки"
            columns={[
              { key: "number", header: "Чек", cell: (row) => row.number, sortValue: (row) => row.number },
              { key: "table", header: "Стол", cell: (row) => row.table },
              { key: "status", header: "Статус", cell: (row) => <StatusPill domain="order" status={row.status} /> },
              { key: "total", header: "Сумма", numeric: true, cell: (row) => <Money value={row.total} size="sm" className="text-foreground" />, sortValue: (row) => row.total },
            ]}
            rows={[
              { id: "a", number: 1042, table: "Стол 4", status: "paid", total: 18450 },
              { id: "b", number: 1043, table: "Стол 7", status: "held", total: 7990 },
              { id: "c", number: 1044, table: "Навынос", status: "refunded", total: 2850 },
            ]}
            getRowId={(row) => row.id}
            onRowClick={(row) => setSelectedRow(row.id)}
            selectedId={selectedRow}
            loadMore={{ loaded: 3, total: 128, canLoadMore: true, onLoadMore: () => toast("Загружаем ещё 50 чеков") }}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <DataTable caption="Загрузка" columns={[{ key: "a", header: "Название", cell: () => null }]} rows={undefined} getRowId={() => ""} />
            <DataTable
              caption="Пусто"
              columns={[{ key: "a", header: "Название", cell: () => null }]}
              rows={[]}
              getRowId={() => ""}
              empty={<EmptyState title="Накладных пока нет" description="Создайте первую приходную накладную" action={<Button size="sm">Создать</Button>} />}
            />
          </div>
        </Section>

        <Section title="Диалоги, тосты, PinPad">
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setDialogOpen(true)}>Открыть диалог</Button>
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>Отменить заказ</Button>
            <Button variant="secondary" onClick={() => toast("Чек отложен")}>Тост</Button>
            <Button variant="secondary" onClick={() => toast("Не удалось сохранить", "error")}>Тост-ошибка</Button>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Скидка на чек</DialogTitle>
                <DialogDescription>Больше 10 % — с подтверждением менеджера</DialogDescription>
              </DialogHeader>
              <p className="text-body-sm">Содержимое диалога.</p>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setDialogOpen(false)}>Отмена</Button>
                <Button onClick={() => setDialogOpen(false)}>Применить</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Отменить заказ?"
            description="Заказ №1043, стол 7. Действие нельзя отменить."
            confirmLabel="Отменить заказ"
            reasonLabel="Причина отмены"
            onConfirm={() => {
              setConfirmOpen(false)
              toast("Заказ отменён", "success")
            }}
          />
          <div className="flex justify-center rounded-card bg-muted p-6">
            <PinPad label="PIN-код" secret value={pinValue} onValueChange={setPinValue} maxLength={6} onSubmit={() => toast(`PIN из ${pinValue.length} цифр`)} />
          </div>
        </Section>
      </div>
    </main>
  )
}
