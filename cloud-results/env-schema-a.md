# env-schema-a — build report (2026-11-16) — PARTIAL

Branch `refactor/env-schema-a` in both repos, from `origin/refactor/terra` (Tovu `80b00f5b`, Jini `02edbb68`).
Design: `origin/plan/env-schema-design-2026-11-16` r2. SEQUENCE.md lists J0, J1, T0, T1, T7 as parallel-now; AMENDMENTS-A/B hold no env-schema item.
Stopped on the context budget, not on a blocker. Nothing is red.

## Done

| Step | Repo | SHA | What |
|---|---|---|---|
| pins | Tovu | `e9d3d4e5` | One test per CLI deny switch, alone (design §2.4a, judge blocker 1). |
| pins | Tovu | `a76d9d6c` | Import-time and startup credential consumption, in subprocesses (§2.6 S0/S3, judge blocker 2). |
| J0 | Jini | `50b54d65` | `@jini-ai/devops/checks/env-access`: `HW9-env-access`, `HW12-env-import-time`, fixtures, `runHardwiring({ rules })`, export entry, changeset. |
| J0 | Jini | `3642b063` | Host script `scripts/check-env-access.ts`, baseline `scripts/env-access-debt.json`, wider scan roots, registered in `guard.ts` and `check-guard-drift.ts`. |
| J0 | Jini | `e5e56ccd` | Helpers take one object of arguments (owner args audit). |
| J1 part 1 | Jini | `988221a2` | `@jini-ai/core`: `contracts/env` (types), `env/parse-env` (`parseEnv`), `env/format-env-issue` (`formatEnvIssue`), `env/coercers`, changeset. |

Tovu commits build on Jini `02edbb68` (they are tests of unchanged Tovu code; no Jini change is needed to run them).

## Not done (next step first)

1. **J1 remainder**: `describeEnvForDiagnostics`, `renderEnvExample`, `renderEnvDocs`, `launchEnvFor`; the `missing` issue kind (needs the "recommended in production" input); preset schemas in `server` and `cli`; `HW10` + `HW11` with `envDataOwners`, `familyReaders`, `bindingModules` and the worker-binding test; the 11 Jini census rows; first consumer `server/storage/backend-config.ts`; generated `.env.example` + `docs/ENVIRONMENT.md`; publish.
2. **T0, T1, T7**: not started. T0 needs J1 published (design §3 rollout order); T1 and T7 need T0.

## Pins and mutation proof

All new tests were green on the unmodified tree first. Each mutation below was applied to the source, the named test file run, and the source restored (`git status` clean afterwards).

**Tovu deny switches** — `apps/website/src/contracts/core/__tests__/unit/assistant-cli-deny-switches.pins.unit.test.ts` (15 tests). Each switch alone: access off, a saved owner grant does not beat it, the lock names the switch, every capability off; a 21-word hostile table proves only today's exact words deny.

| Mutation | Failing tests |
|---|---|
| drop the `TOVU_AGENT_PERMISSION_MODE` lock | 4 |
| drop the `TOVU_AGENT_FORBID_BASH` lock | 5 |
| drop `TOVU_AGENT_NATIVE_FALLBACKS` | 6 |
| drop `TOVU_AGENT_FULL_CLI_ACCESS` | 5 |
| add the word `off` | 2 |
| let `FORBID_BASH` accept `true` | 1 |
| swap the lock order | 1 |
| permission mode ignores `restricted` | 1 |

The strict prompt block for `TOVU_AGENT_FORBID_BASH=1` was already pinned (`assistant-system-overlay.unit.test.ts:31-46`); not duplicated.

**Tovu boot credentials** — `apps/website/src/server/runtime/boot/__tests__/boot-credential-order.pins.unit.test.ts` (5 tests).

| Mutation | Failing tests |
|---|---|
| launcher pid not erased at import | 1 |
| sign-in keys read but not erased | 1 |
| sign-in keys not read at import | 1 |
| startup secrets left in `process.env` | 1 |
| accessor adds secrets to a foreign map | 1 |
| startup key list reordered | 1 |

`REQUIRED_SECRETS` already has a literal pin (`deploy-config.unit.test.ts:38`).

**Jini gate** — `packages/devops/src/checks/__tests__/env-access.test.ts` (15), `hardwiring-node.pins.test.ts` (+1), `scripts/__tests__/check-env-access.test.ts` (6). 16 mutations, all caught: entry exemption removed / widened to every file; build define covering any key / ignoring package runtime; `import.meta.env` unseen; import-time rule off / everywhere; debt identity without the env name; runner ignoring `rules`; no file an entry; bin targets ignored; define allowed in node packages; payloads unscanned; examples unscanned; every payload folder scanned; debt ignored.

**Jini parser** — `packages/core/src/env/__tests__/parse-env.test.ts` (18). 15 mutations, all caught: blank counts as set; owner value judged; inactive setting judged; IPC/import-time values in the config; secret shown; unlisted name shown; presence-only value shown; URL credentials shown; secret default named; config not frozen; flag words trimmed; flag ignoring its own words; int ignoring max; unknown names unreported; declared names ignored.

## Baseline numbers (J0)

`HW9-env-access` 76 occurrences in 50 files (45 in packages); `HW12-env-import-time` 9. Process entries, derived from the tree: `packages/*/src/bin/**` and each manifest `bin` target (`packages/mcp/src/bin/serve.ts`, `packages/cli/src/main.ts`).

## Deviations and findings (decisions for the coordinator)

1. **Rule id clash.** `HARDWIRING_RULES` already has `HW9-plugin-import`. The design's ids are used as written (`HW9-env-access`, `HW12-env-import-time`); the full ids are distinct. Renumbering is one constant in `env-access.ts` plus the debt file.
2. **`HW12` baseline is 9, not the design's 0.** 3 are in `packages/db/src/testing/*` (the old `HW1` exempts `testing/`; `HW9`/`HW12` do not), 6 are example entry files (`examples/*/src/main.ts`, `server.ts`) that J0's wider scan roots now reach. All are debt rows, not failures.
3. **Preset entries are not process entries yet.** D1 is not recorded as decided, so `server`/`cli` preset files stay debt. If D1 is yes, add them to `isProcessEntry` and the rows become stale debt.
4. **Separate debt file.** `scripts/env-access-debt.json`, not `hardwiring-debt.json`, so this lane edits only its own rows (SEQUENCE H4 row-file rule). Same ratchet (`diffHardwiringDebt`).
5. **No `./env` index entry.** The design names one `@jini-ai/core` `./env` entry over several files; that needs a re-export file, which the owner rule bans. Each file is its own entry: `./contracts/env`, `./env/parse-env`, `./env/format-env-issue`. Same for devops: `./checks/env-access`, not a line in the existing `./checks/node` re-export.
6. **Additions to the design's type sketch:** `EnvSchema<Config>` (`specs`, `ownedPrefixes` — the host says which prefixes are its own, so no product word is in Jini); `EnvIssue.suggestion` (nearest known name); `HostEnvironment`; `ParsedEnv`. `bindingModules` is not an input of J0: `HW9`/`HW12` only look at `process.env` and `import.meta.env`, so a worker's `env` parameter cannot trip them (fixture included); it arrives with `HW10`/`HW11`.
7. **Parser behaviour to confirm before the first consumer:** a spec default that fails its own coercion yields `undefined` silently (a schema test should reject such a spec); `activeWhen` compares the controlling variable's raw text, or its default when unset, exactly; flag and enum words are compared untrimmed (parity with today's `=== '1'` readers); the warning for a rejected value with no nameable default says "is not using this value".
8. **Design fact wrong (Tovu, T0 input).** §2.6 S0 says nothing else reads the owner sign-in names. `apps/website/src/features/plugin-runtime/install.ts:13` reads the launcher pid name from an injected map. Class: a second reader of a name its owner erases at import. Not verified which map that caller receives; the T0 spec for that name needs two readers and a characterization test of the order. Pinned as a two-file literal for now.
9. **`HW12` limits (stated in the code):** a read reached through a call made at module scope, a class static initialiser, and `globalThis.process.env` are not seen; the design's import-recording test covers the first.

## Gates

| Gate | Result |
|---|---|
| Jini `pnpm -r build` on the unmodified tree | **fails at base**: `@jini-ai/chat` and `@jini-ai/admin` (51 TS errors, test-support files). Not touched. `core` and `devops` build clean. |
| Jini `pnpm guard` | exit 1 at base with 16 violations; **same 16 after**, 0 new (`[guard]` lines diffed). Env rules: 76 / 9, 0 new. |
| Jini `check:size` | fails at base; output identical after. |
| Jini `check:complexity` | passes. |
| Jini typecheck | `packages/core`, `packages/devops`, `scripts/tsconfig.json`: 0 errors. `pnpm -r typecheck` not run in full (the two base build failures above). |
| Jini tests | core 2731/2731; devops checks 103; scripts env-access 6 + entrypoints 6 + drift 1. |
| Tovu touched tests | 20/20, plus the 21 neighbouring tests unchanged. |
| Tovu `tsc -p tsconfig.tests.json` | 4 errors, none in the new files (base state with the linked Jini). Root `tsc`, `check:size`, `check:complexity`, `check:boundaries` not re-run: no product file changed. |
| Owner audits (`tools/owner-audits-2026-11-16`) | `owner-rules-audit`: 0 findings in changed files. `args-object-audit`: 0 violations; 2 `unsure` in `env-access.ts` (`inspect` takes a named object type, `visit` is the compiler's callback shape). `hook-injection-audit`: no component touched. Tovu changes are test files, which the audits skip. |

No test process is left running. No secret value is in any test or in this report (fixtures are literal placeholder words).
