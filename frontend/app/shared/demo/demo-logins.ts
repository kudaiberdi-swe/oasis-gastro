// Fixed demo sign-ins for the DEV deployment (dapper-lobster-404) only. Loaded by the browser solely in a
// VITE_DEMO_MODE build (dynamic import behind the flag), and by scripts/seed-demo-logins.mjs, which creates
// these accounts on dev. Never create them on prod. No imports here: Node runs this file as-is.

export const DEMO_RESTAURANT = "sandyq-almaty" // its terminal sandyq-almaty-01 is DEMO_TERMINAL_ID in demo-mode.tsx

export const DEMO_POS_LOGINS = [
  { role: "cashier", label: "Кассир", name: "Демо Кассир", code: "70001", pin: "4817", hint: "Заказы, столы, оплата и смена" },
  { role: "manager", label: "Менеджер", name: "Демо Менеджер", code: "70002", pin: "5926", hint: "Касса плюс подтверждение отмен и скидок" },
  { role: "administrator", label: "Администратор", name: "Демо Администратор", code: "70003", pin: "3751", hint: "Полный доступ к кассе и её настройкам" },
]

export const DEMO_KITCHEN_LOGIN = { role: "kitchen", label: "Кухня", name: "Демо Кухня", code: "70004", pin: "6283", hint: "Экран заказов для поваров" }

export const DEMO_OFFICE_PASSWORD = "SandyqDemo2026"

export const DEMO_OFFICE_LOGINS = [
  { role: "administrator", label: "Администратор", name: "Демо Администратор", email: "demo-admin@demo.sandyq.kz", hint: "Весь офис: меню, склад, финансы, отчёты, доступы" },
  { role: "restaurant-manager", label: "Управляющий рестораном", name: "Демо Управляющий", email: "demo-manager@demo.sandyq.kz", hint: "Филиал Алматы: заказы, смены, склад, персонал, отчёты" },
]
