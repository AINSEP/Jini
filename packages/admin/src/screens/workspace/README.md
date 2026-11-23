# workspace (admin screens)

The workspace settings screen: the current workspace's rename form (name, slug), its read-only
identity summary (id, created) and the always-disabled delete control, plus its controller hook
(`useWorkspace`: fetch, rename draft, save). The API client, the locale, the dictionary, the
error-code copy and the delete notice copy stay in the host and arrive here as hook args or props.

| file | what it is |
|---|---|
| `Workspace.tsx` | The screen — markup only — plus the `WorkspaceController` shape its hook returns. |
| `rules.ts` | `isWorkspaceDirty` — whether the rename draft differs from the persisted workspace. |
| `hooks/workspace-port.hooks.ts` | `WorkspacePort` — the two calls the controller hook makes. |
| `hooks/use-workspace.hooks.ts` | `useWorkspace` — the controller hook (load, rename draft, save, bound `t`) the host binds and passes to the screen. |

## Wiring

Architecture: [DR-005 portable package boundaries](../../../../../docs/decisions/DR-005-portable-package-boundaries.md).

**Needs injected**
- `useWorkspaceHook: () => WorkspaceController` — REQUIRED. The host's wired workspace hook: it
  calls `useWorkspace({ port, locale, translate, describeError })` with its `WorkspacePort` binding,
  its resolved admin locale, its workspace dictionary and its error-code copy (the host's admin
  workspace feature's `workspace-dependencies.hooks.ts` binds all four as `useWiredWorkspace`).
- `deletion: { lead, unavailableTitle }` — the host's copy (translation keys, resolved through the
  controller's `t`) explaining why deleting is unavailable in its deployment.
- `showPageHeader?` — `false` when the host mounts the screen inside a shell that already shows its
  title (for example as a settings tab).

**Provides**: `Workspace`, `WorkspaceController`, `WorkspaceProps`, `isWorkspaceDirty`,
`WorkspacePort`, `useWorkspace`, `WorkspaceDependencies`, `WorkspaceTranslate`, `WorkspaceErrorDescriber`. The wire DTO is `AdminWorkspaceResponse` from `@jini-ai/core/contracts/site/cms-workspace`.

**Classes** (host styles them): `jini-page`, `jini-workspace-page`, `jini-page-header*`,
`jini-notice`, `jini-notice-error`, `jini-integrations-form`, `jini-form-measure`,
`jini-settings-layer-grid`, `jini-settings-layer-cell`, `jini-settings-layer-label`,
`jini-workspace-identity-grid`, `jini-card`, `jini-card-danger`, `jini-card-title`, `jini-card-lead`,
`jini-btn-danger`, `jini-save-error`, `jini-save-success`.

**Host binding today**: the host's admin workspace feature keeps a thin `Workspace` wrapper that
binds its wired hook and delete copy and renders this screen, plus its port binding, its fake and
`useWiredWorkspace` (which injects the locale, dictionary and error copy into `useWorkspace`).

**Must never import**: host app code, host copy, an API client or an i18n provider.
