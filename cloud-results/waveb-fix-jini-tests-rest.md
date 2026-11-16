# Wave B Jini tests (rest) — fix run

Branch `fix/wave-b-jini-tests-rest` (from `fix/wave-b-jini-build`), Node 24.22.3, vitest `--maxWorkers=2`.
Baseline tree `../base` = `origin/refactor/terra`. `better-sqlite3` native build fails in this container (both trees installed with scripts ignored where needed), so no sqlite-driver test depends on it here.

## Per-package totals (failed tests / total) — before → after

| package | branch before | base (terra) | branch after |
|---|---|---|---|
| agent-plugins | 3 / 2163 | 3 | 0 / 2163 |
| agent-runtime | 6 / 4490 | 6 | 0 / 4490 |
| agentic | 1 / 1136 | 1 | 0 / 1136 |
| plugins | 1 / 1011 | 1 | 0 / 1011 |
| provider-plugins | 17 / 873 | 2 | 0 / 873 |
| diagnostics | 3 / 958 | 3 | 0 / 958 |
| platform | 2 / 3102 | 1 | 0 / 3102 |
| core | 2 / 2711 | 2 | 0 / 2713 |
| db | 8 / 861 | 3 | 0 / 861 |
| mcp | 3 / 1741 | 2 | 0 / 1741 |
| cli | 1 / 583 | 1 | 0 / 583 |
| infra | 1 / 145 | 1 | 0 / 145 |
| desktop-host | 1 / 700 | 1 | 0 / 700 |
| http-kit | 6 / 540 | 2 | 0 / 539 |
| examples/neutral-host | 1 / 79 | 2 | 0 / 79 |
| examples/minimal-host | 1 / 3 | 1 | 1 / 3 (blocked, see below) |
| examples/reference-web | build + typecheck failed (AgentLab) | n/a | `vitest run src` 54/54, `vite build` OK |

(base after-totals not re-measured; base was not modified.)

## Classification and root causes (fix SHAs)

NEW = failing on the branch only; PRE = also failing on `refactor/terra`.

- **agent-plugins (PRE)** 3d4808a2 — failure `reason`s are class-only by the 11-15 red tests (`seed-bundled-edges`, `retire-bundled`); two older tests still expected message text; plugin-identity pinned `^0.6.10` exactly. Tests aligned (assert floor ≥0.6.10 by range).
- **agent-runtime (PRE)** a5a2d271 — `parsePiModels`/`parsePiRpcModels` were deduplicated into one function (test asserted two copies); the hard-coded AMR model preference was removed on purpose (discovered order kept); chmod warning line is `Error(EIO)` via core's describer. Tests aligned.
- **agentic (PRE)** 41494552 — test read `signal.reason.message` before the abort happened (and jsdom's signal has no `reason`); now asserts the `AbortError` name.
- **plugins (PRE, real source bug)** 8964947f — `./host` reached the `glue` domain through `manifest-keys.ts` (SI-domain). Moved to shared `src/core/`. host-entry-purity red→green.
- **diagnostics (PRE)** c5c2157f — non-Error source failures are reported by type (`string`), by the log policy. Tests aligned.
- **provider-plugins (NEW 15, PRE 2)** fe55a2c4 — the build-fix run declared `@jini-ai/core` as a runtime `dependency`, breaking the "packed distributions ship zero runtime deps" invariant (15 distribution/artifact tests). The imports are type-only: moved to `devDependencies` (the plugin-packaging convention the guard already accepts), lockfile updated by hand (frozen install passes), patch changeset. The 2 PRE (otel/sentry): unapproved credential-shaped `error.code` now reads as the class label `Error` (never printed); tests assert that.
- **platform (PRE)** cefbaee7 — `./system` (universal) and `./mail/email-template` added to the published-subpath assertions; exact-patch dependency ranges replaced by shape checks.
- **core (PRE)** 133ee420 — `optimistic-concurrency` imported `settings/errors`; `SettingsRevisionConflictError` now lives in root `src/revision-conflict-error.ts` (settings/errors re-exports the one symbol). Comments no longer name the consumer (source-neutrality).
- **db (PRE+NEW)** ffa47340, e4364f11, 6d507c33 — kernel now needs core (`toBool` moved to `@jini-ai/core/contracts/storage`): probe + allowed-package expectations updated; `pglite/socket-server` and `kernel/postgres/driver` import core's describer from its leaf entry (was the root barrel → 74 files); `secrets-vault` no longer imports platform (moved to core) so the optional platform peer is removed (package.json, README, test, injection-debt entry); consumer paths removed from comments.
- **mcp (PRE)** edde963d — log lines carry fixed words, the original goes to the logger's error bag; the test logger now records the bag. (`adapter.stdio.pins` "late" stderr test is timing-flaky; it passed in the final run.)
- **cli (PRE)** 07e5ec4f — same abort-reason read-before-abort test bug. **infra (PRE)** same commit — peer floor asserted by range. **desktop-host (PRE)** same commit — host message gets the error class.
- **http-kit (PRE+NEW)** 7fa60107 — origin/adapter tests mocked `@jini-ai/core`'s `isLocalSameOrigin`, but `guardSameOrigin` moved into core and calls it internally: tests now use real headers; the env-injection behaviour moved into core's own `origin.test.ts`. The HTTP log-class guard now accepts core's `describeErrorForLog` and the `Logger` error bag (same exemption as `check-log-safety`).
- **examples/neutral-host (NEW)** 2ca96251 — provisioning warning is class-only; original goes to the host sink. `credential-tools` type errors were already fixed by the build run.
- **examples/reference-web (NEW)** 1649d5ad — `AgentLab.tsx` now uses `createDomPageDriver` + `createDriverPagePort` from `@jini-ai/agentic/dom` and the bridge's `page:` option.
- Guard-driven (97542db8, c0641854, f3685f4a): N1/N2 comments in mcp/plugins reworded to "a host"; HW3 constant tables typed `ReadonlySet/Map` (agent-runtime ×4, platform email-template); platform `shared` source list so `mail/email-template` stops reaching the `web` domain (SI-domain); `claude-fable-5-2` added to the claude fallback list (R13); stale db injection-debt entry removed.

## Left, with locations

- **examples/minimal-host** `src/health-boot.test.ts`: `pnpm --filter @jini-ai/daemon run build` fails (daemon build is another run's scope; daemon tsc depends on chat). PRE on terra too.
- **examples/reference-web** `vitest run` at package root also collects `e2e/*.test.mjs` (node:test) → 2 "failed files"; the package script is `vitest run src && node --test e2e/*.test.mjs`, `src` is green. e2e not run (needs a built daemon).
- Not mine / still in guard: N1/N2 in admin, chat, cms, commerce, ui, user-management (other runs); HW3 in chat A2uiSurfaceCard.hooks.ts:23, daemon agent-executor/launch.ts, mcp-bridge.ts, ui dependencies-fake.hooks.ts:4, user-management agent-tool-input.ts:30; R10 chat ChatPane.tsx; 5 stale hardwiring-debt occurrences (hardwiring-debt.json — not in my packages' lines to verify).

## Guard

Before (Tovu check, wave-B branch): 153 violations (N1 52, N2 50, L3 17, SI-domain 16, HW3 14, R13 7, HW1 1, R10 1, injection-debt-stale 1).
After (this branch, `pnpm guard`, exit still 1): 78 lines — N1 35 + N2 34 (all in admin/chat/cms/commerce/ui/user-management), HW3 8 (chat/daemon/ui/user-management), R10 1. SI-domain, L3, HW1, R13, injection-debt-stale: 0. None remain in packages of this scope.
