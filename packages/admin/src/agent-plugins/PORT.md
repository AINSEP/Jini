# Agent-plugins port — 2026-10-03

## Active spec and decisions before implementation

Owner admin-port-batch1 brief version 1.0.0, SHA256
75491ff8c01f3da8b680a791461028b0bc182fbcc5af597862d245553ae60469,
and continuation dispatch. Spec provider: speckit. Follow media/security/source-control's
defineAdminModule, bindReact and effect-owned useController pattern. English copy, no
framework in headless code, no logic in TSX, all tabs lazy, exactly one React folder level,
ui-kit facades and overridable guarded confirmation. Instance-scoped API/transport ports.

This domain ports Agent Plugins only. The sibling CMS/runtime Plugins screen and chat's
composer skill ranking remain outside this page. Lifecycle activation, installation,
manifest validation and MCP provisioning stay in @jini-ai/agent-plugins and the host;
admin imports its existing InstalledAgentPlugin/InstalledAgentPluginSkill and
SetAgentPluginEnabledInput types, with a presentation projection for the HTTP wire.
Never duplicate lifecycle business rules in the admin controller.

Installed is the default tab; both Installed and Downloaded show every scoped package,
including switched-off packages. Installed has an Enabled switch; Downloaded has
Turn off/Enable. Disable/Turn off require safety confirmation. No optimistic activation:
only the returned server row may change the displayed state. Per-row single flight,
independent writes, no follow-up GET, distinct load/action errors, safe error copy,
abort and disposal, stale-list and stale-inspector race guards.

Rows retain full descriptions, versions, skill summaries, keywords, portable components,
MCP server ids, expansion and inspection. No uninstall/install endpoint is invented.
Uninstall stays unavailable with one accessible shared explanation. Host-specific bundled
copy becomes an optional notice. Marketplace is an honest planned empty state.
Inspector reads actual files even for disabled plugins; preserves omission reasons,
truncation notice, files-first alphabetical tree, roving focus/keyboard navigation,
first visible file selection, wrap default/reset and line-number alignment.

Page reads require admin.plugins.read; activation additionally requires
admin.plugins.enable. Permissions default denied in page, tabs and controllers.
Server authorization remains mandatory. Package contents are plain text, never executed.

## Acceptance contract

Controller tests against memory: reads denied by default; read-only activation guards;
server-confirmed writes and no refetch; failed writes retain state; concurrent rows;
duplicate clicks; confirmation freshness; abort/disposal and stale reads. File-controller
tests: selection/order, omissions/caps, id changes/close ignore old reads, no-grants read.
Exported API conformance against memory: immutable snapshots, scoped enable/disable,
missing ids, bool validation, file metadata/content, aborted reads and writes.
HTTP tests: existing GET list, PATCH activation and GET files routes, encoding, envelopes,
body, cancellation. React tests: no-grants and read-only mounts, all lazy tabs, confirmation,
file inspector/tree/wrap/omission and partial ui-kit overrides.

## Source mapping

Source root: `apps/admin/src/features/plugins/` in the host repository.

| Source | This domain |
|---|---|
| AgentPlugins.tsx + use-agent-plugins.hooks.ts | module, page/hooks and agent-plugins.controller.ts |
| AgentPluginRow.tsx + agent rules | row/panel hooks, component, models and rules |
| AgentPluginDisableConfirmDialog.tsx + disable-confirm hook | ui-kit ConfirmDialog and controller confirmation state |
| AgentPluginDetailsModal.tsx + details hook | AgentPluginInspector and agent-plugin-files.controller.ts |
| PackageFilesModal.tsx + package-files/tree/wrap hooks | inspector/tree/content components and Inspector.hooks.ts |
| package-file-tree.ts | same pure tree behavior, public operations converted to two object arguments |
| agent-plugins-port/dependencies + lib/api.ts | API token, injected HTTP transport and memory adapter |
| index.ts + plugins-i18n.ts | explicit exports and English messages; shared source rationale retained |

SOURCE-RATIONALE.md retains all agent-owned/shared viewer comments and shared export/i18n
comments with product identities generalized. Verified every source block rationale exists
in the retained report. Important active invariants also accompany the implementation.
Historical comments claiming enabled-only Installed, two routes, or no I/O remain provenance;
current behavior shows disabled rows, uses three routes and reads the server.

## Host swap

Inject `agentPluginsApi` in createAdmin, with explicit `admin.plugins.read` and, for writes,
`admin.plugins.enable`. Rebuild the scope for changed grants or workspace. Supply an
AgentPluginsTransportPort plus workspacePath such as `/api/admin/v1/workspaces/<id>`:

- GET `<workspacePath>/agent-plugins` → `{ agentPlugins }`.
- PATCH `<workspacePath>/agent-plugins/<encodedPluginId>` with `{ enabled: boolean }` → `{ agentPlugin }`.
- GET `<workspacePath>/agent-plugins/<encodedPluginId>/files` → `{ pluginId, files, truncated, limits }`.

Transport owns authentication, decoding, JSON serialization and error status. The server must
validate workspace/entity authorization, resolve current package roots, reject symlinks,
enforce file caps, serialize durable activation writes and provision/revoke runtime capabilities.
Admin copies no filesystem, install, trust, manifest, digest, activation-file or MCP logic.
The headless import of lifecycle types is type-only; no node lifecycle runtime enters admin.
The existing lifecycle SetAgentPluginEnabledInput supplies the activation contract; host supplies
its workspaceId/actor and projects the resulting package into the presentation row.

Use `agentPlugins({}, { uninstallNotice })` to explain the host's bundled restoration/removal
policy. The generic fallback makes no restart/restoration assumption. Both list tabs show this
single shared notice referenced by each disabled uninstall control. KitProvider supplies custom
Button/Switch/Dialog/ConfirmDialog, agent wiring and overlayContainer; confirms remain overridable,
use the kit safety controller, refuse agent confirmation and block dismissal while pending.
Default native kit behavior works without a provider. Styling remains host-owned.

## Behavior not yet ported / deliberate differences

No marketplace, install, uninstall or server lifecycle endpoint is invented. The sibling CMS
Plugins screen (including Trash), composer skill ranking, localization dictionaries, product
icons/styles and live refresh-bus integration are outside this domain. Reload is explicit.
Inspector uses ui-kit Dialog and plain numbered text; source-specific preview fullscreen and
syntax highlighting are not ported. File tree ordering, omission/cap notices, keyboard navigation,
selection highlighting and wrap/reset behavior are retained; category/icon families use generic
glyphs. No package content is evaluated or rendered as HTML. Server failures use safe English
copy rather than raw exception text. Turn off copy accurately says the row stays on both tabs.

No live server, browser geometry/focus-trap validation, packed-package consumer, full workspace
suite or daemon MCP side-effect verification was run. Scoped jsdom checks establish DOM behavior;
the host remains responsible for runtime enable/disable semantics and real browser behavior.

## Final validation

Working directory: `/Users/la/Programming/Jini`. Vitest commands below show the executable
command after removing the source-host admin-password environment variable with env -u.
Full exact invocations are recorded in the requested batch handoff.

- PRE-EDIT `pnpm --filter @jini-ai/admin exec tsc --noEmit` — exit 0, no diagnostics.
- FINAL `pnpm --filter @jini-ai/admin exec tsc --noEmit` — exit 0, no diagnostics.
- FINAL `pnpm --filter @jini-ai/admin exec vitest run src/agent-plugins`
  — exit 0, 4 files / 24 tests: controllers+16-check memory conformance 10, HTTP 2, rules/tree 5,
  React 7. Final run 11.11s; captured in `/private/tmp/jini-admin-agent-plugins-final.log`.
- REGRESSION `pnpm --filter @jini-ai/admin exec vitest run
  src/security src/playground src/source-control` — exit 0, 11 files / 50 tests, 8.23s;
  `/private/tmp/jini-admin-agent-plugins-regression.log`. Completed domains were not modified.

Independent helper confirmed five exports/runtime entries/source paths, exact React folder
layout, no raw controls in production TSX, no old UI imports or cross-domain implementation
imports, and reuse of lifecycle types. Its initial regression capture lost a yielded session id;
that result is not claimed. Primary repeated with disk capture/retained execution handle and
verified the result above. No skipped tests, weaker assertions, config changes or exclusions.

Development checks caught an untyped generic transport fixture, a duplicate tree variable in a
React test, and duplicated body/consequence copy. Fixed fixtures and the confirmation input;
retained the assertions. A mistake record documents the visible-copy issue.

No install, commit, staging, push, publish, stash, checkout or reset. Added only the new
@jini-ai/agent-plugins hard dependency and five exports/entries to admin/package.json, preserving
all inherited manifest changes. Existing ui-kit dependency and optional React peers remain.
Local dependency link: packages/admin/node_modules/@jini-ai/agent-plugins → ../../../agent-plugins,
using its existing dist declarations. No lockfile edits: shared diff remains 194 insertions /
16 deletions. Coordinated workspace install/lock update belongs to the release owner.

## Complete file inventory

- `packages/admin/src/agent-plugins/PORT.md`
- `packages/admin/src/agent-plugins/SOURCE-RATIONALE.md`
- `packages/admin/src/agent-plugins/__tests__/controllers.test.ts`
- `packages/admin/src/agent-plugins/__tests__/http.test.ts`
- `packages/admin/src/agent-plugins/__tests__/rules.test.ts`
- `packages/admin/src/agent-plugins/adapters/http.ts`
- `packages/admin/src/agent-plugins/adapters/memory.ts`
- `packages/admin/src/agent-plugins/agent-plugins.module.ts`
- `packages/admin/src/agent-plugins/conformance/agent-plugins-api.conformance.ts`
- `packages/admin/src/agent-plugins/controllers/agent-plugin-files.controller.ts`
- `packages/admin/src/agent-plugins/controllers/agent-plugins.controller.ts`
- `packages/admin/src/agent-plugins/index.ts`
- `packages/admin/src/agent-plugins/messages.en.ts`
- `packages/admin/src/agent-plugins/models.ts`
- `packages/admin/src/agent-plugins/package-file-tree.ts`
- `packages/admin/src/agent-plugins/ports.ts`
- `packages/admin/src/agent-plugins/react/__tests__/agent-plugins.test.tsx`
- `packages/admin/src/agent-plugins/react/components/AgentPluginFileContent.tsx`
- `packages/admin/src/agent-plugins/react/components/AgentPluginFileTree.tsx`
- `packages/admin/src/agent-plugins/react/components/AgentPluginInspector.tsx`
- `packages/admin/src/agent-plugins/react/components/AgentPluginListPanel.tsx`
- `packages/admin/src/agent-plugins/react/components/AgentPluginRow.tsx`
- `packages/admin/src/agent-plugins/react/hooks/AgentPluginInspector.hooks.ts`
- `packages/admin/src/agent-plugins/react/hooks/AgentPluginPanel.hooks.ts`
- `packages/admin/src/agent-plugins/react/hooks/AgentPluginRow.hooks.ts`
- `packages/admin/src/agent-plugins/react/hooks/AgentPluginsPage.hooks.ts`
- `packages/admin/src/agent-plugins/react/hooks/AgentPluginsPorts.hooks.ts`
- `packages/admin/src/agent-plugins/react/hooks/MarketplaceTab.hooks.ts`
- `packages/admin/src/agent-plugins/react/index.ts`
- `packages/admin/src/agent-plugins/react/pages/AgentPluginsPage.tsx`
- `packages/admin/src/agent-plugins/react/tabs/DownloadedTab.tsx`
- `packages/admin/src/agent-plugins/react/tabs/InstalledTab.tsx`
- `packages/admin/src/agent-plugins/react/tabs/MarketplaceTab.tsx`
- `packages/admin/src/agent-plugins/rules.ts`

Modified: `packages/admin/package.json`. Local-only dependency symlink described above.

Artifacts: own helper ledger, mistake record, session archive, and the requested host handoff.
Suggested next assignee: host integration/release owner.
