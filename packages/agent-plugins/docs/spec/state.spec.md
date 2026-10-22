Spec ID: SPEC-JINI-AGENT-PLUGINS-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:860223beaa86e0b0388a21d60108a153905c41843e7d0103a957608661c8ce26
spec_mode: reverse_spec


# State Contract: Agent Plugins

## Filesystem lifecycle

An explicit absolute root contains `ws/<lowercase-workspace-id>/packages/sha256/<digest>`, workspace `staging/`, and `data/<plugin-id>/`. Workspace and plugin path segments must be at most 64 characters and use lowercase alphanumeric groups separated by single periods or hyphens. Workspace ids are lowercased; plugin ids are validated as supplied. Installed package bytes persist independently from activation and host MCP records. Uninstall does not delete the plugin-data directory.

Install progresses from verified archive to temporary extraction to manifest/index validation to renamed digest directory to frozen permissions. Digest reuse returns a fresh index of the existing directory. Only lowercase 64-hex directory names participate in discovery; missing package directories return empty, malformed packages are skipped, and other directory-read failures propagate. Discovery does not hash installed files again.

## Activation document

`ACTIVATIONS_FILENAME = 'activations.json'`; the durable document is:

```ts
type AgentPluginActivations = {
  schemaVersion: 1;
  plugins: Readonly<Record<string, {
    enabled: boolean;
    origin: 'bundled' | 'operator-installed';
    updatedAt: string;
    updatedBy: string;
  }>>;
};
```

Missing document/entry resolves active. Bundled seeding explicitly records disabled unless host seed policy enables the id. A record still disabled by `system:seed` can be enabled by seed/successor policy; an operator-disabled record stays disabled. A toggle preserves existing bundled origin unless an explicit origin is supplied and stamps actor/time. Delete removes the record rather than writing a tombstone; subsequently absent activation defaults active.

`resolveAgentPluginActivation` returns `active`, `inactive`, or `undetermined`. Whole-document read/parse/schema failure and a malformed target record resolve undetermined and block guarded execution. `readAgentPluginActivations` and `normalizeActivations` are permissive projections: unreadable documents become empty and invalid entries disappear. Do not use those projections as the execution-authority check.

Writes serialize in-process per resolved workspace root and acquire `ACTIVATIONS_LOCK_FILENAME = 'activations.json.lock'` across processes. They read fresh raw data under lock, preserve unrelated raw entries, and reject unreadable documents or unreadable target entries on toggles. The writer creates a `0600` exclusive temporary file, writes and fsyncs it, verifies lock ownership, renames it, and best-effort syncs the directory on non-Windows platforms. Failures before rename leave the original document; failures after rename are not rolled back.

## Lock lifetime

Activation passes 15000ms timeout / 10000ms staleness / 10ms fixed polling to the shared platform lock. A holder records `{ pid, hostname, token, acquiredAt }`. Acquisition uses exclusive file creation and core wall-clock elapsed time. Staleness is age over budget OR a dead same-host pid, with unchanged inode/device; bytes and mtime are also rechecked before removal. There is no heartbeat. A long live critical section can lose ownership; publication requires the held-lock check. Shared release matches token plus inode/device.

`HeldFileLock` exposes `lockPath` and `assertHeld({}): Promise<void>`. Critical sections must assert ownership immediately before committing. Release only removes a lock with the caller's token. A stale owner cannot intentionally delete a newer owner's lock. The age threshold is a lease-like bound, not proof of process death.

## Bundled digest ledger

`BUNDLED_DIGESTS_FILENAME = 'bundled-digests.json'` stores schema version 1 and plugin records `{ archiveDigest, seededAt }`. Read/parse/schema failures yield an empty map. Only safe ids and lowercase 64-hex digests survive normalization. Multiple differing digests for one id in the same seed batch remove that id's trust grant. Entries not present in the batch are retained. Writes fsync a temporary file and rename it; unlike activation writes, ledger updates have no cross-process lock or directory fsync. The consumer must serialize concurrent ledger updates if lost-update avoidance is required.

## Host context and recovery

Internal module instances/activation queues are cached by injected context identity using WeakMaps. Keep one stable context; supplying optional factory values creates a merged context for that factory call. There is no explicit close/dispose or automatic reseed task. The host invokes seeding and retirement on its own startup path and owns MCP retry/reconciliation. A successful local install/enable/uninstall does not establish successful remote provisioning.

Uninstall renames trees to `.uninstalling-*`, deletes activation, then removes frozen trees. Before activation commit, rollback restores staged trees in reverse order; failed restores remain for recovery and are named in the error. After commit, a deletion failure requires inspecting retained quarantine paths. No automatic quarantine recovery is provided.

Evidence: `src/lifecycle/{layout,index,activation,bundled-digests,install,uninstall,mcp-provisioning}.ts`; tests include durable-write, corrupt-file, cross-process activation, lock-loss, and rollback scenarios. They were not run for this documentation job.
