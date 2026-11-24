# `@jini-ai/admin`

A composable admin surface for Jini-hosted products. A host picks the panels it wants, wires the
ports those panels need, and gets a working admin — sidebar, routing, and agent-navigation
allowlist all derived from one declaration.

Extracted from the reference implementation's admin SPA, which had grown a 1,548-line API client
with 134 methods in a single object and defined every section across three files that had to be
kept in sync by hand.

## Layers

Import only what you need. `sideEffects: false` plus per-layer subpaths means an unused layer is
not in your bundle.

| Subpath | Contains | Needs |
|---|---|---|
| `@jini-ai/admin/core` | contracts, panel registry, route matching, transport, ports | nothing |
| `@jini-ai/admin/browser` | `window`-bound navigation, link interception | a DOM |
| `@jini-ai/admin/react` | Primitives, hooks, shell and entity screens | React and React DOM (optional peers) |
| `@jini-ai/admin/react/shell` | Session gate, panel rendering and persistent assistant slot | React and injected session/navigation |
| `@jini-ai/admin/react/entities` | Schema-driven index, list, detail and create/edit screens | React and injected registry/translation/navigation |
| `@jini-ai/admin/browser/shell-navigation` | Query-preserving History API adapter for the shell | Injected browser window/document/location |

`/core` is the layer a panel author codes against: no React, no DOM, no I/O. That boundary is
enforced at runtime — this package's vitest config runs `src/core/**` without a jsdom environment,
so a `window` reference in core fails loudly instead of passing quietly.

React and react-dom are **optional** peer dependencies (`peerDependenciesMeta`), so a consumer
importing only `/core` is not asked to install them.

## A panel

```ts
import type { AdminPanel } from '@jini-ai/admin/core';

export const usersPanel: AdminPanel<() => ReactNode> = {
  id: 'users',
  render: () => <Users />,
  nav: { label: 'Users', group: 'People', order: 1 },
  requires: ['identity'],          // dropped entirely if no identity port is wired
  permissions: ['users.read'],     // affordance only — never the authz boundary
  agentReachable: true,            // explicit opt-in; defaults to false
  routes: [{ pattern: '/:userId', view: 'user-detail' }],
};
```

Three properties carry decisions worth not re-deriving:

- **`nav` is optional.** A panel can be routable without a sidebar row (the reference
  implementation's `appearance` and `settings-raw` panels both rely on this).
- **`agentReachable` defaults to `false` and must stay an explicit opt-in.** It is the allowlist
  behind `page.navigate`-style capabilities. Deriving it from panel registration would make every
  new screen agent-reachable as a side effect of existing, which inverts the point of an
  allowlist. An AI generating a panel manifest cannot make itself reachable by omission.
- **`requires` is how a host composes.** You do not ship or omit panel *code*; you supply or
  withhold the *ports* a panel names, and unmet panels vanish — no dead nav row, no route that
  renders an error.

## Assembling a shell

```ts
import { resolvePanels, buildNav, buildAgentPageMap, matchRoute } from '@jini-ai/admin/core';

const mounted   = resolvePanels({ panels: ALL_PANELS }, { capabilities: wiredPorts, permissions: me.permissions });
const nav       = buildNav({ panels: mounted });
const agentPages = buildAgentPageMap({ panels: mounted });   // pass the RESOLVED set, never the raw one
const route     = matchRoute({ routePath: '/users/u1', panels: mounted });
// -> { panelId: 'users', view: 'user-detail', params: { userId: 'u1' }, query }
```

Route matching is registry-driven: a panel declares its own detail routes and the matcher is
generic. Unregistered paths return `panelId: null` so the shell can fall through to the dashboard,
matching the ported behaviour — a typo should look like a bad URL, not an empty screen.

## Adding host routes

Route groups are host-owned factories taking `({ transport })`. The package ships
contracts and an HTTP transport; it does not ship identity or media route factories.

```ts
import { createAdminClient, createHttpTransport } from '@jini-ai/admin/core';

const transport = createHttpTransport({
  baseUrl: '/api/admin/v1',
  fetch: ({ url }, init) => fetch(url, init),
});
const createStatusRoutes = ({ transport }) => ({
  read: ({}) => transport.request({ path: '/status' }),
});
const client = createAdminClient({ transport, groups: { status: createStatusRoutes } });
await client.status.read({});
await client.transport.request({ path: '/one-off' });
```

`AdminTransport` also supports non-HTTP adapters. Hosts bind authentication,
workspace scope and error handling at that boundary.

## Wiring

`src/posts/` holds the post editor's field components (`PostAuthorFields`, `PostPublishAtField`).
They own no state: the host's editor hook passes the values, their setters and `t` as required
props. Labels carry the `jini-field-label` class (inside `jini-post-publishing__field`); the host
stylesheet styles that class, so no bare host class names leak into the package.

**Two HTTP clients, one set of stages.** Both live in this package and share the fetch-failure
classification, JSON body parse and app-envelope rule in `core/transport/http.ts`:

- `createHttpTransport` (`@jini-ai/admin/core`) is the route-group `AdminTransport`. Use it when a
  host assembles route groups with `createAdminClient`: neutral copy, `AdminApiError`, no retry.
- `createAdminHttp` (`@jini-ai/admin/shell/lib/admin-http/request`) is the host session client.
  Use it for the host's own screens when requests must ride out a server restart (one retry),
  report session invalidation (`401` + `UNAUTHENTICATED` only), and publish a final failure notice.
  The host calls it **once** and exports the bound operations from its own request module. Every
  port is required: `fetch`, `timeoutSignal`, `isPageUnloading`, `resolveBasePath`,
  `isUpstreamRefused`, `decodeApiError`, `createError` (the host's error class; Core's
  `AdminApiError` fits `AdminHttpError`), `isRequestError`, `messages`, `reconnect`, `shouldRetry`,
  `sessionInvalidated`, `getFailureGeneration`, `reportFailure`. The factory defines no error class,
  no copy and no failure vocabulary. Per-call options are `AdminHttpOptions` from
  `@jini-ai/core/admin-runtime`.

Converging the two into one transport is a follow-up (P12 ledger), not part of this cut.

**Admin locale.** `useAdminLocale(required)` (`@jini-ai/admin/shell/hooks/use-admin-locale.hooks`)
takes every collaborator from the host: the `AdminLocalePort` (load + namespace-filtered refresh,
both `(required, optional?)`), `useBootScope`, the host's `useFetchQuery`/`useInvalidate`, the
`queryPrefix` and the `fallbackLocale`. The host binds it **once** into a zero-input
`UseAdminLocaleHook` and passes that same function to `AdminKitHooks.useAdminLocale` and to every
mount whose required `useAdminLocaleHook` prop needs it. There is no default hook in this package.

**Settings-dialog tabs.** `SettingsDialogTab<TId>` (`@jini-ai/admin/react/kit`) is the kit's
structural mirror of the UI library's tab type (`id`, `label`, `navHint`, `title`, `subtitle`,
`icon`, `panel`). Host screens type their tab arrays with it and mount them through the
`SettingsDialogShell` slot, which the host binds in its `AdminKit` alongside `I18nProvider` and
`Icon`. The two declarations are intentional; the host's kit integration test asserts they stay
mutually assignable. `SettingsDialogShellProps.labels` is `SettingsDialogChromeLabels`, the kit mirror of the UI
shell's chrome labels, so labelled screens mount the kit facade too.

**Admin shell pieces (w4-admin-shell).** Every collaborator below is a required field the host
passes; none of these modules imports a host module or ships a default hook.

- `shell/components/AssistantDock/hooks/chat-package-kind`: `partitionChatPackages` /
  `chatPackageKind` take `legacyManifestNames` (the host's legacy plugin-manifest file names). They
  are routing hints only, matched exactly at the archive root or one folder deep.
- `shell/components/AssistantDock/hooks/conversation-refresh.hooks`: `useConversationRefreshSignal`
  takes the host's `AssistantChatsPort` (`shell/hooks/assistant-chats-port.hooks`) as `port`.
- `shell/components/AssistantDock/chat-agent-plugin-preferences` and the preference hooks
  (`use-chat-agent-plugins.hooks`, `use-assistant-runtime-preferences.hooks`) take the host's
  ledger port plus its settings `namespace`; the runtime hook also takes `defaults`.
- `use-selected-agent-auth-warning.hooks` takes the host's detection-port factory (`createPort`)
  and its warning rule (`selectWarning`). `SubagentsIndicator` requires the host's subagents
  settings hook as the `useSettings` prop.
- `shell/lib/agent-screenshot`: the host supplies `renderElementToCanvas` (its rasterizer adapter);
  the package has no rasterizer dependency.
- `shell/components/MediaEditDialog/MediaEditDialog.hooks` and `shell/lib/media-embed-extension.hooks`:
  the host's wiring hooks pass `translate` (its media dictionary), `describeHtmlAttributeError` with
  `htmlAttributePolicy` (the embed policy), and `mediaOriginalUrl` from its media API.
  `shell/lib/media-image-extension.hooks`: `createMediaImageTranslator({ locale, translate })`.
  TipTap extension definitions (`Node.create` / `.extend`) stay in the host.
- `shell/lib/live-tiptap-editor`: `isLiveEditor` reads a structural editor (`{ schema }`), so the
  host keeps its own TipTap `Editor` type through the narrowing.
- `shell/components/TemplateSource/ViewTemplateButton` renders `jini-view-template-btn`, which the
  host stylesheet styles. `shell/hooks/use-desktop-view-release.hooks` is called once from the
  host root with `{ routePath, signedIn }`.
- Admin telemetry: hosts call `useBrowserTelemetryFeed` (`@jini-ai/admin/react`) with their `base`
  path and telemetry instance.
- `shell/components/AssistantDock/assistant-dock-i18n`: `t({ locale, key, hostDictionary })` and
  `createChatI18nAdapter({ locale, hostDictionary, settingsDialogKeys, settingsDialogDictionaries })`.
  The host passes its product-naming copy as `hostDictionary`, plus the chat package's settings-owned
  keys and the UI package's settings-dialog dictionaries by identity. Lookup order: host entries,
  then the package dictionaries (split per locale group beside the entry file), then
  `ADMIN_COMMON_I18N` (or the settings copy), then the key.
- `dock-header-rules`: `dockSettingsMenuSections({ t, toolCallOptions, replyLengthOptions }, …)`;
  the host supplies its Tool calls and Reply length choice lists. `useDockHeaderTip({ useTip })`
  takes the host UI kit's InfoTip controller hook. `DockSettingsMenu` (mount under
  `AdminKitProvider`) requires `useTaxonomyRowMenuHook` (normally `useTaxonomyRowMenu` from
  `screens/taxonomy/TaxonomyRowMenu.hooks`) and the host chat library's `ChatSettingsSegmented`
  (`DockSettingsSegmentedProps`); it renders `jini-dock-settings-menu*` and
  `jini-assistant-dock-icon-button`, and renders `jini-row-menu-*` classes (host-styled).
- `FolderDropConfirmation`, `FolderDropError`, `FolderDropPathHint`, `FolderPathButton`: kit icons
  (mount under `AdminKitProvider`) and a required `useTHook` (the host chat library's `useT`); they
  render `jini-folder-drop-notice*` / `jini-composer-folder-path`, styled by the host.
- `shell/components/MediaPickerDialog/JiniMediaPicker.hooks`: `useJiniMediaPicker(args)` takes the
  host's mounted `picker` (or `null`), its media `port`, its `errorRedaction` policy and an
  `errorIdOf(cause)` reader; it uses the kit's `useCachedLoader`.
- `shell/components/WidgetConfigFields/HtmlAttributeRows.hooks` takes the host's attribute parser,
  serializer and allowlist check (`htmlAttributesToRows`, `rowsToHtmlAttributes`,
  `isDroppedAttributeRow`). `PlacementContentFields` requires the host's media content editor as
  `ContentEditor`; the host imports that editor's stylesheet at the mount and styles
  `jini-widget-embed-content-choice > .jini-field-label`.

## Errors

Route groups throw `AdminApiError` (`status`, `code`, raw `body`). There is deliberately **no**
shared code-to-message table: the same `code` means genuinely different things in different
domains, and a shared table could only pick one. `describeApiError` is the base case only; panels
layer their own per-code copy on top and fall through to it.

`src/shell/hooks/admin-execution-credential-port.hooks.ts` declares the admin execution-credential
port plus its unset view and in-memory fake; the host binds the live port to its own API.
`src/shell/hooks/use-sites-sidebar-nav.hooks.ts` takes every host collaborator as a required field
of its first argument: `port` (the Sites list read), `useSitesSnapshot` (the host's cached query
hook) and `translateNavLabel` (the host-bound nav-label translator). It has no default for any.

## Wiring: Secrets (`security`)

`@jini-ai/admin/security/react` exports one factory per admin scope. The host injects the module UI
and every policy value; the module imports no renderer implementation and no host copy.

```ts
const secrets = security(
  { ui: reactModuleUi },                       // the host's AdminModuleUi (bindReact + useController)
  {
    t: hostTranslator,                         // optional; default `englishSecurity`
    rootKeyScopeNotice: hostScopeCopy,          // optional; root-key tab `params.scopeNotice`
    rootKeyTab: { generate: 'hidden', defaultEnvVarName: 'HOST_KEY_ENV', previewRequired: false },
    tabIcons: { 'access-tokens': <Glyph />, 'root-key': <Glyph /> },
    describeError: ({ error }) => ({ code: hostCode(error), detail: hostPublicDetail(error) }), // optional
  },
);
// Ports: `securityApi` (required), `otherCredentials`, `rootKey` (optional), via createAdmin.
// Live locale: <secrets.react.Provider admin={admin} t={currentTranslator}> relabels without remounting.
// Owner controls: <secrets.react.Provider admin={admin} ownerControls={<HostOwnerSettings />}> renders
// once above the tabs while the page is visible, and is not remounted by a tab change.
```

- `describeError` returns a failure's server code and public detail. Root-key generate refusals are
  classified from it (`locked` / `refused` / `already-exists` / `generic`); the page shows only that
  detail or fixed copy, never a raw `Error.message`, so the describer is where the host redacts.
- `rootKeyTab` merges into the `root-key` tab's params. Omitted fields keep the stock behaviour:
  generate shown, a preview before start fresh, no env-var name fallback.
- The page renders the kit `TabBar` with the agent handles `security-tab-access-tokens`,
  `security-tab-site-key` and container `security-tab-bar`. Tab visibility follows the module's
  grants: `security.read` for the page, `admin.security.tokens.manage` for `root-key`; a deep link
  to a hidden tab falls back to Access tokens. The server stays the authorization boundary.

## Not a security boundary

`hasPermission` and a panel's `permissions` decide whether a control renders. They never run on
the server. A bug here can only show or hide a control; it cannot grant or block the underlying
operation, because every mutation must be independently re-checked server-side. Do not import
these into server code.

## Connector integrations

`@jini-ai/admin/server` no longer exists. The former embedded connector backend
was extracted and subsequently removed by the owner. Hosts supply connector data
and authorization through the UI ports; there is no built-in connector vendor
adapter to import. See `@jini-ai/integrations` for the supported webhook and
media-provider capabilities.

## Before writing a panel: check `@jini-ai/ui-core` first

`@jini-ai/ui-core` already models several domains an admin panel would otherwise re-derive —
`execution`, `integrations`, `connectors`, `media-providers`, `notifications`, `appearance`. Reuse
its ports and rules rather than defining a second (or third) version. See that package's README
for the full map and for the `DetectedAgent` drift that motivated this rule.

Panels that reuse `ui-core` take the dependency in `/react/panels/*`. **`/core` stays
zero-dependency** — otherwise every consumer of the contracts layer pulls in 6,000+ lines of
unrelated domain features to get a type.

## API arguments and integration status

Public helpers and factories take a required argument object and an optional
options object. Pass `{}` before optional-only arguments. React props and native
framework callbacks retain their framework contracts.

```ts
hasPermission({ permissions, permission: 'records.read' });
adminHref({ routePath: '/records' }, { base: '/console' });
new AdminApiError({ message: 'Unavailable', status: 503 }, { code: 'unavailable' });
createAdminShellNavigation({ location: window.location, window, document });
```

The shell requires `apiBase`, `workspace`, `adminBase`, `defaultPanelId`,
`railStorageKey`, title, labels, session/navigation ports, panels and slots. A host
supplies every product value. Its session port exposes `read(context)`,
`logout(context)` and `onUnauthenticated({ ...context, onUnauthenticated })`.

Entity screens consume the existing entity port through `EntityRegistryPort` and
require translation and navigation ports. `createEntityPanel({ adminBase,
panelId, navigate, registry, translate }, options)` returns an `AdminShellPanel`.
It contributes list, create, detail and edit routes; agent reachability is opt-in.
Its translation port takes `{ key }`, and `navigate` takes `{ routePath }`.

The HTML editor's direct marker helpers take `{ el }`; its React component adapts
those calls to the upstream editor callbacks. Marker bytes and labels are unchanged.

The export map and barrels include all these slices. The package typecheck includes
test sources and passes after the upstream agentic and UI declarations are rebuilt.
Runtime tests and packing remain deferred under the owner's execution directive. Active owners
must still update Sidebar/RowMenu callers and the entity/menu port APIs before the
package can be released. The integration handoff records the remaining changes.

## Kernel contracts

Admin editor and menu contracts document host integration without repository-specific paths.
`RedirectMatchType` retains `regex` because callers can submit that rejected request shape;
its presence does not imply matcher support. Hosts must verify support before offering it.

## Agent-addressable React controls

React controls keep importing `agentHandle` and `buildAgentListHandles` from
`@jini-ai/agentic`; this is an allowed UI-to-agentic layer dependency. The helpers
have not moved and consumers continue to use their original exports.

Shared React binding helpers are also available from `@jini-ai/admin/core/react`.
This is an explicit browser adapter entry: `@jini-ai/admin/core` and the package
root remain framework free. Domain React entries call these shared helpers
directly, and the existing `react/bind-react` and `react/use-controller` entries
retain their exports through compatibility re-exports. Domain integration
packages are optional peers; install the peers used by the selected entries.

## Wiring: shell request-bound helpers (`shell/lib`)

`shell/lib/version-conflict`, `shell/lib/stored-credential-endpoint`, `shell/lib/visitor-tools` and
`shell/lib/assistant-permanent-deletes` never import a host's session client or error class. The
pure rules, copy keys and types are plain exports; the parts that touch the host's HTTP boundary are
factories the host binds once at its composition root:

- `createVersionConflict({ isRequestError })` and `createProbeErrorDescribers({ isRequestError })`
  take the same `isRequestError` guard the host already passes to `createAdminHttp` (typed
  `RequestErrorGuard<E>`), so `instanceof HostApiError` stays in the host.
- `createVisitorToolsPort({ http, workspaceId })` and `createAssistantPermanentDeletesPort({ http, workspaceId })`
  take the host's bound `authenticatedAdminRequest` (`AdminRequestOps`) and its workspace id; the
  permanent-delete tool list, dangers copy and namespace stay with the host.
- `createCredentialSubmitErrorClassifier({ isRequestError })` and
  `createReadInitialAdminSession({ readInitialSession, isRequestError })` take the same guard; the
  latter also takes the session-bootstrap reader (`@jini-ai/user-management`'s `readInitialSession`,
  which `@jini-ai/admin` does not depend on), so the bootstrap policy stays with its owner.
- `createAssistantSubagentsPort({ http, workspaceId })` takes the bound `authenticatedAdminRequest`.
- `createOwnerMfaPort({ http })`, `createOwnerPasskeyPorts({ http })` and `createOwnerRecoveryPort({ http })`
  take the host's bound single-send `requestOnce` (`AdminRequestOnceOps`);
  `createOwnerRecoveryFailure({ describeError, redactionOptions })` takes the host's request-error
  describer and its secret-redaction options (product vocabulary stays in the host).

## Wiring: host-owned storage keys (`shell/components/ChatFab`, `shell/lib`)

Browser-storage keys hold operators' existing data, so they stay with the host and arrive as required
inputs; Jini never names one.

- `useFabPosition({ dockOpen, avoidBottomPx, avoidRightPx?, storageKey })`
  (`shell/components/ChatFab/ChatFab.hooks`) binds the kit's `chat.useFabPosition` to
  `localStorage`, `window`, `document` and the shared FAB geometry (`FAB_EDGE_MARGIN`, 56px, 5px
  drag threshold). Needs `AdminKitProvider` above it; the host component passes its key.
- `createAssistantAgentsSnapshot({ storageKey, createInventorySnapshot })`
  (`shell/lib/assistant-agents-snapshot`) returns `{ readAgentsSnapshot, writeAgentsSnapshot }`.
  The host passes `@jini-ai/chat/browser/agent-inventory`'s `createAgentInventorySnapshot` (this
  package does not depend on the chat package) and binds the pair once at its composition root.
- `createBrowserWorkingDirectoryAccess({ recentDirectoryNamesStorageKey })`
  (`shell/lib/browser-working-directory-access`) returns the native `ChatPaneWorkingDirectoryAccess`
  (kit type mirror) or `undefined` where the File System Access API is missing.

## Wiring: shell dock components and shared copy (`shell/components`)

- `shell/components/shared-components-i18n` holds the shared components' dictionary, falling back to
  `ADMIN_COMMON_I18N` (`core/i18n-common`); a host's own branded common entries stay in the host.
  `shell/components/AdminByokKeyPanel.hooks` binds it per locale.
- `shell/components/AssistantDock/agent-failure` wraps a `ChatTransport` (kit type mirror) so a run's
  failure surfaces as an `agent_failure` ext event with redacted details.
- `MessageOverflowModal`, `SelectedAgentPluginTray` and `SlowRunNoticeCard` take the host's chat
  translator hook as a required `useTHook` prop; `MessageOverflowModal` also takes its required
  `useModal` (the host passes `useMessageOverflowModal`). `SelectedAgentPluginTray` renders the kit
  `Icon`, so it needs `<AdminKitProvider>`. The modal renders `jini-message-overflow-modal{,-close,-body}`
  classes; the host styles them.
- `shell/components/AssistantDock/hooks/use-routed-a2ui-surface-card.hooks` reads only `events` and
  `onAgentAction` from the a2ui card props (`A2uiSurfaceCardProps`, a structural kit mirror).

## Wiring: admin failure reporter (`shell/lib/admin-failure-reporter`)

- `createAdminFailureReporter({ channel, vocabulary, redaction, appVersion, jiniVersion, decodeError, notRunningCodes }, { now?, mintErrorId? })`
  returns `{ adminFailureChannel, isPageWideFailure, publishAdminFailure, publishLocalAdminFailure }`
  bound to one host channel. Jini owns the disclosure rules (approved server wording only after
  sign-in, redacted unlisted routes, small `{error, code}` replies, "post" -> "page" swap, the
  page-wide classification). The host injects its channel (`@jini-ai/ui/panel-kit`'s
  `createFailureChannel`), its failure vocabulary and redaction options, its "Copy details" app
  label, the error decoder (`@jini-ai/protocol`'s `decodeApiError`; this package does not depend on
  protocol) and the server codes a passive read answers while the assistant is not running.
  `isClipboardRefusal` is a plain export. The host calls the factory once in its composition module.

## Wiring: shell components (`shell/components`, step components-4)

- `AdminFailureNotice({ channel, ...errorNoticePorts })` — the host passes its failure channel
  (`subscribe`/`getSnapshot`/`reset`); renders the kit `ErrorNotice` (needs `AdminKitProvider`).
  Classes `jini-admin-failure-notice`, `jini-admin-failure-notice__dismiss`: the host stylesheet styles them.
- `MailStatusBanner({ fetchStatus, labels, storage?, useMailStatusBannerHook })` — the banner state
  hook is a REQUIRED prop (no default); generic over the host's status and storage types. Kit `Icon`.
  Classes `jini-mail-status-banner{,-text,-link,-dismiss}`.
- `SitesSidebarNav({ groups, locale, soonLabel?, options?, port, useSitesSnapshot, translateNavLabel,
  useSitesSidebarNavHook, SidebarNav, useSidebar })` — every host collaborator, the label hook and the
  admin `Sidebar.Nav`/`useSidebar` pair are required props (keeps this browser entry out of the react domain).
  Classes `jini-sites-{label,prefix,name,suffix}`.
- `WidgetConfigFields/WidgetConfigFields.hooks` — `useFetchedOptions` reads through the kit's
  `useFetchQuery` (needs `AdminKitProvider`); a cross-realm `DOMException` AbortError keeps its name.
- `AssistantDock/agent-failure-hints` — `localFailureHints({ agentId })`, pure data.
- `AssistantDock/AgentFailureCard({ ...extEventProps, useTHook, useAgentFailureCardHook, redactionOptions })`
  — the chat translator hook, the failure hook and the host's secret-redaction copy (the second
  argument of `formatUserFacingError`) are REQUIRED props; kit `ErrorNotice` (needs `AdminKitProvider`).
  Class `jini-agent-failure`.
- `AssistantDock/AgentFailureCard.hooks` — `useAgentFailureSurface`, `FailureSurfaceContext`,
  `hasAgentFailureNotice`, and `useAgentFailureCard({ events, runStreaming, runSucceeded, useTHook })`
  (the translator hook is a required arg). Kit type mirror added: `ChatPaneRuntimeAccess`.
