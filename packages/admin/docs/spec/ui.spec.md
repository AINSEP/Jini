Spec ID: SPEC-JINI-ADMIN-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:061d214df7d394f4d67032a9ce8581866dbcc93cd1aecabc0b14b388706d3a1f
spec_mode: reverse_spec


# Admin UI contract

## Scope and runtime

All UI is exported from `/react`; shell and entity entries allow narrower imports. React/ReactDOM peers are required for UI consumers. The package ships class-based markup and no authored stylesheet. Host CSS determines layout, breakpoints, hidden labels and visual focus. The HTML editor imports GrapesJS vendor CSS through its UI dependency. Browser DOM, native dialog APIs and portals are used; a DOM-free server render is not promised.

Evidence: `src/react/index.ts`, components, shell, entity modules and colocated tests, inspected without running. The current components use the published hook and agent-helper argument shapes.

## Components and composition

| Component | Required props | Optional props / slots |
|---|---|---|
| ConfirmButton | `label`, `confirmLabel`, `onConfirm(): void` | `destructive`, `pending`, `pendingLabel`, `disabled`, `className`, `ariaLabel`, `useConfirmButton` |
| ConfirmDialog | `open`, `title`, `body: ReactNode`, `confirmLabel`, `onConfirm`, `onCancel` | `cancelLabel`, `tone`, deprecated `destructive`, `pending`, `useDialog`, `agentHandle`, `agentMayConfirm` |
| ConfirmDialogDefaultsProvider | `children` | `cancelLabel` propagated through context |
| DataTable<Row> | `rows`, `columns`, `rowKey(row,index): string` | `empty`, `loading`, `loadingContent`, `footer`, `label`, `caption`, `rowClassName`, `className`, `scrollClassName`, controlled `sort`, `onSortChange` |
| InteractiveHtmlEditor | `html: string`, `onChange(html: string): void` | `className`, `canvasStyling` from the UI HTML-editor contract; protection/describer predicates are fixed by this wrapper |
| RowMenu | `items: RowMenuItem[]`, `triggerLabel` | `useRowMenu`, `agentHandle`, `portalContainer` (default document.body) |
| Sidebar | `activeId` | `base` default `/admin`, `open` false, `railStorageKey`, `railDefaultCollapsed` false, `label` `Admin`, `className`, `id` `admin-sidebar`, `children` |
| Sidebar.MobileHeader | `onClose()` | `title` `Navigation`, `closeLabel` `Close navigation` |
| Sidebar.Nav | `groups: readonly AdminNavGroup[]` | `soonLabel` `Soon`, `renderItem(item,{active,href,collapsed})`, `collapsibleGroups` empty |
| Sidebar.Footer | None | `children`, `className` |
| Sidebar.RailToggle | None | `expandLabel` `Expand sidebar`, `collapseLabel` `Collapse sidebar` |

A table column requires `key`, `cell(row,index)`; optional `header`, `headerLabel`, `headerClassName`, `cellClassName` string/callback, and `sort`. Sort requires `compare(a,b)`, `label(direction | null)` and optional defaultDirection (asc). State is `{column: string, direction: 'asc'|'desc'}`. Table sorting copies rows, keeps stable ties and is parent-controlled. Header activation toggles the active direction; a different column starts its default direction. No pagination, selection, filtering, virtualization or bulk actions are built into DataTable.

LoadingContent replaces the table when loading; empty replaces it only when not loading and rows are empty. Without these slots, table markup still renders. Footer must be valid tfoot children. Cell/row callback indices refer to displayed order after sorting.

A RowMenuItem requires `key`, `label`, `onSelect()`; optional `tone` and deprecated `destructive`. A SidebarContextValue contains `collapsed`, `toggleRail()`, `open`, `base`, `activeId`, `railTooltipProps(label: string): RailTooltipHandlers`. Tooltip handlers provide mouse enter/leave and focus/blur. The sidebar sanitizes icon markup to geometric SVG tags/allowed attributes; invalid SVG produces no icon. Custom renderItem owns its own disabled/active/accessible markup.

### Hook substitution seams

- ConfirmButton invokes its optional hook as `({onConfirm, document}, {pending, disabled})`, expecting `confirming`, nullable buttonRef, handleClick and handleBlur.
- ConfirmDialog invokes `UseConfirmDialog` as `({open, onCancel, document}, {pending})`, expecting the published ConfirmDialogController in api.spec. The default hook uses unique ids, showModal/close with plain open-attribute fallback, cancel focus on open, and trigger restoration on close.
- RowMenuProps.useRowMenu has the inferred internal hook type `({itemCount, window, document}) => controller`. The component supplies `{itemCount, window, document}` and calls selection with `{onSelect}`.

## Shell required wiring and slots

`AdminShellProps` requires `apiBase`, `workspace`, `adminBase`, `defaultPanelId`, `railStorageKey`, `title: ReactNode`, `session: AdminShellSessionPort`, `navigation: AdminShellNavigationPort`, `panels`, `slots`, and all labels. Labels are `navigation`, `openNavigation`, `closeNavigation`, `skipToContent`, `loading`, `sessionError`, `retry`, `expandSidebar`, `collapseSidebar`, `soon`; no product copy is supplied by the shell.

Optional props are `capabilities`, `railDefaultCollapsed`, `collapsibleGroups`, `translateNav({groups})`, `mainRef`, `className`, `theme`, `colorScheme`, `themeEnvironment`, `themePreferenceStore`, `onColorSchemeChange({preference})`.

| Slot | Shape / visibility |
|---|---|
| login, required | `({context, refreshSession}) => ReactNode`; anonymous only |
| sessionError | `({error, retry}) => ReactNode`; otherwise built-in alert/retry button |
| sidebarHeader | ReactNode, authenticated |
| sidebarFooter | `(AdminShellSlotArgs) => ReactNode`, after rail toggle |
| topbar | ReactNode, after title |
| overlays | `(AdminShellSlotArgs) => ReactNode`, authenticated |
| assistant | `{content: ReactNode, label: string, open: boolean}`; authenticated aside, stays mounted with hidden when closed |

Render args carry context, session and route; slot args also carry logout, refreshSession and optional appearance. The shell passes these args to the resolved panel renderer. The host owns login implementation, assistant controls/content, overlays, labels and actual API adapters. No logout button is built in; place one in a slot.

Shell markup exposes a skip link to a unique main id, `main` with tabIndex -1 and optional ref, `data-agent-page` from the model, navigation label, mobile toggle aria-expanded/aria-controls, labeled close backdrop and assistant aside. Drawer closes on path changes/Escape. The shell does not insert Sidebar.MobileHeader or implement a drawer focus trap/automatic trigger restoration. Host styles must make the skip link and responsive controls usable.

## Entity screens

Each screen requires `registry`, `routes`, `translate({key})`; list additionally requires entityName/limitParam, detail entityName/id, edit entityName/id (null for create). `createEntityPanel` wires them as the existing manifest contribution with default translated Data nav and agentReachable false. It installs no shell/router/store.

- EntityIndex shows names, machine keys and field counts; entity links come from the routes port.
- EntityList uses declared fields in declaration order, links title field to detail and offers New, Previous and Next. It preserves server order without sort controls, exposes loading/error/empty states and a relation truncation notice. No filter UI is supplied even for queryable fields.
- EntityDetail is read-only, showing a definition list and Edit link; missing row has status text. Missing relation resolution shows stored id with warning and explanatory title, rather than a blank cell.
- EntityEdit renders labeled controls with unique ids: text input, integer/real number, required boolean checkbox, optional boolean three-way Select, relation Select, JSON textarea, UTC datetime-local with step 0.001. Blank optional relation/boolean values mean undefined. An unresolved selected relation is retained as an explicit option.
- Required markers, missing/invalid value text, invalid JSON alert, loading/error status and pending button labels are translated through the consumer. Native inputs/textarea get aria-invalid; relation and optional-boolean Select calls do not forward that flag. No error-description ids or automatic focus to invalid fields are supplied.
- Save is disabled for missing required values, kind mismatch, invalid JSON or pending mutation. Existing-row Delete is present only when remove exists and invokes it on a single click; it does not use ConfirmButton/ConfirmDialog. Host authorization and destructive-action policy remain adapter responsibilities.
- Translation keys are stable source phrases; placeholders such as `{entity}`, `{limit}`, `{targets}` are replaced after translation. Descriptor labels/field labels are passed through translation. Returned adapter data is rendered as text; JSON display uses JSON.stringify and assumes renderable values.

## Theming variables and stylesheet ownership

Theme types are supplied by `@jini-ai/ui/theme`: theme name, body/heading font stacks, optional mono/load stylesheet URLs, complete light and dark palettes, optional radius/density. A theme prop requires an injected `{target, document, matchMedia}` environment. Use the document root when body portals need the same variables.

The theme effect writes `data-admin-theme` and both sets of `--jini-theme-{light|dark}-{primary|primary-ink|bg|surface|text|muted|border|danger|success|warning}`. It writes `--jini-font-body`, `--jini-font-heading`, `--jini-font-mono`, `--jini-radius`, `--jini-density`; appearance writes `data-color-scheme='light'|'dark'`. Host CSS maps the active palette to public variables `--jini-{primary|primary-ink|bg|surface|text|muted|border|danger|success|warning}`. Applying the theme alone does not load a component stylesheet.

The UI theme dependency validates input, restores previous CSS/attribute values on cleanup, deduplicates/reuses font stylesheet links and removes only owned links after their final lease. Optional mono defaults to ui-monospace, monospace, radius to 8px and density to 1. A controlled preference is light/dark/system; system follows matchMedia. Theme persistence is consumer-defined per user/workspace, with no built-in theme picker.

Host selectors include `.cms-nav`, `.is-open`, `.is-rail`, `.cms-section`, `.cms-item`, `.cms-foot`, `.cms-tooltip-portal`, `.row-menu-*`, `.confirm-dialog`, `.confirm-dialog-*`, `.btn-danger`, `.btn-warning`, `.btn-secondary`, `.visually-hidden`, `.table-scroll`, `.list-table`, `.sortable-column-header`, `.admin-layout`, `.admin-main-col`, `.admin-topbar`, `.admin-content`, `.sidebar-backdrop`, `.admin-assistant-pane`, `.skip-link`, `.page`, `.interactive-html-editor`. Visually-hidden content must remain available to assistive technology without consuming layout.

## Interaction and accessibility limits

ConfirmButton requires two activations, announces arming through a polite live region, and disarms on blur/Escape/outside click. Pending defaults to an ellipsis and blocks activation. The live-region sentence is built-in English; labels are consumer supplied. There is no arming timer.

ConfirmDialog uses aria-labelledby and initially focuses Cancel. Both actions are ordinary buttons; pending disables actions and ignores Escape/backdrop cancellation. Agent handles are opt-in; agentMayConfirm defaults true only when a base handle exists. Tone labels describe irreversible danger or reversible access changes; they are caller assertions, not verified backend capabilities.

DataTable uses table/caption/column scope semantics. Sortable columns expose aria-sort and named buttons; decorative carets are hidden. Provide labels for icon-only headers/actions. Sidebar rows expose aria-current for active links, aria-disabled for inert soon rows, and real links for soonPreviewable rows. Collapsible headings use buttons/aria-controls/hidden panels; rail tooltip portals are presentation-only.

RowMenu hook implements menu roles, ArrowUp/Down wrapping, Home/End, Escape focus return and Tab dismissal. All item markup has tabIndex -1; hook focus is programmatic. Position is fixed, measured before display, with 8px viewport margin and 4px trigger gap, repositioned on captured scroll/resize. No zero-item/oversized-popup usability guarantee is supplied.

The HTML editor recognizes protected embed attributes data-embed-type/data-widget-embed/data-form-embed and describes valid object data-embed-config. It delegates editing, canvas styling and lifetime to the UI component: mount-once HTML input, HTML onChange output, no persistence. Protected block content is atomic but the block can still be moved/copied/deleted. This wrapper does not forward the UI editor's imperative flush ref. Canvas support is not a guarantee of complete editor accessibility or arbitrary HTML sanitization.

## Host interaction responsibilities

Sidebar, RowMenu and ConfirmDialog supply the current object-shaped hook and agent-helper arguments. Host styles, session/navigation adapters and optional agent handles remain required for their respective features. No browser checks were executed for this source-derived specification.
