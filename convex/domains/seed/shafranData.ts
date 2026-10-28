// Demo chain «Шафран» for the DEV deployment only (scripts/seed-shafran.mjs). No imports: Node runs this file
// as-is too (scripts/seed-demo-logins.mjs reads SHAFRAN_DEMO_RESTAURANT from it).
//
// Public facts (2ГИС/Wolt, 27.10.2026): the brand, the 16 branch addresses with landmarks, per-branch opening
// hours, own delivery + Wolt + Glovo. No phone numbers or 2ГИС ids are stored. Everything else — the legal
// entity, menu, prices, recipes, suppliers, staff, guests, sales — is synthetic and marked «демо» where shown.

export const SHAFRAN_ORGANIZATION = { externalId: "shafran", name: "Шафран", legalName: "ТОО «Шафран Фуд» (демо)", currency: "KZT", timezone: "Asia/Almaty" }

/** The branch the demo sign-ins (scripts/seed-demo-logins.mjs) are bound to; its till is `${id}-01`. */
export const SHAFRAN_DEMO_RESTAURANT = "shafran-09"

type Hours = Record<number, [number, number]> // ISO weekday (1 = Monday … 7 = Sunday) → [open, close] minutes from midnight; close > 1440 = after midnight
const week = (weekdays: [number, number], sunday: [number, number]): Hours => ({ 1: weekdays, 2: weekdays, 3: weekdays, 4: weekdays, 5: weekdays, 6: weekdays, 7: sunday })
const daily = (open: number, close: number): Hours => week([open, close], [open, close])
const TYPICAL = week([11 * 60, 24 * 60], [12 * 60, 24 * 60]) // пн–сб 11:00–00:00, вс 12:00–00:00 («большинство точек»)

// `load` is a synthetic multiplier of demo sales volume, not a fact about the branch.
export const SHAFRAN_BRANCHES: { externalId: string; city: string; address: string; landmark?: string; hours: Hours; load: number }[] = [
  { externalId: "shafran-01", city: "Алматы", address: "Прокофьева, 244", hours: TYPICAL, load: 1 },
  { externalId: "shafran-02", city: "Алматы", address: "Толе би, 112", hours: TYPICAL, load: 1.15 },
  { externalId: "shafran-03", city: "Алматы", address: "Толе би, 207", hours: TYPICAL, load: 1 },
  { externalId: "shafran-04", city: "Алматы", address: "10-й микрорайон, 1а", landmark: "Ауэзовский р-н, 4 этаж", hours: daily(11 * 60, 23 * 60), load: 0.9 },
  { externalId: "shafran-05", city: "Алматы", address: "Жайдарман, 32", landmark: "мкр Достык, уг. Яссауи", hours: daily(12 * 60, 25 * 60), load: 0.9 },
  { externalId: "shafran-06", city: "Алматы", address: "Пушкина, 2/76", landmark: "БЦ SAYAHAT, 2 этаж", hours: week([10 * 60, 24 * 60], [12 * 60, 24 * 60]), load: 1.2 },
  { externalId: "shafran-07", city: "Алматы", address: "Шолохова, 8а", hours: TYPICAL, load: 1 },
  { externalId: "shafran-08", city: "Алматы", address: "мкр Коктобе-1, 36", landmark: "ВОАД — Толе би", hours: TYPICAL, load: 0.9 },
  { externalId: "shafran-09", city: "Алматы", address: "пр. Абылай хана, 62", landmark: "ТД ЦУМ", hours: TYPICAL, load: 1.3 },
  { externalId: "shafran-10", city: "Алматы", address: "Байтурсынова, 152", landmark: "Бостандыкский р-н", hours: TYPICAL, load: 1 },
  { externalId: "shafran-11", city: "Алматы", address: "Кажымукана, 49", landmark: "ЖК Royal", hours: TYPICAL, load: 0.95 },
  { externalId: "shafran-12", city: "Алматы", address: "20-й микрорайон, 34", landmark: "ЖК Titul Town", hours: TYPICAL, load: 0.9 },
  { externalId: "shafran-13", city: "Алматы", address: "Жунисова, 8/11", landmark: "ЖК Alma City", hours: TYPICAL, load: 0.9 },
  { externalId: "shafran-14", city: "Алматы", address: "Майлина, 2", hours: TYPICAL, load: 0.8 },
  { externalId: "shafran-15", city: "с. Отеген Батыр", address: "Жансугурова, 80", landmark: "Илийский р-н, Алматинская обл.", hours: TYPICAL, load: 0.75 },
  { externalId: "shafran-16", city: "Конаев", address: "Индустриальная, 108в", landmark: "Алматинская обл.", hours: TYPICAL, load: 0.75 },
]

export const branchName = (branch: { address: string }) => `Шафран · ${branch.address}`
export const branchAddress = (branch: { city: string; address: string; landmark?: string }) => `${branch.city}, ${branch.address}${branch.landmark ? ` (${branch.landmark})` : ""}`

export const SHAFRAN_CATEGORIES = [
  { externalId: "shafran-cat-soups", label: "Сорпалар / Супы", shortLabel: "Супы" },
  { externalId: "shafran-cat-plov", label: "Палау / Плов", shortLabel: "Плов" },
  { externalId: "shafran-cat-hot", label: "Ыстық тағамдар / Горячие блюда", shortLabel: "Горячие блюда" },
  { externalId: "shafran-cat-dough", label: "Қамыр тағамдары / Манты и самса", shortLabel: "Манты и самса" },
  { externalId: "shafran-cat-grill", label: "Кәуаптар / Шашлыки", shortLabel: "Шашлыки" },
  { externalId: "shafran-cat-salads", label: "Салаттар / Салаты", shortLabel: "Салаты" },
  { externalId: "shafran-cat-european", label: "Еуропалық тағамдар / Европейская кухня", shortLabel: "Европейская кухня" },
  { externalId: "shafran-cat-sides", label: "Гарнирлер / Гарниры", shortLabel: "Гарниры" },
  { externalId: "shafran-cat-desserts", label: "Тәттілер / Десерты", shortLabel: "Десерты" },
  { externalId: "shafran-cat-drinks", label: "Сусындар / Напитки", shortLabel: "Напитки" },
]

export type SupplierKey = "meat" | "veg" | "dry" | "dairy" | "goods"
export const SHAFRAN_SUPPLIERS: { key: SupplierKey; name: string; paymentDelayDays: number }[] = [
  { key: "meat", name: "ТОО «Мясной двор» (демо)", paymentDelayDays: 7 },
  { key: "veg", name: "ТОО «Зелёный базар» (демо)", paymentDelayDays: 3 },
  { key: "dry", name: "ТОО «Бакалея Опт» (демо)", paymentDelayDays: 14 },
  { key: "dairy", name: "ТОО «Молочная ферма» (демо)", paymentDelayDays: 7 },
  { key: "goods", name: "ТОО «Напитки и десерты» (демо)", paymentDelayDays: 14 },
]

// Ingredients: unit, synthetic purchase price per unit (₸), weight of one unit in kg (л and шт), supplier.
export const SHAFRAN_INGREDIENTS: Record<string, { name: string; unit: "кг" | "л" | "шт"; price: number; kg?: number; supplier: SupplierKey }> = {
  beef: { name: "Говядина", unit: "кг", price: 4200, supplier: "meat" },
  lamb: { name: "Баранина", unit: "кг", price: 4800, supplier: "meat" },
  horse: { name: "Конина", unit: "кг", price: 4600, supplier: "meat" },
  chicken: { name: "Филе куриное", unit: "кг", price: 2300, supplier: "meat" },
  wings: { name: "Крылья куриные", unit: "кг", price: 1700, supplier: "meat" },
  mince: { name: "Фарш говяжий", unit: "кг", price: 3700, supplier: "meat" },
  fish: { name: "Филе рыбы", unit: "кг", price: 3200, supplier: "meat" },
  sausage: { name: "Колбаса говяжья халал", unit: "кг", price: 3400, supplier: "meat" },
  potato: { name: "Картофель", unit: "кг", price: 190, supplier: "veg" },
  carrot: { name: "Морковь", unit: "кг", price: 210, supplier: "veg" },
  onion: { name: "Лук репчатый", unit: "кг", price: 170, supplier: "veg" },
  cabbage: { name: "Капуста", unit: "кг", price: 160, supplier: "veg" },
  beet: { name: "Свёкла", unit: "кг", price: 180, supplier: "veg" },
  tomato: { name: "Помидоры", unit: "кг", price: 950, supplier: "veg" },
  cucumber: { name: "Огурцы", unit: "кг", price: 750, supplier: "veg" },
  pepper: { name: "Перец болгарский", unit: "кг", price: 1150, supplier: "veg" },
  pumpkin: { name: "Тыква", unit: "кг", price: 320, supplier: "veg" },
  eggplant: { name: "Баклажаны", unit: "кг", price: 700, supplier: "veg" },
  greens: { name: "Зелень", unit: "кг", price: 2200, supplier: "veg" },
  garlic: { name: "Чеснок", unit: "кг", price: 1900, supplier: "veg" },
  lemon: { name: "Лимоны", unit: "кг", price: 1300, supplier: "veg" },
  lettuce: { name: "Салат айсберг", unit: "кг", price: 1600, supplier: "veg" },
  mushrooms: { name: "Шампиньоны", unit: "кг", price: 1800, supplier: "veg" },
  rice: { name: "Рис девзира", unit: "кг", price: 680, supplier: "dry" },
  flour: { name: "Мука пшеничная", unit: "кг", price: 290, supplier: "dry" },
  pasta: { name: "Макароны", unit: "кг", price: 850, supplier: "dry" },
  buckwheat: { name: "Гречка", unit: "кг", price: 560, supplier: "dry" },
  chickpeas: { name: "Нут", unit: "кг", price: 900, supplier: "dry" },
  raisins: { name: "Изюм", unit: "кг", price: 2400, supplier: "dry" },
  sugar: { name: "Сахар", unit: "кг", price: 460, supplier: "dry" },
  salt: { name: "Соль", unit: "кг", price: 110, supplier: "dry" },
  spices: { name: "Специи", unit: "кг", price: 3200, supplier: "dry" },
  oil: { name: "Масло подсолнечное", unit: "л", price: 950, kg: 0.92, supplier: "dry" },
  tomatoPaste: { name: "Томатная паста", unit: "кг", price: 1200, supplier: "dry" },
  mayo: { name: "Майонез", unit: "кг", price: 1450, supplier: "dry" },
  crackers: { name: "Сухари панировочные", unit: "кг", price: 2000, supplier: "dry" },
  peas: { name: "Горошек зелёный", unit: "кг", price: 1300, supplier: "dry" },
  pickles: { name: "Огурцы солёные", unit: "кг", price: 1100, supplier: "dry" },
  olives: { name: "Маслины", unit: "кг", price: 3500, supplier: "dry" },
  teaBlack: { name: "Чай чёрный", unit: "кг", price: 4200, supplier: "dry" },
  teaGreen: { name: "Чай зелёный", unit: "кг", price: 4600, supplier: "dry" },
  coffee: { name: "Кофе в зёрнах", unit: "кг", price: 9500, supplier: "dry" },
  driedFruit: { name: "Сухофрукты", unit: "кг", price: 2300, supplier: "dry" },
  berries: { name: "Ягоды замороженные", unit: "кг", price: 2600, supplier: "dry" },
  milk: { name: "Молоко 3,2%", unit: "л", price: 460, kg: 1.03, supplier: "dairy" },
  cream: { name: "Сливки 20%", unit: "л", price: 1900, kg: 1, supplier: "dairy" },
  sourCream: { name: "Сметана", unit: "кг", price: 1650, supplier: "dairy" },
  butter: { name: "Масло сливочное", unit: "кг", price: 4600, supplier: "dairy" },
  cheese: { name: "Сыр твёрдый", unit: "кг", price: 4300, supplier: "dairy" },
  feta: { name: "Брынза", unit: "кг", price: 3300, supplier: "dairy" },
  eggs: { name: "Яйца куриные", unit: "шт", price: 75, kg: 0.055, supplier: "dairy" },
}

type Dish = { id: string; name: string; nameKk: string; category: string; price: number; popular?: boolean; recipe?: Record<string, number>; good?: { cost: number; kg: number } }

// Synthetic halal menu: no pork anywhere. A dish has a recipe per portion (ingredient → quantity in its unit);
// a good («good») is bought ready and written off as a finished product.
export const SHAFRAN_DISHES: Dish[] = [
  { id: "shorpo", name: "Шорпо из баранины", nameKk: "Қой етінен сорпа", category: "shafran-cat-soups", price: 1790, recipe: { lamb: 0.12, potato: 0.1, carrot: 0.03, onion: 0.03, greens: 0.005, spices: 0.002 } },
  { id: "lagman-soup", name: "Суп-лагман", nameKk: "Лағман сорпасы", category: "shafran-cat-soups", price: 1590, recipe: { beef: 0.07, flour: 0.07, pepper: 0.03, tomato: 0.03, onion: 0.02, oil: 0.01, spices: 0.002 } },
  { id: "borsch", name: "Борщ с говядиной", nameKk: "Сиыр етімен борщ", category: "shafran-cat-soups", price: 1490, recipe: { beef: 0.07, beet: 0.06, cabbage: 0.06, potato: 0.06, carrot: 0.02, onion: 0.02, tomatoPaste: 0.01, sourCream: 0.02 } },
  { id: "noodle-soup", name: "Куриный суп с лапшой", nameKk: "Тауық кеспесі", category: "shafran-cat-soups", price: 1290, recipe: { chicken: 0.06, flour: 0.04, potato: 0.05, carrot: 0.02, onion: 0.02, greens: 0.003 } },
  { id: "solyanka", name: "Солянка мясная", nameKk: "Етті солянка", category: "shafran-cat-soups", price: 1690, recipe: { beef: 0.05, sausage: 0.04, pickles: 0.03, olives: 0.01, tomatoPaste: 0.015, onion: 0.02, lemon: 0.01, sourCream: 0.02 } },
  { id: "mastava", name: "Мастава", nameKk: "Мастава", category: "shafran-cat-soups", price: 1390, recipe: { beef: 0.06, rice: 0.04, potato: 0.05, carrot: 0.03, tomato: 0.03, onion: 0.02, sourCream: 0.02 } },
  { id: "plov-uzbek", name: "Плов по-узбекски", nameKk: "Өзбекше палау", category: "shafran-cat-plov", price: 1990, popular: true, recipe: { rice: 0.13, beef: 0.1, carrot: 0.09, onion: 0.04, oil: 0.03, garlic: 0.008, spices: 0.003, chickpeas: 0.01 } },
  { id: "plov-festive", name: "Плов праздничный с изюмом и нутом", nameKk: "Мерекелік палау", category: "shafran-cat-plov", price: 2490, recipe: { rice: 0.13, lamb: 0.12, carrot: 0.08, onion: 0.04, oil: 0.03, chickpeas: 0.02, raisins: 0.015, spices: 0.003 } },
  { id: "plov-horse", name: "Плов с кониной", nameKk: "Жылқы етімен палау", category: "shafran-cat-plov", price: 2590, recipe: { rice: 0.13, horse: 0.11, carrot: 0.08, onion: 0.04, oil: 0.03, garlic: 0.008, spices: 0.003 } },
  { id: "lagman-guiru", name: "Гуйру-лагман", nameKk: "Гуйру лағман", category: "shafran-cat-hot", price: 2190, popular: true, recipe: { flour: 0.15, beef: 0.1, pepper: 0.05, tomato: 0.04, onion: 0.03, garlic: 0.005, oil: 0.02, spices: 0.002 } },
  { id: "lagman-fried", name: "Лагман жареный", nameKk: "Қуырылған лағман", category: "shafran-cat-hot", price: 2290, recipe: { flour: 0.15, beef: 0.1, pepper: 0.05, eggs: 1, onion: 0.03, oil: 0.03, spices: 0.002 } },
  { id: "beshbarmak", name: "Бешбармак", nameKk: "Бешбармақ", category: "shafran-cat-hot", price: 2990, popular: true, recipe: { horse: 0.1, beef: 0.08, flour: 0.1, onion: 0.05, spices: 0.002 } },
  { id: "kuyrdak", name: "Куырдак", nameKk: "Қуырдақ", category: "shafran-cat-hot", price: 2590, recipe: { lamb: 0.15, potato: 0.15, onion: 0.05, oil: 0.02, spices: 0.002 } },
  { id: "kazan-kebab", name: "Казан-кебаб", nameKk: "Қазан-кебаб", category: "shafran-cat-hot", price: 2790, recipe: { lamb: 0.18, potato: 0.18, onion: 0.05, oil: 0.03, spices: 0.003, greens: 0.005 } },
  { id: "goulash", name: "Гуляш из говядины", nameKk: "Сиыр етінен гуляш", category: "shafran-cat-hot", price: 2190, recipe: { beef: 0.15, onion: 0.04, tomatoPaste: 0.02, flour: 0.01, oil: 0.015, spices: 0.002 } },
  { id: "manty-beef", name: "Манты с говядиной, 5 шт", nameKk: "Сиыр етімен манты, 5 дана", category: "shafran-cat-dough", price: 1990, popular: true, recipe: { flour: 0.12, beef: 0.15, onion: 0.08, oil: 0.01, spices: 0.002, sourCream: 0.03 } },
  { id: "manty-pumpkin", name: "Манты с тыквой, 5 шт", nameKk: "Асқабақ қосылған манты, 5 дана", category: "shafran-cat-dough", price: 1590, recipe: { flour: 0.12, pumpkin: 0.15, onion: 0.05, butter: 0.015, sourCream: 0.03 } },
  { id: "samsa-beef", name: "Самса с говядиной", nameKk: "Сиыр етімен самса", category: "shafran-cat-dough", price: 690, popular: true, recipe: { flour: 0.08, beef: 0.06, onion: 0.03, butter: 0.015, eggs: 0.2 } },
  { id: "samsa-chicken", name: "Самса с курицей", nameKk: "Тауық етімен самса", category: "shafran-cat-dough", price: 590, recipe: { flour: 0.08, chicken: 0.06, onion: 0.03, butter: 0.015 } },
  { id: "chebureki", name: "Чебурек с говядиной", nameKk: "Сиыр етімен шебурек", category: "shafran-cat-dough", price: 590, recipe: { flour: 0.08, mince: 0.06, onion: 0.02, oil: 0.04 } },
  { id: "baursak", name: "Баурсаки", nameKk: "Бауырсақ", category: "shafran-cat-dough", price: 490, recipe: { flour: 0.1, milk: 0.04, sugar: 0.01, oil: 0.04 } },
  { id: "lepeshka", name: "Лепёшка тандырная", nameKk: "Тандыр нан", category: "shafran-cat-dough", price: 290, good: { cost: 110, kg: 0.25 } },
  { id: "shashlik-lamb", name: "Шашлык из баранины", nameKk: "Қой етінен кәуап", category: "shafran-cat-grill", price: 2790, popular: true, recipe: { lamb: 0.2, onion: 0.04, spices: 0.003, oil: 0.005 } },
  { id: "shashlik-beef", name: "Шашлык из говядины", nameKk: "Сиыр етінен кәуап", category: "shafran-cat-grill", price: 2590, recipe: { beef: 0.2, onion: 0.04, spices: 0.003, oil: 0.005 } },
  { id: "shashlik-chicken", name: "Шашлык из курицы", nameKk: "Тауық етінен кәуап", category: "shafran-cat-grill", price: 1990, recipe: { chicken: 0.2, onion: 0.03, spices: 0.003, sourCream: 0.02 } },
  { id: "lyulya", name: "Люля-кебаб из говядины", nameKk: "Сиыр етінен люля-кебаб", category: "shafran-cat-grill", price: 2290, recipe: { mince: 0.2, onion: 0.05, spices: 0.003 } },
  { id: "wings", name: "Крылья на мангале", nameKk: "Мангалдағы тауық қанаттары", category: "shafran-cat-grill", price: 1890, recipe: { wings: 0.3, spices: 0.004, oil: 0.01, garlic: 0.005 } },
  { id: "achichuk", name: "Салат «Ачичук»", nameKk: "«Ачичук» салаты", category: "shafran-cat-salads", price: 890, recipe: { tomato: 0.15, onion: 0.04, spices: 0.001, greens: 0.005 } },
  { id: "caesar", name: "Салат «Цезарь» с курицей", nameKk: "Тауық еті қосылған «Цезарь» салаты", category: "shafran-cat-salads", price: 2190, recipe: { chicken: 0.08, lettuce: 0.08, cheese: 0.02, crackers: 0.02, mayo: 0.03, tomato: 0.03 } },
  { id: "greek", name: "Салат «Греческий»", nameKk: "«Грек» салаты", category: "shafran-cat-salads", price: 1890, recipe: { tomato: 0.07, cucumber: 0.07, pepper: 0.04, feta: 0.04, olives: 0.02, oil: 0.015, onion: 0.01 } },
  { id: "olivier", name: "Салат «Оливье» с говядиной", nameKk: "Сиыр еті қосылған «Оливье» салаты", category: "shafran-cat-salads", price: 1290, recipe: { potato: 0.06, beef: 0.04, eggs: 1, pickles: 0.03, peas: 0.03, carrot: 0.02, mayo: 0.04 } },
  { id: "fresh-salad", name: "Салат из свежих овощей", nameKk: "Балғын көкөніс салаты", category: "shafran-cat-salads", price: 990, recipe: { tomato: 0.08, cucumber: 0.08, pepper: 0.03, greens: 0.005, oil: 0.01 } },
  { id: "vinegret", name: "Винегрет", nameKk: "Винегрет", category: "shafran-cat-salads", price: 790, recipe: { beet: 0.07, potato: 0.05, carrot: 0.03, pickles: 0.03, peas: 0.02, oil: 0.01 } },
  { id: "chicken-grill", name: "Куриная грудка на гриле", nameKk: "Грильдегі тауық төсі", category: "shafran-cat-european", price: 2490, recipe: { chicken: 0.2, oil: 0.01, spices: 0.002, lemon: 0.01 } },
  { id: "kiev", name: "Котлета по-киевски", nameKk: "Киевше котлета", category: "shafran-cat-european", price: 2290, recipe: { chicken: 0.15, butter: 0.03, eggs: 1, flour: 0.02, crackers: 0.03, oil: 0.04 } },
  { id: "pasta-chicken", name: "Паста с курицей в сливочном соусе", nameKk: "Кілегейлі тұздықтағы тауық еті қосылған паста", category: "shafran-cat-european", price: 2590, recipe: { pasta: 0.1, chicken: 0.1, cream: 0.08, cheese: 0.02, mushrooms: 0.03, garlic: 0.003 } },
  { id: "stroganoff", name: "Бефстроганов с пюре", nameKk: "Езбе қосылған бефстроганов", category: "shafran-cat-european", price: 2890, recipe: { beef: 0.15, sourCream: 0.05, onion: 0.03, mushrooms: 0.04, potato: 0.15, butter: 0.01, milk: 0.03 } },
  { id: "cutlet", name: "Котлета говяжья домашняя", nameKk: "Сиыр етінен үй котлеті", category: "shafran-cat-european", price: 1390, recipe: { mince: 0.12, onion: 0.02, eggs: 0.3, crackers: 0.015, oil: 0.02 } },
  { id: "fish", name: "Рыба в кляре", nameKk: "Кляр ішіндегі балық", category: "shafran-cat-european", price: 2390, recipe: { fish: 0.17, flour: 0.03, eggs: 1, oil: 0.05, lemon: 0.01 } },
  { id: "julienne", name: "Жульен с курицей и грибами", nameKk: "Тауық еті мен саңырауқұлақ қосылған жульен", category: "shafran-cat-european", price: 1690, recipe: { chicken: 0.07, mushrooms: 0.06, cream: 0.05, cheese: 0.03, onion: 0.02 } },
  { id: "mash", name: "Картофельное пюре", nameKk: "Картоп езбесі", category: "shafran-cat-sides", price: 690, recipe: { potato: 0.2, milk: 0.04, butter: 0.015 } },
  { id: "rice", name: "Рис отварной", nameKk: "Пісірілген күріш", category: "shafran-cat-sides", price: 590, recipe: { rice: 0.08, butter: 0.01 } },
  { id: "fries", name: "Картофель фри", nameKk: "Фри картобы", category: "shafran-cat-sides", price: 890, recipe: { potato: 0.2, oil: 0.03, salt: 0.002 } },
  { id: "buckwheat", name: "Гречка с маслом", nameKk: "Майлы қарақұмық", category: "shafran-cat-sides", price: 590, recipe: { buckwheat: 0.08, butter: 0.01 } },
  { id: "grill-veg", name: "Овощи на гриле", nameKk: "Грильдегі көкөністер", category: "shafran-cat-sides", price: 1290, recipe: { eggplant: 0.08, pepper: 0.06, tomato: 0.06, onion: 0.03, oil: 0.02 } },
  { id: "chakchak", name: "Чак-чак", nameKk: "Шәк-шәк", category: "shafran-cat-desserts", price: 990, good: { cost: 380, kg: 0.15 } },
  { id: "medovik", name: "Медовик", nameKk: "Бал торты", category: "shafran-cat-desserts", price: 1290, good: { cost: 450, kg: 0.15 } },
  { id: "napoleon", name: "Наполеон", nameKk: "«Наполеон» торты", category: "shafran-cat-desserts", price: 1290, good: { cost: 450, kg: 0.15 } },
  { id: "cheesecake", name: "Чизкейк", nameKk: "Чизкейк", category: "shafran-cat-desserts", price: 1590, good: { cost: 600, kg: 0.13 } },
  { id: "pakhlava", name: "Пахлава", nameKk: "Пахлава", category: "shafran-cat-desserts", price: 890, good: { cost: 330, kg: 0.1 } },
  { id: "blini", name: "Блинчики со сметаной", nameKk: "Қаймақ қосылған құймақ", category: "shafran-cat-desserts", price: 990, recipe: { flour: 0.06, milk: 0.12, eggs: 1, sugar: 0.01, oil: 0.01, sourCream: 0.04 } },
  { id: "tea-black", name: "Чай чёрный, чайник", nameKk: "Қара шай, шәйнек", category: "shafran-cat-drinks", price: 690, popular: true, recipe: { teaBlack: 0.008, sugar: 0.02, lemon: 0.01 } },
  { id: "tea-green", name: "Чай зелёный, чайник", nameKk: "Көк шай, шәйнек", category: "shafran-cat-drinks", price: 690, recipe: { teaGreen: 0.008, sugar: 0.02 } },
  { id: "tea-milk", name: "Чай с молоком", nameKk: "Сүт қосылған шай", category: "shafran-cat-drinks", price: 790, recipe: { teaBlack: 0.008, milk: 0.1, sugar: 0.02 } },
  { id: "compote", name: "Компот из сухофруктов, 0,5 л", nameKk: "Кептірілген жеміс компоты, 0,5 л", category: "shafran-cat-drinks", price: 590, recipe: { driedFruit: 0.04, sugar: 0.04 } },
  { id: "mors", name: "Морс ягодный, 0,5 л", nameKk: "Жидек морсы, 0,5 л", category: "shafran-cat-drinks", price: 790, recipe: { berries: 0.08, sugar: 0.04 } },
  { id: "lemonade", name: "Лимонад домашний, 1 л", nameKk: "Үй лимонады, 1 л", category: "shafran-cat-drinks", price: 1890, recipe: { lemon: 0.12, sugar: 0.08, greens: 0.005 } },
  { id: "americano", name: "Американо", nameKk: "Американо", category: "shafran-cat-drinks", price: 890, recipe: { coffee: 0.009 } },
  { id: "cappuccino", name: "Капучино", nameKk: "Капучино", category: "shafran-cat-drinks", price: 1190, recipe: { coffee: 0.009, milk: 0.15 } },
  { id: "ayran", name: "Айран, 0,5 л", nameKk: "Айран, 0,5 л", category: "shafran-cat-drinks", price: 590, good: { cost: 260, kg: 0.5 } },
  { id: "water", name: "Вода без газа, 0,5 л", nameKk: "Газсыз су, 0,5 л", category: "shafran-cat-drinks", price: 390, good: { cost: 140, kg: 0.5 } },
  { id: "cola", name: "Кола, 0,5 л", nameKk: "Кола, 0,5 л", category: "shafran-cat-drinks", price: 690, good: { cost: 310, kg: 0.5 } },
]

export const dishExternalId = (id: string) => `shafran-${id}`

export const SHAFRAN_DELIVERY_SOURCES = [
  { externalId: "shafran-delivery-own", name: "Собственная доставка", kind: "phone" as const },
  { externalId: "shafran-delivery-wolt", name: "Wolt", kind: "aggregator" as const },
  { externalId: "shafran-delivery-glovo", name: "Glovo", kind: "aggregator" as const },
]

// Synthetic people: a first name and an initial only; phones of guests are +7 000 … (no such operator code).
export const FIRST_NAMES = ["Айгерим", "Данияр", "Ерлан", "Асель", "Нурлан", "Жанар", "Арман", "Динара", "Бауыржан", "Гульнара", "Тимур", "Алия", "Руслан", "Мадина", "Серик", "Камила", "Азамат", "Сауле", "Ольга", "Дмитрий", "Наталья", "Игорь", "Елена", "Максат", "Айдана", "Ержан", "Индира", "Санжар", "Томирис", "Виктория"]
export const INITIALS = ["А.", "Б.", "Ж.", "И.", "К.", "М.", "Н.", "О.", "С.", "Т.", "У.", "Ш."]
export const GUEST_COUNT = 200
