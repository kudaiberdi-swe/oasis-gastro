Depends on: none
Complexity: routine
Reason: one-line effect dependency fix in a client-side sidebar hook, no backend, no state machine.

## 1. Frontend

- [x] 1.1 (frontend) In `frontend/app/office/data/use-office-navigation.ts:27-29`, run the "open the active group" effect on `activeGroupId` only, with a functional `setExpanded` that adds the id if missing; update the doc comment at :23.

## 2. Tests (vitest + Testing Library, `tests/pos/office-navigation.test.tsx`)

- [x] 2.1 (frontend) Hook/component test `[fix-office-sidebar-collapse] close the group of the current page`: render `Sidebar` with `activeItemId="stock"`, click «Товары и склады», assert `aria-expanded="false"`, the «Остатки» link is gone and the header still has the active styling; repeat for «Главная» with `activeItemId="dashboard"`.
- [x] 2.2 (frontend) `[fix-office-sidebar-collapse] open a closed group`: click «Финансы», assert `aria-expanded="true"` and «Проводки» is visible.
- [x] 2.3 (frontend) `[fix-office-sidebar-collapse] close a group that does not hold the current page`.
- [x] 2.4 (frontend) `[fix-office-sidebar-collapse] entering a page opens its group`, `[fix-office-sidebar-collapse] closed group stays closed on the same page` and `[fix-office-sidebar-collapse] page in the same group keeps the group closed` and `[fix-office-sidebar-collapse] page in another group opens that group` (rerender with a new `activeItemId`).
- [x] 2.5 (frontend) `[fix-office-sidebar-collapse] Enter toggles a group header` and `[fix-office-sidebar-collapse] Space toggles a group header` (focus the header button, press the key, check `aria-expanded`).
- [x] 2.6 (frontend) `[fix-office-sidebar-collapse] open groups are remembered in the browser` and `[fix-office-sidebar-collapse] reload reopens the group of the current page` (unmount/remount with the stubbed localStorage).

## 3. E2E (Playwright, `e2e/regressions/office-sidebar-collapse.spec.ts`)

- [x] 3.1 (frontend) Office surface, desktop viewport >= 1280px: open `/office/stock`, click «Товары и склады» → `aria-expanded="false"` and «Остатки» hidden; click again → open. Same for «Главная» on `/office/dashboard`. Keyboard: focus «Главная», press Enter, then Space. Use the existing `e2e/fixtures.ts`.

## 4. Checks

- [ ] 4.1 (frontend) `npm run typecheck`, `npm test`, `npx playwright test e2e/regressions/office-sidebar-collapse.spec.ts` pass.
