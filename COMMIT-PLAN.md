# Security fixes — Jini half

No installs, builds, tests, typechecks, or linters run. Changes remain uncommitted.
Tests precede fixes; red/green execution is deferred to the coordinator.

## 1. sec 8 — root-key auto-creation
- Tests first: `packages/platform/src/secrets/__tests__/keyring.env.generate-errors.test.ts`.
- Mutation: `auto-create-root-key-without-exclusivity` restores the nonexclusive write; the collision test rejects the write options and requires the collision error before derivation, then reads the winner on the next invocation.
- Fix: `packages/platform/src/secrets/keyring.env.ts` reuses `generateFileRootKey` and caches decoded hex only after success.

## 2. sec 4 — form-delivery secret shapes
- Tests first: `packages/cms/src/settings/site/__tests__/form-delivery.unit.test.ts`; top-level and nested refusals are evaluated separately for all three synthetic token shapes, with ordinary-value controls.
- Mutation: `omit-shared-delivery-secret-shapes` removes the shared-pattern check and makes each refusal fail.
- Fix: `packages/cms/src/settings/site/form-delivery.ts` imports the existing core vocabulary. Current entries expose their RegExp as `.pattern`; reset that expression's `lastIndex` before testing.
- Host follow-up: activate the existing witness and remove its obsolete acceptance pin in the host repository; this checkout has no such pin.

## 3. sec 3b — persisted empty MCP grants
- Prerequisite confirmed: host `use-external-mcp.hooks.ts:114` uses `server.allowedToolNames.join(", ")`, preserving persisted empty as `""`.
- Tests first: `packages/admin/src/screens/settings/hooks/__tests__/use-external-mcp-tool-picker.hooks.unit.test.tsx`, including the named reopen case and absent-to-empty roster reseeding.
- Mutation: `default-explicit-empty-mcp-allowlist` restores length-based defaults; the reopen assertion fails. Restoring nullish coalescing in the signature fails absent-to-empty reseeding.
- Rewritten bug pin: the existing unreachable-probe retry test must keep a saved empty selection empty after success.
- Fix files: `packages/admin/src/screens/settings/external-mcp-tool-picker-rules.ts`; `packages/admin/src/screens/settings/hooks/use-external-mcp-tool-picker.hooks.ts`.
- The other named `parseSavedToolNames` consumers (refresh and dirty comparison) already preserve zero grants: neither applies defaults. No changes required there.

## 4. sec 3c — MCP enum validation copy (Jini half)
- Tests first: `packages/mcp/src/federation/hosted/__tests__/second-host-store.test.ts`, named invalid-auth/grant refusal case with exact safe messages and field IDs.
- Mutation: `echo-invalid-mcp-enum` restores either submitted-value interpolation and fails its exact message assertion.
- Fix files: `packages/mcp/src/federation/hosted/store.ts`; `packages/mcp/src/federation/hosted/store-oauth-fields.ts`.
- Searched current hosted tests and host save-refusals for “is not supported” / “expected one of”: no affected pre-existing pins found.
- Host follow-up: endpoint-origin confirmation copy and `show-mcp-endpoint-path` witness remain in the host tool registration.

## 5. sec 7 — canonical source-control deletion lookup
- Tests first: `packages/devops/src/source-control/site/__tests__/store.test.ts`, canonical-only scoped metadata review followed by removal of the same ID/workspace, with no legacy removal.
- Mutation: `delete-source-control-describe-legacy-only` restores the legacy-only return and fails the reviewed-summary assertion.
- Fix: `packages/devops/src/source-control/site/store.ts`, preserving the legacy match before optional canonical list fallback.
- Caller census before editing: host source-control index/store tests and `server/runtime/composition/permanent-delete-deps.ts` use the describe entrypoint; the admin GET-by-id also gains canonical metadata resolution, intentionally matching list precedence. The host branch still has its old implementation; repoint its thin binding to this Jini function and activate the full prepare/execute witness there.

## 6. sec 6 — publish verification basis
- Tests first: `packages/devops/src/deploy/site/static-publish/__tests__/publish-verification-basis.unit.test.ts`, named B226 case: verify A, promote unverified B, assert no readiness/status/timestamp inheritance or secret resolution, and no exposed basis. Same-ID revision and env mismatch controls exercise the required cache basis.
- Mutation: `read-publish-verification-without-basis` removes the cache basis comparison and fails the unverified-B assertions.
- Fix files: `packages/devops/src/deploy/site/static-publish/{types,credentials,verify}.ts`, `packages/devops/src/deploy/site/publish-credentials/store-resolution.ts`, `packages/devops/src/deploy/site/publish-tool-capabilities.ts`.
- Existing metadata seam `hasDefaultForPublish` now returns selected `{ id, revision } | null` instead of discarding the selected VaultSummary as a boolean. Its existing source binding uses that selection as readiness basis; no additional port is added.
- `resolveForPublish`/`resolveDefaultForPublish` return the opened VaultSummary's revision. Both verification writers bind the pre-probe resolved basis; no post-probe reads.
- Mechanical fixture changes: `static-publish/__tests__/{credentials.unit.test.ts,publish-site.tw4.pins.test.ts,adapter.unit.test.ts}`.
- Host follow-up: update metadata-source wrappers and true-ready fake sources to include basis, cache get/set fixtures to pass basis, and activate the composed-app B226 witness. No new subpaths required.

## Remaining / skipped sheets
- sec 1: host-owned `apps/desktop/src/site-dir-store.ts`; Q2 is answered FIX, so there is no remaining owner gate. Apply the corrected stdin/random-password helper and host tests in the host half.
- sec 2: host-owned `apps/desktop/src/workspace-chat-ipc.ts`; no matching registrar in the Jini desktop/node/CLI packages. Host half wraps the 13 handlers.
- sec 3a: NEEDS-OPUS, shared OAuth callback/conditional-write contract and both adapters; intentionally untouched.
- sec 3c endpoint card: host-owned `externalMcpAccessSubject`; Jini enum copy is implemented above.
- sec 3d: host-owned `assistant/external-mcp-reauth-tool.ts` / registration policy binding; no matching Jini tool deps. Host half adds required authorization and updates its fixtures.
- sec 5: host-owned `apps/admin/src/lib/admin-http/request.ts:261`; no Jini `describeApiError` implementation. Apply the corrected all-unexpected-values fallback rule in the host half.
- sec 9: REJECT, duplicate of admin 3 commit 1 and incomplete without the controller availability fix.
- sec 10: host-owned `features/site-update/tools.ts`; the two exception interpolations are still there. Host half replaces both with safe fixed copy, preserving `checked: false`.
- sec 11: REJECT, duplicate owned by data 3; no actor fallback changes here.
- H1440, H1974, H2179, H2195: remain skipped for the owner-specified reasons.
- No independent Jini sheet stopped for an anchor/prerequisite mismatch.

## Final review and handoff
- Scope: six logical Jini changes above; no subagents, commits, pushes, installs, builds, tests, typechecks or linters. `.git` was only read.
- Static diff review only: test declarations in touched test files increased from 35 to 42. No tests were deleted, skipped, weakened, or excluded; the named old picker assertion was corrected to the intended empty-grant behavior.
- Two test files created: CMS `form-delivery.unit.test.ts` and devops `publish-verification-basis.unit.test.ts`; all other code/test paths are listed under their logical commits above.
- Reuse: existing exclusive key generator, core secret-pattern vocabulary, picker seed/signature seams, MCP validation errors, optional canonical metadata list/remover, and publish selector/cache ports. No new helpers, wrappers, ports, config flags or dependencies.
- API follow-up: source success/readiness now carries `basis`; cache `get`/`set` requires it; selected publishing resolution carries `revision`; `hasDefaultForPublish` returns selected metadata or null. The new named `PublishVerificationBasis` is exported from the existing static-publish types subpath. No new package export map/subpath is needed.
- Source-control describe fallback intentionally applies to every caller, including GET-by-id and permanent-delete review, with legacy precedence retained. Full host prepare/execute wiring remains for the host regression test.
- Architecture audit: manual scope review found no new cross-package dependency or host identity; all fixes stay at their extracted owners. Execution/typing remains unverified by instruction; coordinator must build and run the named regressions after the host contract updates.
- Quality review: key generation and cache operations remain bounded; canonical lookup adds one metadata-list scan only after a legacy miss; form validation adds the fixed shared pattern set; publish readiness keeps its existing metadata selector and performs no secret read or outbound verification. No new long-lived state beyond the existing one-result-per-workspace/target cache slot, now with constant-size basis metadata.
- Deletions during final diff review: removed extra blank lines introduced by the edits only. No production behavior or tests were deleted; the obsolete nonexclusive auto-generation statements were replaced as required by sec 8.
