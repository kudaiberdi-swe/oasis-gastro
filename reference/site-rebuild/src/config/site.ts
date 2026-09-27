/**
 * All editable content for the website lives here: brand, contacts, navigation,
 * page copy, image choices. Components only render what this file describes.
 *
 * Copy is placeholder text written in the tone of the reference site — replace it
 * with approved texts before launch. Values marked `PLACEHOLDER` are invented
 * (addresses, phones, names) and must be confirmed with the business.
 *
 * Images are referenced by name: the file name in the repo's /public folder without
 * extension (see docs/09-WEBSITE-ASSETS.md). `alt: ""` marks an image as decorative.
 */

export type ImageRef = { name: string; alt: string }
export type NavLink = { label: string; href: string }
export type NavItem = NavLink | { label: string; children: readonly NavLink[] }

export const site = {
  brand: {
    group: "Sandyq Group",
    restaurant: "Sandyq",
    coffee: "TARY",
    since: 2020,
    logo: { name: "sandyq-group-logo", alt: "Sandyq Group" },
    footerLogo: { name: "sandyq-group-header-logo", alt: "Sandyq Group, с 2020 года" },
  },

  seo: {
    home: {
      title: "Sandyq Group — сеть этно-ресторанов",
      description:
        "Sandyq Group — сеть этно-ресторанов и этно-кофеен казахской кухни: восстановленные рецепты, авторская посуда и степное гостеприимство.",
    },
    restaurant: {
      title: "Sandyq — ресторан казахской кухни",
      description:
        "Ресторан Sandyq: блюда по рецептам из этнографических экспедиций, кымызотека, банкеты и семейные торжества.",
    },
  },

  languages: [
    { code: "RU", active: true },
    { code: "KZ", active: false },
    { code: "EN", active: false },
  ],

  nav: [
    {
      label: "Бренды",
      children: [
        { label: "Sandyq", href: "/restaurant" },
        { label: "Tary", href: "/#brands" },
      ],
    },
    { label: "Для партнеров", href: "/#partners" },
    { label: "Поставщикам", href: "/#suppliers" },
    { label: "Для гостей", href: "/restaurant#locations" },
    { label: "О нас", href: "/#about" },
  ] as NavItem[],

  contacts: {
    // PLACEHOLDER — contact person and phone for suppliers.
    supplierManager: "Алия Сейтказы",
    supplierPhone: "+7 700 000 00 00",
    email: "hello@sandyq.example", // PLACEHOLDER
    instagram: "https://instagram.com/", // PLACEHOLDER
  },

  footer: {
    columns: [
      {
        title: "Sandyq Group",
        href: "/",
        icon: { name: "sandyq-group-logo", alt: "" },
        links: [
          { label: "Контакты", href: "/restaurant#locations" },
          { label: "О нас", href: "/#about" },
          { label: "Партнерам", href: "/#partners" },
          { label: "Поставщикам", href: "/#suppliers" },
        ],
      },
      {
        title: "Sandyq",
        href: "/restaurant",
        icon: { name: "sandyq-brand-thumb", alt: "" },
        links: [
          { label: "Рестораны", href: "/restaurant#locations" },
          { label: "Меню", href: "/menu/menu-almaty.pdf" },
          { label: "Банкеты", href: "/restaurant#events" },
        ],
      },
      {
        title: "TARY",
        href: "/#brands",
        icon: { name: "tary-brand-thumb", alt: "" },
        links: [
          { label: "О кофейне", href: "/#brands" },
          { label: "Instagram", href: "https://instagram.com/" }, // PLACEHOLDER
        ],
      },
    ],
    copyright: "Sandyq Group. Все права защищены.",
  },

  home: {
    hero: {
      image: { name: "bg-main", alt: "Войлочный орнамент и корзина с куртом" },
      title: "Хранители степного вкуса",
      lead: "Мы собираем национальную кухню по крупицам и возвращаем её гостям — через сеть этно-ресторанов и этно-кофеен в Казахстане и за его пределами.",
    },
    // PLACEHOLDER figures — replace with confirmed numbers.
    stats: [
      { value: "20", suffix: "заведений", label: "в трёх странах" },
      { value: "4", suffix: "партнёра", label: "по франшизе" },
      { value: "700+", label: "человек в команде" },
      { value: "+60%", label: "рост выручки за год" },
      { value: "+30%", label: "рост за последние полгода" },
      { value: "×2", label: "рост за полтора года" },
    ],
    concept: {
      id: "about",
      title: "Традиция как концепция",
      paragraphs: [
        "Меню выросло из полевой работы: вместе с этнологами мы годами ездили по аулам и районным центрам, записывая, как готовят в семьях, где рецепты передаются из поколения в поколение.",
        "Мы слушали старших, фотографировали утварь, сверяли технологии и пробовали — снова и снова. Так сложилась база блюд, которую мы бережно переносим на кухни наших заведений.",
      ],
    },
    facts: [
      { value: "15 лет", label: "длится исследовательская работа по регионам" },
      { value: "1 200 км", label: "дорог пройдено ради одного сезона экспедиций" },
      { value: "13 регионов", label: "вошли в карту рецептов" },
      { value: "1 500 рецептов", label: "описаны вместе с технологией приготовления" },
    ],
    slogan: {
      image: { name: "hero-block-main-3", alt: "" },
      text: "Память · Ремесло · Гостеприимство · Точность · Постоянство",
    },
    values: {
      left: { title: "Во что мы верим", items: ["Уважение", "Честность", "Верность слову", "Открытость", "Качество"] },
      right: {
        title: "Как мы работаем",
        items: ["Подлинность", "Прозрачность", "Внимание к гостю", "Технологии", "Скорость"],
      },
      ornament: { name: "decor-carving", alt: "" },
    },
    rows: [
      { id: "news", title: "Новости", cta: { label: "Все новости", href: "/#news" } },
      { id: "partners", title: "Партнёрам", cta: { label: "Стать партнёром", href: "mailto:hello@sandyq.example" } },
    ],
    partners: [
      { name: "decor-pana", alt: "Pana" },
      { name: "decor-ozen", alt: "Özen" },
      { name: "decor-turanga", alt: "Turanga" },
    ],
    suppliers: {
      id: "suppliers",
      title: "Поставщикам",
      text: "Работаете с фермерскими продуктами или посудой ручной работы? Оставьте короткую анкету — мы ответим в течение недели.",
      button: "Заполнить анкету",
      form: {
        title: "Анкета поставщика",
        step: "О компании",
        warning: "Проверьте данные перед отправкой: после отправки анкету нельзя будет изменить.",
        submit: "Отправить анкету",
        success: "Спасибо! Анкета принята, менеджер свяжется с вами.",
        // Set to a real endpoint (e.g. a form service URL) to actually send the data.
        endpoint: "",
        activities: ["Производство", "Дистрибуция / опт", "Услуги", "Другое"],
      },
    },
    brands: {
      id: "brands",
      title: "Наши бренды",
      items: [
        {
          name: "Sandyq",
          description: "Ресторан казахской кухни",
          logo: { name: "sandyq-brand-thumb", alt: "Логотип Sandyq" },
          href: "/restaurant",
        },
        {
          name: "TARY",
          description: "Этно-кофейня",
          logo: { name: "tary-brand-thumb", alt: "Логотип TARY" },
          href: "/#brands",
        },
      ],
    },
    seo: {
      title: "Sandyq Group — этно-рестораны казахской кухни",
      intro:
        "Sandyq Group развивает рестораны и кофейни, где казахская кухня звучит так, как её готовили дома: неспешно, щедро и по правилам.",
      sections: [
        {
          heading: "Что такое Sandyq Group",
          body: "Это семья брендов, объединённая одной базой рецептов и общим стандартом гостеприимства. Ресторан Sandyq рассчитан на долгий ужин и праздник, кофейня TARY — на короткую встречу и кофе с баурсаком.",
        },
        {
          heading: "Откуда берутся рецепты",
          body: "Каждое блюдо проходит путь от записи в экспедиционном дневнике до технологической карты. Мы сохраняем исходный вкус и адаптируем только то, что требуют современные нормы кухни.",
        },
        {
          heading: "Для партнёров",
          body: "Мы открываем заведения по франшизе: передаём концепцию, рецептуры, стандарты сервиса и сопровождаем запуск от подбора помещения до первых месяцев работы.",
        },
      ],
      more: "Читать далее",
      less: "Свернуть",
    },
  },

  restaurant: {
    hero: {
      slides: [
        { name: "slide-img-1", alt: "Гостья в национальном головном уборе с пиалой" },
        { name: "slide-img-2", alt: "Горячие баурсаки над деревянными чашами" },
        { name: "slide-img-3", alt: "Вход в зал, оформленный как юрта" },
      ],
      label: "Ресторан Sandyq",
    },
    mission: {
      title: "Зачем существует «Sandyq»",
      text: "Показать, как много в казахской кухне мудрости: в способах приготовления, в забытых рецептах, в самом обычае встречать гостя. И рядом с едой — рассказать о вещах, которые делают руками мастера нашего края.",
      imageLeft: { name: "about-restaurant-1", alt: "Двое в национальных костюмах приветствуют друг друга в степи" },
      imageRight: { name: "about-restaurant-2", alt: "Стопка расшитых подушек в зале ресторана" },
      aside: "Сегодня всё больше людей хотят знать, откуда пришло блюдо на их столе. Мы строим ресторан, который отвечает на этот вопрос.",
    },
    started: {
      title: "С чего всё началось",
      reasons: [
        "Молодое поколение всё реже знает, как готовили их бабушки и что значило каждое блюдо.",
        "На рынке почти не было этно-ресторанов, где к национальной кухне подходят с исследовательской точностью.",
        "Казахская кухня до сих пор редко попадает в мировые рейтинги традиционной еды.",
      ],
      images: [
        { name: "cymbal-1", alt: "Сложенные текстильные изделия и тканый ковёр" },
        { name: "cymbal-2", alt: "Две домбры на узорном ковре" },
        { name: "cymbal-3", alt: "Бешбармак в деревянной чаше" },
      ],
    },
    unique: {
      title: "Что делает нас особенными",
      items: [
        {
          title: "Авторское меню",
          text: "Старинные рецепты, переведённые на язык современной кухни. У каждого блюда есть регион, история и человек, который его сохранил.",
          image: { name: "hero-block-main-2", alt: "Бульон наливают в деревянную чашу" },
        },
        {
          title: "Посуда мастеров",
          text: "Дерево и керамика, как в доме предков, — без стилизации.",
          image: { name: "cymbal-3", alt: "Горячее блюдо в резной деревянной чаше" },
        },
        {
          title: "Звук степи",
          text: "Домбра и кобыз звучат в зале так же естественно, как разговор за дастарханом.",
          image: { name: "hero-block-main-1", alt: "Домбры на ковре у кирпичной стены" },
        },
        {
          title: "Интерьер с историей",
          text: "Сундуки и ковры, привезённые из экспедиций, — многим из них больше полувека.",
          image: { name: "hero-block-main-3", alt: "Расшитая подушка на резном сундуке" },
        },
        {
          title: "Свет и тепло",
          text: "Мягкий свет цветного стекла и запах свежего хлеба возвращают в детство и напоминают, откуда мы родом.",
          image: { name: "bright-bulbs", alt: "Подвесные светильники из цветного стекла" },
        },
      ],
    },
    signature: {
      text: "Кухня «Sandyq» — авторская",
      image: { name: "bright-bulbs", alt: "Светильники из цветного стекла в зале ресторана" },
    },
    author: {
      // PLACEHOLDER — name and role of the project's ethnographer.
      name: "Айжан Нурланова",
      role: "этнограф проекта",
      image: { name: "slide-img-1", alt: "Портрет в национальном головном уборе" },
      signature: { name: "sandyq-kz-sign-author", alt: "" },
      text: "Экспедиции проекта искали самые старые рецепты казахской кухни и записывали, как их готовят. Мы описали технологии, рассчитали пищевую ценность мясных и молочных блюд, выпечки, сладостей и напитков, а редкие блюда, почти исчезнувшие из обихода, вернули на стол после долгой полевой работы.",
    },
    tech: {
      title: "Технологии «Sandyq»",
      items: [
        { title: "Собственная ERP", text: "Своя система управления залом, кухней и складом." },
        { title: "Единый звук", text: "Общий музыкальный канал, чтобы в каждом зале звучало одинаково." },
        { title: "Приложение Sandyq.App", text: "Бронь стола, оплата онлайн и доставка — в одном месте." },
        {
          title: "Бонусы «Асыки»",
          text: "За каждый заказ гость получает асыки и может обменять их на предметы казахского быта: украшения, посуду, текстиль и продукты.",
        },
      ],
      phone: {
        city: "Алматы",
        bonus: "Начислено 450 асыков",
        heroDish: { title: "Қуырдақ", price: "3 900 ₸", image: { name: "hero-block-main-2", alt: "" } },
        chip: "Популярное",
        list: [
          { title: "Бешбармак по-домашнему", price: "5 990 ₸", image: { name: "cymbal-3", alt: "" } },
          { title: "Баурсаки с каймаком", price: "1 990 ₸", image: { name: "slide-img-2", alt: "" } },
          { title: "Сорпа в деревянной чаше", price: "2 490 ₸", image: { name: "hero-block-main-2", alt: "" } },
        ],
      },
    },
    locations: {
      id: "locations",
      title: "Наши рестораны",
      subtitle: "Меню в каждом городе своё: у некоторых блюд есть региональная прописка.",
      items: [
        {
          city: "Алматы",
          address: "ул. Примерная, 1", // PLACEHOLDER
          hours: "Ежедневно 11:00–00:00", // PLACEHOLDER
          phone: "+7 700 000 00 01", // PLACEHOLDER
          image: { name: "slide-img-3", alt: "Зал ресторана Sandyq в Алматы" },
          menus: [{ label: "Меню", href: "/menu/menu-almaty.pdf", size: "5,5 МБ" }],
        },
        {
          city: "Шымкент",
          address: "пр. Примерный, 2", // PLACEHOLDER
          hours: "Ежедневно 11:00–00:00", // PLACEHOLDER
          phone: "+7 700 000 00 02", // PLACEHOLDER
          image: { name: "about-restaurant-2", alt: "Зал ресторана Sandyq в Шымкенте" },
          menus: [{ label: "Меню", href: "/menu/menu-shymkent.pdf", size: "2,7 МБ" }],
        },
        {
          city: "Туркестан",
          address: "ул. Примерная, 3", // PLACEHOLDER
          hours: "Ежедневно 10:00–23:00", // PLACEHOLDER
          phone: "+7 700 000 00 03", // PLACEHOLDER
          image: { name: "hero-block-main-1", alt: "Интерьер ресторана Sandyq в Туркестане" },
          menus: [{ label: "Меню", href: "/menu/menu-turkistan.pdf", size: "5,0 МБ" }],
        },
      ],
    },
    events: {
      id: "events",
      title: "Банкеты и семейные праздники",
      subtitle: "Щедрый дастархан, национальные обряды и внимательный сервис для ваших главных дней",
      cta: "Узнать больше",
      items: [
        { title: "Банкеты", text: "Большие праздники с праздничной накрывкой и традиционными блюдами на весь стол.", href: "mailto:hello@sandyq.example?subject=Банкет" },
        { title: "Свадьбы", text: "Свадебный вечер в национальном стиле: атмосфера, подача и программа под ваших гостей.", href: "mailto:hello@sandyq.example?subject=Свадьба" },
        { title: "Қыз ұзату", text: "Проводы невесты со всеми обрядами — и с сервисом, о котором не нужно думать.", href: "mailto:hello@sandyq.example?subject=Қыз ұзату" },
        { title: "Сүндет той", text: "Тёплый семейный праздник с традиционным застольем и заботой о каждом госте.", href: "mailto:hello@sandyq.example?subject=Сүндет той" },
        { title: "Мерейтой", text: "Юбилеи и памятные даты в кругу близких — с меню, собранным под ваш повод.", href: "mailto:hello@sandyq.example?subject=Мерейтой" },
      ],
    },
    seo: {
      title: "Ресторан казахской кухни Sandyq",
      intro:
        "Sandyq — ресторан, в котором национальная кухня раскрывается через рецепты из экспедиций по регионам Казахстана. Мы готовим так, как готовили предки, но с точностью современной кухни и вниманием к каждой детали подачи.",
      sections: [
        {
          heading: "Концепция",
          body: "В основе меню — редкие блюда, которые почти исчезли из повседневной жизни. Мы восстанавливаем технологию, проверяем пищевую ценность и рассказываем гостям историю каждого рецепта.",
        },
        {
          heading: "Кымызотека",
          body: "Коллекция кумыса и шубата разной выдержки и из разных регионов — по принципу винной карты. Напитки подают в традиционной посуде и при правильной температуре.",
        },
        {
          heading: "Сервис и технологии",
          body: "Бронь, оплата и доставка работают через приложение, а собственная ERP-система связывает зал и кухню — поэтому заказ приходит быстрее, а ошибок становится меньше.",
        },
      ],
      more: "Читать далее",
      less: "Свернуть",
    },
  },
} as const

export type Site = typeof site
