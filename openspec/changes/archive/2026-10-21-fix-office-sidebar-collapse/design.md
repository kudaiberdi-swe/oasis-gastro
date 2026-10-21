## Context

Office sidebar: `frontend/app/office/components/sidebar.tsx` renders 12 groups from
`frontend/app/office/model/navigation.ts`. In the wide sidebar each group header is a `<button aria-expanded>` that
calls `toggle(group.id)` (sidebar.tsx:160-164); the list renders when `open = searching || expanded.includes(group.id)`
(sidebar.tsx:117). The open set comes from `useExpandedGroups(activeGroupId)`
(`frontend/app/office/data/use-office-navigation.ts:24-38`); `activeGroupId` is the group holding `activeItemId`
(sidebar.tsx:70). The open set is stored per browser in localStorage key `sandyq-office-nav`
(use-office-navigation.ts:3, :25, :31).

## Root cause

`frontend/app/office/data/use-office-navigation.ts:27-29`:

```ts
useEffect(() => {
  if (activeGroupId && !expanded.includes(activeGroupId)) setExpanded((current) => [...current, activeGroupId])
}, [activeGroupId, expanded])
```

The effect depends on `expanded`. A click on the active group's header removes it from `expanded` (`toggle`,
:33-35); the changed `expanded` re-runs the effect, which sees the active group missing and adds it back. Net
effect: the group holding the current page can never close. The doc comment at :23 ("the active group is always
open") states the intent that turned out to be wrong for users.

Affected groups: any of the 12 groups while the current page is in it, in the wide sidebar (desktop and the mobile
drawer). «Главная» is the one hit most, because «Стартовая страница» is the default office page; «Товары и склады»
is hit on every stock page. Groups not holding the current page open and close normally. The 72px sidebar uses
Radix popovers per group and is not affected. The redesign (d14b810, 432dc41) did not cause it: the hook is
unchanged since ef9592a.

## Decision

Run the "open the active group" effect only when the active group changes, not when `expanded` changes:

```ts
useEffect(() => {
  if (activeGroupId) setExpanded((current) => (current.includes(activeGroupId) ? current : [...current, activeGroupId]))
}, [activeGroupId])
```

Resulting behavior:
- Mount (first load, reload, mobile drawer opened): the active group opens, remembered groups stay open.
- Navigation to a page in a different group: that group opens.
- Navigation to another page in the same group: `activeGroupId` is unchanged, the user's choice (closed) stays.
- Header click / Enter / Space: `toggle` works for every group. `aria-expanded` already mirrors `open`.
- The open set is still written to localStorage `sandyq-office-nav` on every change (per browser, survives
  navigation and reload; on reload the active group is reopened by the mount rule above).

Update the comment at :23 to "the active group opens when the user enters it".

## Alternatives considered

- Key the effect on `activeItemId` (reopen on every page change, even inside the same group): needs a new hook
  argument and reopens a group the user just closed while they keep working in it. Rejected.
- Drop auto-open entirely: the user would land on a page with its group closed and lose the "where am I" cue in
  the list. Rejected; the header still shows the active group, but auto-open on entry is the existing behavior.
- Keep a separate "user closed" set: more state for the same result. Rejected.

## Convex functions

None. This change calls no backend functions.

| Function | Kind | Args | Returns | Roles | Notes |
|----------|------|------|---------|-------|-------|
| none | - | - | - | - | front-end only |

## Data

None. Existing localStorage key `sandyq-office-nav` (JSON array of group ids) keeps its format.

## Screens

- Office, all roles with office access: the wide sidebar (`Sidebar`, desktop >= 1280px and the mobile drawer < 1024px).

## Risks

- Minimal: one dependency list. The existing test "remembers opened groups and always opens the active one"
  (tests/pos/office-navigation.test.tsx) stays valid (it checks open-on-mount and persistence).

## Open questions

None.
