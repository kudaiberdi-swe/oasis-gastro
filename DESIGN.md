---
name: Sandyq
description: The cashier, kitchen screen and back office of the Sandyq ethno-restaurants, in the brand's carved-chest identity.
colors:
  cream: "#fff7ec"
  ink: "#121316"
  card-white: "#ffffff"
  muted-parchment: "#f5ecdf"
  muted-ink: "#6b6159"
  hairline-sand: "#e8e3dc"
  input-clay: "#8c8173"
  wine: "#8c2323"
  wine-deep: "#6e1b1b"
  brass-text: "#8a6526"
  gold: "#b28f6f"
  rust: "#a33009"
  clay-ring: "#7f5c43"
  steppe-green: "#44632f"
  amber-warning: "#8a5a00"
  ember-red: "#b42318"
  night-ink: "#121316"
  night-raised: "#1e1e1e"
  nav-muted: "#bfb5a8"
  cat-meat: "#8c2323"
  cat-dairy: "#b28f6f"
  cat-bread: "#9a4408"
  cat-green: "#4d5a36"
  cat-tea: "#6b4a2e"
  cat-turkistan: "#2e6a6e"
typography:
  hero:
    fontFamily: "Cormorant, PT Serif, Georgia, serif"
    fontSize: "44px"
    fontWeight: 600
    lineHeight: "48px"
  display:
    fontFamily: "Cormorant, PT Serif, Georgia, serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: "36px"
  title:
    fontFamily: "Golos Text, PT Sans, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: "28px"
  title-sm:
    fontFamily: "Golos Text, PT Sans, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "24px"
  body:
    fontFamily: "Golos Text, PT Sans, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
  body-sm:
    fontFamily: "Golos Text, PT Sans, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "Golos Text, PT Sans, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
  price:
    fontFamily: "Cormorant, PT Serif, Georgia, serif"
    fontFeature: "lnum, tnum"
rounded:
  control: "2px"
  card: "6px"
  panel: "8px"
  round: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
components:
  button-primary:
    backgroundColor: "{colors.wine}"
    textColor: "{colors.card-white}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.wine-deep}"
  button-secondary:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ember-red}"
    rounded: "{rounded.control}"
    height: "44px"
  button-pos-large:
    backgroundColor: "{colors.wine}"
    textColor: "{colors.card-white}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 24px"
    height: "56px"
  input:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
  card:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "16px"
  status-pill:
    backgroundColor: "{colors.muted-parchment}"
    textColor: "{colors.muted-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "24px"
  nav:
    backgroundColor: "{colors.night-ink}"
    textColor: "{colors.cream}"
    typography: "{typography.body-sm}"
  nav-item-active:
    backgroundColor: "{colors.night-raised}"
    textColor: "{colors.gold}"
---

# Design System: Sandyq

This file holds two things. The first eight sections are the design system of the app in this repo — the
cashier (`/pos`), the kitchen screen (`/kitchen`) and the office (`/office`); its source of truth is
`src/shared/styles/theme.css`. The last section, **Website**, is the spec of the marketing site in
`website/`, read from the reference pages of sandyqgroup.com; the app derives its palette from it.
Detailed screen rules live in `docs/04-POS-DESIGN.md` and `docs/05-OFFICE-DESIGN.md`.

## Overview

**Creative North Star: "The Carved Chest"**

Sandyq means chest — the carved wooden sandyq where a Kazakh family keeps what is valuable, each thing in
its place. The system borrows that object's discipline rather than its ornament: almost square, carved
corners (2px on every control), flat surfaces laid out in order, thin gold lines where a craftsman would
cut an edge, and one wine-red mark for the thing that matters most on the screen. It is a working tool
first. Cashiers take orders at a table in a full hall; the chest keeps everything findable, calm and within
reach, and lets the brand show in precise details instead of decoration.

The world is warm but restrained: cream working areas, white cards, ink text, a dark ink frame (the POS
header, the office sidebar, the sign-in screen) that holds the working area like a chest's lid and body.
Cormorant, the brand's display serif, is kept for titles and prices; everything operational is set in Golos
Text so Kazakh and Russian read equally well at a glance. Density is honest to the surface: the POS and
kitchen are touch-first with 48–56px targets, the office is a desktop tool with a compact mode.

**Key Characteristics:**
- Carved, almost-square forms: 2px controls, 6px cards, 8px panels; never pill buttons.
- Flat by default: tonal layers (cream → white card) and hairline borders; shadows only where a surface floats.
- One wine primary per screen; gold is line and ornament, brass is the readable accent.
- Cormorant for titles and prices with tabular figures, Golos Text for everything else.
- Day and night themes over the same semantic tokens; contrast is checked in CI.
- The brand lives in details: the 4px rust heading accent, gold active markers, category strips.

## Colors

The palette is the one of the live Sandyq site — cream, ink, wine, gold, rust — with a few derived values
tuned so text reaches 4.5:1 and control borders 3:1 in both themes (`npm run contrast`).

### Primary
- **Kilim Wine** (wine): the one main action of a screen — «Оплатить», «Провести», «Сохранить» — and the
  hover darkens to **Wine Deep** (wine-deep). Also the category mark of meat dishes.

### Secondary
- **Brass Text** (brass-text): the readable gold — prices, links, active tabs and info pills on light
  surfaces (4.98:1 on cream).
- **Carving Gold** (gold): lines and ornament only — hairlines, the active menu marker, dashed «add» outlines,
  prices on the dark frame. Never text on a light surface.
- **Rust Cut** (rust): the 4px accent beside page titles and ornament markers.

### Tertiary
- **Steppe Green** (steppe-green): paid, posted, ready.
- **Amber Ember** (amber-warning): held, below minimum, overdue, long shifts — amber, kept apart from
  rust and from the danger red so a warning never reads as an error.
- **Ember Red** (ember-red): errors, negative amounts, dangerous actions; a muted wine
  (`--destructive-muted`) marks refunded checks — the danger family without the alarm.
- **Status surfaces** (`--success-surface`, `--warning-surface`, `--destructive-surface`): opaque tints
  behind pills and banners, contrast-checked for the tone text and the banner body in both themes.
- **Category marks** (cat-meat, cat-dairy, cat-bread, cat-green, cat-tea, cat-turkistan): menu families on
  dish cards and category chips; Turkistan teal only marks dishes of the Turkistan menu.

### Neutral
- **Cream Tablecloth** (cream): the working area of every surface.
- **Night Ink** (ink): text; also the dark frame (night-ink) with **Night Raised** (night-raised) for its
  raised items and **Felt Grey** (nav-muted) for its secondary text.
- **Card White** (card-white): cards, panels, tables, dialogs, inputs.
- **Parchment** (muted-parchment): row stripes, segmented controls, read-only fields, neutral pills.
- **Muted Ink** (muted-ink): secondary text, captions, placeholders (5.68:1 on cream).
- **Sand Hairline** (hairline-sand): decorative card and table borders.
- **Input Clay** (input-clay): input and secondary-button borders (3.82:1 on white, WCAG 1.4.11).
- **Clay Ring** (clay-ring): the focus ring.

The night theme overrides every token (see `.impeccable/design.json` → `extensions.themes.night`): ink
background, raised charcoal cards, a brighter wine primary, and gold becomes the readable accent.

### Named Rules
**The One Wine Rule.** A screen has one wine primary action; everything else is secondary, ghost or link.

**The Gold Is Line Rule.** Carving gold draws lines and marks; readable gold text on light is always brass.

**The Strip Not Fill Rule.** Category colors appear as a 3px strip on a card or chip, never as a fill.

**The One File Rule.** Raw color values exist only in `src/shared/styles/theme.css`; components use semantic
tokens (`bg-card`, `text-accent`, `border-input`…).

## Typography

**Display Font:** Cormorant (with PT Serif, Georgia)
**Body Font:** Golos Text (with PT Sans, Segoe UI, Roboto, Arial)
**Label/Mono Font:** SFMono-Regular / Consolas for codes only

**Character:** A classical Cyrillic serif for the brand's voice beside a clear contemporary sans for work;
both self-hosted and both cover Kazakh letters (Ә Ғ Қ Ң Ө Ұ Ү Һ І).

### Hierarchy
- **Hero** (600, 44px / 48px, Cormorant): sign-in and large totals only.
- **Display** (600, 32px / 36px, Cormorant): page titles in the office header, beside the rust accent.
- **Title** (600, 22px / 28px, Golos Text): panel and card headings.
- **Title small** (600, 18px / 24px): section headings inside cards and dialogs.
- **Body** (400, 16px / 24px): POS text, dialog body, POS buttons.
- **Body small** (400, 14px / 20px): office text, tables, inputs, buttons.
- **Label** (500, 12px / 16px): captions, pills, table hints, breadcrumbs.
- **Price** (Cormorant, lining tabular figures): every amount of money, so columns align.

### Named Rules
**The Fourteen Floor Rule.** POS and kitchen text is never below 14px; the office never below 12px.

**The Serif For Voice Rule.** Cormorant sets titles and prices only; labels, buttons, tables and forms stay in Golos Text.

## Layout

Two spatial models share the tokens. The POS and the kitchen are fixed touch surfaces (minimum 1024px wide,
no page scroll): the dark header on top, the catalog and the order panel side by side, every control at
least 48px (`--control-h-pos`). The office is a shell: a dark collapsible sidebar with grouped sections and
search, a cream working area whose page header carries breadcrumbs, the Cormorant title with its rust accent
and the section's actions; registers are tables (48px rows) with a 440px right panel for the selected record
on desktop, which becomes a full-height sheet on narrow screens.

The spacing scale is 4 / 8 / 12 / 16 / 24 / 32px. `[data-density="compact"]` really tightens it (controls
36px, POS 44px, table rows 40px) for office users who want more on screen.

## Elevation & Depth

Flat by default. Depth comes from tonal layers — cream area, white card, parchment inset — and from hairline
borders. Two shadows exist, both soft and ink-tinted: **panel** for KPI cards and raised panels, and
**float** for toasts, sheets and dialogs above the page (values in `.impeccable/design.json` →
`extensions.shadows`). Night uses deeper, darker versions of the same two.

### Named Rules
**The Flat Chest Rule.** Surfaces rest flat on the cream; only something that floats above the page gets the float shadow.

## Shapes

Carved, almost square: controls, pills and inputs 2px, cards 6px, panels and dialogs 8px; fully round only
for avatars and dots. Borders are 1px — sand hairlines for decoration, clay for inputs. The recurring accent
is linear, not rounded: the 4px rust bar beside a title, the 2px gold bar marking the active menu item, the
3px category strip, the dashed gold outline of an «add» slot.

## Components

### Buttons
- **Shape:** carved corners (2px), 44px high in the office, 48–56px on the POS.
- **Primary:** wine fill, white label, semibold 14px; hover to wine deep; one per screen.
- **Secondary:** white card with a clay border and ink label; hover to parchment.
- **Ghost / Link:** ink label on transparent, hover parchment; links in brass with an underline on hover.
- **Danger:** white with an ember-red border and label; «danger-solid» fills ember red for the confirm step.
- **Focus:** a 2px clay ring offset by 2px, on every interactive element; disabled at 45% opacity.
- **Press:** the button sinks 1px (150ms ease-out) for touch feedback; it stays still under reduced motion.

### Chips
- **Status pills:** 24px tall, 2px corners, 12px medium label; success, warning and danger sit on their opaque
  status surface with a 35% border, refunded on parchment in muted wine, info is a 10% brass tint, neutral
  parchment. «Отложен» (amber), «Возвращён» (muted wine) and «Оплачен» (green) never share a tone.
- **Filter / category chips:** the active chip is a fill (`--chip-active`): ink by day, cream at night.

### Cards / Containers
- **Corner Style:** 6px.
- **Background:** card white on cream (raised charcoal at night).
- **Shadow Strategy:** flat with a sand hairline; KPI cards and raised panels take the panel shadow.
- **Internal Padding:** 16px.

### Inputs / Fields
- **Style:** white field, 1px clay border, 2px corners, 44px high, 14px text, muted-ink placeholder.
- **Focus:** the clay ring.
- **Error / Disabled:** ember-red border (`aria-invalid`); disabled at 50%; read-only fields turn parchment.

### Navigation
- **Office sidebar:** night-ink frame, felt-grey 14px items, raised hover; the active item is raised, gold,
  semibold, with a 2px gold bar on its left edge; groups collapse, search filters sections.
- **POS header:** the same dark frame with the Sandyq mark (`sandyq-group-logo.svg`, gold, 32px), terminal and
  shift state («Смена №12 · открыта 09:41»); theme, density and the RU/KK interface language switch live in the staff profile.

### Page Header (signature)
Breadcrumb in 12px, then the Cormorant display title set against a 4px rust bar, an optional description,
and the section's actions aligned to the right. It is the brand's most recognizable mark inside the tool.

### Dish Card (signature)
A white card with a 3px category strip, the name in the interface language first (Russian in RU, Kazakh in KK, with `lang="kk"`) and the other one second, the price in
Cormorant tabular figures in brass, and availability shown in text, not only in color.

## Do's and Don'ts

### Do:
- **Do** use semantic tokens only; add a color by adding a token to `theme.css`, in both themes.
- **Do** keep one wine primary per screen and make the other actions secondary, ghost or link.
- **Do** set every amount of money in the price style (Cormorant, tabular figures) so columns align.
- **Do** keep POS and kitchen targets at 48px or more and text at 14px or more.
- **Do** show Kazakh and Russian side by side where the menu has both, the interface language first (Russian by default).
- **Do** run `npm run contrast` after touching colors; text 4.5:1, borders 3:1, in day and night.

### Don't:
- **Don't** round buttons into pills or soften cards past 8px; the chest is carved, not molded.
- **Don't** set gold as text on a light surface — use brass.
- **Don't** fill a surface with a category color; it is a 3px strip.
- **Don't** add shadows to resting cards; depth is tonal.
- **Don't** set labels, buttons or tables in Cormorant.
- **Don't** hard-code a hex value, a Tailwind palette class or an inline color in a component.

## Website

Spec of the marketing site in `website/` (moved here from the former `docs/DESIGN.md` unchanged, headings one level down).

Source of truth for the marketing site in `website/`. For the POS / office / kitchen / courier app see the sections above and `docs/04-POS-DESIGN.md` (it derives its palette from §1 here) and the migration plan in `reference/archive/PLAN.md`. Everything here was read from the raw HTML/CSS of the two reference pages (saved under `reference/site-src/`) and checked against full-page screenshots in `reference/site-screenshots/` (1440 / 768 / 375 px).

- Group landing — https://sandyqgroup.com/ → our `/`
- Restaurant page — https://sandyqgroup.com/sandyq/ → our `/restaurant`

The reference is a WordPress + Elementor site whose sections are hand-written HTML widgets, each with its own inline `<style>`. There is no global design system on the reference side: values below are the ones actually used by each section, consolidated into tokens. Where the reference is internally inconsistent (e.g. three slightly different browns, headings that fall back to Times because no font is set), the consolidation is noted.

---

### 1. Color palette

| Token | Hex | Where the reference uses it |
|---|---|---|
| `ink` | `#121316` | `--s-dark`. Header background (at 95% opacity), stat numbers, mission text, author description, dropdown menu bg |
| `ink-soft` | `#1e1e1e` | "Почему мы начали?" title + list text |
| `cream` | `#FFF7EC` | Page/section background everywhere (Elementor containers, footer, `.sandyq-section`) |
| `cream-alt` | `#FAF8F5` | Banquets section panel background |
| `stone` | `#E7E5E4` | `--s-bg`: mobile menu overlay background |
| `gold` | `#B28F6F` | `--s-gold`: nav hover, active language, carving ornaments, group logo mark |
| `gold-text` | `#B18E6E` (`rgb(177,142,110)`) | "Авторская кухня" signature headline (same hue as gold) |
| `gold-link` | `#B5893D` | SEO text links and "Читать далее ↓" trigger |
| `brown` | `#331F15` | Values/features titles + items, footer links, partner logos |
| `brown-muted` | `rgba(51,31,21,.7)` | Footer copyright line |
| `brown-line` | `rgba(51,31,21,.1)` | Footer top divider |
| `clay` | `#9D7455` → `rgb(157,116,85)` | Outline pill buttons ("Смотреть новости →", "Стать партнером →") text + border |
| `amber` | `#B45309` | Supplier banner border, "Заполнить анкету" button, phone link, form focus |
| `amber-dark` | `#92400E` | `.sq-brand-btn:hover` |
| `rust` | `#A33009` → `rgb(163,48,9)` | 4 px accent line next to "Технологичность «Sandyq»"; red ornament icons |
| `wine` | `#8C2323` | Banquet card "Подробнее" button |
| `wine-dark` | `#6E1B1B` | Banquet card button hover |
| `charcoal` | `#23282D` | Restaurant SEO "Читать далее" button (hover `#555555`) |
| `stone-500` | `#78716C` | Author role ("этнограф") |
| `gray-600` | `#4B5563` | Brand description under brand logo |
| `gray-text` | `#555555` | Uniqueness item text, card descriptions |
| `gray-666` | `#666666` | Banquets subtitle |
| `card-border` | `#E8E3DC` | Banquet card border |
| `white` | `#FFFFFF` | Hero text, nav links, banquet cards |
| `slogan-text` | `#FAFAFA` | Slogan band text |
| `form-bg` | `#FEFCE8` / border `#FEF08A` | Supplier modal window |
| `form-field-border` | `#D1D5DB` | Modal inputs |
| `danger` | `#EF4444` | Required-field asterisk |

Overlays:

- Group hero: `linear-gradient(to top, rgba(0,0,0,.60) 0%, rgba(0,0,0,.20) 100%)` over the photo.
- Restaurant hero: flat `rgba(0,0,0,.20)` over a looping video.
- Slogan band: no overlay; text has `text-shadow: 1px 1px 5px rgba(0,0,0,.5)`.
- Header: `rgba(18,19,22,.95)` + `backdrop-filter: blur(12px)`, bottom border `rgba(255,255,255,.05)`.
- Modal backdrop: `rgba(0,0,0,.4)` + `blur(3px)`.

**Consolidation for the build:** `clay` (#9D7455), `gold` (#B28F6F) and the signature gold are one family; kept as `gold` (decor, hover) and `clay` (text on cream — #9D7455 on #FFF7EC is 3.9:1, so for small text we darken to `clay-strong` `#7F5C43`, 5.6:1, see §9). `amber` and `wine` are kept separate because the reference uses them for different CTAs.

### 2. Typography

The reference loads **no brand webfont**. It uses:

- **System UI sans** — `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` — header, hero, stats, values, supplier banner, brands, banquets.
- **Roboto** (self-hosted woff2, 300/400/500/700) — only where Elementor's global font variable is used: "Уникальность" slider and the group SEO block. Visually indistinguishable from system sans at those sizes.
- **Times (browser default serif)** — every block that sets `font-family: inherit` from Hello Elementor's un-styled body: slogan band, "Новости"/"Партнеры"/"Новым поставщикам" headings, mission, "Почему мы начали?", signature headline, author, "Технологичность", restaurant SEO, footer. This is accidental on the reference, but it is what users see and it gives the restaurant page its editorial look.

Build decision: two families, both zero-download:

- `--font-sans`: the system stack above.
- `--font-serif`: `"Times New Roman", Times, "Liberation Serif", "Noto Serif", Georgia, serif`.

Roboto is dropped (not visible as a difference; saves ~80 KB of fonts).

#### Type scale (desktop → mobile)

| Role | Family | Size desktop | Size mobile | Weight | Line height | Notes |
|---|---|---|---|---|---|---|
| Hero H1 (group) | sans | 4.2rem (67.2px) | 2rem (32px) | 700 | 1.15 | `text-shadow 0 2px 4px rgba(0,0,0,.3)`, max-w 1200px, mb 1.8rem / 1.2rem |
| Hero lead | sans | 1.25rem | 1.05rem | 400 | 1.5 | max-w 850px |
| Stat number | sans | 4.2rem | 3rem | 600 | 1.1 | letter-spacing −1px; `small` suffix 1.1rem/600 |
| Stat label | sans | 0.95rem | 0.95rem | 400 | normal | opacity .9, mt 5px |
| Section H2 (group, sans) | sans | 2.2rem ("Концепция"), 36px (values), 32px (brands) | 1.8rem / 24px / 26px | 600 | 43px on values | |
| Section H2 (restaurant, serif) | serif | 36px (2.25rem) | 28px / 1.75rem / 1.5rem | 600–700 | 1.2 | mission, started, uniqueness, tech |
| Values item | sans | 24px | 16px | 500 | 28px / 19px | color `brown` |
| Expedition H3 | sans | 1.4rem | 1.4rem | 600 | — | p 0.95rem/1.4 |
| Body lead (concept) | sans | 1.05rem | 1.05rem | 400 | 1.5 | |
| Body large (restaurant) | serif | 20px (mission), 18px (started, author, tech) | 16px | 400 | 1.5–1.6 | |
| Slogan | serif | 36px | 16px | 600 | 1.2 | |
| Signature headline | serif | 48px → 40px ≤1440 → 32px ≤1024 | 32px | 700 | — | color gold |
| Brand name | sans | 36px | 32px | 500 | 1.2 | desc 18px / 16px `gray-600` |
| Uniqueness item title | sans | 1.75rem | 1.25rem | 600 | — | text 1.125rem/1.6 → .95rem |
| Card title (banquets) | sans | 18px | 18px | 600 | — | desc 14px/1.5 |
| Banquets H2 | sans | 28px | 28px | 700 | — | subtitle 16px `#666` |
| Nav link | sans | 13px | — | 500 | — | UPPERCASE, gap 30px |
| Dropdown link | sans | 14px | — | 500 | — | sentence case, padding 12px 20px |
| Mobile menu link | sans | 28px | 28px | 400 | — | padding 15px, color `ink` |
| Logo wordmark | sans | 19px | 19px | 500 | — | letter-spacing −0.04em |
| Lang switch | sans | 13px | — | 600 | — | gold active, white others, "—" separators |
| Footer brand | serif | 20px | 20px | 500 | — | row height 70px, gap 16px |
| Footer link | serif | 16px | 16px | 500 | 1.4 | hover opacity .7 |
| Footer legal | serif | 14px | 14px | 400 | — | `brown-muted` |
| Button (amber) | sans | 13px | 13px | 600 | — | padding 10px 20px, radius 6px |
| Button (wine, card) | sans | 14px | 14px | 600 | — | padding 10px 16px, radius 6px, full width |
| Button (outline pill) | serif | 16px | 16px | 700 | — | padding 10px, radius 14px, 1px `clay` border, width ~260px |
| SEO H1 / H2 / H3 | sans (group) / serif (restaurant) | 28 / 22 / 18 px | same | 700 / 600 / 600 | 1.6 body | body 15–16px `#333` |

Uppercase is used **only** in the desktop nav.

### 3. Layout

| Token | Value | Source |
|---|---|---|
| Header height | 75px, fixed, `z-index 9999`; body gets `padding-top: 75px` | `.s-header` |
| Header container | max-width 1400px, padding 0 30px; 3 columns flex 1 / 2 / 1 | `.s-container` |
| Content container (group) | max-width 1200px, padding 0 20px | stats, values, footer |
| Boxed container (Elementor) | 1140px | news/partners rows, supplier banner, brands |
| Wide container (restaurant) | 1440px with 103px side padding → 64px ≤1280 → 20px ≤768 | tech, uniqueness title |
| Author container | 1280px, padding 0 20px, margin 5rem auto | |
| Banquets container | 1160px | |
| Section vertical rhythm | 50px (stats, supplier), 60px (mission, started), 80px (values), 100px (signature, author top), 40px (uniqueness) | |
| Gutter | 20px mobile, 40px/60px desktop grids | |

Breakpoints found in media queries (all used):

| Name | px | Used for |
|---|---|---|
| `xs` | 480 / 485 | marquee image size, author signature hidden |
| `sm` | 600 | footer columns stack |
| `md` | 768 | main mobile ↔ desktop switch (hero, values, slogan, brands, mission) |
| `lg` | 992 | stats 2 → 3 columns, concept 1 → 2 columns, expedition 2 → 4 |
| `xl` | 1024 | burger menu, footer stacks, started section stacks |
| `wide` | 1180 | tech section stacks |
| `2xl` | 1280 | uniqueness card size, wide container padding |
| `3xl` | 1440 | signature text size, author margin |

Grids:

- Stats: 2 cols (gap 40/20) → 3 cols ≥992 (gap 60/40), text centered, mb 70px.
- Concept text: 1 → 2 columns ≥992, gap 25px.
- Expedition: 2 → 4 columns ≥992, gap 30/20, mt 50px.
- Values: two centered lists split by a 130px vertical 1px line (margin 0 66px); becomes a 130px horizontal line on mobile.
- Brands: flex row gap 64px, item 240px; column gap 48px on mobile.
- Footer: logo 140px + three 310px columns (gap 80px, ml 100px) → stacked ≤1024 → single column ≤600.
- Mission (restaurant): flex, `align-items: flex-end`, gap 100px, ml 103px; left 60% (title, text, image at 70% width), right 30% (tall image + text).
- Started: text column (flex 1, min 450px) + marquee column (flex 1.5) that bleeds to the right edge (`margin-right: calc(-50vw + 50%)`).
- Tech: title row with 186×4px rust line; 50/50 split list + phone image (max 570px).
- Banquets: flex-wrap, gap 24px, card flex 1 1 320px, 280–360px.

### 4. Components

**Header** — fixed, dark translucent with blur, 75px. Left: 28px gold mark + "Sandyq Group" wordmark. Center: uppercase nav with a "Бренды" parent that is not a link and reveals a dropdown (`ink` bg, 1px `rgba(255,255,255,.1)` border, min-w 220px, padding 10px 0) on hover. Right: `RU — KZ — EN` language switch. ≤1024px: nav hidden, 25×16px burger (three 2px white bars) appears. The header is **not** transparent over the hero; the hero starts below it.

**Mobile menu** — full-screen `stone` (#E7E5E4) overlay, centered list of 28px `ink` links (brand children shown flat), language switch, "×" close at top-right 25px/35px. Reference toggles with `display` (no animation).

**Hero (group)** — background image, bottom-to-top dark gradient, content pinned bottom-left. Padding `140px 6% 60px` mobile → `460px 10% 100px` desktop, so the hero is ~725px tall at 1440.

**Hero (restaurant)** — full-bleed media block, `height: 70vh`, `min-height: 500px` (400px mobile), black background, 20% black overlay, `object-fit: cover` looping muted video. No text.

**Stat card** — big number + small suffix + label, centered.

**Slogan band** — full-bleed background photo, 564px tall (212px mobile), single centered serif line with shadow.

**Values/features** — see grid above; `decor-carving.svg` ornaments 52px wide at the far left/right on desktop (right one mirrored with `scaleX(-1)`), 32px ornaments inside each list on mobile.

**Section header row with pill button** — serif H2 left, outline pill button right (margin-left 300px on desktop, 0 on mobile, centered stack on mobile).

**Partner logo strip** — three logos (max-height 100px) spaced between, padding 40px 0; stacked with gap 30px on mobile.

**Supplier banner** — transparent card, 1px `amber` border, radius 16px, padding 30px 40px, text + amber button left, contact name + underlined bold amber phone right. Mobile: column, contact block gets a top border `rgba(180,83,9,.2)`.

**Supplier modal form** — backdrop blur, window `form-bg`, radius 16px, max-w 500px, max-h 90vh scroll, padding 26px, shadow `0 10px 25px rgba(0,0,0,.1)`. Fields: label 13px/600 `#374151`, input padding 10px 12px, radius 6px, 1px `#D1D5DB`, focus border amber; submit full width amber 14px/600, padding 12px.

**Brand card** — 140px-high logo box (logo 120px wide), 36px name, 18px description.

**SEO/expandable text** — H1 28px + intro, hidden body that expands with `max-height` + `opacity` transition 0.5s, trigger "Читать далее ↓" / "↑" in `gold-link` (group) or a dark filled button (restaurant).

**Footer** — cream, padding 64px 0 32px; big stacked logo (140px) + three brand columns, each headed by a 70px-tall row with icon + brand name; bottom bar with top border, copyright left, credits right.

**Mission block (restaurant)** — see layout. Images square-cornered.

**Marquee gallery ("Почему мы начали?")** — three portrait photos 545×840 (240×370 ≤480), 20px gap, no radius, duplicated track scrolling `translateX(0 → -100%)` in 25s linear infinite, pauses on hover.

**Uniqueness slider** — cards 566px wide (420 ≤1280, 280 ≤768), 50px gap (24 mobile), images radius 8px with heights alternating 530/590 (400/450 ≤1280, 320 mobile), every even card is `column-reverse` (text above image) → staggered checkerboard; track loops `translateX(0 → -50%)` in 50s linear, pauses on hover. Info padding 24px 20px.

**Signature block** — 1250px tall (700 mobile), two thin gold ellipse outlines anchored bottom-left and top-right, center: a 360px (250 ≤1024, 200 ≤485) media card rotated −6.2°, with the gold serif headline overlapping it at 45% from top.

**Author block** — portrait 448×530 left (35%), right column (50%) with name 1.5rem/600, role 1.25rem/600 `stone-500`, a 193×165 handwritten signature image, description 1.125rem/1.6.

**Tech block** — serif title + rust line, four items each with a 40px ornament icon + label (500) and description (18px), phone mockup image right.

**Banquet card** — white, 1px `card-border`, radius 12px, padding 24px, title/desc/full-width wine button; hover lifts `translateY(-4px)` + `0 10px 20px rgba(0,0,0,.06)` in 0.2s ease.

Image treatments: square corners everywhere except uniqueness images (8px). No filters. Cards radius 12px, banners/modals 16px, buttons 6px, outline pills 14px.

### 5. Motion

| Where | Behavior | Timing |
|---|---|---|
| Nav links | color → gold on hover | `transition: 0.2s` (all, ease) |
| Dropdown | appears on `li:hover` (display toggle) | instant |
| Amber button | bg → `amber-dark` | 0.2s |
| Wine card button | bg → `wine-dark` | 0.2s ease |
| Banquet card | lift −4px + shadow | 0.2s ease |
| Footer links | opacity .7 on hover | instant |
| Expandable SEO text | `max-height` 0 → large + `opacity` 0 → 1 | 0.5s ease-in / ease-out; arrow swap |
| "Почему мы начали?" marquee | continuous horizontal loop, pause on hover | 25s linear infinite |
| Uniqueness marquee | continuous horizontal loop, pause on hover | 50s linear infinite |
| Restaurant hero | autoplay looping muted video | — |
| Signature card | looping video inside a rotated card | — |

No scroll-triggered reveal animations exist on the reference. The build adds a subtle fade-up on section entry (Framer Motion, 0.6s, `ease: [0.22, 1, 0.36, 1]`, 24px offset, once) and a slow crossfade/Ken Burns image loop in place of the videos (no video assets were provided). All of it is disabled under `prefers-reduced-motion: reduce`, and the marquees stop and become horizontally scrollable lists.

### 6. Section order

#### `/` (group landing)

1. Header (fixed)
2. Hero — H1 "Возрождение степной легенды" + mission lead over the felt/kurt photo
3. Stats (6 numbers) → "Концепция традиций" two-column text → expedition facts (4)
4. Slogan band — five values separated by " - "
5. "Наши ценности" | "Наши особенности" with carving ornaments
6. "Новости" row + outline button
7. "Партнеры" row + outline button
8. Partner logo strip (Pana, Özen, Turanga)
9. "Новым поставщикам" banner (+ modal form)
10. "Наши бренды" (Sandyq, TARY)
11. SEO text, collapsed, "Читать далее"
12. Footer

#### `/restaurant`

1. Header (same as group)
2. Media hero (70vh video, no text)
3. Mission — "Цель ресторана" + two images
4. "Почему мы начали?" — three reasons + marquee photo strip bleeding right
5. "Уникальность" — staggered looping card slider (5 items)
6. Signature — rotated media card + "Авторская кухня" headline between two ellipses
7. Author — ethnographer portrait, name, role, signature, text
8. "Технологичность" — 4 items + phone mockup
9. "Организация банкетов и торжеств" — 5 cards
10. SEO text, collapsed, dark "Читать далее" button
11. Footer

### 7. Implementation tokens

These live in `website/src/styles/index.css` as CSS variables and are exposed to Tailwind v4 through `@theme` (Tailwind v4 is CSS-first; there is no `tailwind.config.js` — see NOTES.md).

```css
--color-ink: #121316;        --color-ink-soft: #1e1e1e;
--color-cream: #fff7ec;      --color-cream-alt: #faf8f5;   --color-stone: #e7e5e4;
--color-gold: #b28f6f;       --color-gold-link: #8a6526;   /* darkened from #b5893d for AA */
--color-clay: #9d7455;       --color-clay-strong: #7f5c43;
--color-brown: #331f15;
--color-amber: #b45309;      --color-amber-dark: #92400e;
--color-rust: #a33009;       --color-wine: #8c2323;        --color-wine-dark: #6e1b1b;
--color-charcoal: #23282d;   --color-muted: #555555;       --color-muted-2: #4b5563;
--color-stone-500: #78716c;  --color-line: #e8e3dc;        --color-form: #fefce8;

--font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
--font-serif: "Times New Roman", Times, "Liberation Serif", "Noto Serif", Georgia, serif;

--breakpoint-xs: 30rem; --breakpoint-sm: 37.5rem; --breakpoint-md: 48rem; --breakpoint-lg: 62rem;
--breakpoint-xl: 64rem; --breakpoint-wide: 73.75rem; --breakpoint-2xl: 80rem; --breakpoint-3xl: 90rem;

--radius-btn: 6px; --radius-img: 8px; --radius-card: 12px; --radius-pill: 14px; --radius-panel: 16px;
--shadow-card: 0 10px 20px rgba(0,0,0,.06); --shadow-modal: 0 10px 25px rgba(0,0,0,.1);
--spacing-header: 75px; --spacing-gutter-wide: 103px;
--ease-out-soft: cubic-bezier(.22,1,.36,1);
```

### 8. Content tone

Russian, formal but warm, "мы" voice. Headlines are short declaratives ("Возрождение степной легенды", "Почему мы начали?"); body copy is one to three long sentences about heritage, expeditions, recipes, hospitality. Numbers are presented as big figures with a short noun suffix. All copy in the build is new placeholder text written in this tone and at similar length; it lives in `website/src/config/site.ts`.

### 9. Accessibility adjustments vs. reference

The reference fails AA in a few places; the build keeps the look but nudges values:

| Element | Reference | Contrast on cream | Build |
|---|---|---|---|
| Outline pill text | `#9D7455` | 3.9:1 | `clay-strong` `#7F5C43` (5.6:1); border stays `#9D7455` |
| SEO "Читать далее" link | `#B5893D` | 2.9:1 | `gold-link` `#8A6526` (5.0:1) |
| Signature headline | `#B18E6E` at 48px bold | 2.8:1 | large text (≥24px bold) needs 3:1 → `#9D7455` (3.9:1) |
| Nav hover gold on ink | `#B28F6F` on `#121316` | 6.2:1 | unchanged |
| Card desc `#555` on white | — | 7.5:1 | unchanged |

Other: visible focus rings (2px gold outline, 3px offset) on every interactive element; the "Бренды" dropdown also opens on keyboard focus (`:focus-within`) and is a real `<button>` with `aria-expanded`; marquees are decorative duplicates hidden from assistive tech (`aria-hidden` on the clone track); the mobile menu traps focus and closes on Escape.
