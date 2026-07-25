# `@jini/composio`

Incubating, Node-only Composio integration package for Jini hosts.

It provides:

- a static and live Composio toolkit catalog with bounded per-connector tool
  previews;
- injectable file-backed configuration and credential stores;
- connected-account OAuth lifecycle support;
- direct tool execution with output protection and per-run limits; and
- a Composio-prefixed application service that coordinates those pieces.

The package is headless. It does not register HTTP routes, import UI code, or
assume a Jini host layout. Hosts inject the user id, config store, fetch
implementation, cache path, and optional curation data.

Provider and persisted data are treated as untrusted. The package revalidates
user, connector, toolkit, auth-config, account, and active-status ownership
before execution or disconnection; recomputes tool safety at the effect
boundary; validates the supported JSON Schema subset fail-closed; bounds
execute identifiers and input before provider I/O; bounds responses and cache
files; redacts secret-shaped output fields; rejects symlinked secret files;
enforces owner-only secret-file mode; and serializes file-store and catalog
cache updates with ownership-checked cross-process locks and atomic rename.

Catalog discovery is metadata-only. Tool schemas are loaded through bounded
per-connector preview or current-hydration calls; aggregate catalog hydration
is rejected. Provider-discovered tools remain display-only unless their exact
provider identifiers are curated by the package or host. Execution always
uses a current strict hydration: provider failure denies execution, and a
successful current response that omits a curated static tool revokes that
tool's execution authority. A provider-reported connected state is likewise
insufficient without matching persisted credential evidence.

```ts
import {
  ComposioConnectorProvider,
  ComposioConnectorService,
  ConnectorStatusService,
  FileConnectorCredentialStore,
  createFileComposioConfigStore,
} from '@jini/composio';

const configStore = createFileComposioConfigStore({
  filePath: '/var/lib/example/composio/config.json',
});
const credentialStore = new FileConnectorCredentialStore({
  filePath: '/var/lib/example/composio/credentials.json',
});
const provider = new ComposioConnectorProvider({
  userId: 'user_123',
  configStore,
  catalogCachePath: '/var/lib/example/composio/catalog-cache.json',
});
const service = new ComposioConnectorService({
  provider,
  statusService: new ConnectorStatusService({ credentialStore }),
});
```

`@jini/composio` is not yet part of the locked package set. See
`UNLOCKED.md` and `source-map.md` for its admission status, provenance, and
accepted live-credential verification gap.

Verification commands:

```sh
pnpm --filter @jini/composio run typecheck
pnpm --filter @jini/composio run test
pnpm --filter @jini/composio run test:coverage
```

The committed coverage gate includes every `src/**/*.ts` module and requires
100% statements, branches, functions, and lines. Coverage exclusions and
ignore directives are not used.
