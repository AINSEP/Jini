# workspace (admin screens)

The workspace settings screen: the current workspace's rename form (name, slug), its read-only
identity summary (id, created) and the always-disabled delete control. The controller hook (fetch,
draft, save, locale), the API client, the error-code copy and the delete notice copy stay in the
host and arrive here as props.

| file | what it is |
|---|---|
| `Workspace.tsx` | The screen — markup only — plus the `WorkspaceController` shape its hook returns. |
| `rules.ts` | `isWorkspaceDirty` — whether the rename draft differs from the persisted workspace. |
| `hooks/workspace-port.hooks.ts` | `WorkspacePort` — the two calls a host's controller hook makes. |

## Wiring

Architecture: [DR-005 portable package boundaries](../../../../../docs/decisions/DR-005-portable-package-boundaries.md).

**Needs injected**
- `useWorkspaceHook: () => WorkspaceController` — REQUIRED. The host's workspace hook: loads the
  workspace through its `WorkspacePort` binding, owns the rename draft and save, resolves the
  locale and returns a bound `t`.
- `deletion: { lead, unavailableTitle }` — the host's copy (translation keys, resolved through the
  controller's `t`) explaining why deleting is unavailable in its deployment.
- `showPageHeader?` — `false` when the host mounts the screen inside a shell that already shows its
  title (for example as a settings tab).

**Provides**: `Workspace`, `WorkspaceController`, `WorkspaceProps`, `isWorkspaceDirty`,
`WorkspacePort`. The wire DTO is `AdminWorkspaceResponse` from `@jini-ai/core/contracts/site/cms-workspace`.

**Classes** (host styles them): `jini-page`, `jini-workspace-page`, `jini-page-header*`,
`jini-notice`, `jini-notice-error`, `jini-integrations-form`, `jini-form-measure`,
`jini-settings-layer-grid`, `jini-settings-layer-cell`, `jini-settings-layer-label`,
`jini-workspace-identity-grid`, `jini-card`, `jini-card-danger`, `jini-card-title`, `jini-card-lead`,
`jini-btn-danger`, `jini-save-error`, `jini-save-success`.

**Host binding today**: the host's admin workspace feature keeps a thin `Workspace` wrapper that
binds its wired hook and delete copy and renders this screen, plus its port binding and fake.

**Must never import**: host app code, host copy, an API client or an i18n provider.
