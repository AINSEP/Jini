Spec ID: SPEC-JINI-REGISTRY-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:9d5d8a7a17e2497ba1c80b174c383aa12506e3c48a487cbe5e5872017f6b814d
spec_mode: reverse_spec

# State Contract: @jini-ai/registry

## Content backends

Static backend stores the supplied manifest object by reference; caller mutation can affect later reads. There is no cloning, persistence, reload task, or disposal method. GitHub backend holds one manifest snapshot read during asynchronous creation. Publishing/yanking opens a PR and does not refresh the instance. Construct a new backend or supply external lifecycle logic to observe remote changes.

Database backend uses consumer-owned SQLite table `registry_entries`, primary key `(backend_id, name)`, columns for current version, full entry JSON, and numeric update time. Ensure is idempotent DDL. Publish/upsert replaces that row, including its entire versions array; no merge or per-version archive table is provided. Reads query all rows for the instance backend ID in name order and validate each stored entry.

Database yank is an IMMEDIATE read/modify/write transaction. Missing entry/version leaves data untouched. Yanking the top-level version also yanks the entry, which prevents resolving other versions until a consumer republishes suitable data. Repeated yanks rewrite timestamps. Dry-run publish leaves persistent rows untouched.

The consumer owns connection open/close, migrations, backup, restore, locking policy, permissions, and retention. No backend starts a worker or timer. Signature checking caches no trust decision and requires consumer-supplied stable CA material.

## GitHub mutation lifecycle

```text
read base ref/commit -> create blobs -> create tree -> create commit
-> create/update deterministic branch -> create/reuse pull request
```

The client may force-update an existing deterministic publish/yank branch. It never merges the PR. Partial remote artifacts can remain after any failing step. Repeated calls can create new commits while reusing a branch/PR; consumers must reconcile that state before retrying writes.

## Tool catalog lifecycle

`ensureToolCatalogTables` creates `tool_catalog` with ID primary key, description, nullable JSON schema, source (default first-party), and update timestamp, plus external-content `tool_catalog_fts`. It neither rebuilds an existing index nor creates triggers for external writes.

`reseedToolCatalog` transactionally replaces all rows and rebuilds FTS before commit. Failure rolls back the replacement. Rows and index survive restart in a file database; in-memory connections lose them on close. Searches/descriptions read the consumer's current connection. Input schemas are JSON serialized and parsed, not validated as a schema dialect.

`ToolCatalogQuery` is a port with no package-owned state. The unexported catalog-builder sources are outside the supported consumer lifecycle in this snapshot.

Evidence: backend and catalog adapter source; `src/__tests__/database-backend.test.ts`, `github-client.test.ts`, `src/tool-catalog/__tests__/sqlite.test.ts`. Tests were read only.

## Builder lifecycle and ports

A builder holds its immutable descriptor snapshot and authored-description map; its backend is host owned. The live wrapper owns one current query reference. Rebind changes future delegation, preserving query identity, and never disposes backend resources. SQLite factories borrow the connection and replace the database-wide catalog; retirement/close belongs to the host.
