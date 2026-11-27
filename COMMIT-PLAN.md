# w3-arch Jini working-tree delivery

Base: fd06f45b12ae0516b0fc196f58d785eba4d3831e (`codex/w3-archj`). No Git writes. Tests are written first and left unrun per dispatch. Changeset bumps follow cross-set X5 (minor under fixed group except agent-plugins major).

## 1. R01.TABLE.J — table selector contract

Files: packages/ui/src/features/interactive-ui/{data-table.css,providers/native/data-table.tsx,providers/shadcn/data-table.tsx,__tests__/components/DataTable.test.tsx,providers/shadcn/__tests__/data-table.test.tsx}; packages/ui/src/features/charts/{table.ts,__tests__/table.characterization.test.ts}; packages/ui/src/features/a2ui/__tests__/real-catalog-components.test.tsx; .changeset/r01-ui-table-class-contract.md.

Tests first: both provider suites read the real stylesheet and check every rendered scoped class against its selectors, including empty and populated states. Existing accessibility and sort assertions retained. Mutation: M-rename-table-markup-only changes a markup class without its CSS selector. No API declaration change.

## 2. R02.CONSENT.J — host banner refusal copy

Files: packages/cookie-consent/src/site/{validation.ts,service.ts,tool-registrations.ts,__tests__/validation.pins.test.ts}; .changeset/r02-consent-validation-copy.md.

Tests first: `banner-mode refusal comes from each host and defaults to neutral copy` and `draft and assistant preparation use the bound banner-mode refusal`. Mutations: M-leak-default-product-name restores the product fallback; M-drop-banner-refusal-forward removes one parser forwarding field. The integration witness covers draft save and both assistant preparations without saving a draft.

Baseline pending: api-baseline/jini-ai__cookie-consent.json (three additive option changes). Tovu sheet 9 binds the copy in service/tool hosts and public middleware.

## 3. R03.MCP-ALIASES.J — host-bound legacy MCP fields

Files: packages/agent-plugins/src/core/identity-namespace.ts; packages/agent-plugins/src/lifecycle/{manifest.ts,ports.ts,capability-projection.ts,__tests__/unit/legacy-vocabulary.pins.unit.test.ts,__tests__/unit/portable-metadata.unit.test.ts,__tests__/unit/capability-projection-host-contract.unit.test.ts}; packages/agent-plugins/docs/{legacy-vocabulary-triage.md,spec/api.spec.md}; .changeset/r03-injected-mcp-aliases.md.

Tests first: `two hosts translate only their own legacy MCP fields` and `canonical metadata wins even when malformed`. Same input tested unbound and with two distinct descriptors; all four fields, host warning, canonical-only output and inline read stripping asserted. Existing N-1 namespace and installed warning witnesses retained and alias fixtures explicitly bound. Mutations: M-drop-injected-mcp-alias; M-inline-grants-review.

Baseline pending: api-baseline/jini-ai__agent-plugins.json. Tovu sheet 10 must bind its descriptor at lifecycle composition and intentional standalone legacy reads. No new subpath.

## 4. R03.SHARE-KEY.J — host share-key predicate

Files: packages/devops/src/deploy/{host-kit.ts,target-contracts.ts}; packages/agent-plugins/vercel/{object-stores/vercel-blob.mjs,__tests__/share-key.test.mjs,NOTES.md}; packages/agent-plugins/s3-compatible/{targets/s3-compatible.mjs,__tests__/target-edges.test.mjs,__tests__/object-store.test.mjs}; packages/agent-plugins/docs/legacy-vocabulary-triage.md; .changeset/r03-injected-share-key-policy.md.

Tests first: `the same provider follows the key rule of the host that built it` in both provider suites. Upload/delete/verify use Alpha and Beta host suffixes; adjacent keys produce no transport calls, and an absent predicate refuses deletion. Existing share fixtures receive neutral predicates; publishing/credential fixtures unchanged. Mutations: M-ignore-injected-share-key-policy restores the fixed suffix; M-delete-skips-share-key-check bypasses only deletion validation.

Baseline pending: api-baseline/jini-ai__devops.json. Tovu sheet 11 must supply the exact existing object-key predicate on the share-only kit before bundled provider release. No export or provider ABI additions beyond the kit capability.

## 5. K03.BRIDGE.J — runtime-bound MCP mechanism

Files: packages/core/src/contracts/agents/definition.ts; packages/daemon/src/ports/agent-runtime.ts; packages/agent-runtime/src/runtime-strategies.ts; packages/daemon/src/agent-executor/{mcp-bridge.ts,launch.ts,__tests__/strategy-dispatch.test.ts,__tests__/agent-executor.test.ts,__tests__/http-mcp.test.ts,__tests__/split-parity.test.ts,__tests__/access-approval-transport.test.ts,__tests__/antigravity-permissions.test.ts,__tests__/full-cli-mcp-policy.test.ts,__tests__/message-relay.test.ts}; packages/daemon/docs/spec/api.spec.md; .changeset/k03-bound-mcp-mechanism.md.

Tests first: `identical host capabilities select the same delivery without a vendor id` and `unbound configured delivery fails before acquiring a credential`. Mutations: M-raw-cli-strategy-dispatch restores raw delivery keys; M-inherited-credential-before-consent moves credential lookup ahead of inherited consent (existing antigravity consent witness retained). Direct caller objects use literal mechanisms; whole-registry fixtures select literal mechanisms using existing bound slots rather than raw definition spelling. Existing refusal and credential tests retained.

Baselines pending: api-baseline/jini-ai__{core,agent-runtime,daemon}.json; regenerate K03 before p4mounts J3a/J3b. Public inventory is a names-only array; both names are already present and unchanged, so no inventory edit is required. Runtime-port bindings and core agents barrel already forward/export the new slot/type. No subpaths added. Per FIX, vendor-neutral-debt.json remains untouched; Opus must re-measure mcp-bridge.ts and tighten only reduced counts. G06 remains held.

## 6. P10-H2.MIGRATE.J — trusted migrate-forward actor

Files: packages/db/src/recovery/migrate-forward-hooks.ts; packages/db/src/__tests__/recovery/owner-contract.test.ts; .changeset/p10-h2-migrate-forward-actor.md.

Tests first: `migrate-forward retains user, agent, and explicit system attribution without changing the plan`. Same actor ID used for all three kinds; createdBy, ledger actorId and parsed detail (including artifactRef) asserted. Existing fresh-capability/capture witness updated and barrel identity witness preserved. Mutations: M-migrate-drops-actor-kind; M-migrate-defaults-to-user.

Baseline pending: api-baseline/jini-ai__db.json. Tovu sheet 12 must pass admin user attribution and assistant channel attribution at its existing writer bindings. No new subpaths/exports.

## Left for Opus

G06.RUN.J: NEEDS-OPUS; literal admitted/prepared/resource-state types and phase signatures are absent. No launch split or size-debt edits authorized.

## Verification and cleanup

No tests, installs, builds, type checks or linters run (dispatch restriction). API baselines must be regenerated by the coordinator from fresh declarations; never merge hashes by hand. Diff cleanup removed an unused legacyMcpAliases option accidentally added to parseDeclaredServer and an eager launch binding read, and the now-unused local import of the fixed alias warning; the binding stays inside the original conditional call site. No unrelated additions or deletions remain. Required deletion: Vercel’s file-local SHARE_KEY constant (replaced by the injected predicate).

## Static handoff evidence

- HEAD and branch matched the dispatched SHA/name; tree was clean before edits.
- Scoped source searches found no retired table class except the two required negative CSS assertions, no legacy MCP field literals in the compatibility decoder, and no host share suffix in either provider implementation.
- Every consent service/tool parser call forwards the host field. Migrate-forward has only the owner-contract caller and unchanged barrel identity references in its package.
- Existing public entries are unchanged; `LegacyMcpAliases` is exposed through the existing manifest/lifecycle exports and `McpBridgeMechanism` through the existing core agents type barrel.
- `scripts/check-api-surface.ts` explicitly requires built dist output. Baseline refresh is stopped at that substep because fresh declaration builds are prohibited by this dispatch. Baseline JSON files are left intact rather than guessed.
- No test, build, install, type-check, linter, API gate, mutation execution, browser or runtime harness was run. No coverage or passing-test result is claimed.
- Static test declaration count across changed test files: 472 -> 483 (+11); parameterized declarations counted once. No tests deleted/skipped or coverage settings changed. This is a source count, not an executed-test count.

## Architecture / pre-completion audit

Status: WARNING — source review only; named tests, paired Tovu verification and regenerated API baselines remain outstanding. Audited all changed files against the sheet file maps. Host policy/copy remains injected; namespace compatibility, inline-read stripping, provider checks before I/O, credential consent order, conditional staging reads, attribution and save/append order preserved in source. No new public subpaths, wrappers, vendor debt allowances or launch phases added. Scope is the six eligible Jini sheets only; Tovu sheets 8–12 remain with their owner.

Function review: validation and alias readers remain pure; provider predicate checks precede existing I/O; bridge resolver retains cleanup/failure ownership; migrate-forward retains its existing effect order. No additional recurring work, storage, timers or retained state. Variable-name review found no remaining mismatch. New test evidence is unproven until Opus runs it and the named mutations. Inline documentation changes are limited to the sheet-required compatibility/spec updates and existing rationale adapted to the injected seams.

File inventory: 45 existing files modified; six named changesets and this commit plan created (52 working-tree files). No file moves or file deletions. All changes remain uncommitted.
