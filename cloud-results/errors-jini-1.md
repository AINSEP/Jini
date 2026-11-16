# errors-jini-1 — no swallowed errors, no generic error messages (Jini)

Branch `fix/errors-jini-1` (from `origin/integ/wave-b`). Node 24.11, pnpm 10.33.2.

## Caveat on the audit tool
`Tovu/development/scripts/owner-rules-audit.mjs` does **not exist** in the attached Tovu checkout (checked `main`, `cloud/errors`, `cloud/ci-errors`). I wrote an AST approximation of the two rules
(`cloud-results/errors-jini-1-audit.mjs`: `swallowed-error` = empty catch without comment / `.catch(() => {})`; `generic-error-catch` = catch that never reads the error yet has a fixed sentence + throw/log/return).
Counts below are from that approximation, not the real tool. Re-run the real one.

## 1. Bug: `describeErrorForLog` dropped the message
- RED: new `packages/core/src/__tests__/describe-error-for-log-message.test.ts` — 3 of 4 failed (`Error(EACCES)` instead of `Error(EACCES): EACCES: permission denied…`, no `: offline`, no redacted message).
- Fix: `model-facing-tool-errors.ts` — class label + approved code + **credential-redacted (`redactSecrets`), 300-char-truncated message**, same for the direct cause. Never throws (throwing `message` getter → label+code only). Non-Error throws stay `typeof`.
- GREEN: 4/4. Mutation: replacing `redactSecrets` with identity → "redacts credentials" fails; dropping the message from the text → 3 fail.
- ~35 existing tests across core/diagnostics/db/plugins/platform/cms/integrations/http-kit/server asserted "class only, never the message"; updated to the new contract (redacted secrets still asserted absent).
- Added `ignoreBestEffortFailure({operation},{scope})` to core (debug-logs the cause) used by the "intentionally ignored" sites.

## 2/3. Hits before → after (my approximation)
| package | before (swallowed/generic) | after | decisions |
|---|---|---|---|
| diagnostics | 13 / 0 | 0 / 0 | (c) browser/route/reader cleanup + async error-report admission → `ignoreBestEffortFailure` debug log + why comment; `sources.ts` keeps redacted message / thrown string text |
| db | 6 / 2 | 0 / 1 | snapshot removal → (a) propagates; pglite cleanup/rollback → (c) debug log; `ready.catch` → (c) comment; postgres URL error now says why (parser message only) |
| plugins | 2 / 1 | 0 / 0 | `detail` on INTEGRITY_FAILED; late attach failure + failing `onError` → (c) debug log |
| user-management | 1 / 1 | 0 / 0 | `parseLoginProviders` returns redacted `detail`; roster re-read comment |
| admin | 4 / 6 | 0 / 0 | panels use `describeApiError` (host message shown, cause logged); JSON import error shows parser message; telemetry/widget-title → (c) debug log; redirects toggle/remove → comment |
| platform | 0 / 7 | 0 / 4 | login-shell failure names class/code; guarded open names code (ELOOP…); object-store JSON says why |
| integrations | 0 / 17 | 0 / 16 | auth-schemes JSON says why; webhook worker log keeps message |
| cms | 0 / 13 | 0 / 5 | reconcile `detail`; `FormDeliveryError` keeps `cause`; free-disk check logs error; destination JSON; video-workspace code; redirect `detail` |
| provider-plugins | 0 / 3 | 0 / 2 | Stripe transport failure names code/class (plugin ships standalone, no core dep) |
| server, http-kit, capability-providers | 0 | 0 | no hits; log-contract tests updated (messages now kept) |
| **total** | 26 / 50 = **76** | **0 / 28 = 28** | |

## Left (28, all "generic-error-catch" by my heuristic) — justified, please review
- URL-parse input validation whose typed message already says what was wrong, cause adds only "Invalid URL": `platform/src/asset-cache.ts:98`, `platform/src/web/web-page.ts:163`, `integrations/.../credentialed-request.ts:71`, `sets/store.ts:199,218`, `webhooks/subscriptions.ts:209`, `media-providers/dispatch/ssrf-guard.ts:65`, `cms/src/media/import/fetch-image.ts:30`, `media/provenance.ts:8,42`, `media/sanitize-svg.ts:58`, `provider-plugins/src/analytics-posthog/consent.ts:37`.
- Deliberately secret-safe (message/echo would leak): `credentialed-request.ts:330` (probe URL), `:573`, `platform/src/secrets/passphrase-envelope.ts:74,88`, `db/src/secrets-vault/repo.sql.ts:42` (VaultError code-only), `integrations/src/saved-requests/projection.ts:15`, `validation.ts:56` (SavedRequestError code-only), `provider-plugins/.../payments-stripe/provider.ts:33` (reply goes to webhook sender).
- Already report the detail (provider + body snippet): media-providers `openai-compatible.ts:239`, `aihubmix.ts:165`, `nanobanana.ts:136`, `openai.ts:178`, `openrouter.ts:124`, `senseaudio.ts:190`, `response-parsers.ts:136`.
- Already logged with id+count: `cms/src/widgets/read-service.ts:117`.
- Not fixed, follow-ups: `plugins/src/host/node/loader.ts:235` drops the new `detail` from `admitBrowserProviderAssets`; non-Error throws (`throw "text"`) still log only `string` by design; `db/.../data-module.ts` housekeeping catch has a comment but no debug log; user-facing "snapshot failed"/"could not be snapshotted" messages in db transfer tools stay fixed (cause is logged).

## Test status (honest)
All touched packages' tests pass **except failures that exist on the unmodified tree** (verified by stash/compare where noted): core `settings-subpath-isolation`, `source-neutrality`; db `loads-without-driver`, `security-defaults.source`; platform `integration-contracts`, `secrets/exports`; plugins `PLUGIN_PROVIDER_CAPABILITY is not defined` (provider-contributions, provider-schema, provider-settings-migrations), `host-entry-purity`; http-kit `origin.test`, `same-origin`, `http-error-log-redaction` (guard lists `describeErrorForLog` logs); cms `repo.dialects` (version 99); admin React suites need unbuilt `@jini-ai/ui` (not run to completion). `pnpm -r build` has baseline failures (desktop-host, capability-providers tests in tsc, http-kit test files). `pnpm guard`: 158 baseline violations, none from the new code.
Changesets (patch) per package under `.changeset/*error*.md`.
