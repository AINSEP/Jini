# cms/change-sets

## Wiring

- `agent-tools.ts`: the `change_sets_list` / `change_sets_revert` catalog and permission/limit constants. The host builds registrations and binds its change-set repo and revert registry in its tool-registration module.
- `tool-registrations.ts`: builds `change_sets_list` / `change_sets_revert` registrations over `core/commands`' `revertChangeSet`. The host injects every collaborator through `ChangeSetToolDeps` (authorize, workspaceId, changeSets repo, the shared `revertRegistry`, clock, idGen, outbox) and installs `contributeChangeSetsTools()` in its tool-catalog manifest.
