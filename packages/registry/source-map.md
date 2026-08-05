# `@jini/registry` — provenance

**New package, not yet in the locked §3 package set in
`ADS-memory/reports/jini-port/extraction-plan.md`.** Per that doc's precedent for
`@jini/deploy` ("a genuinely new package this list didn't originally
enumerate — listed here for visibility, not folded into the locked set
until reviewed"), the same applies here: this package needs Coordinator/
Software-Architect sign-off before being folded into the locked list. It was
built per the task-6 audit's PART A brief off `ADS-memory/reports/jini-port/recon/
r1-daemon.md`'s TASK 1 MIXED classification for `registry/`: "Pluggable
content-registry backends (`static`/`github`/`database`/`versioning`) —
generic pattern, but typed against `@open-design/registry-protocol` +
`MarketplaceManifest` (OD marketplace). Split protocol from OD manifest."

## Why a new package instead of folding into `@jini/core` or `@jini/sqlite`

The task brief suggested `@jini/core` as a likely home. Read `@jini/core`'s
own `source-map.md` first: its charter is explicitly composition-only — "a
from-scratch implementation of the typed composition contract... there is
nothing to port" — it holds zero concrete port/adapter implementations
today (`token.ts`/`pack.ts`/`bindings.ts`/`daemon.ts` are all pure DI
machinery). Adding stateful backend classes (in-memory, GitHub-PR-mutating,
sqlite-backed) would be a first-of-its-kind widening of that charter, which
reads as exactly the kind of ad-hoc scope creep extraction-plan.md §9 warns
against ("a new kernel token requires a kernel invariant, not merely a need
discovered by the first consumer").

`@jini/sqlite` was the other candidate (it already holds one concrete
`better-sqlite3`-backed adapter, `event-log.ts`, implementing `@jini/daemon`'s
`EventLog` port). But `@jini/sqlite`'s own source-map.md scopes it
specifically to durable adapters for daemon/core kernel ports; a registry
backend is not a kernel port and two of the three backends here
(`static`/`github`) have no sqlite dependency at all.

Instead this follows the same shape as `@jini/sqlite` itself: `@jini/protocol`
defines the pure wire types and the `RegistryBackend` port (already true
before this change — see "What already existed" below); this new leaf
package holds concrete backend implementations against that port, exactly
as `@jini/sqlite` holds concrete `EventLog` implementations against
`@jini/daemon`'s port.

## What already existed (this task reused it, did not duplicate it)

`packages/protocol/src/registry.ts` — `RegistryEntry`, `RegistryBackend`,
`RegistrySearchQuery`/`Result`, `RegistryPublishRequest`/`Outcome`,
`RegistryYankOutcome`, `RegistryDoctorReport` — was ported in an earlier
session (branch `port/http-sqlite-platform-protocol-plus`, commit
`1572052f8`, "feat(protocol): add registry-protocol wire schemas"), already
merged to `main`. This task's PART A did **not** re-port those; it added one
new schema to that same file (`RegistryManifestSchema` — see below) and
built the concrete backends on top.

## Origin

`leonaburime-ucla/open-design`'s `refactor/web-memory-slice` branch (cloned
fresh to `/tmp/od-source`), `apps/daemon/src/registry/` (4 files: `static-
backend.ts`, `github-backend.ts`, `database-backend.ts`, `versioning.ts`).

## File map

| Jini file | Origin file | Transform |
|---|---|---|
| `src/versioning.ts` | `registry/versioning.ts` | `parsePluginSpecifier`→`parseRegistrySpecifier` (generic rename); `resolveMarketplaceEntryVersion`→`resolveRegistryEntryVersion`, retyped from `MarketplacePluginEntry` to `@jini/protocol`'s `RegistryEntry` — the field shapes are already identical (both carry `version`/`source`/`ref`/`versions`/`distTags`/`integrity`/`manifestDigest`/`deprecated`), so this is a type-only swap; the npm-style caret/tilde/prerelease semver resolution logic is byte-identical. |
| `src/static-backend.ts` | `registry/static-backend.ts` | `StaticRegistryBackendOptions.manifest` retyped from OD's `MarketplaceManifest` to `@jini/protocol`'s new `RegistryManifest` (`entries` instead of `plugins`). Because `RegistryManifest.entries` is already `RegistryEntry[]` (not a separate `MarketplacePluginEntry` needing conversion), the origin's `toRegistryEntry`/`normalizePublisher` conversion step is gone — replaced with a `RegistryEntrySchema.safeParse` defensive filter (`validEntries()`) that keeps the same "drop malformed entries silently" behavior without a type-conversion step that no longer applies. `list`/`search`/`resolve`/`doctor` logic otherwise unchanged. |
| `src/github-backend.ts` | `registry/github-backend.ts` | `GithubRegistryClient.readMarketplace`→`readManifest` (returns `RegistryManifest`); `marketplacePath`→`manifestPath`, default path `plugins/registry/official/open-design-marketplace.json`→`registry/index.json` (de-branded, generic default); publish/yank's file-tree root `plugins/${vendor}/${name}`→`entries/${vendor}/${name}` (de-branded — "plugins" is OD's marketplace vocabulary, "entries" matches the generic `RegistryEntry` noun). Publish/yank PR-mutation logic otherwise unchanged. |
| `src/database-backend.ts` | `registry/database-backend.ts` | Retyped from `MarketplaceManifest`/`MarketplacePluginEntry` to `RegistryManifest`/`RegistryEntry`; `manifestFromDb`'s per-row `toRegistryEntry` validation step dropped for the same reason as `static-backend.ts` (rows already store `RegistryEntry` JSON, no marketplace-shaped conversion needed); table schema, dry-run/db:// changed-file paths ("plugins/"→"entries/", matching the github-backend rename), and publish/yank logic otherwise unchanged. |
| `src/index.ts` | *(new — barrel)* | Re-exports the four modules' public surface. |

## New protocol schema: `RegistryManifestSchema`

Added to `packages/protocol/src/registry.ts` (not a new file) alongside the
already-ported `RegistryEntry`/`RegistryBackend` schemas: `{ specVersion,
name, version, entries: RegistryEntry[] }`. This is the direct generic
counterpart of OD's `MarketplaceManifest` (`{ specVersion, name, version,
plugins: MarketplacePluginEntry[] }`, `packages/contracts/src/plugins/
marketplace.ts`) — same envelope shape, `entries` instead of the
marketplace-specific `plugins`. Kept in `@jini/protocol` rather than this
package because it is a pure wire type with the same "no runtime/backend
logic" charter as every other schema in that file, and because both this
package and any future non-backend consumer (e.g. a CLI that just reads a
manifest file) need it without depending on `@jini/registry`'s concrete
backend code.

## De-branding

No `Open Design`/`OD_`/`--od-stamp` strings anywhere in this package (grep-
verified). Every "marketplace"/"plugin(s)" noun tied to OD's specific
product vocabulary was replaced with the generic "registry"/"entry"/
"entries" vocabulary already established by the protocol-layer port. `gh`-
style file-tree conventions (`entries/<vendor>/<name>/...`) are backend
implementation detail, not product identity.

## Dependencies

`@jini/protocol` (workspace) for the wire types/schemas; `better-sqlite3`
(matching `@jini/sqlite`'s existing dependency) for `database-backend.ts`
only — `static-backend.ts`/`github-backend.ts` have no database dependency.

## 2026-07-21 hardening pass

Targeted audit of every file in `src/` (not just this doc), matching the
rigor of `ADS-memory/reports/code-review/CR-remaining-backend-audit-2026-07-21.md`
and `ADS-memory/reports/security/SEC-remaining-backend-audit-2026-07-21.md`
(both already covered this package as CR-008/CR-009/SEC-RB-005 — those were
independently re-verified against the current tree, not re-derived from
scratch). CR-008/CR-009/SEC-RB-005's headline items (version-identity
mismatch, `list()` ignoring its filter, database `publish()` ignoring
`dryRun`, `yank()` reporting false success, the hardcoded `'official'`
trust default) were **already fixed** in an earlier commit on this branch
(`97ad2d80f`, before this session started — see its own commit message for
detail) and were still passing on re-verification; this pass looked for
what was genuinely still open, not a re-litigation of already-closed items.

**Findings, fixed:**

- **Medium — manifest envelope not guarded against a non-array `entries`,
  crashing `list`/`search`/`resolve`/`doctor` with a bare `TypeError`
  instead of a clear diagnostic.** `validEntries()` called
  `manifest.entries.flatMap(...)` and `doctor()` did `for (const raw of
  entries)` (`packages/registry/src/static-backend.ts`, pre-fix) assuming
  `RegistryManifestSchema`-shaped input, but nothing on the read path
  actually runs that schema against the manifest *envelope* — only against
  each entry inside it. `GithubRegistryBackend.create()`
  (`packages/registry/src/github-backend.ts:127-132`) passes whatever its
  injected `client.readManifest()` returns straight through with no
  validation; a malformed remote JSON file (missing `entries`, or `entries`
  not an array) would throw a bare `TypeError` out of a caller-facing method
  instead of the clear, attributable errors this package uses everywhere
  else for corrupt input (`database-backend.ts`'s `parseStoredEntry`,
  `github-backend.ts`'s `assertSafeEntryName`/`assertSafeVersion`). Fixed by
  adding `manifestEntriesRaw()`/updating `validEntries()`
  (`packages/registry/src/static-backend.ts:240-261`) to treat a non-array
  `entries` as no entries (matching the existing "drop malformed content
  silently" philosophy for read paths), and by having `doctor()`
  (`packages/registry/src/static-backend.ts:162-170`) report one explicit
  `malformed-manifest` issue instead of crashing — consistent with its own
  documented purpose ("surface malformed data," not hide it by returning an
  empty, `ok: true` report). Tests:
  `packages/registry/src/__tests__/static-backend.test.ts`'s "malformed
  manifest envelope on the read paths" and "flags a malformed manifest
  envelope" / "flags a manifest with entries entirely missing" `doctor`
  cases; `packages/registry/src/__tests__/github-backend.test.ts`'s
  "malformed remote manifest (SEC-RB-005)" case exercises the actual
  external-boundary scenario (a client returning `entries: 'not-an-array'`)
  this was originally about.

- **High — `publish()` validated only `name`/`version`'s path-safety, not
  the rest of the request, against the wire schema — `DatabaseRegistryBackend`
  could have a single malformed `publish()` call permanently break every
  future read for that backend.** `database-backend.ts`'s `publish()`
  (pre-fix) wrote `request.entry` straight to the `registry_entries` table
  with no schema check. But every read path
  (`manifestFromDb()`/`parseStoredEntry()`,
  `packages/registry/src/database-backend.ts:152-164`) **throws** — not
  silently drops — on a row that fails `RegistryEntrySchema`, on the
  documented theory that data this backend itself wrote should already be
  schema-shaped. A caller passing a malformed `entry` (wrong field type, or
  a `name` not matching the required `vendor/name` shape) to `publish()`
  would write exactly such a row, then permanently break `list`/`search`/
  `resolve`/`doctor` for that backend id until someone manually repaired
  the row — a denial-of-service reachable through the ordinary public API
  by an innocently-malformed caller, not just an attacker.
  `github-backend.ts`'s `publish()` had the analogous but lower-severity gap:
  it validated `name`/`version` shape for path/branch safety
  (`assertSafeEntryName`/`assertSafeVersion`) but not the rest of the entry
  before writing it into a real PR against a shared external manifest.
  Fixed by adding `assertValidPublishRequest()`
  (`packages/registry/src/static-backend.ts:263-294`, exported so both
  backends share one validator) which parses the whole request against
  `RegistryPublishRequestSchema` and throws a clear error on failure; wired
  into `database-backend.ts:52` (before any DB write) and
  `github-backend.ts:143` (after the existing path-safety asserts, so their
  more specific error messages still fire first for the traversal/branch-
  injection cases those asserts exist for). Tests:
  `packages/registry/src/__tests__/database-backend.test.ts`'s "publish
  rejects a malformed entry instead of writing a row that would poison
  future reads" and "...a wrongly-typed field..." cases (both assert
  nothing was written and the backend stays usable);
  `packages/registry/src/__tests__/github-backend.test.ts`'s "publish
  rejects an entry that passes name/version path-safety but fails the wire
  schema otherwise"; `packages/registry/src/__tests__/static-backend.test.ts`'s
  `assertValidPublishRequest` describe block (unit-level, both the
  pass-through and rejection cases).

- **Medium — `DatabaseRegistryBackend.yank()`'s read-modify-write was two
  separate auto-committing statements, not one atomic operation, leaving a
  lost-update window against a concurrent writer sharing the same database
  file.** `yank()` (pre-fix,
  `packages/registry/src/database-backend.ts:60-85`) ran a bare `SELECT`,
  computed `nextVersions` from the result, then ran a separate `UPSERT` —
  with nothing binding those two statements together at the SQLite level. A
  second connection/process writing to the same row between them (a
  realistic shape for this backend, since the whole point of a
  `better-sqlite3`-backed registry is a shared file multiple daemon
  instances could point at) would have its change silently overwritten when
  the stale-data-derived `UPSERT` finally ran. Fixed by wrapping the whole
  read-modify-write in `this.db.transaction(...).immediate()`
  (`packages/registry/src/database-backend.ts:78-104`) — `.immediate()`
  acquires the write lock at the *start* of the transaction, before the
  `SELECT` even runs, so a concurrent writer is rejected for the whole
  operation instead of being able to interleave. Test:
  `packages/registry/src/__tests__/database-backend.test.ts`'s "yank
  concurrency (read-modify-write atomicity)" describe block — uses two real
  file-backed `better-sqlite3` connections (not `:memory:`, which each
  connection would see independently) and intercepts the exact moment
  `yank`'s `SELECT` runs to attempt a genuinely concurrent write from the
  second connection at that point; asserts the concurrent write is rejected
  (`SQLITE_BUSY`) and the yank itself still succeeds — proving the whole
  operation now holds the lock, not just proving the code runs. Both
  connections are constructed with a short explicit `timeout` (50ms,
  `packages/registry/src/__tests__/database-backend.test.ts:230-235`)
  because `better-sqlite3`'s default busy-wait budget is 5000ms, which would
  otherwise make this one test take 5+ seconds for no benefit.

**Findings, deferred to a proposal doc (needs architect/human sign-off):**

- **High (the still-open half of SEC-RB-005) — registry `trust` is entirely
  config-asserted; `RegistryEntrySchema.signatures[]` is defined in
  `@jini/protocol` but never read or verified by any backend.** A host can
  still explicitly construct a backend with `trust: 'official'` (this
  session's earlier-branch fix only removed the *automatic* default, not
  the option itself) with nothing cryptographically backing that claim.
  Closing this for real requires deciding which signature kind(s) to verify
  first, where a trust-root/allowlist lives, and whether verified trust
  replaces/narrows/sits-alongside the existing backend-level `trust`
  field — the last of which is a `@jini/protocol` schema decision outside
  this package's boundary. Write-up:
  `ADS-memory/reports/proposals/PROP-registry-signature-trust-verification-2026-07-21.md`.
  Not implemented.

**Observed, not fixed (reasoned as acceptable, not requiring a proposal):**

- `GithubRegistryBackend.yank()` does not check whether the requested
  `name`/`version` actually exists in its locally-held manifest snapshot
  before opening a PR (`packages/registry/src/github-backend.ts:175-208`),
  unlike `DatabaseRegistryBackend.yank()`'s existence check
  (`database-backend.ts:90-93`, the original CR-009 fix). This is an
  intentional asymmetry, not an oversight: the GitHub backend's manifest
  snapshot is read once at `create()` time and can be stale relative to the
  real upstream file (which may have gained the target version via an
  already-merged PR since), so a local "not found" check could produce a
  false rejection. The GitHub flow's actual safety net is the PR review
  itself — a human reviewing a yank PR for a genuinely nonexistent
  entry/version would see a nonsensical diff (a "yank" that creates a new
  file rather than modifying an existing one) and reject it. Revisit if
  this backend ever gains a live-synced manifest.
- `list()`/`search()`'s `RegistryListFilter` has no result-count bound at
  the protocol layer (`search()` is capped at `query.limit ?? 100`, itself
  ceilinged at 500 by `RegistrySearchQuerySchema`, but `list()` has no
  equivalent). Not fixed: adding one would mean changing
  `@jini/protocol`'s `RegistryListFilterSchema`, which is outside this
  package's boundary and this task's scope. Low severity in practice — a
  content/plugin registry's entry count is operator-controlled, not
  attacker-controlled unbounded content, unlike (for comparison) an
  arbitrary-user-upload surface. Worth a proposal if this package is ever
  promoted and a registry with a genuinely large entry count becomes real.
- `GithubRegistryClient`/its actual HTTP implementation (timeout, retry,
  rate-limit handling for the real GitHub API calls) does not exist in this
  package — `readManifest`/`createPublishPullRequest` are an injected
  interface with no concrete implementation anywhere in this repo yet
  (confirmed via repo-wide grep). There is nothing to harden here until a
  real implementation is built; noted so a future implementer doesn't
  assume this package already covers that concern.

**Verification:** `pnpm --dir packages/registry exec vitest run --coverage`
— 103/103 tests pass, 100% statements/branches/functions/lines on
`database-backend.ts`, `github-backend.ts`, `index.ts`, `static-backend.ts`
(the four files touched this pass); `versioning.ts` (untouched this pass)
stays at its pre-existing 99.3% branch coverage, one pre-existing gap this
pass did not introduce or touch. Package-wide aggregate 100/99.68/100/100,
above the package's configured 99% threshold gate
(`packages/registry/vitest.config.ts`). `pnpm --dir packages/registry exec
tsc --noEmit` clean. `pnpm guard` (repo root) clean. `pnpm --dir
packages/protocol exec vitest run` (unmodified, but exercised more heavily
via `RegistryPublishRequestSchema`) still 10/10 passing.

## 2026-07-21 — production-hardening audit, part 2: closing the one flagged gap, confirming no other genuine gaps

Follow-up pass specifically scoped to "what production-hardening work is
still open" (as opposed to the hardening pass above, which was a fresh
line-by-line audit of every file). Re-read `database-backend.ts`,
`github-backend.ts`, `static-backend.ts`, `versioning.ts`, and
`@jini/protocol`'s `registry.ts` schemas in full, specifically hunting for
rate limiting, additional validation, and concurrency edge cases beyond what
the hardening pass above already found/fixed/deferred/accepted. Also
`grep`ed the whole package for `TODO`/`FIXME`/`XXX` (none found).

**Findings:**

- **The one concrete gap this session's own hardening-pass section already
  named but did not close: `versioning.ts`'s 99.3% branch coverage.** The
  pass above fixed four other files but explicitly left this one
  "untouched." Reading `versioning.ts` line-by-line to find the actual
  uncovered branch (rather than assuming it was cosmetic) surfaced a real,
  previously-untested correctness case: `resolveRegistryEntryVersion`'s
  final yanked check (`packages/registry/src/versioning.ts:73`,
  `if (versionRecord?.yanked) return null;`) is reachable two ways — (a) a
  caller requests a *specific* version/dist-tag that turns out to be
  yanked (already tested — `resolveRequestedVersion`'s own
  `versionExists` filters that case before this line is even reached with a
  non-null `targetVersion`), and (b) **no range is requested at all**, so
  resolution falls through to `distTags.latest`/`entry.version` — and *that*
  default can itself name a version that is present in the `versions`
  ledger but marked `yanked` there. Case (b) had no test: every existing
  yanked-related test either requested an explicit version/range, or
  exercised the "no `version`/`distTags` at all" fallback (which walks
  `versions.find(v => !v.yanked)` and therefore can never land on a yanked
  record in the first place). Without this line, a caller asking for
  "whatever the default/latest version is" on an entry whose declared
  default happens to be yanked would silently receive that version's
  source/integrity instead of `null` — i.e. the exact "don't silently serve
  a yanked release" property `resolveRequestedVersion`'s own doc comment
  already promises for the *explicit*-request path, but which had no test
  proving it also holds for the *default* path. Fixed by adding
  `packages/registry/src/__tests__/versioning.test.ts`'s "returns null
  instead of silently serving a yanked version when it is the resolved
  DEFAULT (no range requested)" test, covering both the `distTags.latest`
  and bare `entry.version` routes to that line. No production code changed
  — the guard already existed and was already correct; only the missing
  proof was added. `versioning.ts` is now 100/100/100/100, and the
  package-wide aggregate is 100/100/100/100 (up from the prior
  100/99.68/100/100 baseline).

**Re-confirmed as already covered by the pass above (not re-litigated):**
signature/trust verification remains proposal-gated
(`ADS-memory/reports/proposals/PROP-registry-signature-trust-verification-2026-07-21.md`,
untouched); the `GithubRegistryBackend.yank()` no-existence-check asymmetry,
`RegistryListFilter`'s missing result-count bound, and the absent
`GithubRegistryClient` HTTP implementation all remain as previously reasoned
(acceptable / out of this package's boundary / nothing to harden yet).

**No rate limiting was added.** Searched deliberately for a rate-limiting
gap (the task's own suggested example of "production hardening" work) and
found none to close within this package's boundary: `database-backend.ts`
has no network calls to rate-limit (pure sqlite I/O); `static-backend.ts`
has no I/O at all; `github-backend.ts`'s `GithubRegistryClient` is a
caller-injected interface with — as already noted above — **no concrete
implementation in this repo**, so there is no real outbound HTTP call site
in this package to attach a rate limiter to. Rate-limiting a call this
package never actually makes would be speculative surface with nothing to
validate it against; deferred, consistent with the "nothing to harden until
a real client implementation is built" reasoning already on record above.

**No new concurrency edge case was found beyond the ones already fixed in
the pass above** (`DatabaseRegistryBackend.yank()`'s atomic
read-modify-write). `DatabaseRegistryBackend.publish()`'s
`upsertRegistryEntry` is a single `INSERT ... ON CONFLICT DO UPDATE`
statement — atomic at the SQLite level already, no read-then-write window to
race. `GithubRegistryBackend.publish()`/`yank()` each open exactly one PR
per call with no local mutable state shared across calls; two concurrent
publishes for the same name/version would (at worst) open two PRs against
the same branch name, which GitHub itself rejects/reconciles at the git
level — a real client-implementation concern (see above), not a gap in this
package's own logic.

**Verification:** `pnpm --dir packages/registry exec vitest run --coverage`
— 104/104 tests pass (one new test added), package-wide aggregate
100/100/100/100 statements/branches/functions/lines (up from
100/99.68/100/100), above the package's configured 99% threshold gate.
`pnpm --dir packages/registry exec tsc --noEmit` clean.

## 2026-07-21 — signature/trust verification (`github-oidc`)

Implements the proposal above
(`ADS-memory/reports/proposals/PROP-registry-signature-trust-verification-2026-07-21.md`)
per human/architect sign-off on its four open questions. Kept in its own
commit, separate from the concrete `GithubApiRegistryClient` work below
(a different, independent gap this doc's hardening passes also flagged) —
see that section's own header for why the two aren't conflated.

**Decisions, as given (not re-litigated):** (1) v1 supports exactly one
`RegistrySignatureSchema.kind` — `github-oidc`; `cosign`/`minisign`/`custom`
are recognized and always report "unsupported kind, cannot verify", never
silently pass, never throw. (2) Per-entry verified trust is **additive**
alongside the existing backend-level `trust` field, never replacing/
narrowing it. (3) The trust-root/allowlist is a constructor option on each
backend, matching how `trust` itself already is one. (4) Built now, zero
behavior change for a backend that doesn't configure a trust root.

**New file `src/trust.ts`** — the verifier. Exports `RegistryTrustRoot`
(`{ githubOidc?: GithubOidcTrustRoot }`, an envelope keyed by signature kind
so future `cosign`/`minisign` roots can be added without a breaking rename),
`GithubOidcTrustRoot` (`{ caCertificates: string[]; allowedIssuers?:
string[]; allowedIdentities?: Array<string | RegExp> }`),
`verifyRegistrySignature(entry, signature, trustRoot)` and
`verifyRegistryEntrySignatures(entry, trustRoot)` (tries every signature,
returns the first that verifies or the last failure), and
`canonicalRegistrySigningPayload(entry)` (this package's own convention for
what a `github-oidc` signature's bytes must cover — `@jini/protocol`'s wire
schema doesn't define one — exported so a future signing tool computes the
identical string this verifier checks).

**What `github-oidc` verification actually does, researched (not guessed)
against GitHub's real docs and empirically against `node:crypto`'s real
behavior** (WebFetch/WebSearch against `docs.github.com`'s OpenID Connect
and REST attestations pages, plus direct `openssl`+`node -e` experiments —
see `trust.ts`'s module doc comment for the full citation trail):

- A raw GitHub Actions OIDC **ID token** (`iss:
  https://token.actions.githubusercontent.com`, a JWT verifiable via
  `token.actions.githubusercontent.com/.well-known/jwks`) was considered and
  rejected as the thing this verifier checks: that token's `exp` is
  minutes-scoped, but a registry entry is resolved and re-checked long after
  it was signed — a stored raw ID token would already be expired by the
  time anyone checks it. This is exactly why GitHub's own durable-provenance
  mechanism ("Artifact Attestations") is Sigstore-style **keyless signing**:
  the short-lived ID token is used once, at signing time, to obtain a
  short-lived Fulcio-issued X.509 certificate whose SAN encodes the OIDC
  identity; that certificate's public key then verifies a signature that
  stays checkable indefinitely. `RegistrySignatureSchema`'s own shape
  (`signature` + `certificate` + `issuer`/`subject`/`signedAt`) already
  matches this model far better than a bearer token would, so `kind:
  'github-oidc'` here means a Sigstore/Fulcio-style keyless signature,
  cryptographically verified end to end.
- What's real: (1) the certificate chains — via `X509Certificate#checkIssued`
  **and** `#verify` (an actual signature check, not just a DN-string match)
  — to a host-configured CA in `GithubOidcTrustRoot.caCertificates`, walking
  through any bundled intermediate certs in `signature.certificate` (multiple
  concatenated PEM blocks, leaf first); (2) `signature.signature` (base64) is
  a real `node:crypto` `verify('sha256', ...)` check against
  `canonicalRegistrySigningPayload(entry)`, using the leaf certificate's own
  public key; (3) the certificate's `subjectAltName` URI (e.g.
  `https://github.com/OWNER/REPO/.github/workflows/WORKFLOW.yml@REF`, the
  real shape GitHub Artifact Attestations certs use) is checked against
  `allowedIdentities` when configured — this is the cert-bound identity, not
  the signature's self-reported `subject` field, so a signer can't lie about
  who it is via that field alone.
- What's explicitly **not** implemented in v1 (documented in `trust.ts`'s
  module doc comment, matching this repo's convention of stating scope
  limits plainly rather than silently under-delivering): no Sigstore Rekor
  transparency-log inclusion-proof verification (this module trusts the
  signature's self-reported `signedAt` against the certificate's validity
  window, not an independent timestamp authority); no Sigstore public-good
  root/TUF auto-discovery or any hardcoded root (the host supplies
  `caCertificates` explicitly — no network call is made by this module at
  all); no revocation checking (CRL/OCSP); no Fulcio custom-OID
  (`1.3.6.1.4.1.57264.1.1`) extension parsing (Node's `X509Certificate` has
  no public API for arbitrary extension OIDs without a hand-rolled ASN.1
  parser — identity comes from the SAN URI instead, which `X509Certificate`
  does expose natively).
- `allowedIssuers` (default `['https://token.actions.githubusercontent.com']`)
  checks the signature's self-reported `issuer` field — a declarative /
  operator-bookkeeping check, not cryptographically bound to the
  certificate; the cryptographic trust boundary is `caCertificates` +
  the SAN identity check, documented as such so a future reader doesn't
  mistake it for a stronger guarantee than it is.

**Schema change (`@jini/protocol`, decision 2 — see that package's own
source-map.md addendum below):** `ResolvedRegistryEntrySchema` gains
`verified: z.boolean().default(false)`, `verifiedIssuer?: string`,
`verifiedSubject?: string` — additive, defaulted, never thrown on missing
input; `trust` is completely untouched.

**Backend wiring:** `StaticRegistryBackendOptions`/`GithubRegistryBackendOptions`/
`DatabaseRegistryBackendOptions` each gain an optional `trustRoot?:
RegistryTrustRoot`; `GithubRegistryBackend`/`DatabaseRegistryBackend` just
pass theirs through to `super()`. `StaticRegistryBackend.resolve()` (the one
place all three backends compute a `ResolvedRegistryEntry`) calls
`verifyRegistryEntrySignatures(entry, this.trustRoot)` and stamps
`verified`/`verifiedIssuer`/`verifiedSubject` onto the result — a backend
with no `trustRoot` configured always gets `verified: false` without
attempting any cryptographic work (decision 4, unchanged default).

**Tests:** `src/__tests__/trust.test.ts` (37 tests) — a self-contained
`openssl`-generated CA + leaf certificate pair (checked into the test file
as PEM constants, not fetched from any real CA; no network call anywhere in
this file), covering: end-to-end verify, multi-hop chain (leaf issued by a
bundled intermediate), every kind/config/field-missing/malformed-cert/
wrong-chain/expired-window/identity-mismatch/bad-signature failure path, and
an Ed25519 certificate proving the outer `try`/`catch` around `node:crypto`'s
`verify('sha256', ...)` is genuinely reachable (an Ed25519 key throws for an
explicit 'sha256' digest — verified empirically before writing the test, not
assumed). Small wiring tests added to
`static-backend.test.ts`/`github-backend.test.ts`/`database-backend.test.ts`
proving the constructor option reaches `resolve()`.

One documented, intentionally-not-covered branch: `trust.ts`'s
`certIssuedAndSignedBy`'s `catch { return false; }` (defense-in-depth for
this module's "never throw" contract) — empirically, `X509Certificate#verify()`
was checked across EC/RSA/Ed25519 issuer-key combinations during this
module's construction and consistently returned `false` rather than
throwing (unlike the standalone `crypto.verify()` function used elsewhere in
the same file, which does throw for an incompatible key/digest pairing —
that one *is* covered, via the Ed25519 test above). Kept rather than
deleted, and documented rather than silently left unexplained, matching
`@jini/deploy`'s `netlify.ts`/`github-pages.ts` precedent for this repo.

## 2026-07-21 — concrete `GithubApiRegistryClient`

Closes the "no concrete `GithubRegistryClient` HTTP implementation exists"
gap this doc's hardening passes both flagged and explicitly deferred (see
"Observed, not fixed" above). Independent of, and kept in a separate commit
from, the signature-verification work in the section above — different
files, different concern (a real HTTP client vs. a cryptographic verifier),
even though both were scoped in the same task.

**New file `src/github-client.ts`** — a real `GithubRegistryClient`
implementation (the interface `github-backend.ts` already defined but no
concrete implementation existed for, confirmed via repo-wide grep before
this task and re-confirmed in this doc's own prior "Observed, not fixed"
section above). Built directly against GitHub's REST API docs (fetched via
WebFetch this session, not recalled from memory):

- `readManifest(owner, repo, ref, path)` — `GET
  /repos/{owner}/{repo}/contents/{path}?ref={ref}` (the Contents API).
  Verified against GitHub's own documented size tiers: ≤1MB returns inline
  `content`/`encoding: "base64"`; 1-100MB returns `encoding: "none"` with
  empty `content` (requiring the raw media type or Git Trees API instead);
  >100MB isn't supported by this endpoint at all. A registry manifest is a
  JSON index, expected well under 1MB, so this implementation reads the
  standard base64 response and throws a clear, attributable error for the
  oversized case rather than silently misreading it.
- `createPublishPullRequest(request)` — the Git Data API flow (create
  blob(s) → a tree layered on the base commit's tree → a commit → a branch
  ref) followed by an actual `POST /repos/{owner}/{repo}/pulls` call.
  Mirrors the blob/tree/commit/ref mechanics `@jini/deploy`'s
  `github-pages.ts` already verified against the same Git Data API docs
  (written fresh for this package — no cross-package dependency added, this
  package does not gain a dependency on `@jini/deploy`), extended with the
  Pulls API call that file didn't need (it force-pushes a branch directly;
  this one opens a PR against `baseRef`, matching `GithubPublishMutation`'s
  shape). Branch-already-exists (`409`) falls back to a `force: true` PATCH
  update, matching `github-pages.ts`'s own "last publish wins" reasoning for
  a retried/racing publish. PR-already-exists (a `422` whose message says
  so) falls back to looking up and returning the existing open PR's URL,
  matching `netlify.ts`'s `ensureNetlifySite` create-then-recover-on-conflict
  shape for a different provider's analogous race.
- No token is required for `readManifest` (GitHub's Contents API supports
  anonymous reads of a public repo, subject to its lower unauthenticated
  rate limit) but `createPublishPullRequest` throws immediately, before any
  network call, when constructed without one — matching
  `NetlifyDeployTarget.publish()`/`GitHubPagesDeployTarget.publish()`'s own
  "throw immediately on missing token" convention rather than silently
  downgrading behavior.

**Tests:** `src/__tests__/github-client.test.ts` (37 tests), `fetch` mocked
at the HTTP-client boundary via `vi.stubGlobal('fetch', ...)` — the exact
pattern `@jini/deploy`'s `netlify.test.ts` established (no real network call
anywhere in this file) — covering every guard/error path in both methods
(oversized file, non-file/directory path, malformed JSON, missing sha/tree/
commit/html_url fields, branch-conflict recovery, PR-already-exists
recovery and its own failure/not-found sub-cases, custom `apiUrl` override
for GitHub Enterprise Server).

**Also:** added a `test:coverage` script to `package.json` (this package had
`test` but not `test:coverage`, unlike `@jini/deploy`) since this task's
process required running it.

**Verification:** `pnpm --dir packages/protocol build` clean (registry
depends on protocol's dist). `pnpm --dir packages/registry typecheck` clean
under this repo's `exactOptionalPropertyTypes: true`. `pnpm --dir
packages/registry test:coverage` — 183/183 tests pass, package-wide
aggregate 99.76/99.61/100/99.76 statements/branches/functions/lines (up from
the prior pass's 100/100/100/100 on a smaller file set — the drop is
entirely the one documented unreachable `catch` branch above), still above
the package's configured 99% threshold gate on every metric. `pnpm --dir
packages/protocol exec vitest run` — 11/11 passing (2 new assertions on the
additive schema fields). `pnpm guard` (repo root) clean.

## 2026-07-22 addition — `trust.ts:337-338` empirically re-verified unreachable (audit fix)

Per this task's own "no scope cuts for coverage — re-derive, don't trust the prior claim" standing
rule, `certIssuedAndSignedBy`'s `catch { return false; }` (the only remaining uncovered branch in
this package) was independently re-tested rather than accepted from the code comment already
there. Generated fresh RSA-2048, P-256, P-384, and Ed25519 self-signed certs via a real local
`openssl` (3.0.13) and called `X509Certificate#verify()` across all 9 cross-type combinations plus
same-key self-verification for each — **zero throws**, every call returned a clean boolean, on this
repo's actual Node (v22.22.2) runtime. Went further than the original claim: also confirmed
`verify()` *can* throw a `TypeError`, but only for a malformed argument shape (a non-`KeyObject`,
or a private key passed where a public key is required) — and `certIssuedAndSignedBy`'s only call
site (`chainToTrustedRoot`) never passes anything but `issuer.publicKey`, a real `X509Certificate`
getter, so that throw mode is structurally unreachable through this module's actual call graph, not
just empirically unobserved. Doc comment on `certIssuedAndSignedBy` updated with the full
re-verification record. No code change — the branch is genuinely, provably unreachable; this entry
and the code comment are the record the standing rule requires in place of a forced test.

**Verified, personally, this session**: `pnpm --dir packages/registry exec tsc --noEmit`: clean.
`pnpm --dir packages/registry run test:coverage`: 183/183 tests pass, same 99.76/99.61/100/99.76
aggregate as before (unchanged — no test was added or removed, only the doc record).
