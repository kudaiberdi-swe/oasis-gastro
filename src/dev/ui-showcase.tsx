import { useState } from "react"
import { Coffee, Truck, Utensils } from "lucide-react"

import { useTheme } from "@/shared/components/theme-provider"
import {
  Button,
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
      </div>
    </main>
  )
}
