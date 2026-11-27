# WAL round 2 — coordinator handoff (DO NOT COMMIT THIS FILE)

Baseline: `984a319b4adc3ea78ea148e6cb50e7ba5d875bd8`, branch `codex/x4g-walj`.
Scope: Jini only. No subagents, package intake, commits, pushes, installs,
builds, tests, mutations, typechecks, or linters. The dispatch overrides the
programmer skill's execution, approval, refactoring, and documentation additions.
`.git` remains read-only.

## Ordered coordinator units

### WAL-01 — scoped vault authorization contract correction

Test first: extend the existing
`packages/core/src/contracts/site/__tests__/vault-context.test.ts` before editing
the helper. Characterize the API vault's workspace/kind/owner/principal/binding
predicate, including list contexts without a binding. Preserve the existing
workspace-independent destination authorization case.

Mutations for the coordinator (not applied or run):

- `drop-principal-null-check`: remove the principal rejection; the existing and
  workspace-scoped negative cases must reject its success.
- `drop-workspace-scope-check`: remove the workspace comparison; the matching
  kind/owner in a different workspace must still be refused with `VaultError`
  code `context`.

Design gate: amend the existing pure async predicate, with its existing
`(required, _optional = {})` signature and `Promise<void>`/`VaultError` contract.
Workspace is checked when supplied by the caller's scope; callers such as the
destination binding that supply no workspace retain their existing policy.
Binding-less list contexts retain the API vault's existing behavior; present
non-null bindings are refused. No effects, collaborators, new helpers/types,
dependency edges, storage changes, or public subpaths. O(1) time/space.

Ordered files:

1. `packages/core/src/contracts/site/__tests__/vault-context.test.ts`
2. `packages/core/src/contracts/site/vault-context.ts`
3. `.changeset/x4-walg-01-core.md` (minor)

Implemented in the working tree. Tests: one before, two after; none deleted or
weakened. The added test was written before the production change. No mutations
were applied. Runtime/type/mutation evidence is unavailable by explicit dispatch
prohibition.

Tovu follow-up: replace the inline API-vault `authorize` predicate with
`({ context }) => authorizeScopedVaultContext({ context, scope })`, supplying the
existing `apiConnectionVaultScope({ workspaceId })` result unchanged. Import from
the already-public `@jini-ai/core/contracts/site/vault-context`. No new subpath or
manifest entry is needed. The destination binding's existing null-binding
projection and workspace-independent scope remain supported. Its policy is not
strengthened to pin a workspace it never pinned before.

## Per-file disposition — every LEFT / not-counted WAL MOVE

Paths below are relative to Tovu's `apps/website/src/features/`. Jini owners were
read from this working tree; Tovu was read only from local
`/Users/la/Programming/Tovu`, ref `codex/tv-x4f-wal`. No fetch was necessary.
Existing package owners were inspected and left unchanged, rather than copied.
No Tovu files were edited or deleted, and no counter reduction is claimed.

| Sheet | Tovu MOVE file | Residual LOC supplied | Jini-side disposition / remaining blocker |
|---|---|---:|---|
| WAL-01 | `api-connections/vault-store-binding.ts` | 87 | Jini contract correction implemented above; source-level handoff ready for the pure binding. Existing public helper now preserves the API workspace and optional-binding predicate. Execution pending. |
| WAL-07 | `entries/publish-content.ts` | 184 | STILL BLOCKED / NEEDS-OPUS. `cms:entries/site/publish-content` is absent. The caller passes `state.termIds` to `prepareTermSync`; `cms/src/taxonomy/site/publish-term-ids.ts:104` normalizes a non-array (including absence) to `[]`. `apply-absent-terms-as-empty` is baseline behavior, so the requested distinction cannot be characterized without changing behavior. No contributor or substitute test invented. |
| WAL-09a | `agent-plugins/automatic-agent-plugins.ts` | 280 | STILL BLOCKED / NEEDS-OPUS. `site/automatic-agent-plugins` is absent from source, exports and entries. `createAutomaticPluginRuns` remains lines 197–280, exactly 84 physical lines. No named split is authorized for this function. No implementation compressed/reformatted to evade the limit. |
| WAL-09b | `agent-plugins/connect-tool.ts` | 210 | Existing Jini `defaultResolveInstalledAgentPlugin` and its export through `@jini-ai/agent-plugins/connect` are present. List → bundled digest → trusted manifest/cards → servers order inspected. Tovu cutover STILL STOPPED on anchor mismatch below. No duplicate entry or implementation added. |
| WAL-09c | `agent-plugins/exports/source.ts` | 76 | Existing `site/exports/source` source, export and universal entry are present; trusted inactive discovery, contained asset reader and required URL prefix are already supplied by the package API. Tovu cutover STILL STOPPED on anchor mismatch. |
| WAL-09d | `agent-plugins/install-tool.ts` | 253 | Existing `site/install-tool` source, export and node entry are present; X4-09's core install-source contract is present and imported. Tovu cutover STILL STOPPED on anchor mismatch. |
| WAL-09d | `agent-plugins/install-upload.ts` | 386 | Existing `site/install-upload` source, export and node entry are present; existing rejected-update and OFF-before-publication tests inspected, not executed. Tovu cutover STILL STOPPED on anchor mismatch. |
| WAL-09f | `agent-plugins/memory.ts` | 92 | Existing `site/memory` source, export and node entry are present, with required filesystem/migration/warning effects. Existing sibling-lock test inspected; note projection text matches the Tovu source exactly. Tovu cutover STILL STOPPED on anchor mismatch. |
| WAL-09g | `agent-plugins/set-enabled.ts` | 93 | Existing `site/set-enabled` source, export and node entry are present, including lifecycle memoization, linked-face/readiness precedence and post-OFF notification. Tovu cutover STILL STOPPED on anchor mismatch. Independent `site/update-effects` and deferred provisioning contracts already exist. |
| WAL-17 | `identity/user-purge.ts` | 43 | STILL BLOCKED / not counted under G3. Existing `SqlUserPurge` and public entry accept statement callbacks, not a kernel/table SQL factory. The Tovu residual still contains the deletes and outbox insert. The dispatch explicitly forbids inventing that missing API; no wrapper, alternative delete path, or new dependency added. |

### Exact plugin anchor stops

These are independent stops, not a stop of the entire WAL-09 sheet. Existing Jini
owners alone do not authorize re-anchoring the Tovu bodies.

| File | Expected original blob | Actual `codex/tv-x4f-wal` blob |
|---|---|---|
| `connect-tool.ts` | `67c6aa91c2` | `5d15d424a2e4b2c7504ea7244483d70ac8597a10` |
| `exports/source.ts` | `ea24b05d72` | `1ff1f20d47422b33351725838ef1e508679afc69` |
| `install-tool.ts` | `42e0e13086` | `7f3cb25b2ee523b805430c958f90a1c29b6486df` |
| `install-upload.ts` | `6c3263208f` | `8764aa143ddc53ff34c4b53f636ad31ab4da93f5` |
| `memory.ts` | `8515e1a54a` | `0eb10d8eea4bd39cf48f337b0d13574eabb689f3` |
| `set-enabled.ts` | `fa704ffac2` | `abe61a2a61f65192fb84674f103b0ed67cf2266e` |

`install-tool.ts` has drifted again since the supplied fix-pass ledger, which
reported `67b9ed3a3535e115c8a9f57313eba3266f380632`. That makes the stop stronger;
no assumption was made about the extra change.

### Additional upstream/spec stops retained

- WAL-09b: `connect/new-site-agent-plugin-tokens` and token binding already exist.
  The token parser still has no retired-ID decision to swap with a limit check;
  `token-refusal-order-swapped` remains NEEDS-OPUS.
- WAL-13c: `devops:deploy/site/static-publish/publish-history` already exists and
  is exported, but `PublishHistoryEntry`, `PublishDestination`, replay eligibility
  and destination projection still embed `tovu-peer` / `tovu-peer:`. The handoff
  explicitly says the neutral peer return contract is unresolved and forbids
  widening the discriminator or inventing generics. STILL BLOCKED / NEEDS-OPUS;
  no persisted bytes renamed. The Tovu history file was already deleted, so
  retaining its deletion is not a new completed MOVE in this round.
- K0 / Appendix B, canonical counter and shared-file sequencing remain
  coordinator work; no package intake, keep ledger, counter script, theme,
  desktop, approval-owner, feature-mount, migration or lockfile edits here.
- Other WAL MOVE rows are already deleted or bindings in the supplied inventory
  and are skipped as requested. No REJECT disposition.

## Source review / architecture handoff

Architecture Audit: WARNING/PARTIAL overall because the explicit source/spec/G2
stops above remain. The sole amended production function is product/vendor/server
neutral, imports only its existing same-package VaultError, adds no dependency
edge or abstraction, and preserves the existing error identity. It remains eight
physical lines, below the 80-line/500-line limits. Boolean decision count remains
below ten by source inspection; no complexity tool was run.

Reuse: scoped vault authority; inspected `core/contracts/site/vault-context`, the
Tovu API-vault predicate and destination binding, and core/platform vault context
and query contracts; amended the existing predicate rather than introducing a
second authorization owner. Owner record: WAL-01 fix-pass security stop.

| Assessment unit | Disposition | Findings / evidence | Cost / seam |
|---|---|---|---|
| `authorizeScopedVaultContext` | INCONCLUSIVE (execution prohibited) | Source-reviewed workspace check, exact null/present-binding policy, same VaultError. No new storage/crypto effects. | O(1) time/space; direct accepted-query/identity and wrong workspace/kind/owner/principal/binding assertions. |

Documentation: intentionally no new source comments, per the explicit no-comment
dispatch override; no existing why-comment removed. The contract change and Tovu
call shape are recorded above and in the minor changeset.

Pre-completion: dispatch/spec re-read, diff reviewed, no tests weakened/deleted,
no extra production helper/type/file/import added, and no cleanup deletion was
needed. Changed files are exactly the WAL-01 three-file group plus this uncommitted
plan. No certified coverage or runtime/type/mutation result is claimed.

Fresh source check: `git diff --check` passed. The final check is repeated after
this ledger update. Self-validation, tests, builds, installs, typechecks, linters
and mutations NOT RUN by explicit dispatch prohibition. Coordinator/Opus must run
the added characterization and named mutations before accepting the cutover.
