## ADDED Requirements

### Requirement: Group headers toggle open and closed

In the wide office sidebar («Навигация офиса»), a click on a group header SHALL open the group when it is closed
and close it when it is open, for every group, including the group that holds the current page. Closing the group
of the current page SHALL keep the header marked as the group of the current page.

#### Scenario: close the group of the current page
- **WHEN** a user on the page «Остатки» (group «Товары и склады», open) clicks the header «Товары и склады»
- **THEN** the header has `aria-expanded="false"` and the link «Остатки» is no longer shown
- **AND** the header «Товары и склады» keeps the active-group styling (accent icon, bright label)
- **AND** the same holds for «Главная» on the page «Стартовая страница»

#### Scenario: open a closed group
- **WHEN** a user clicks the header «Финансы» of a closed group
- **THEN** the header has `aria-expanded="true"` and the link «Проводки» is shown

#### Scenario: close a group that does not hold the current page
- **WHEN** a user on «Стартовая страница» opens «Финансы» and then clicks «Финансы» again
- **THEN** the header «Финансы» has `aria-expanded="false"` and its links are not shown

### Requirement: Entering a page opens its group once

The group that holds the current page SHALL open when the user enters that group: on first load or reload of an
office page, when the mobile menu opens, and on navigation from a page in another group. After that the open or
closed state of that group SHALL change only by the user's toggle while the user stays in the same group.

#### Scenario: entering a page opens its group
- **WHEN** a user with no remembered open groups opens the office page «Остатки»
- **THEN** the group «Товары и склады» is open and the link «Остатки» is marked as the current page (`aria-current="page"`)

#### Scenario: closed group stays closed on the same page
- **WHEN** a user on «Остатки» closes «Товары и склады» and waits without navigating
- **THEN** the group stays closed

#### Scenario: page in the same group keeps the group closed
- **WHEN** a user closes «Товары и склады» while on «Остатки» and then reaches «Приходные накладные» without the sidebar (for example a link on the page)
- **THEN** the group «Товары и склады» stays closed

#### Scenario: page in another group opens that group
- **WHEN** a user on «Стартовая страница» with «Товары и склады» closed navigates to «Остатки»
- **THEN** the group «Товары и склады» opens

### Requirement: Keyboard and accessible state

Each group header in the wide sidebar SHALL be a button operable from the keyboard, and its `aria-expanded`
attribute SHALL equal the group's shown state at all times.

#### Scenario: Enter toggles a group header
- **WHEN** a keyboard user focuses the header «Главная» (open, holds the current page) and presses Enter
- **THEN** the group closes and `aria-expanded` becomes `"false"`
- **AND** pressing Enter again opens it and `aria-expanded` becomes `"true"`

#### Scenario: Space toggles a group header
- **WHEN** a keyboard user focuses the header «Товары и склады» and presses Space
- **THEN** the group toggles and `aria-expanded` matches whether its links are shown

### Requirement: Open groups are remembered per browser

The set of open groups SHALL be stored in the browser (localStorage) and SHALL survive in-app navigation and page
reload. On reload the group of the current page SHALL be open in addition to the remembered groups. If browser
storage is blocked, the sidebar SHALL still open and close groups for the current visit.

#### Scenario: open groups are remembered in the browser
- **WHEN** a user opens «Финансы» and closes «Главная» while on «Остатки», then navigates to «Номенклатура»
- **THEN** «Финансы» is open, «Главная» is closed and «Товары и склады» keeps its current state

#### Scenario: reload reopens the group of the current page
- **WHEN** a user on «Остатки» closes «Товары и склады», opens «Финансы» and reloads the page
- **THEN** «Финансы» is open and «Товары и склады» is open again
