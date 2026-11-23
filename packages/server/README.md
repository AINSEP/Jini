
# @jini-ai/server

Host composition requires the external host's SQLite opener for durable storage:

```ts
import Database from 'better-sqlite3';
import { runAnthropicToolTurn, runAzureToolTurn, runGoogleToolTurn, runOllamaToolTurn, runOpenAiToolTurn, validateBaseUrl } from '@jini-ai/agent-runtime';
import { createLocalNodeDaemon } from '@jini-ai/server';
const daemon = await createLocalNodeDaemon({
  dataDir, packs: [], open: (file, options) => new Database(file, options),
  toolTurns: { anthropic: runAnthropicToolTurn, openai: runOpenAiToolTurn, azure: runAzureToolTurn, google: runGoogleToolTurn, ollama: runOllamaToolTurn },
  baseUrlGuard: { validate: validateBaseUrl },
});
```

The preset ships no provider tool-turn or base-URL-guard implementation: `toolTurns` and
`baseUrlGuard` are required on `createLocalNodeDaemon`, and a `composeJiniKernel` that activates
`modelProxy` or `research` must supply `featureOptions.modelProxy` / `featureOptions.research`.

`composeJiniKernel` requires an explicit `security` choice: `{ mode: 'host' }` for host-owned
security, `jini-local` for local bearer/origin middleware, or `sidecar-strict` for mandatory
bearer validation before body parsing. Omitted and unknown modes fail before resources open.

For `composeJiniKernel`, use `storage: { kind: 'sqlite', dataDir, open }`; memory composition
uses `{ kind: 'memory' }` and needs no SQLite driver. All acquired event/journal/feature handles
belong to the kernel base, so independently disabling daemonDb/toolCatalog keeps health's
connection intact. Failed boot closes acquired handles; shutdown is idempotent.

`./storage` exports backend configuration resolution only, retaining the existing environment
names. It never selects or opens a driver. `./storage/legacy/sqlite` exports `openDatabase(root,
{ dataDir?, open })`, `closeDatabase()` and `migrate(db)`. This explicit local app.sqlite bootstrap
composes unchanged concern DDL for projects, conversations/messages and rich daemon sessions.
`./store/projects/sqlite` retains project CRUD and legacy run/awaiting-input projections over a
borrowed handle. No content/chat file is moved or host migration ledger applied.

No permanent package imports the compatibility shim. SQLite is an optional peer supplied by the
host; the server has no driver hard dependency or autoload behavior.

## Design decisions

- [Boot failure closes every resource already acquired](docs/decisions/DR-001-partial-boot-rollback.md).

Built-in daemon routes import `@jini-ai/daemon/http`. Middleware order is preserved:
probe routes first; in sidecar-strict mode bearer auth precedes JSON parsing, then the origin
guard; in jini-local mode JSON parsing precedes bearer auth and the origin guard. API packs,
the after-API hook and status packs follow. Hosts compose read-only attenuation innermost
around the bare executor to intercept nested recovery dispatches.

Backend config, legacy SQLite acquisition/bootstrap and project CRUD/status remain owned by `@jini-ai/server/{storage,storage/legacy/sqlite,store/projects/sqlite}`. Import these entries directly; the deprecated sqlite package no longer forwards them. Storage behavior and wire data are unchanged.

## Composition contracts

Built-in and caller packs use `definePack({ name, deps, services }, { tools, http, dispose })`.
Contribution callbacks receive an object (`{ app, services }` for HTTP, `{ services }` for tools
and disposal). Kernel composition forwards these hooks through the current core lifecycle helpers.

`agentExecutor` accepts the optional settings from `createAgentExecutor`'s second argument;
the kernel supplies its lifecycle, journal and retry classifier. Event-log cleanup passes `{}` to
the daemon's close port in both failed boot and normal shutdown.

The package TypeScript configuration includes source tests and fixtures. Published files continue
to exclude test output. The packed memory-boot fixture is local to this package so compiling server
does not pull another package's test sources outside server's source root.

## Legacy owner store (read-only)

`@jini-ai/server/owner-store` reads an old owner store so a host can import its entries. Nothing writes,
migrates or syncs an owner store any more. `countLegacyOwnerStore` counts entries and grants without the
key; `readLegacyOwnerStore` decrypts entries and lists recorded destinations, opening the file with SQLite's
read-only mode. This entry is only the file wiring: the SQL reads live in `@jini-ai/db/owner-store`, and the
passphrase-backup decoder (`readLegacyOwnerBackup`), `OwnerStoreRecoveryError`, `ownerContext` and the legacy
keyring and authorization policy live in `@jini-ai/platform/secrets/legacy-owner`. The database path, key path
and SQLite opener remain host supplied. This entry requires the `@jini-ai/db` and `@jini-ai/platform` packages.

```ts
import { countLegacyOwnerStore, readLegacyOwnerStore } from '@jini-ai/server/owner-store';
// ports: LegacyOwnerStorePorts — the host binds openKernel, the @jini-ai/db/owner-store reads,
// createVaultRepo, ownerWorkspaceId and the platform legacy-owner vault/entry readers.
const { entries } = await countLegacyOwnerStore({ filePath, open, ports });
if (entries > 0) await readLegacyOwnerStore({ filePath, keyFilePath, open, ports }, { metaParsers });
```

**Migration (breaking):** `OwnerStoreBackupError`, `OwnerStoreRecoveryError`, `readLegacyOwnerBackup`, `ownerContext`,
`OWNER_WORKSPACE_ID` and `LegacyOwnerSnapshot` moved to `@jini-ai/platform/secrets/legacy-owner`; the shared
`LegacyOwnerStoreDestination`/`LegacyOwnerStoreSnapshot` contract lives in `@jini-ai/core/contracts/site/legacy-owner-store`.
The old entry type is gone: use `VaultArchiveEntry` from `@jini-ai/platform/secrets/credential-sets`.

## Wiring

`createJiniKernelBase` / `composeJiniKernel` take the agent-executor ports through
`agentExecutor.runtime` (spawn, processes, fileLock, writer, commandShell). Omitted, the preset builds it
from the required `osPorts` (`KernelOsPorts`: processes, fileLock, writer — the host binds them with
`@jini-ai/node-adapters`' builders over `@jini-ai/platform`'s functions) plus node-adapters' Node spawn
and command shell. `createLocalNodeDaemon` takes the same `osPorts` and writes its discovery record
with `osPorts.writer`; the server imports no `@jini-ai/platform/fs` or `/process` implementation.
