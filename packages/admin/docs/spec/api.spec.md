Spec ID: SPEC-JINI-ADMIN-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:39333d928bc1ff9ece83ec4ab054a0da3135d03f5e6e2e194509c0f4762155df
spec_mode: reverse_spec


# Admin consumer API

## Purpose and import registry

This contract describes the current source surface. Source and test files were read as evidence; tests were not executed. APIs that already split arguments use `(required, optional = {})` below. A function with only one object currently has no second argument. Legacy positional signatures are recorded explicitly; the future convention is not represented as implemented behavior. React components receive one props object through JSX.

| Import | Runtime | Public surface |
|---|---|---|
| `@jini-ai/admin` | Universal | Same exports as `/core` |
| `@jini-ai/admin/core` | Universal | Manifest, routing, permission, transport, entity registry and all port/data types |
| `@jini-ai/admin/browser` | Browser, no React | Navigation helpers and shell navigation factory |
| `@jini-ai/admin/browser/shell-navigation` | Browser, no React | `createAdminShellNavigation` only |
| `@jini-ai/admin/react` | Browser, React | Primitives, hooks, all `/react/shell` and `/react/entities` exports |
| `@jini-ai/admin/react/shell` | Browser, React | Shell, model, session and appearance hooks/types |
| `@jini-ai/admin/react/entities` | Browser, React | Entity screens, panel/routes factories and draft/relation helpers/types |

React/ReactDOM peer ranges are `^18.3.0 || ^19.0.0`; the universal and browser entries do not require them. The package declares `sideEffects: false`. There is no exported `/server`, CSS subpath, or shipped `createIdentityRoutes`/other domain route-group factory. The editor brings vendor CSS through `@jini-ai/ui/html-editor`.

## Core functions

All names in this section are exported from both the root and `/core`. No injected dependency is required for pure rules.

| Current signature | Return | Consumer responsibility |
|---|---|---|
| `resolvePanels<T>({ panels: readonly AdminPanel<T>[] }, { capabilities?: readonly string[], permissions?: readonly string[] } = {})` | `readonly AdminPanel<T>[]` | Supply actual wired capabilities and effective grants |
| `buildNav<T>({ panels: readonly AdminPanel<T>[] })` | `readonly AdminNavGroup[]` | Pass the resolved set |
| `panelHref({ panelId: string })` | `string` route path | Apply the mount base separately |
| `buildAgentPageMap<T>({ panels: readonly AdminPanel<T>[] }, { defaultReachable?: boolean } = {})` | `Readonly<Record<string,string>>` | Pass the resolved set; review explicit route destinations |
| `resolveAgentPageId<T>({ panels: readonly AdminPanel<T>[], panelId: string \| null, view: string \| null })` | `string \| null` | Use matched panel and view |
| `stripTrailingSlash({ pathname: string })` | `string` | Removes one final slash, except from `/` |
| `adminHref({ routePath: string }, { base?: string } = {})` | `string` URL path | Base defaults to `DEFAULT_ADMIN_BASE = '/admin'` |
| `currentRoutePath({ pathname: string }, { base?: string } = {})` | `string` | Input is pathname, without query/hash |
| `matchRoute<T>({ routePath: string, panels: readonly AdminPanel<T>[] })` | `AdminRoute` | Pass resolved panels and path with optional query |
| `hasPermission({ permissions: readonly string[], permission: string })` | `boolean` | UI affordances; authorize independently in backend |
| `createHttpTransport({ baseUrl: string, fetch: AdminFetch }, { headers?: Readonly<Record<string,string>>, credentials?: RequestCredentials } = {})` | `AdminTransport` | Supply object-argument fetch; base has no trailing slash |
| `createAdminClient<G>({ transport: AdminTransport, groups: G })` | `AdminClient<G>` | Supply every factory; `transport` is a reserved group name |
| `new AdminApiError({ message: string, status: number }, { code?: string, body?: Record<string,unknown> } = {})` | `AdminApiError` | Codes and payload vocabulary belong to the backend |
| `describeApiError({ e: unknown, fallback: string })` | `string` | Supply contextual/localized fallback |

`AdminFetch = ({ url: string }, init?: RequestInit) => Promise<Response>`.
`AdminTransport.request<T>({ path: string }, init: RequestInit = {}): Promise<T>`; `path` starts with `/`. The transport forwards `body` as supplied; stringify JSON in the route factory. `AdminRouteGroupFactory<P> = ({ transport: AdminTransport }) => P`. `AdminClient<G>` has each factory's return type plus its shared `.transport`.

`AdminPanel<T>` requires `{ id: string, render: T }`, with optional `nav`, `routes`, `requires`, `permissions`, `agentReachable`. `AdminNavEntry` has required `label` and optional `icon`, `group`, `order`, `soon`, `soonPreviewable`. `AdminRoutePattern` requires `pattern`, `view` and optionally `agentPageId`. `AdminRoute` always contains `{ panelId: string | null, view: string | null, params: Readonly<Record<string,string>>, query: URLSearchParams }`. Nav groups contain optional `label` and `items`; each item adds `id` and route-path `href` to the nav entry.

### Entity registry: current positional exceptions

These helpers have not adopted the two-object convention. Use the signatures below, not object wrappers around their first arguments.

```ts
createAdminEntityRegistry<P extends Record<string, AdminEntityPort<AdminEntityDescriptor>>>(
  ports: P,
): AdminEntityRegistry<P>;
eraseEntityPort<D extends AdminEntityDescriptor>(
  port: AdminEntityPort<D>, options: AdminEntityErasureOptions = {},
): AdminErasedEntityPort;
listErasedEntityPorts(
  registry: Readonly<Record<string, AdminEntityPort<AdminEntityDescriptor>>>,
  options: AdminEntityErasureOptions = {},
): readonly AdminErasedEntityPort[];
getErasedEntityPort(
  registry: Readonly<Record<string, AdminEntityPort<AdminEntityDescriptor>>>,
  name: string, options: AdminEntityErasureOptions = {},
): AdminErasedEntityPort | null;
describeAdminEntityFieldMismatch(field: AdminEntityField, value: unknown): string | null;
```

`AdminEntityErasureOptions` contains only optional `onViolation(violation: AdminEntityRowViolation): void`, a positional callback. A violation has `entity`, `operation: 'list'|'get'|'create'|'update'`, `rowId`, `field`, `problem: 'missing-required'|'wrong-type'|'undeclared-field'`, `detail`. It is diagnostic data, not a thrown error class.

An `AdminEntityDescriptor` requires `name`, `labelSingular`, `labelPlural`, `titleField`, `fields`. Fields require `name`, `kind`, and optionally `label`, `required`, `queryable`. Kinds are closed: `text`, `integer`, `real`, `boolean`, `datetime`, `relation`, `json`. Relation fields also require `target`; JSON fields permit only `queryable?: false`. Rows have implicit string `id`; declaring `as const satisfies AdminEntityDescriptor` preserves field-name inference. Required fields are non-optional; string kinds yield strings, number kinds numbers, boolean boolean, JSON unknown. `AdminEntityRowData` is `{ id: string } & Record<string,unknown>`.

`AdminEntityListQuery` has optional `limit`, opaque `cursor`, `filter: readonly AdminEntityFilter[]`, and `sort: {field: string, direction: 'asc'|'desc'}`. Filters require `field`, `op: 'eq'|'neq'|'lt'|'lte'|'gt'|'gte'`, and string/number/boolean `value`. `AdminEntityPage<R>` requires `items: readonly R[]`, `nextCursor: string | null`, optionally `total: number`. Adapter ordering precedes pagination. Queryable flags and referential integrity are adapter obligations.

### Minimal universal wiring

```ts
import { createHttpTransport, createAdminClient, resolvePanels, matchRoute } from '@jini-ai/admin';
const transport = createHttpTransport({
  baseUrl: '/operator-api', fetch: ({ url }, init) => fetch(url, init),
}, { credentials: 'same-origin' });
const client = createAdminClient({ transport, groups: {
  records: ({ transport }) => ({
    list: (_required: Record<string, never>) => transport.request({ path: '/records' }),
  }),
} });
await client.records.list({});
const panels = resolvePanels({ panels: [{ id: 'records', render: 'record-view' }] });
const route = matchRoute({ panels, routePath: '/records' });
```

The same example can import from `/core`. For entities, supply backend-scoped ports to `createAdminEntityRegistry(ports)`; adapt `getErasedEntityPort(registry: Readonly<Record<string, AdminEntityPort<AdminEntityDescriptor>>>, name: string, options: AdminEntityErasureOptions = {})` and `listErasedEntityPorts(registry: Readonly<Record<string, AdminEntityPort<AdminEntityDescriptor>>>, options: AdminEntityErasureOptions = {})` to the screen registry below.

## Browser functions

| Current signature | Return |
|---|---|
| `readRoutePath({ window: Pick<Window,'location'> }, { base?: string } = {})` | `string` pathname-only route |
| `navigate({ routePath: string, window: Pick<Window,'location'|'history'|'dispatchEvent'> }, { replace?: boolean, base?: string } = {})` | `void` |
| `installInternalLinkInterceptor({ window: Pick<Window,'location'|'history'|'dispatchEvent'>, document: Pick<Document,'addEventListener'|'removeEventListener'> }, { base?: string } = {})` | `() => void` teardown |
| `subscribeToRoute({ window: Pick<Window,'addEventListener'|'removeEventListener'>, onChange: () => void })` | `() => void` teardown |
| `createAdminShellNavigation({ location: Pick<Location,'pathname'|'search'>, window: Pick<Window,'location'|'history'|'dispatchEvent'|'addEventListener'|'removeEventListener'>, document: Pick<Document,'addEventListener'|'removeEventListener'> })` | `AdminShellNavigationPort` |

The first four and `NAVIGATION_EVENT = 'jini:admin-navigate'` are on `/browser`. The factory is on `/browser` and `/browser/shell-navigation`; pass a live location object matching the supplied window.

```ts
import { subscribeToRoute, navigate } from '@jini-ai/admin/browser';
import { createAdminShellNavigation } from '@jini-ai/admin/browser/shell-navigation';
const navigation = createAdminShellNavigation({ location: window.location, window, document });
const unsubscribe = subscribeToRoute({ window, onChange: () => console.log(navigation.readRoute({ base: '/console' })) });
navigate({ window, routePath: '/records?tab=history' }, { base: '/console' });
unsubscribe();
```

## React primitives and hooks

Component signatures are `Component(props: PublishedProps): ReactElement`, unless noted. All props, slots, accessibility and styling contracts are in [ui.spec.md](ui.spec.md). These are browser components; ambient `document`, `DOMParser` and portal targets remain in component internals.

| Export | Current signature / return | Required dependencies |
|---|---|---|
| `ConfirmButton` | `ConfirmButton(ConfirmButtonProps)` | `label`, `confirmLabel`, `onConfirm`; optional hook substitution |
| `ConfirmDialog` | `ConfirmDialog(ConfirmDialogProps)` | `open`, `title`, `body`, `confirmLabel`, `onConfirm`, `onCancel`; optional `UseConfirmDialog` |
| `ConfirmDialogDefaultsProvider` | `(ConfirmDialogDefaultsProviderProps)` | `children`; optional `cancelLabel` |
| `DataTable<Row>` | `(DataTableProps<Row>)` | `rows`, `columns`, `rowKey` callbacks |
| `InteractiveHtmlEditor` | `(InteractiveHtmlEditorProps)` | `html`, `onChange(html)`; optional `className`, `canvasStyling` |
| `RowMenu` | `(RowMenuProps)` | `items`, `triggerLabel`; optional hook substitution and `portalContainer` |
| `Sidebar` | `(SidebarProps)` plus `.MobileHeader`, `.Nav`, `.Footer`, `.RailToggle` | `activeId`; compound context and children |
| `useSidebar` | `(): SidebarContextValue` | Must run inside Sidebar |
| `toneClassName` | `({ tone: ConfirmTone }): string \| undefined` | None |
| `resolveTone` | `({}, { tone?: ConfirmTone, destructive?: boolean } = {}): ConfirmTone` | None |
| `useSidebarRail` | `({ storage: Pick<Storage,'getItem'|'setItem'>, events: Pick<Window,'addEventListener'|'removeEventListener'> }, { storageKey?: string, defaultCollapsed?: boolean } = {}): SidebarRail` | Inject storage/events |
| `useNavSections` | Same required ports; `({ storage, events }, { storageKey?: string } = {}): NavSections` | Inject storage/events |

`ConfirmTone = 'default'|'warning'|'danger'`. `SidebarRail` returns `{ collapsed: boolean, toggle(): void }`. `NavSections` returns `{ isOpen({groupLabel: string}): boolean, toggle({groupLabel: string}): void }`. Public constants are `DEFAULT_SIDEBAR_RAIL_STORAGE_KEY = 'jini-admin-sidebar-rail-collapsed'` and `DEFAULT_NAV_SECTIONS_STORAGE_KEY = 'jini-admin-nav-sections'`. `NavSectionState = Readonly<Record<string,boolean>>`.

`UseConfirmDialog = ({ open: boolean, onCancel: () => void, document: Pick<Document,'activeElement'> }, { pending?: boolean }?) => ConfirmDialogController`. The controller supplies `titleId`, nullable `dialogRef`/`cancelRef`, `handleNativeCancel(event)` and `handleBackdropClick(event)`. The default hook itself is not a barrel export. `ConfirmButtonProps.useConfirmButton` and `RowMenuProps.useRowMenu` expose inferred hook types; see [ui.spec.md](ui.spec.md) for their call shapes and current mismatches.

```tsx
import { ConfirmButton, DataTable, useSidebarRail } from '@jini-ai/admin/react';
function Records() {
  const rail = useSidebarRail({ storage: localStorage, events: window }, { storageKey: 'example-rail' });
  return <><button onClick={rail.toggle}>{rail.collapsed ? 'Expand' : 'Collapse'}</button>
    <DataTable rows={[{ id: 'r1', title: 'Record' }]} rowKey={(r) => r.id}
      columns={[{ key: 'title', header: 'Title', cell: (r) => r.title }]} />
    <ConfirmButton label="Remove" confirmLabel="Confirm removal" onConfirm={() => { /* host action */ }} />
  </>;
}
```

## Shell entry

These names also re-export through `/react`.

```ts
AdminShell(props: AdminShellProps): ReactNode;
resolveAdminShellModel(args: { readonly panels: readonly AdminShellPanel[]; readonly session: AdminShellSession; readonly routePath: string; readonly defaultPanelId: string }, options: { readonly capabilities?: readonly string[] } = {}): AdminShellModel;
useAdminShellSession(args: Owner): AdminShellSessionController;
useAdminTheme({ userId, workspace }: { readonly userId: string | null; readonly workspace: Readonly<Record<string, string>>; }, { theme, colorScheme, environment, preferenceStore, onColorSchemeChange }: { readonly theme?: AdminTheme; readonly colorScheme?: ColorSchemePreference; readonly environment?: AdminThemeEnvironment; readonly preferenceStore?: AdminThemePreferenceStorePort; readonly onColorSchemeChange?: (args: { readonly preference: ColorSchemePreference }) => void; } = {}): AdminShellAppearance | undefined;
```

`AdminShellModel` returns `panels`, optional resolved `panel`, clean `route`, `nav`, and nullable `agentPageId`. `AdminShellPanel = AdminPanel<(args: AdminShellRenderArgs) => ReactNode>`. Render args contain `context`, authenticated `session`, `route`; slot args additionally contain optional `appearance`, `logout(): Promise<void>`, `refreshSession(): Promise<void>`.

`AdminShellContext = { apiBase: string, workspace: Readonly<Record<string,string>> }`. The package forwards this scope; it does not construct a backend client or choose a tenant. `AdminShellSession` contains `user: AdminAuthUser`, optional `effectivePermissions`. The session controller returns `state`, `refresh(): Promise<void>`, `logout(): Promise<void>`; state variants are specified in [state.spec.md](state.spec.md).

Consumer theme ports: `AdminThemeEnvironment = { target: AdminThemeTarget, document: AdminThemeDocument, matchMedia: MatchMediaPort }` (types from `@jini-ai/ui/theme`). `AdminThemePreferenceStorePort.read({userId, workspace}): ColorSchemePreference | null` and `.write({userId, workspace, preference}): void`. `AdminShellAppearance = { preference, resolved: 'light'|'dark', setPreference({preference}): void }`.

```ts
import { resolveAdminShellModel } from '@jini-ai/admin/react/shell';
const model = resolveAdminShellModel({
  panels: [{ id: 'home', render: () => 'Home' }],
  session: { user: { id: 'u1', username: 'operator' } },
  routePath: '/', defaultPanelId: 'home',
});
```

To mount `AdminShell`, supply the full props and slots listed in [ui.spec.md](ui.spec.md). Sidebar, RowMenu and shell hooks use their current object-shaped dependencies; mounting and backend authentication remain host responsibilities.

## Entity screen entry

These names also re-export through `/react`. The four screens return React elements.

```ts
EntityIndex(props: EntityScreenDependencies);
EntityList(props: EntityListProps);
EntityDetail(props: EntityDetailProps);
EntityEdit(props: EntityEditProps);
createEntityRoutes({ adminBase, panelId, navigate }: EntityRouteDependencies): EntityRoutesPort;
createEntityPanel(args: EntityRouteDependencies & { readonly registry: EntityRegistryPort; readonly translate: EntityTranslate }, options: { readonly nav?: AdminNavEntry; readonly agentReachable?: boolean; readonly requires?: readonly string[]; readonly permissions?: readonly string[] } = {}): AdminShellPanel;
resolveEntityPageSize({ raw }: { readonly raw: string | null }): number;
relationFieldsOf({ descriptor }: { readonly descriptor: AdminEntityDescriptor }): readonly AdminEntityRelationField[];
loadRelationIndex({ descriptor, registry }: { readonly descriptor: AdminEntityDescriptor; readonly registry: EntityRegistryPort }): Promise<RelationIndex>;
readTitle({ row, titleField }: { readonly row: AdminEntityRowData; readonly titleField: string }): string | null;
emptyDraft({ descriptor }: { readonly descriptor: AdminEntityDescriptor }): Record<string,unknown>;
draftForRow({ descriptor, row }: { readonly descriptor: AdminEntityDescriptor; readonly row: AdminEntityRowData | null }): Record<string,unknown>;
missingRequiredFields({ descriptor, draft }: { readonly descriptor: AdminEntityDescriptor; readonly draft: Record<string, unknown> }): readonly string[];
invalidDraftFields({ descriptor, draft }: { readonly descriptor: AdminEntityDescriptor; readonly draft: Record<string, unknown> }): readonly DraftFieldProblem[];
toDatetimeLocalValue({ value }: { readonly value: unknown }): string;
fromDatetimeLocalValue({ raw }: { readonly raw: string }): string | undefined;
```

`EntityScreenDependencies = { registry, translate, routes }`. List props add `entityName` and required `limitParam: string | null`; detail adds `entityName`, `id: string`; edit adds `entityName`, `id: string | null` (null creates). `EntityTranslate = ({ key: string }) => string`. `EntityRegistryPort.listEntities({}): readonly AdminErasedEntityPort[]` and `.getEntity({ name: string }): AdminErasedEntityPort | null` are consumer supplied. Replace registry identity when registrations change.

`EntityRoutesPort.href(target): string`, `.navigate(target): void`; `EntityRouteTarget` has optional `entity`, `id`, `view: 'list'|'detail'|'edit'|'create'`. `EntityRouteDependencies` is the factory's required object above. `RelationIndex = Readonly<Record<string,RelationOptions>>`; options contain `options: readonly { id: string, title: string }[]`, `titles: Readonly<Record<string,string>>`, `truncated: boolean`. `DraftFieldProblem = {field: string, detail: string}`. `RELATION_OPTION_LIMIT = 100` is exported.

```tsx
import { getErasedEntityPort, listErasedEntityPorts } from '@jini-ai/admin/core';
import { EntityIndex, createEntityRoutes, createEntityPanel } from '@jini-ai/admin/react/entities';
// entityRegistry and navigation are previously supplied host dependencies.
const registry = {
  listEntities: (_required: Record<string, never>) => listErasedEntityPorts(entityRegistry),
  getEntity: ({ name }: { name: string }) => getErasedEntityPort(entityRegistry, name),
};
const translate = ({ key }: { key: string }) => key;
const dependencies = { adminBase: '/console', panelId: 'data', registry, translate,
  navigate: ({ routePath }: { routePath: string }) => navigation.navigate({ base: '/console', routePath }) };
const routes = createEntityRoutes(dependencies);
const panel = createEntityPanel(dependencies);
const screen = <EntityIndex registry={registry} translate={translate} routes={routes} />;
```

## Consumer-supplied domain ports

These are type-only contracts exported by root and `/core`; none installs routes or provides storage. Factories passed to `createAdminClient` implement them. Backend URL/method mappings, validation, authorization, concurrency, tokens, persistence and domain errors are host owned. Optional arguments below are declared optional in interfaces; implementations choose their defaults. Where there is no optional object, the current declaration accepts only its required argument; a universal second default object is not implemented. `Record<string,never>` means the required empty object `{}`.

The following signatures are extracted from the current declarations. Entity and menu methods remain positional; the other ports use one required object and, where declared, an optional object. `GatedOperation` carries `plan(input): Promise<GatedPlanResult<Details>>`, `confirm(input): Promise<GatedConfirmResult>`, `execute(input): Promise<Result>`; simple confirmation input is `{token: string}`, execution input `{confirmToken: string}`. Plans require string `token`, typed `details`, optional `reversible`, `warnings: readonly string[]`; confirmation requires `confirmToken`. Restore uses its declared extra fields.

### Auth

Source: [port declarations](../../src/core/ports/auth.ts). Referenced DTOs and unions are listed below.

```ts
export interface AdminAuthPort {
  login(input: { username: string; password: string }): Promise<{ user: AdminAuthUser }>;
  logout(requiredArgs: Record<string, never>): Promise<{ ok: boolean }>;
  me(requiredArgs: Record<string, never>): Promise<{ user: AdminAuthUser; effectivePermissions?: readonly string[] }>;
}
```

### Identity

Source: [port declarations](../../src/core/ports/identity.ts). Referenced DTOs and unions are listed below.

```ts
export interface AdminIdentityPort {
  listUsers(requiredArgs: Record<string, never>): Promise<readonly AdminIdentityUser[]>;
  createUser(requiredArgs: { username: string; password: string }, optionalArgs?: { email?: string }): Promise<AdminIdentityUser>;
  updateUser(requiredArgs: { id: string }, optionalArgs?: { email?: string }): Promise<AdminIdentityUser>;
  disableUser(requiredArgs: { id: string }): Promise<AdminIdentityUser>;
  enableUser(requiredArgs: { id: string }): Promise<AdminIdentityUser>;
  resetUserPassword(requiredArgs: { id: string; password: string }): Promise<{ ok: boolean }>;
  assignRole(requiredArgs: { userId: string; roleId: string }): Promise<{ ok: boolean }>;
  attachPolicy(requiredArgs: { userId: string; policyId: string }): Promise<{ ok: boolean }>;
  listRoles(requiredArgs: Record<string, never>): Promise<readonly AdminRole[]>;
  createRole(requiredArgs: { name: string }, optionalArgs?: { description?: string }): Promise<AdminRole>;
  updateRole(requiredArgs: { id: string }, optionalArgs?: { name?: string; description?: string }): Promise<AdminRole>;
  deleteRole(requiredArgs: { id: string }): Promise<{ ok: boolean }>;
  listPolicies(requiredArgs: Record<string, never>): Promise<readonly AdminPolicy[]>;
  createPolicy(requiredArgs: { name: string }, optionalArgs?: { description?: string }): Promise<AdminPolicy>;
  updatePolicy(requiredArgs: { id: string }, optionalArgs?: { name?: string; description?: string }): Promise<AdminPolicy>;
  deletePolicy(requiredArgs: { id: string }): Promise<{ ok: boolean }>;
  writePolicyPermission(
    requiredArgs: { policyId: string; permission: string; granted: boolean },
  ): Promise<AdminPolicy>;
}
```

### Members

Source: [port declarations](../../src/core/ports/members.ts). Referenced DTOs and unions are listed below.

```ts
export interface AdminMembersPort {
  listMembers(requiredArgs: Record<string, never>): Promise<readonly AdminMember[]>;
  getMember(requiredArgs: { id: string }): Promise<AdminMember>;
  disableMember(requiredArgs: { id: string }): Promise<AdminMember>;
  requestMemberMagicLink(
    input: { email: string },
    options?: { redirectPath?: string },
  ): Promise<{ delivered: true }>;
}
```

### Workspace

Source: [port declarations](../../src/core/ports/workspace.ts). Referenced DTOs and unions are listed below.

```ts
export interface AdminWorkspacePort {
  getWorkspace(requiredArgs: Record<string, never>): Promise<AdminWorkspace>;
  updateWorkspace(requiredArgs: Record<string, never>, optionalArgs?: { name?: string; slug?: string }): Promise<AdminWorkspace>;
  deleteWorkspace(requiredArgs: Record<string, never>): Promise<void>;
}
```

### Settings

Source: [port declarations](../../src/core/ports/settings.ts). Referenced DTOs and unions are listed below.

```ts
export interface AdminSettingsPort {
  getSettingsEffective(
    input: { namespace: string },
    options?: { principalId?: string },
  ): Promise<readonly SettingResolvedValue[]>;
  setSetting(
    input: { namespace: string; key: string; scope: SettingScope; value: unknown },
    options?: { principalId?: string },
  ): Promise<SettingValueResponse>;
  clearSetting(
    input: { namespace: string; key: string; scope: SettingScope },
    options?: { principalId?: string },
  ): Promise<SettingValueResponse>;
  resetSettingsNamespace(input: { namespace: string; scope: SettingScope }): Promise<SettingResetResponse>;
}
```

### Plugins

Source: [port declarations](../../src/core/ports/plugins.ts). Referenced DTOs and unions are listed below.

```ts
export interface AdminExtensionsPort {
  listPlugins(requiredArgs: Record<string, never>): Promise<readonly AdminPlugin[]>;
  setPluginEnabled(requiredArgs: { id: string; enabled: boolean }): Promise<AdminExtensionEnabledResult>;
}
```

### Media

Source: [port declarations](../../src/core/ports/media.ts). Referenced DTOs and unions are listed below.

```ts
export interface AdminMediaPort {
  listMedia(requiredArgs: Record<string, never>): Promise<readonly AdminMedia[]>;
  mediaOriginalUrl(requiredArgs: { id: string }): string;
  uploadMedia(
    input: { filename: string; contentType: string; dataBase64: string },
    options?: { alt?: string; caption?: string; credit?: string },
  ): Promise<AdminMedia>;
  updateMedia(
    requiredArgs: { id: string },
    optionalArgs?: { title?: string; alt?: string; caption?: string; credit?: string },
  ): Promise<AdminMedia>;
  trashMedia(requiredArgs: { id: string }): Promise<AdminMedia>;
  deleteMedia(requiredArgs: { id: string }): Promise<{ purged: boolean }>;
}
```

### Analytics

Source: [port declarations](../../src/core/ports/analytics.ts). Referenced DTOs and unions are listed below.

```ts
export interface AdminAnalyticsPort {
  listRecentAnalyticsHits(requiredArgs: Record<string, never>, optionalArgs?: { limit?: number }): Promise<readonly AdminAnalyticsHit[]>;
}
```

### Comments

Source: [port declarations](../../src/core/ports/comments.ts). Referenced DTOs and unions are listed below.

```ts
export interface AdminCommentsPort {
  listCommentsQueue(requiredArgs: Record<string, never>, optionalArgs?: {
    status?: CommentStatus;
    cursor?: string;
    limit?: number;
  }): Promise<AdminCommentsQueuePage>;
  moderateComment(
    requiredArgs: { commentId: string; action: CommentModerationAction; expectedVersion: number },
    optionalArgs?: { note?: string },
  ): Promise<void>;
  purgeComment(requiredArgs: { commentId: string }, optionalArgs?: { note?: string }): Promise<void>;
  getCommentsSettings(requiredArgs: Record<string, never>): Promise<CommentsSettings>;
  putCommentsSettings(requiredArgs: Record<string, never>, optionalArgs?: Partial<CommentsSettings>): Promise<CommentsSettings>;
}
```

### Database

Source: [port declarations](../../src/core/ports/database.ts). Referenced DTOs and unions are listed below.

```ts
export interface AdminDatabasePort {
  getDatabaseTimeline(requiredArgs: Record<string, never>, optionalArgs?: {
    kind?: string;
    outcome?: string;
    fromDate?: string;
    toDate?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ items: readonly AdminLedgerRow[]; nextCursor: string | null }>;
  listDatabaseRestorePoints(requiredArgs: Record<string, never>): Promise<readonly AdminRestorePoint[]>;
  createDatabaseRestorePoint(requiredArgs: Record<string, never>, optionalArgs?: {
    trigger?: string;
    costAck?: boolean;
  }): Promise<AdminRestorePointSummary>;
  readonly migrateForward: GatedOperation<Record<string, never>, unknown, MigrateForwardResult>;
}
```

### Recovery

Source: [port declarations](../../src/core/ports/recovery.ts). Referenced DTOs and unions are listed below.

```ts
export interface AdminRecoveryPort {
  listRecoveryRestorePoints(requiredArgs: Record<string, never>): Promise<readonly AdminRestorePoint[]>;
  computeRecoveryDisclosure(requiredArgs: { restorePointId: string }): Promise<AdminDisclosureResult>;
  resolveRecoveryDeepLink(envelope: DatabaseContextEnvelope): Promise<AdminRecoveryDeepLinkResult>;
  getRecoveryStatus(requiredArgs: Record<string, never>): Promise<AdminRecoveryStatus>;
  readonly restore: GatedOperation<
     { readonly restorePointId: string },
     unknown,
     RestoreExecuteResult,
     RestoreConfirmInput,
     RestoreExecuteInput
  >;
}
```

### Seo

Source: [port declarations](../../src/core/ports/seo.ts). Referenced DTOs and unions are listed below.

```ts
export interface AdminSeoPort {
  getSeoEntry(requiredArgs: { entryId: string }): Promise<AdminSeoMeta>;
  putSeoEntry(requiredArgs: { entryId: string }, optionalArgs?: AdminSeoOverrides): Promise<AdminSeoMeta>;
  analyzeSeoEntry(requiredArgs: { entryId: string }): Promise<AdminSeoAnalysis>;
  getSeoSettings(requiredArgs: Record<string, never>): Promise<AdminSeoSettings>;
  putSeoSettings(requiredArgs: Record<string, never>, optionalArgs?: Partial<AdminSeoSettings>): Promise<AdminSeoSettings>;
  regenerateSeoSitemap(requiredArgs: Record<string, never>): Promise<{ accepted: boolean }>;
}
```

### Menus

Source: [port declarations](../../src/core/ports/menus.ts). Referenced DTOs and unions are listed below.

```ts
export interface AdminMenusPort {
  listMenus(): Promise<readonly AdminMenu[]>;
  getMenu(id: string): Promise<AdminMenu>;
  createMenu(input: AdminMenuCreateInput): Promise<AdminMenu>;
  updateMenuTree(id: string, input: AdminMenuUpdateTreeInput): Promise<AdminMenu>;
  deleteMenu(id: string, options?: { force?: boolean }): Promise<AdminDeleteMenuResult>;
  assignMenuLocation(id: string, locationKey: string): Promise<AdminAssignMenuLocationResult>;
}
```

### Forms

Source: [port declarations](../../src/core/ports/forms.ts). Referenced DTOs and unions are listed below.

```ts
export interface AdminFormsPort {
  listFormDefinitions(requiredArgs: Record<string, never>): Promise<readonly AdminFormDefinition[]>;
  getFormDefinition(requiredArgs: { id: string }): Promise<AdminFormDefinition>;
  createFormDefinition(requiredArgs: Omit<AdminFormCreateInput, "notify">, optionalArgs?: Pick<AdminFormCreateInput, "notify">): Promise<AdminFormDefinition>;
  updateFormDefinition(requiredArgs: { id: string }, optionalArgs?: AdminFormUpdatePatch): Promise<AdminFormDefinition>;
  listFormSubmissions(
    requiredArgs: { formId: string },
    optionalArgs?: { limit?: number; cursor?: string },
  ): Promise<AdminFormSubmissionPage>;
  getFormSubmission(requiredArgs: { formId: string; submissionId: string }): Promise<AdminFormSubmission>;
  deleteFormSubmission(requiredArgs: { formId: string; submissionId: string }): Promise<void>;
}
```

### Redirects

Source: [port declarations](../../src/core/ports/redirects.ts). Referenced DTOs and unions are listed below.

```ts
export interface AdminRedirectsPort {
  listRedirects(requiredArgs: Record<string, never>, optionalArgs?: AdminRedirectListFilter): Promise<readonly AdminRedirect[]>;
  getRedirect(requiredArgs: { id: string }): Promise<AdminRedirect>;
  createRedirect(requiredArgs: Omit<AdminRedirectCreateInput, "override" | "priority">, optionalArgs?: Pick<AdminRedirectCreateInput, "override" | "priority">): Promise<AdminRedirect>;
  updateRedirect(requiredArgs: { id: string }, optionalArgs?: AdminRedirectUpdatePatch): Promise<AdminRedirect>;
  tombstoneRedirect(requiredArgs: { id: string }): Promise<AdminRedirect>;
  getRedirectHitStats(requiredArgs: { id: string }): Promise<AdminRedirectHitStats>;
  importRedirects(requiredArgs: { rules: readonly AdminRedirectCreateInput[] }): Promise<AdminRedirectImportResult>;
}
```

### Integrations

Source: [port declarations](../../src/core/ports/integrations.ts). Referenced DTOs and unions are listed below.

```ts
export interface AdminIntegrationsPort {
  listIntegrationSubscriptions(requiredArgs: Record<string, never>): Promise<readonly AdminIntegrationSubscription[]>;
  createIntegrationSubscription(input: {
    label: string;
    targetUrl: string;
    topics: readonly string[];
  }): Promise<AdminIntegrationSubscription>;
  pauseIntegrationSubscription(requiredArgs: { id: string; paused: boolean }): Promise<AdminIntegrationSubscription>;
  deleteIntegrationSubscription(requiredArgs: { id: string }): Promise<AdminIntegrationSubscription>;
  listIntegrationDeliveries(requiredArgs: { subscriptionId: string }): Promise<readonly AdminIntegrationDelivery[]>;
}
```

### Entities

Source: [port declarations](../../src/core/ports/entities.ts). Referenced DTOs and unions are listed below.

```ts
export interface AdminEntityPort<D extends AdminEntityDescriptor> {
  readonly descriptor: D;
  list(query?: AdminEntityListQuery): Promise<AdminEntityPage<AdminEntityRow<D>>>;
  get(id: string): Promise<AdminEntityRow<D> | null>;
  create(input: Omit<AdminEntityRow<D>, 'id'>): Promise<AdminEntityRow<D>>;
  update(id: string, patch: Partial<Omit<AdminEntityRow<D>, 'id'>>): Promise<AdminEntityRow<D>>;
  remove?(id: string): Promise<void>;
}
export interface AdminErasedEntityPort {
  readonly descriptor: AdminEntityDescriptor;
  list(query?: AdminEntityListQuery): Promise<AdminEntityPage<AdminEntityRowData>>;
  get(id: string): Promise<AdminEntityRowData | null>;
  create(input: Record<string, unknown>): Promise<AdminEntityRowData>;
  update(id: string, patch: Record<string, unknown>): Promise<AdminEntityRowData>;
  remove?(id: string): Promise<void>;
}
```

### Shell

Source: [port declarations](../../src/core/ports/shell.ts). Referenced DTOs and unions are listed below.

```ts
export interface AdminShellSessionPort {
  read(args: AdminShellContext): Promise<AdminShellSession | null>;
  logout(args: AdminShellContext): Promise<void>;
  onUnauthenticated(args: AdminShellContext & { readonly onUnauthenticated: () => void }): () => void;
}
export interface AdminShellNavigationPort {
  readRoute(args: { readonly base: string }): string;
  subscribe(args: { readonly base: string; readonly onChange: () => void }): () => void;
  navigate(args: { readonly base: string; readonly routePath: string }, options?: { readonly replace?: boolean }): void;
  installLinkInterceptor(args: { readonly base: string }): () => void;
}
```

## Exported type registry

These source links define the exact fields of the public data and callback types referenced above. They are declarations, not executable factories; consumers import them with `import type`. Port method signatures above retain these return types without inventing response envelopes.

| Source | Public types |
|---|---|
| [core/manifest/types.ts](../../src/core/manifest/types.ts) | `AdminNavEntry`, `AdminPanel`, `AdminRoutePattern` |
| [core/manifest/rules.ts](../../src/core/manifest/rules.ts) | `AdminNavGroup`, `AdminNavItem`, `AdminRegistryContext` |
| [core/routing/types.ts](../../src/core/routing/types.ts) | `AdminRoute` |
| [core/transport/index.ts](../../src/core/transport/index.ts) | `AdminClient`, `AdminFetch`, `AdminRouteGroupFactory`, `AdminTransport`, `HttpTransportOptions` |
| [core/gated/types.ts](../../src/core/gated/types.ts) | `GatedConfirmResult`, `GatedOperation`, `GatedPlanResult` |
| [core/data-table/types.ts](../../src/core/data-table/types.ts) | `DataTableSortDirection`, `DataTableSortState` |
| [core/ports/auth.ts](../../src/core/ports/auth.ts) | `AdminAuthPort`, `AdminAuthUser` |
| [core/ports/members.ts](../../src/core/ports/members.ts) | `AdminMember`, `AdminMembersPort` |
| [core/ports/media.ts](../../src/core/ports/media.ts) | `AdminMedia`, `AdminMediaPort` |
| [core/ports/settings.ts](../../src/core/ports/settings.ts) | `AdminSettingsPort`, `SettingResetResponse`, `SettingResolvedValue`, `SettingScope`, `SettingValueResponse` |
| [core/ports/database.ts](../../src/core/ports/database.ts) | `AdminDatabasePort`, `AdminLedgerRow`, `AdminRestorePoint`, `AdminRestorePointSummary`, `MigrateForwardResult`, `RestorePointCostClass` |
| [core/ports/recovery.ts](../../src/core/ports/recovery.ts) | `AdminDegradedBanner`, `AdminDisclosureResult`, `AdminRecoveryDeepLinkResult`, `AdminRecoveryPort`, `AdminRecoveryStatus`, `CategoryCount`, `DatabaseContextEnvelope`, `DegradedBannerActionKind`, `DegradedBannerKind`, `RestoreConfirmInput`, `RestoreExecuteInput`, `RestoreExecuteResult` |
| [core/ports/integrations.ts](../../src/core/ports/integrations.ts) | `AdminIntegrationDelivery`, `AdminIntegrationDeliverySummary`, `AdminIntegrationSubscription`, `AdminIntegrationsPort` |
| [core/ports/comments.ts](../../src/core/ports/comments.ts) | `AdminComment`, `AdminCommentsPort`, `AdminCommentsQueuePage`, `CommentModerationAction`, `CommentStatus`, `CommentsSettings` |
| [core/ports/plugins.ts](../../src/core/ports/plugins.ts) | `AdminExtensionEnabledResult`, `AdminExtensionsPort`, `AdminPlugin` |
| [core/ports/analytics.ts](../../src/core/ports/analytics.ts) | `AdminAnalyticsHit`, `AdminAnalyticsPort` |
| [core/ports/workspace.ts](../../src/core/ports/workspace.ts) | `AdminWorkspace`, `AdminWorkspacePort` |
| [core/ports/identity.ts](../../src/core/ports/identity.ts) | `AdminIdentityPort`, `AdminIdentityUser`, `AdminPolicy`, `AdminRole` |
| [core/ports/seo.ts](../../src/core/ports/seo.ts) | `AdminSeoAnalysis`, `AdminSeoIssue`, `AdminSeoMeta`, `AdminSeoOpenGraph`, `AdminSeoOverrides`, `AdminSeoPort`, `AdminSeoRobotsDirective`, `AdminSeoRobotsRule`, `AdminSeoSettings`, `AdminSeoTwitterCard`, `SeoIssueSeverity`, `SeoOpenGraphType`, `SeoTwitterCardKind` |
| [core/ports/redirects.ts](../../src/core/ports/redirects.ts) | `AdminRedirect`, `AdminRedirectCreateInput`, `AdminRedirectHitStats`, `AdminRedirectImportFailure`, `AdminRedirectImportResult`, `AdminRedirectListFilter`, `AdminRedirectUpdatePatch`, `AdminRedirectsPort`, `RedirectMatchType`, `RedirectSource`, `RedirectStatus`, `RedirectStatusCode` |
| [core/ports/menus.ts](../../src/core/ports/menus.ts) | `AdminAssignMenuLocationResult`, `AdminDeleteMenuResult`, `AdminMenu`, `AdminMenuBinding`, `AdminMenuCreateInput`, `AdminMenuCustomTarget`, `AdminMenuEntryTarget`, `AdminMenuItem`, `AdminMenuItemAttrs`, `AdminMenuRouteTarget`, `AdminMenuTarget`, `AdminMenuTermTarget`, `AdminMenuUpdateTreeInput`, `AdminMenuUrlTarget`, `AdminMenusPort`, `MenuStatus`, `NavTargetKind` |
| [core/ports/forms.ts](../../src/core/ports/forms.ts) | `AdminFormCreateInput`, `AdminFormDefinition`, `AdminFormField`, `AdminFormNotifyConfig`, `AdminFormSubmission`, `AdminFormSubmissionPage`, `AdminFormUpdatePatch`, `AdminFormsPort`, `FormDefinitionStatus`, `FormFieldType` |
| [core/ports/entities.ts](../../src/core/ports/entities.ts) | `AdminEntityDescriptor`, `AdminEntityField`, `AdminEntityFieldKind`, `AdminEntityFilter`, `AdminEntityJsonField`, `AdminEntityListQuery`, `AdminEntityPage`, `AdminEntityPort`, `AdminEntityRegistry`, `AdminEntityRelationField`, `AdminEntityRow`, `AdminEntityRowData`, `AdminEntityScalarField`, `AdminErasedEntityPort` |
| [core/entities/rules.ts](../../src/core/entities/rules.ts) | `AdminEntityErasureOptions`, `AdminEntityRowViolation` |
| [core/ports/shell.ts](../../src/core/ports/shell.ts) | `AdminShellContext`, `AdminShellNavigationPort`, `AdminShellSession`, `AdminShellSessionPort` |
| [react/types.ts](../../src/react/types.ts) | `ConfirmTone` |
| [react/components/ConfirmButton/ConfirmButton.tsx](../../src/react/components/ConfirmButton/ConfirmButton.tsx) | `ConfirmButtonProps` |
| [react/components/ConfirmDialog/ConfirmDialog.tsx](../../src/react/components/ConfirmDialog/ConfirmDialog.tsx) | `ConfirmDialogProps` |
| [react/components/ConfirmDialog/ConfirmDialog.hooks.tsx](../../src/react/components/ConfirmDialog/ConfirmDialog.hooks.tsx) | `ConfirmDialogController`, `ConfirmDialogDefaults`, `ConfirmDialogDefaultsProviderProps`, `UseConfirmDialog` |
| [react/components/DataTable.tsx](../../src/react/components/DataTable.tsx) | `DataTableColumn`, `DataTableColumnSort`, `DataTableProps`, `DataTableSortDirection`, `DataTableSortState` |
| [react/components/InteractiveHtmlEditor/InteractiveHtmlEditor.tsx](../../src/react/components/InteractiveHtmlEditor/InteractiveHtmlEditor.tsx) | `InteractiveHtmlEditorProps` |
| [react/components/RowMenu/RowMenu.tsx](../../src/react/components/RowMenu/RowMenu.tsx) | `RowMenuItem`, `RowMenuProps` |
| [react/components/Sidebar.tsx](../../src/react/components/Sidebar.tsx) | `RailTooltipHandlers`, `SidebarContextValue`, `SidebarFooterProps`, `SidebarMobileHeaderProps`, `SidebarNavProps`, `SidebarProps`, `SidebarRailToggleProps` |
| [react/hooks/use-sidebar-rail.ts](../../src/react/hooks/use-sidebar-rail.ts) | `SidebarRail` |
| [react/hooks/use-nav-sections.ts](../../src/react/hooks/use-nav-sections.ts) | `NavSectionState`, `NavSections` |
| [react/shell/types.ts](../../src/react/shell/types.ts) | `AdminShellContext`, `AdminShellLabels`, `AdminShellNavigationPort`, `AdminShellPanel`, `AdminShellProps`, `AdminShellRenderArgs`, `AdminShellSession`, `AdminShellSessionController`, `AdminShellSessionPort`, `AdminShellSessionState`, `AdminShellSlotArgs`, `AdminShellSlots` |
| [react/shell/theme-ports.ts](../../src/react/shell/theme-ports.ts) | `AdminShellAppearance`, `AdminThemeEnvironment`, `AdminThemePreferenceStorePort` |
| [react/entities/contribution.tsx](../../src/react/entities/contribution.tsx) | `EntityRouteDependencies` |
| [react/entities/types.ts](../../src/react/entities/types.ts) | `EntityDetailProps`, `EntityEditProps`, `EntityListProps`, `EntityRegistryPort`, `EntityRouteTarget`, `EntityRoutesPort`, `EntityScreenDependencies`, `EntityTranslate` |
| [react/entities/rules.ts](../../src/react/entities/rules.ts) | `DraftFieldProblem`, `RelationIndex`, `RelationOptions` |
| [react/shell/model.ts](../../src/react/shell/model.ts) | `AdminShellModel` |

## Known issues and refresh boundary

Every import path and public runtime name has a source contract above. Shell, Sidebar and RowMenu callers use the current hook, routing and agent-helper signatures. Domain route implementations cannot be documented because none are shipped. See [behavior.spec.md](behavior.spec.md) and [ui.spec.md](ui.spec.md) for exact limitations. Shared base types now come from `@jini-ai/core/primitives`; the contracts here preserve the current declarations, including remaining React callback forms.

## Current manifest boundary

The current `package.json` exposes `.`, `./core`, `./browser`, `./react`, `./react/shell`, `./react/entities`, `./browser/shell-navigation`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
