# `backup/site`

Site backup/share helpers that stay neutral about the host's archive layout, limits and copy.

## Wiring

- `./backup/site/share-refusal` — the one `SiteShareRefusal` class and `archiveRefusalName`; hosts import it from here so `instanceof` has a single class. `./backup/site/archive-media` (`bufferArchiveMedia`) takes the required `host` field (`operations`, `paths`, `sharePolicy`: media sniffing/sanitizing/keys, portable-path policy, and the capped ledger/blob reads that carry the host's limits). `./backup/site/static-export-selection` takes the required `policy` field (`validateSharePath`, `sharePathAlias`, and the host's `invalidInput` refusal that owns the message).
- `./backup/site/credential-warnings` — `warnCredentialContent` and `addCredentialWarning` take the
  host's secret-shape scanner as the required `redactSecretShapes` field (a `CredentialRedactor`:
  `({ text }, { codeAware?, vendorOnly? }) => { text, redactions }`, emitting `[REDACTED:<kind>]`
  markers). The host binds its own redaction policy (its key patterns) there; this module only reads
  the fixed markers and never sees a pattern.
# backup/site

Host-neutral pieces of a site's backup / share-archive feature, moved out of a host product.

## Wiring

- `share-export-failure.ts` (`@jini-ai/devops/backup/site/share-export-failure`, universal): the unexpected-export failure carrying its stage and versions. **Needs injected**: nothing.
- `saved-keys-port.ts` (`.../saved-keys-port`, universal): `SiteSavedKeysPort` (capture / reveal / restore of a share's saved keys), `SAVED_KEYS_PATH` and `ENCRYPTED_KEYS_DESCRIPTOR`. **Needs injected**: nothing; the host implements the port (encryption, vault capture, recipient re-sealing) and passes it to its archive orchestrator. `SealedSecret` comes from `@jini-ai/core/contracts/vault`.
- `static-download-html.ts` (`.../static-download-html`, universal): `downloadForms` (disables backend-dependent forms in a downloaded static copy and reports removed actions / retained sign-in links) and `downloadDocumentBase` (drops `<base>` and rewrites refresh targets). **Needs injected**: `sourceEdits: DownloadHtmlSourceEdits` — the host's source-located HTML editor (`elements`, `attribute`, `editedHtml`, parse5 with source locations). Every read and write of the HTML goes through it, so offsets and untouched bytes stay the host's.
- **Must never import**: a host HTML owner, a credential store or vault implementation.

### Import history (`import-index/*`, node)

The indexed import history replaces a folder of per-import JSON files (the *legacy snapshot*) with one SQLite DB in the host's private workspace root `<ws>`. Every piece is a function of injected ports; the host owns the workspace root, the lock, the opener, the clock and all copy shown around these errors.

- **Storage** — `import-index/open` (`openImportIndex`) takes the host's `SqliteSyncOpener` (`open`), `clock`, `policy` (`ImportHistoryPolicy` from `@jini-ai/core/contracts/site/site-import-history`), `checkIntegrity` and one `createImportIndexIntegrityMemo({})` per composed backend. Every mutation runs under the host's existing workspace lock (`exclusive()`); lock-free `get`/`listPage` resolve the mode with `access: "read"`.
- **Payloads** — `import-index/payload-namespace` keeps upload ZIPs, their metadata and stages under `<ws>/payloads/`, so budget counting and expiry never enumerate the history root.
- **Authority** — `import-index/mode`. `<ws>/import-index.state.json` (`readIndexState` / `writeIndexState`; the host's `writeJson` must replace the file atomically at 0600) says whether `legacy`, `cutover` or `indexed` owns the history. `resolveMode` runs once per lock acquisition, after `ensurePayloadNamespace`, with `evidence` from fixed-path probes (DB / `-wal` / `-shm`, and the witness `<ws>/.history-indexed-v1`), never a root enumeration. `openExisting({ readonly })` must open the existing file only (`mustExist`) and throw `ENOENT` when the main DB file is absent. A `refused` result is latched by the host for the process; busy and out-of-space errors are thrown instead, so they are neither repaired nor latched.
- **Write fence** — before every indexed SQL mutation (admission, recovery/expiry put, ordinary put; the `beforeWrite` callback of `admitImport` / `store.put`) call `markIndexedWrite`. It durably publishes `indexed` state FIRST, then the witness (`writeIndexedWitness`: `wx`, 0600, file fsync, root flush), and only then may SQL run; a throw from either step means no SQL. Before a legacy JSON put, call `confirmLegacyAuthority` under the current lock.
- **Recovery** — active rows (`store.activeRows`) are recovered inside the next lock after cutover; `admitImport` checks the request fence, then the source conflict, then consumes the budget.
- **Pagination** — `import-index/paging` cursors back the host's list route spec and its Admin/tool mounting; the host mounts the route and tool, Jini only pages.
- **Retirement** — `retireLegacySnapshot` runs from the host's tidy under the lock: indexed mode only, from `cutoverAt + legacyRetireMs`, at most 200 regular `^<uuid>\.json$` files per pass with `mtimeMs <= cutoverAt` (no-follow `stat`), never recursing and never touching payloads, state, witness or DB artifacts. Newer files are kept (only their count is logged): they can only come from a pre-index build after a downgrade and may be the only copy.

Why the state lives outside the DB: external state plus the witness stop a missing DB from reopening the stale JSON snapshot, which lacks every post-cutover row and request fence. A crash after the state/witness publish but before SQL only closes the legacy fallback early (conservative). An allowed pre-write rollback (`cutover` → `legacy`) preserves pending owner stages in `payloads/`. Retirement is tidy-only and never removes the witness.

**Not detected** (known limits): a same-ID backup restore of an older DB, loss of committed WAL, and simultaneous loss of every piece of authority evidence (state, witness and DB).

Host binding example (node):

```ts
import { indexStatePaths, markIndexedWrite, readIndexState, resolveMode, writeIndexState, writeIndexedWitness } from '@jini-ai/devops/backup/site/import-index/mode';

const paths = indexStatePaths({ root: ws });
const writeState = ({ state }) => writeIndexState({ file: paths.state, writeJson, state });
const resolved = resolveMode({
  state: readIndexState({ file: paths.state, readJson }), access: 'locked', policy,
  evidence: { dbArtifactsPresent: dbFilesExist(), indexedWitnessPresent: kind(paths.witness) === 'file' },
  openExisting: ({ readonly }) => openImportIndex(openArgs, { mustExist: true, readonly }),
  writeState, backfill: boundBackfill, prepareRetry: ({ reason }) => moveDbAside({ reason }), log,
});
// beforeWrite for every indexed mutation:
const beforeWrite = () => { state = markIndexedWrite({ state, clock, writeState, ensureIndexedWitness: () => writeIndexedWitness({ root: ws, fs: payloadFs }) }); };
```

- **Must never import**: a host product, Express, a native SQLite driver (the opener is injected), or another package's implementation files.
