Status: draft

## Why

Owner bug report: «кнопка Товары и склады после открытия не закрывается, и то же самое кнопка Главная не закрывается».
In the wide (264px) office sidebar, the header of the group that holds the current page cannot be closed: a click
flips `aria-expanded` to false for one render, then the group opens again. «Главная» is hit on almost every visit
because `/office` opens «Стартовая страница» (group «Главная»); «Товары и склады» is hit on any stock page
(«Остатки», «Приходные накладные», ...). The bug is older than the redesign (commit d14b810): it was introduced
with the office shell in ef9592a (W0-UI-01). No SoW function number; this is a defect fix in the office shell.

## What Changes

- The group holding the current page opens when the user enters that group (first load, reload, navigation from
  another group), and the user can close it afterwards with a click or Enter/Space on the group header.
- Closing a group never hides which group holds the current page: the header keeps its active styling.
- No other behavior changes: open groups are still remembered per browser (localStorage), search still shows all
  matching groups open, the 72px sidebar still uses flyouts.

## Capabilities

### New Capabilities

- `office-navigation`: open/close behavior of the office sidebar groups (first spec for this capability).

### Modified Capabilities

None.

## Impact

- Code: `frontend/app/office/data/use-office-navigation.ts` (`useExpandedGroups`). `sidebar.tsx` and
  `office-shell.tsx` need no change.
- Tests: `tests/pos/office-navigation.test.tsx` (hook + component), one new Playwright spec under `e2e/regressions/`.
- No backend, schema, roles or Convex function changes. No contract change.

## Out of scope

- Search mode (group headers are disabled while the search field has text) and the 72px flyout sidebar.
- New features: "collapse all", accordion (one group open at a time), per-user server-side storage.
- Visual restyling of the sidebar.
