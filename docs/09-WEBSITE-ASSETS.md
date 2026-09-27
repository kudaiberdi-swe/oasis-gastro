# Sandyq website — asset map

Every image on the site comes from the repo's `frontend/public/` folder (the same folder the POS uses). Nothing is hotlinked from sandyqgroup.com. `frontend/site/scripts/optimize-images.mjs` (runs before `dev`/`build`) converts rasters to WebP at 480 / 768 / 1080 / 1440 / 1920 px (only widths smaller than the original, skipping ones within 15% of it), copies SVGs with their XML comments stripped, copies the menu PDFs, and writes `frontend/site/src/config/images.gen.json` with intrinsic width/height. The `<Picture>` component reads that manifest so every `<img>` has `width`/`height`, a `srcset` and `sizes`; everything except the first screen is `loading="lazy"`.

The "Reference role" column names the image that plays the same role on the reference page, so the substitution is traceable.

## Photos (`frontend/public/images/`)

| File | Size | What it shows | Used on | Role (reference equivalent) |
|---|---|---|---|---|
| `bg-main.webp` | 1440×769 | Felt ornament + basket of kurt | `/` hero | Same file role as reference `bg-main.webp` (hero background). Eager, `fetchpriority="high"` |
| `hero-block-main-3.jpg` | 720×720 | Embroidered cushion on a carved chest, deep red | `/` slogan band background | Reference `bg.webp` (red felt ornament texture) — closest in color and pattern |
| `slide-img-1.jpg` | 1440×961 | Woman in fur hat with a cup, dark red interior | `/restaurant` hero slide 1; author portrait | Reference hero video (first frame is the dining room) |
| `slide-img-2.jpg` | 1440×961 | Hands with baursak over bowls | `/restaurant` hero slide 2 | Reference hero video |
| `slide-img-3.jpg` | 1440×961 | Doorway into a yurt-like room | `/restaurant` hero slide 3 | Reference hero video |
| `about-restaurant-1.jpg` | 960×801 | Two people in traditional dress greeting in a field | `/restaurant` mission, left (under the text) | Reference `brand-sandyq-tea.webp` (people drinking tea, landscape) |
| `about-restaurant-2.jpg` | 1195×1195 | Stack of patterned cushions, interior | `/restaurant` mission, right (tall) | Reference `brand-sandyq-underslider.webp` (interior, tall) |
| `cymbal-1.jpg` | 483×621 | Folded textiles and a woven rug | `/restaurant` "Почему мы начали?" marquee #1 | Reference marquee slides (545×840 portraits) |
| `cymbal-2.jpg` | 450×579 | Two dombras on a rug | `/restaurant` marquee #2 | Same |
| `cymbal-3.jpg` | 483×623 | Beshbarmak in a wooden bowl | `/restaurant` marquee #3; uniqueness card "Посуда" | Same / reference `san-uniq-002` |
| `hero-block-main-2.jpg` | 962×962 | Broth poured into a wooden bowl | `/restaurant` uniqueness "Авторское меню"; phone mockup screen | Reference `san-uniq-001` |
| `hero-block-main-1.jpg` | 974×974 | Dombras on a rug against brick | `/restaurant` uniqueness "Звук степи" | Reference `san-uniq-003` |
| `hero-block-main-3.jpg` | 720×720 | Cushion + carved chest | `/restaurant` uniqueness "Интерьер" | Reference `san-uniq-004` (carpets and chests) |
| `bright-bulbs.png` | 303×544 | Coloured glass lamps (portrait) | `/restaurant` rotated signature card; uniqueness "Свет" | Reference signature video in the rotated card (portrait) |

## Brand and decor (`frontend/public/branding/`, `frontend/public/images/*.svg`)

| File | Used on | Notes |
|---|---|---|
| `branding/sandyq-group-logo.svg` (gold mark, 31×40) | Header logo (28px wide), footer "Sandyq Group" column icon | Reference `sandyq-group.svg` |
| `branding/sandyq-group-header-logo.svg` (stacked "Sandyq Group / since 2020", 65×95) | Footer big logo (140px) | Reference footer logo |
| `branding/sandyq-brand-thumb.webp` (red mark) | "Наши бренды" Sandyq logo; footer "Sandyq" column icon | Reference `sandyq.webp` |
| `branding/tary-brand-thumb.webp` | "Наши бренды" TARY logo; footer "TARY" column icon | Reference `tary.webp` |
| `branding/sandyq-group-favicon-140.webp` | Favicon / apple-touch-icon | |
| `branding/sandyq-kz-sign-author.svg` (handwritten signature, #FBD784) | `/restaurant` author block | Recolored to `rust` via CSS `mask-image` — the original pale yellow is invisible on cream |
| `branding/ornament.svg` (`currentColor` ram-horn motif) | Bullet icon for "Почему мы начали?" and "Технологичность" items, section dividers | Stands in for reference `patterns.svg` / `half-pattern.svg`; colored `rust` |
| `images/decor-carving.svg` (gold carving, 53×102) | `/` values/features side ornaments (52px desktop, 32px mobile) | Reference `carving.svg` |
| `images/decor-pana.svg`, `decor-ozen.svg`, `decor-turanga.svg` | `/` partner logo strip | Reference `pana.svg`, `ozen.svg`, `turanga.svg` |
| `branding/sandyq-kz-logo.svg`, `sandyq-kz-logo-footer.svg`, `sandyq-kz-reserve-logo.svg` (white) | Phone mockup header (white mark on dark screen) | |
| `branding/sandyq-kz-hidden-menu-logo.svg` (black) | Not used | Reserved for a future light menu variant |
| `branding/sandyq-group-favicon.webp` | Not used | 140×186 variant; the square 140 one is the favicon |

## Menus (`frontend/public/menu-pdfs/`)

| File | Used on |
|---|---|
| `menu-almaty.pdf`, `menu-shymkent.pdf`, `menu-turkistan.pdf` | `/restaurant` location cards ("Меню" links), footer "Sandyq → Меню". Copied to `frontend/site/public/menu/` by the asset script |

## Missing vs. reference

| Reference asset | Why missing | What the build does |
|---|---|---|
| Hero video (`/restaurant`) | No video in `/public` | Crossfading, slowly zooming slideshow of `slide-img-1..3` (static under reduced motion) |
| Signature video in rotated card | No video | `bright-bulbs.png` in the rotated card with a slow Ken Burns zoom |
| Ethnographer portrait (`chef.webp`) | No portrait in `/public` | `slide-img-1` cropped to 448×530 via `object-fit: cover`; name/role are placeholders in `site.ts` |
| Phone app screenshot (`sandyq-phone-app.webp`) | No app screenshot | CSS phone mockup (`PhoneMockup`) built from real photos + placeholder menu items |
| Red felt texture for the slogan band (`bg.webp`) | Not in `/public` | `hero-block-main-3.jpg` with a dark overlay |
