# forms — 2026-11-05

Implemented the approved V3 steps 2 and 5, trimmed evidence capture from step 3, and the trimmed V4 disk guard. Source work is complete; focused tests and touched Jini builds pass. Whole-tree verification remains PARTIAL for the specific pre-existing/environment failures listed below. No deployment or npm publication was performed. Only `cloud/forms` was pushed in either repository; no force push, main push, live/owner data, new table, expiry job, or Google Forms work.

## Branches and pushed implementation commits

Approved bases: Jini `6f507852d`, Tovu `e327c07c8`. Implementation heads when this report was prepared:

- Jini: `cbc51817ddfca6f6ed12585e37b760e740230ddd`
- Tovu: `d79929c429aacc3f0f9bba84be539046f6b6a7f9`

The subsequent report-only commit is the branch head and is identified in the final response. Implementation commits, all confirmed pushed:

### Jini — `cloud/forms`

- `a42d8b8e305d2b56c870296bca7cb7ebbf262af0` — feat(forms): capture submission evidence and add collection and disk admission seams
- `4d2772591c3b3713f30235c03baa4350873c3d7a` — feat(forms): share portable field validation with Cloudflare receiver
- `9bba06e9bb92f42ac2298d30f1f3128da6875e9f` — wip(forms): wire provider selection, historical evidence and static receiver retention
- `1755549cf878a65cab9682fe9151b6c8f3cdd9fa` — fix(forms): verify provider controls, static parity and answer-preserving disk refusal
- `cbc51817ddfca6f6ed12585e37b760e740230ddd` — fix(forms): seal Formspree catalog and enforce stored collection ownership

### Tovu — `cloud/forms`

- `063b052846b128590ecff4da66cdcb6412963dc5` — fix(forms): probe local upload disk once before attachment batches
- `cf4f975b61b12e4bc6394362ebca6e4e90d2f552` — wip(forms): wire providers, transfer markup and preserve remote submission evidence
- `6f606c1a82128a4cfe936151571cd18e6c0d8229` — fix(forms): preserve transfer defaults and provider collection lifecycle
- `d79929c429aacc3f0f9bba84be539046f6b6a7f9` — fix(forms): finish manifest typing and preserve composition complexity


## Changes

- Shared the existing Jini non-file validation owner with the Cloudflare receiver. Numeric/date/time/phone/URL bounds, steps, choices, optional boxes and normalization agree with native validation. Tovu's existing Unicode code-point limits remain unchanged and are verified against the actual native wrapper. Unsupported rules and static file controls still refuse publication explicitly.
- Transfer/hash includes mode, HTML and public provider selection. Legacy Builder/built-in forms overwrite HTML/external destinations correctly. Notification recipients stay local, including when reading an older bundle containing `notify`; mixed and scoped confirmation dialogs show this policy.
- The existing submission envelope captures original descriptors/option labels, exact consent labels/help text and authored HTML context, canonical SHA256 schema hash, time and provenance. Capture uses the stored original definition before answer-dependent validation views. Imports and historical detail, notifications and delivery formatting retain this context. Old rows explicitly say `original schema/consent unavailable`; validation remains unknown where its original result is unavailable. No historical evidence is invented.
- Added the small collection registry/native POST plan and isolated Formspree runtime/agent subpaths. Public provider config stays in the existing definition envelope and survives ordinary edits, HTML/Builder authoring, status changes, duplication, DTOs and tools. Live rendering and exports use the same plan. External forms keep their exact Formspree action and are excluded from built-in manifests/hooks. Missing/retired plugins show specific unavailable states. Server collection ownership checks the stored record even when a legacy validation view omits metadata.
- Built and tested the real Formspree artifact through Tovu's trusted loader, integrity checks and disable lifecycle. Added its two genuinely generated catalog records, preserving existing records. Runtime identity is `jini/formspree`; its linked agent face is `jini/formspree-agent` with `providerPlugin: formspree`.
- Pending Cloudflare counts are visible; uncollected answers never auto-expire. Switching the last built-in form to Formspree retains the existing D1/key and authenticated pull/ack routes, with an empty active built-in manifest. Fresh external-only sites do not provision a receiver.
- V4 is **75 added + 1 deleted = 76 changed lines**, including tests and Tovu wiring. One `statfs` probes the uploads root inside the dedupe-protected batch callback before its first write. The complete batch is refused when free space minus incoming bytes would fall below 512 MiB. Remote stores skip the disk probe; unreadable probes warn and allow. No directory walk, 256 MiB cap, counters, reservations or startup refusal.
- Disk refusal returns HTTP 507 with a stable code and validated non-file answers, or an uncached native retry page with all those answers and empty file controls. Exact Tovu copy: “This site has no room for another attachment. Your answers are kept below. Your form has not been sent.” The captured controls travel with the refusal, so retry rendering does not depend on another database lookup or a truncating cookie. Files must be selected again.

No stale-form detection, import orchestration move, old-report error recovery, storage redesign, Google provider, vendor form creation, synchronization, webhook or scheduler was added. Existing frozen outbound jobs are unchanged.

## Setup and build verification

Fetched `cloud-plans-1105` and read both job files using `git show origin/cloud-plans-1105:<path>`. Named base branches had advanced, so branches were explicitly based on the approved SHA values above. Read the Software Architect, Programmer and TDD personas and used the repository-required helper workflow.

The COMMON setup scripts were absent at `/workspace/shared`; used their existing equivalents under `/workspace/.tovu-build`. Every command below used `source /workspace/.tovu-build/env.sh` (Node 24 / pinned pnpm 10.33.2). PostgreSQL readiness and `SELECT 1` passed. Existing dependencies/dist were present but some workspace links and compiled exports were stale. Lockfile-only setup added six workspace dependency lines; no dependency exclusions or test thresholds changed.

Passing commands/builds:

- `cd /workspace/Jini/packages/cms && pnpm run build` and final `npm --prefix /workspace/Jini/packages/cms run build`.
- `cd /workspace/Jini/packages/cms && npm run typecheck`.
- `cd /workspace/Jini/packages/admin && pnpm run build` and `npm run typecheck`.
- `cd /workspace/Jini/packages/agent-plugins && pnpm run build` (also green in the dependent workspace build).
- `cd /workspace/Jini/packages/provider-plugins && tsc -p tsconfig.json --noEmit` and `node --import tsx scripts/build.ts formspree .` (main config and isolated actual artifact; full chart config is discussed below).
- Rebuilt source-verified stale runtime exports via `pnpm --filter @jini-ai/chat --filter @jini-ai/user-management --filter @jini-ai/daemon --filter @jini-ai/devops build`, then the MCP package build and Tovu contracts build. No source fixes outside this job.
- `cd /workspace/Tovu && JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` (including a final run after the final CMS build; zero link changes).
- `git diff --check` in both repositories.

Initial recursive builds overlapped incomplete concurrent edits; they are not claimed green baselines. A true detached base worktree at Jini `6f507852d` reproduced the existing handler assertion described below. The resumed dependent build passed CMS, agent-plugins, integrations, UI and upstream packages; stopped its duplicate/unrelated build work once touched package builds were independently complete. No whole-workspace green claim.

## Focused tests (exact commands)

Counts overlap between commands and are not summed. No existing test was deleted or weakened; no permanent skip, exclusion or suppression was introduced. New regressions were observed RED before implementation. Working directory is `/workspace/Jini` unless stated.

```sh
npm --prefix packages/cms test -- src/forms/__tests__/submit-service.test.ts src/forms/__tests__/file-fields.test.ts src/forms/__tests__/provider.test.ts
# 31 passed, final stored-provider guard/native/evidence/disk boundaries
npm --prefix packages/cms test -- src/forms/__tests__/file-fields.test.ts src/forms/express/__tests__/handler.test.ts -t disk
# 3 selected disk cases passed; other names unselected, including the known baseline logging failure
npm --prefix packages/cms test -- src/forms/__tests__/provider.test.ts src/forms/__tests__/write-service.test.ts src/forms/html/__tests__/authoring-adapter.unit.test.ts src/widgets/__tests__/unit/resolvers-contact-form.unit.test.ts
# 55 passed
npm --prefix packages/cms test -- src/forms/__tests__/notify-subscriber.test.ts src/forms/__tests__/notify-durable.test.ts src/forms/__tests__/email-sender.unit.test.ts src/forms/__tests__/submit-service.test.ts src/forms/__tests__/submission-evidence.test.ts src/forms/__tests__/submission-validation-metadata.test.ts
# 51 passed before the later additional original-schema-view regression; that new regression is green in the final 31 above
pnpm --filter @jini-ai/cms exec vitest run src/forms/__tests__/forms.submission-validation.test.ts src/forms/__tests__/forms.field-validation.test.ts src/forms/__tests__/checkbox-authored-value.test.ts src/forms/__tests__/email-fields-w2g.unit.test.ts src/forms/__tests__/text-cap-order.test.ts
# 57 passed in four existing files; final selector matched no file
npm --prefix packages/admin test -- src/forms/__tests__/answer-format.unit.test.ts src/forms/react/__tests__/submissions-states.unit.test.tsx src/forms/react/__tests__/copy-polish.unit.test.tsx
# 51 passed; JSX-only notice helper rerun of the latter two files: 25 passed
npm --prefix packages/admin test -- src/forms/react/__tests__/FormEditorFieldsBody.unit.test.tsx src/forms/react/__tests__/use-form-editor.unit.test.tsx src/forms/react/__tests__/use-form-editor.branches.unit.test.tsx src/forms/__tests__/form-editor-dirty.unit.test.ts
# 36 passed
npm --prefix packages/provider-plugins test -- src/formspree/__tests__/provider.test.ts
# 10 passed
npm --prefix packages/plugin-catalog test -- -t 'formspree|lists every provider source'
# 3 selected catalog checks passed, 57 names unselected; both new rows and inventory checked
node --test --test-isolation=none packages/agent-plugins/cloudflare/worker/__tests__/forms-validation-parity.test.mjs packages/agent-plugins/cloudflare/worker/__tests__/forms-urgent.test.mjs packages/agent-plugins/cloudflare/worker/__tests__/forms-receiver.test.mjs packages/agent-plugins/cloudflare/worker/__tests__/forms-receiver-edges.test.mjs packages/agent-plugins/cloudflare/lib/__tests__/forms.test.mjs packages/agent-plugins/cloudflare/lib/__tests__/forms-edges.test.mjs packages/agent-plugins/cloudflare/targets/__tests__/forms-publish.test.mjs
# 56 passed, zero skipped
```

Tovu commands:

```sh
cd /workspace/Tovu
node --import tsx apps/website/src/features/forms/__tests__/import-remote-submissions.test.ts
# 17 passed (actual callbacks, including delayed import and malformed evidence rollback)
node --import tsx apps/website/src/server/inbound/admin-http/http/__tests__/forms-response.test.ts
# 13 passed
node --import tsx --test --test-isolation=none apps/website/src/features/forms/__tests__/publish-content.test.ts apps/website/src/features/forms/__tests__/form-destination-manifest.test.ts apps/website/src/features/forms/__tests__/field-length-caps.test.ts apps/website/src/features/form-destinations/__tests__/port.unit.test.ts apps/website/src/features/publish-content/ui/__tests__/sections.test.ts
# 41 passed, zero skipped
cd /workspace/Tovu/apps/admin
npx vitest run src/features/publish-content/__tests__/PublishContentDialog.unit.test.tsx
# 118 passed, zero skipped
```

Additional actual production probes, not a claim of browser E2E:

```sh
cd /workspace/Tovu
node --import /workspace/Tovu/node_modules/tsx/dist/loader.mjs /workspace/work/forms/provider-lifecycle-probe.mts
node --import /workspace/Tovu/node_modules/tsx/dist/loader.mjs /workspace/work/forms/provider-artifact-lifecycle-probe.mts
# Both passed: stateless/trusted registration, exact native action, negative configuration, immediate lease retirement, real artifact integrity/loading/disable.
node --import /workspace/Jini/node_modules/tsx/dist/loader.mjs /workspace/work/forms/formspree-catalog-update.mts
# Genuine generation/sealing of only the new provider and agent catalog entries; existing entries retained.
```

Detailed raw logs and probe sources remain under `/workspace/work/forms`; required retained results are recorded here. UI verification used component/hook tests; no real-browser or deployed endpoint claim. No coverage percentage is claimed.

## Typecheck/lint failures and open items

- Final `cd /workspace/Tovu && node_modules/.bin/tsc -p tsconfig.json --noEmit` has **one failure and no forms diagnostics**: `apps/website/src/features/deployments/publish-credentials/store.ts(410,88)` TS2322, `string | undefined` used as `string`. That file is unchanged from approved base `e327c07c8`; listed, not fixed.
- Jini strict changed-source ESLint (`--no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}'`) exits 0. One inherited bounded-pattern regex warning moved unchanged into the portable validator; pattern input is capped at 300. No suppression added.
- Forms-specific Tovu logic passes the same ceiling. Whole changed-file strict lint still reports unchanged base composition debt: `app.ts` createRouteDeps=11 and createApp=11; `deps.ts` composeSiteRouteDeps=14/cognitive=11, plus existing nesting warnings. Confirmed by linting the exact base source with `eslint --stdin --stdin-filename`. Removed our added outer branch so composition metrics do not increase. Minor findings remain listed rather than refactoring unrelated host assembly.
- True-base handler test: `cd /workspace/work/forms/baseline-Jini/packages/cms && pnpm exec vitest run src/forms/express/__tests__/handler.test.ts`: 17 passed, 1 failed. Existing test expects a raw Error but the existing logger supplies a redacted stack string. Same failure on changed tree; stopped pursuing it.
- Tovu provider-host test file failed twice before subtests with exit 1/no detailed stack; stopped per COMMON. Commands were `node --import tsx --test --experimental-test-module-mocks apps/website/src/server/runtime/composition/__tests__/provider-plugins.unit.test.ts`, then with `--test-name-pattern='stateless form collection' --test-reporter=tap`. The new lifecycle is independently verified by both direct production probes above; whole file remains unverified.
- Whole catalog suite had two failures: the new publisher-identity convention failure was fixed and focused checks now pass; npm-pack execution failed `spawnSync npm EPERM` twice and was not retried again. No pack assertion was changed. Full release catalog generation also needs pre-existing Langfuse 0.6.22 artifacts absent in this environment; new two entries were really generated with the existing integrity owner.
- Full provider chart typecheck/build is blocked by absent declared ECharts/Recharts dependencies. Main provider types and the actual Formspree artifact pass. Full packaging/global build is not claimed green.
- Generic registry supports future providers; this approved UI/tool schema intentionally offers only built-in and Formspree. Google and descriptor-driven multi-vendor UI remain outside scope.
- No stale-page detection is added: native evidence records the original stored definition at acceptance, not proof of what an already cached browser page displayed.

## State and I/O cost

Let E be serialized evidence (bounded at 1 MiB), A answer bytes, F files, R recipients and N pending rows.

- Provider selection: existing definition read/write gains at most 2 KiB public config; boot/reapply uses the existing host configuration read and module admission once per loaded declaration/version. Rendering performs zero vendor API reads; Formspree receives one browser POST per external submission, carrying its submitted answers.
- Native attempt: existing definition read, one local canonical digest/copy, existing submission write grows by E. Dedupe/rate/notification identities and schedules remain unchanged. Existing submission/detail/list DB reads now carry E per row; list HTTP output carries only a schema hash, not full evidence. Existing list queries still read the envelope; there is no separate evidence table.
- Remote receive: existing single D1 insert gains E; existing pull remains at most 50 rows/page, each row gains E. No new pull poll or orchestration. Worst-case page payload grows with `50 × (A + E)`; no adaptive byte pagination is introduced in this trimmed capture-only scope. Ack still sends IDs and deletes committed remote copies only.
- Notifications/delivery: existing per-recipient jobs and reads carry the captured context; no new job/timer/API read. Historical meaning uses captured labels/options; old frozen jobs are not rewritten.
- Existing receiver publish preview: one indexed `COUNT(*)` scalar query, O(N) index work, no answer payloads and no poll. Empty-form preview adds one credential metadata listing; empty publish opens the existing selected key once and rebinds the existing D1, with no new key/database/migration/answer mutation.
- Attachment-bearing submission: one existing effective-storage selection lookup when settings-driven, then **one statfs for local storage** and O(F) in-memory byte summation. Remote storage performs zero statfs calls. Text-only, honeypot, invalid, rate-denied and already accepted duplicate attempts perform zero probes. No inventory scan/write/counter/poll. A refusal creates no accepted submission/event or file write. Retry HTML/JSON uses captured controls/validated answers already in memory; no extra DB lookup.
- Approximate disk admission has no cross-process reservation: concurrent unrelated writes can consume space after statfs. This is the approved conservative free-space guard, not exact accounting.

## Exact Cloudflare release follow-through

1. Republish every affected existing forms-enabled Cloudflare Worker with **receiver.mjs + portable-validation.mjs + enriched forms-manifest.mjs together**. Keep its D1 database ID, receiver URL and existing management secret.
2. Republish every affected static HTML page after transferred mode/HTML changes or provider selection changes. Cloudflare built-in manifests/routes must match the page; external Formspree forms retain their exact third-party POST action.
3. After the final built-in form switches external, publish the empty active manifest while retaining existing D1/key and authenticated `/_tovu/*` routes until pending imports are completed. Uncollected answers have no automatic expiry; previews disclose counts/policy.
4. Release/distribute the changed CMS/admin/agent-plugins/provider-plugins/catalog packages and Tovu consumer artifacts through the separate release job. This job did not publish packages, deploy, or alter any running Worker. The local disk guard alone requires the Tovu runtime release, not a Cloudflare republish.

## Bugs fixed and findings left open

BUG FIXED: Cloudflare accepted malformed numbers and omitted native format/bound validation; it now uses the shared validator.
BUG FIXED: Native versus static Unicode maximum lengths could disagree; receiver preserves Tovu's code-point contract.
BUG FIXED: HTML-only changes were omitted from transferred content/hashes, and notification recipients traveled across sites.
BUG FIXED: Legacy Builder/built-in transfer could preserve a destination's unrelated HTML/external provider.
BUG FIXED: Historical edits changed field/option meanings; captured evidence now owns historical detail and formatting.
BUG FIXED: Answer-dependent native validation views changed captured schema/hash; capture uses stored originals.
BUG FIXED: A legacy validation view could omit provider metadata and reopen built-in collection for an external form; stored ownership now gates it.
BUG FIXED: Switching the last built-in form removed access to uncollected answers; existing authenticated receiver storage/routes are retained.
BUG FIXED: Admin memory edits omitted provider from its patch allowlist; Builder and HTML select/save/switch-back parity is now tested.
BUG FIXED: Public attachment batches could write despite an exhausted local disk; admission now checks once before all writes and preserves answers on refusal.
BUG OPEN: Base publish-credentials/store.ts:410 optional-id typing error blocks whole Tovu tsc; unchanged/out of scope.
FINDING OPEN: Existing handler logging assertion, old host-composition complexity/nesting, bounded regex warning and environment/global packaging limits above remain unchanged.
