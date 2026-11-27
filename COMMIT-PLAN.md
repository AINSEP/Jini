# P10 Jini SOL commit plan

Base: `010c8cd874f709ffa2c61de0de4e1dde4f808aad` (`codex/b-p10aj`). Changes remain uncommitted for the coordinator. No tests, mutations, builds, installs, type-checks, or linters were executed, as the dispatch prohibits them. Tests were written before the corresponding production edits; RED/GREEN and mutation verification remain for the cloud run.

## 1. P10-O2.J — Counter labels, drainer gauge and agent-run usage contract

Implementation written; runtime verification pending.

Files:
- `packages/daemon/src/tool-recovery/observability.ts`
- `packages/daemon/src/tool-recovery/__tests__/observability.test.ts`
- `packages/infra/src/events/outbox/drainer.ts`
- `packages/infra/src/events/outbox/__tests__/drainer-queue-depth.test.ts` (new)
- `packages/core/src/contracts/observability.ts`
- `packages/provider-plugins/src/observability-opentelemetry/otel-port.ts`
- `packages/provider-plugins/src/__tests__/observability-otel-surfaces.test.ts`
- `.changeset/p10-o2-observability-metrics.md` (new)
- `api-baseline/jini-ai__core.json`
- `api-baseline/jini-ai__infra.json`

Tests and cloud mutations:
- `records exactly one classified counter per non-canceled tool failure`, with updated settled counter expectations: `refused-as-internal` changes denied/confirmation-denied counter kind to internal; exact refused attributes must fail while spans remain nonfailed and incidents absent.
- `samples the durable depth after each drain without changing settlement`: `report-claimed-count-as-depth` substitutes the claimed count for the durable read; expected depths `[1, 0]` must fail on the second drain. The rejected-read subcase must still deliver both rows and schedule another drain without reporting an error.
- `exports only provider-reported usage on the finished agent span`: `omit-output-token-attribute` omits output tokens; exact finished-span attributes must fail, including reported zero. Invalid/absent values remain absent and cost is never inferred.

API fingerprints updated only for the changed declarations; pre-edit normalized declaration hashes matched the committed values. No public signatures changed in daemon or provider-plugins, so their API baselines remain unchanged. No new export paths.

## 2. P10-S3.J — Pass a per-call abort signal to media transport

Implementation written; runtime verification pending.

Files:
- `packages/integrations/src/media-providers/dispatch/types.ts`
- `packages/integrations/src/media-providers/dispatch/engine.ts`
- `packages/integrations/src/media-providers/dispatch/__tests__/engine.test.ts`
- `.changeset/p10-s3-media-call-signal.md` (new)
- `api-baseline/jini-ai__integrations.json`

Test: `media generation forwards caller abort to an in-flight guarded request and skips dispatch when already stopped`. The OpenAI/image adapter supplies its own signal; the existing transport supplies its deadline and redirect policy. The injected guarded fetch records the combined signal before generation settles. Aborting the caller must abort that signal, preserve deadline/redirect options and leave the vendor's own controller unchanged. A pre-aborted call must make zero fetch calls. Cloud mutation `drop-caller-signal-from-guarded-fetch` passes the original guarded fetch into the context instead of the bound function; the recorded signal must then fail to abort on caller Stop.

API fingerprint updated only for `MediaDispatchEngine`, using the same verified pre-edit declaration hashing procedure. Tovu S3.T-MEDIA can now pass `{ signal: ctx.signal }` as generation options through the existing `@jini-ai/integrations/media-providers` path. No new subpath or export.

## 3. P10-S2.J-MFA — Record MFA login without saving a stale user snapshot

Implementation written; runtime verification pending.

Files:
- `packages/user-management/src/server/mfa/service.ts`
- `packages/user-management/src/server/mfa/__tests__/login-record-race.test.ts` (new)

Test: `TOTP and recovery login update lastLoginAt without restoring the old password hash`. The recovery case redeems a code during setup and then enters `beginOwnerLogin`; the TOTP case enters `completeOwnerLogin`. The session-save seam simulates a newer password hash after the stale lookup. Setup/reset writes finish before the user save/recordLogin spies are installed. Each completion must avoid `users.save`, call `recordLogin` exactly once with its workspace/principal/session timestamp and preserve the newer password hash. Cloud mutation `mfa-saves-stale-user-row` restores either old `save({ ...userRow/user, lastLoginAt })` call; the matching case must fail on save, missing recordLogin and the overwritten hash.

No public signatures, exports or authorization/session/recovery-code behavior changed.

## Review deletions

Removed unused required/options placeholder parameters from the private queue sampler during scope review. No unrelated additions or cleanup retained. No existing tests, assertions, behavior branches or why-comments were deleted.

Final diff review: only the three dispatched Jini SOL sheets and this plan are changed (13 existing files, five new files). Five test declarations were added and the existing settled-counter parameterization gained confirmation-denied; no tests were removed or weakened. All implementation anchors matched; no sheets were stopped. This is a source review only, not a passing test/build/type-check claim. The queue sampler retains at most one in-flight sample and constant state per loop; its completion is independent of drain cadence and stop settlement.

## Deferred scope

All Tovu sheets are outside this checkout. All OPUS sheets are reserved for the later Opus run: P10-O1.J, P10-O1.T, P10-S3.T, P10-O2.T, P10-O4.J, P10-O4.T, P10-S2.J, P10-S2.T, P10-S5.T, P10-S6.J.

Tovu O2.T still supplies the durable pending/processing depth read and admitted metric binding, plus canonical reported usage accumulation. Existing paths remain `@jini-ai/daemon/tool-recovery`, `@jini-ai/infra/events/outbox`, `@jini-ai/core/contracts/observability`, and `@jini-ai/provider-plugins/observability-opentelemetry/port`.
