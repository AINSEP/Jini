READY 44f705c80

**`integ/merge-12-2026-11-22` @ `44f705c80`** (last content commit; the commit on top only adds this report). All 4 branches merged, no conflicts. Build, typecheck, guard, `api:check`, the three plugin guards and every touched package suite are green apart from BASE-RED rows. 57 mutations: 54 RED, 3 equivalent. **Listed, not fixed:** 1 new complexity row and 3 why-comment rows (decisions 2 and 3). **Before the next release:** core removes 2 exports with no changeset of its own (decision 1).

# combine-12 JINI (2026-11-22): `integ/merge-12-2026-11-22`

Unattended cloud run, 01:33 – ~02:45 UTC (well inside the 3.5 h cap). Branch created from `origin/integ/merge-11-2026-11-21` (`1ac1cbbd1` = published 0.7.3-next.2). Node v24.22.3 (`/opt/node24`), pnpm 10.33.2 (corepack).
- **Not used:** subagents, codebase-memory tools, force-push, `--no-verify`, `git pull --rebase`, publish, tags, version bumps, changesets.
- **Pushed:** only this branch, always a plain `git push` (the remote branch is new and only this run wrote to it).
- **Untouched:** `main`, `refactor/terra` (fetched only, as the why-comments default base), `plan/*`, `release/*`. Tovu `origin/plan/err-design-1121` was only read; Tovu `apps/` was only grepped for consumers.

**Summary: all 4 merges are done, nothing left.**
- **Conflicts:** none in any merge (jx-err1 and jx-err2 touch disjoint files; nothing had to be reconciled).
- **Sheet tests:** every new or changed test passes after its merge (one new OTel case needed the same 60 s timeout as its BASE-RED twin; fix commit `b7e494ae`).
- **Mutations:** **57 run, 54 RED, 3 GREEN.** All 3 GREEN are equivalent mutants (explained in the table). No mutation was NOT-RUN.
- **Reds found and fixed (4 fix commits):** OTel test timeout (`b7e494ae`), plugin-catalog drift for the Sentry/OTel `server/index.mjs` digests caused by jx-err1 (`9818a048`), test pins for the inner plugin versions jx-route bumped in plugin-catalog (`788a945a`) and agent-plugins `manifest.test.ts` (`44f705c8`, found by the full suite).
- **New ratchet rows (LISTED, not fixed):** complexity `core/src/errors/reporter.ts refusalError (11)` (jx-err1); why-comments `--base` 3 lost / default 5 → 7 (jx-err1 1, jx-route2 2). Everything else equals base or improved.
- **API:** `api:check` 0 before and after; **not purely additive** — core removes `IncidentTrackerReport` and `createRecordingTracker` (err-design J2's declared BREAKS). `api:update` committed (`0e66320a`). No changeset ships with jx-err1 (decision 1).

## Method
- **Setup / base first** (unmodified `1ac1cbbd1`), per combine-11 Method, including its clean-reinstall finding: this clone had **no `node_modules` at all**, so the first `pnpm install --frozen-lockfile` was already a fresh frozen install (0). `pnpm --no-bail -r build` 0 (0 `error TS`); typecheck 0 + scripts tsc 0; `pnpm guard` 0; `api:check` 0; `guard:plugins` / `:packed` / `:catalog` 0 / 0 / 0. Ratchets recorded in `combine-12-jini-raw/gates-base/`. **The base equals combine-11's final state exactly** (same size 3 lines, complexity 4, log-safety 10, error gate 24 New + 1 Worse, why-comments default 5 not allow-listed, HW3 34 / HW9 env 70 / advisory 491).
- **Sheets read before merging:** Tovu `origin/plan/err-design-1121` `err-design/CULL.md` §1 and §5 J1–J7, plus the inputs J5–J7 point to verbatim: `r62t-err3.md` (O126, O133, O134, O308, O397, U550 roster), `r62t-keepstd.md` (O121), `r62t-census2.md` (O93, O178, O245, O248, O302, O314, O423, O485). B5 and r62t-route sheets are not in git: the branch commits and their tests are the spec (as the dispatch says). `cloud-results/combine-11-jini.md` Method.
- **Merges:** `git merge --no-ff`, given order, main tree. Gates after each merge (`combine-12-jini-raw/gates-m<N>/`): `pnpm --no-bail --filter "...[<pre-merge>]" build`; `tsc -p tsconfig.json --noEmit` in each changed package; `pnpm guard`; `SIZE_BASE_REF=1ac1cbbd1 check-size`; `COMPLEXITY_BASE_REF=1ac1cbbd1 check-complexity`; `check-hook-injection`; `check-why-comments --base 1ac1cbbd1` and default (terra `6c9effae4`); `check-log-safety`; `check-error-gate`. Each diffed against base. Plugin guards ran at base, after merge 4 and final.
- **Mutations:** one plant per run (regex substitution by `plant.py`), the test command run, the file restored by byte copy and checked clean with `git diff --quiet`. Every plant's diff and result is in `mutations.txt`. For the idiom sheets (J6/J7) "invoke `work` directly" was planted by replacing that file's idiom import with a local shim that does exactly that (each touched file uses its idiom at the sheet's named site only; O126's file uses it twice, both covered); "remove observation/observer" likewise.
- **Owner args rule:** `git diff 1ac1cbbd1...<tip>` of all 4 branches has **no removed line containing `_optional`**; jx-err2 adds three `_optional: Record<string, never> = {}` pads.
- **Full suites:** separate worktree `/home/user/jt12` at `0e66320a` (fresh frozen install 0, `pnpm --no-bail -r build` 0, 0 `error TS`); each touched package `npm run test -- --maxWorkers=2 --minWorkers=1`; agent-plugins' node:test plugin suites (`*/__tests__/*.test.mjs`) separately.

## Per branch
| # | branch (tip) | merge commit | conflicts → resolution | red found | fix commits | status |
|---|---|---|---|---|---|---|
| 1 | `origin/codex/jx-err1` `ef67a1d04` | `5cf95b40` | none | Filtered build 0 (0 `error TS`); tsc core / diagnostics / provider-plugins 0; guard 0. **Complexity NEW**: `core/src/errors/reporter.ts:158 refusalError (11)` (the added `own-message` line; sheet limit is 10). **why-comments NEW** (`--base` 1 lost, default 5 → 6): `core/src/errors/reporter.ts:26 [5f57b7820e73]` — the doc comment of `IncidentTrackerReport`, which J2 deletes, so the comment is obsolete with it. **Test red**: the new `observability-sentry.test.ts` "OTel operation traceIds belong to that tracker outside its active scope" timed out at 5 s (OTel `dispose()` flushes the exporter towards `collector.invalid`; same class as the 4 BASE-RED engaps J4 timeouts; also red with proxy vars unset). **Catalog drift** (seen when the plugin guards ran after merge 4): Sentry and OTel provider `server/index.mjs` digests. | `b7e494ae` (60 s timeout on that one new case only), `9818a048` (catalog reseal) | GREEN (2 listed ratchet rows) |
| 2 | `origin/codex/jx-err2` `943dc4467` | `7f81e890` | none (no file overlap with jx-err1) | none. Build 0; tsc 11 packages 0; ratchets = merge 1 except **improvements**: size drops 3 stale `json-ipc.ts createJsonIpcServer` debt rows (E9 split), error gate 11 → 28 improved/gone (New/Worse identical to base). | — | GREEN |
| 3 | `origin/codex/jx-b5` `3e8e594ff` | `641ddcbb` | none | none. tsc chat 0. **Improvement**: the BASE-RED complexity row `drainRunFramesToAgUi (12)` is gone; `readConfirmationResume` moved 292 → 296 (same row). | — | GREEN |
| 4 | `origin/codex/jx-route2` `8d9c0e19c` (contains `codex/jx-route` `96381bc48`, verified ancestor) | `a2256623` | none | tsc agent-plugins 0; guard 0; `guard:plugins` 0; `guard:plugins:packed` 0. **`guard:plugins:catalog` RED**: (a) the drift from merge 1 above; (b) `plugin-catalog/__tests__/catalog.test.ts` "preserves each agent manifest version independently of the npm release" pins `ui-ux-design` `0.7.0` and `slide-design` `0.1.1`, which jx-route bumped to `0.7.1` / `0.1.2`. Catalog rows for the routed plugins themselves were already correct (only the 2 provider digests drifted). **why-comments NEW** (`--base` 1 → 3 lost; default 6 → 7): `agent-plugins/kuinetic/__tests__/bundled-package.test.mjs:40-41 [f96a225503a3]` (rewritten, see below) and `agent-plugins/src/lifecycle/__tests__/unit/load-supporting-files.unit.test.ts:49 [03c2746c1aa4]` ("explicit reads now reach the host; … still requires activation" — no longer true, the case now expects a read-only inactive read). | `788a945a` (catalog pins 0.7.1 / 0.1.2); `9818a048` as above → `guard:plugins:catalog` 0 (68/68); `44f705c8` (the same two pins in `agent-plugins/src/__tests__/manifest.test.ts`, found by the full suite) | GREEN (2 listed ratchet rows) |

After all merges: `0e66320a` = `api:update`. Gate/mutation output commits: `779979bd`, `773afe96`, `636f678b`, `21e78e98`, `0cd39ba8`, `e58cba7b`.

## Per-sheet tests and mutations
Raw: `combine-12-jini-raw/mutations.txt` (each plant's diff and result). Every mutation was run separately and restored.
| sheet | new/changed tests after merge | named mutation → result |
|---|---|---|
| J1 (contract + vendor export) | provider-plugins `observability-sentry` + `observability-otel-operations` 53/53 (with the timeout fix); diagnostics 68 files 1090/1090 | Sentry: tagged report sent through `sanitizedError` → **RED**; drop frames → **RED**; keep the message (value = message + ID) → **RED**; literal "keep the message line" (`defaultStackParser(stack, 0)`) → GREEN, **equivalent** (Sentry's parser never makes a frame from the `Error: <message>` head line; the message is excluded by `value: incidentId`). OTel: omit the ID → **RED**. `traceIds()` returning the active scope's IDs instead of the tracker's own: OTel → **RED**, Sentry → **RED**. Noop `traceIds` absent: pinned in `observability-otel-operations.test.ts:26`. |
| J2 (reporter corrections + port swap) | core `src/errors` 5 files 75/75 | omit `fallback.action` → **RED** (7); `describe` with `errorId` records again → **RED**; `error` passed to the logger → **RED**; `step` sent as `operation` → **RED** (3); trace not read from the tracker → **RED** (2); catalog `own-message` → `String(error.message)` → **RED** (catalog.test); reporter `refusalError` `own-message` → raw message → **RED** (2); per-call exact secret dropped from refusal redaction (host-only) → **RED**; `callerSafeRules` keeps `own-message` → **RED** |
| J3 (`runOperation`) | core `boundary.test.ts` 3/3 | describe twice → **RED**; `failed: false` on an incident → **RED**; `error.message` in the words → **RED** (2); skip `end` → **RED** (2) |
| J4 (generic words out) | sidecar 30 files 408 + 3 skipped; protocol 27 files 795 | sidecar `"internal error"` restored → **RED** (4); protocol `'request failed'` restored in both defaults → **RED** (13); restored only in `decodeApiErrorRecord`'s default (`errors.ts:92`) → GREEN, **equivalent** (its only caller always passes `fallbackMessage`) |
| J5 (E9-J-SPLIT) | the named witnesses (`json-ipc.contract.test.ts`, `index.test.ts` UTF-8) are inside the sidecar suite: green | no mutation named ("zero ledger delta"); the error-gate New/Worse set is unchanged and size drops 3 stale `createJsonIpcServer` rows |
| J6 batch A | chat / desktop-host / oauth / user-management / analytics witnesses green | O121 remove `observe` → **RED** (2), `work` directly → **RED** (2); O126 both calls direct → **RED** (3: 2 read + 1 write case); O133 → **RED**; O134 → **RED**; O308 → **RED** (3); O397 → **RED**; U550 roster → **RED** |
| J7 batch B | agent-runtime / cms / daemon / desktop-host / platform / sidecar witnesses green | O93 → **RED**; O178 remove observer → **RED**, await discard directly → **RED** (2); O245 → **RED**; O248 → **RED** (2); O302 → **RED**; O314 → **RED**; O423 → **RED** (2); O485 remove observation → **RED** as the sheet requires: vitest exit 1 with 1 "Unhandled Rejection" (38/38 cases still pass; unmutated exit 0) |
| B5-J1/J2 (AG-UI interruption copy) | chat `run-frames.test.ts` 8/8 | raw `error.message`/`String(error)` restored in `RUN_ERROR` → **RED** (3); host `interruptionMessage` ignored → **RED**; only `Error` redacted, non-Error `String(error)` leaks → **RED** |
| r62t-route J1 (companions) | agent-plugins lifecycle units 106/106 (4 files) | companions dropped from the delivery order → **RED** (3); companion delivered although the top was declined under Ask → **RED**; old cap (top + companions + others ≤ 3) → **RED** (4); malformed `companions` accepted → **RED** (2); installed index drops `companions` → **RED**; explicit off-plugin load no longer opts into inactive guidance → **RED** (2); automatic reads also opt in → **RED** (2); companion not filtered by `enabled` → GREEN, **equivalent** (`prepare()` filters candidates to enabled at `automatic-use.ts:231` before `:75`, exactly like the pre-existing `required` filter at `:76`) |
| r62t-route kUInetic | `kuinetic/__tests__/bundled-package.test.mjs` 5/5 | hard `load_agent_plugin(...)` line restored → **RED**; `companions` removed from `plugin.json` → **RED** |
| r62t-route J2 (import staging) | `site-import/__tests__/bundled-package.test.mjs` 11/11 | SKILL.md moves the current homepage automatically → **RED**; `content-mapping.md` does → **RED** |
| r62t-route J3 (host-neutral design/deck) | `slide-design` 1/1 (new file), `ui-ux-design` 11/11 | slide-design publishes on creation → **RED**; ui-ux-design publishes without a request → **RED** |

## Decisions for the owner
1. **Core removals ship without their own changeset.** `api:check` passes only because the unrelated `.changeset/core-observability-contract.md` (C12-OBS, core `minor`) happens to cover `@jini-ai/core`. jx-err1 removes `@jini-ai/core/errors/reporter#IncidentTrackerReport` and `@jini-ai/core/errors/testing#createRecordingTracker`, and changes `ErrorReporterPorts` / `ErrorReporter` / `createRecordingReporter` shapes (CULL J2 "BREAKS"; no production caller in Jini or Tovu — Tovu `apps/` grep finds none). Add a core changeset describing J1–J3 before the next release, or accept the C12-OBS one as the carrier. Not added here (no changesets/bumps in this run).
2. **Complexity row** `core/src/errors/reporter.ts:158 refusalError (11)`: J2's `own-message` line breaks the sheet's own complexity ≤ 10 rule (a STOP condition for the executor). The guard is defence in depth: the catalog no longer returns a message for `own-message` (`catalog.ts:114`), so `match.message ?? fallback.message` on the next line already gives the fallback. Folding it into that line (or a debt row) closes the row. Listed, not fixed.
3. **why-comments rows (3, all obsolete with the change, none fixed):** `core/src/errors/reporter.ts:26 [5f57b7820e73]` (doc comment of the deleted `IncidentTrackerReport`); `agent-plugins/src/lifecycle/__tests__/unit/load-supporting-files.unit.test.ts:49 [03c2746c1aa4]` (claimed explicit reads still need activation; the case now pins the read-only inactive read); `agent-plugins/kuinetic/__tests__/bundled-package.test.mjs:40-41 [f96a225503a3]` (rewritten as "previously …" text, so it shows only under `--base`). Add debt rows or accept. The combine-11 row `admin/…/test-runner.ts:10-11 [8559987223a2]` is still open (combine-11 decision 1).
4. **jx-route2 behaviour change worth a look:** an explicit `load` of an installed-but-**off** plugin now returns its guidance read-only (`status: 'installed-but-inactive'`, text prefixed "Plugin '<id>' is off; its tools are unavailable.") via the new `resolve(…, { allowInactiveGuidance: true })` option; before, it answered `unavailable`. Automatic (ranked/companion) reads keep active-only resolution (both directions mutation-verified). Also the automatic cap changed from "top + required ≤ 3" to "top + all declared companions + up to 3 additional".
5. **Inner plugin versions bumped by jx-route** (kuinetic 0.1.0 → 0.1.1, site-import 1.0.2 → 1.0.3, slide-design 0.1.1 → 0.1.2, ui-ux-design 0.7.0 → 0.7.1) were pinned in 2 tests outside the branch (`plugin-catalog/__tests__/catalog.test.ts`, `agent-plugins/src/__tests__/manifest.test.ts`); both re-pinned (`788a945a`, `44f705c8`). Future inner-version bumps will keep breaking these exact pins.
6. **Sentry tagged path ships stack frames of the original error.** For an `incidentId`-tagged report the event keeps `defaultStackParser(error.stack, 1)` frames (file paths / function names) while the message is replaced by the ID — exactly as CULL §1 specifies ("stack frames and the message line removed" → frames kept, message removed). Noting it only because frames leave the process.
7. **Equivalent mutants (3)** are explained in the sheet table; no test change is suggested. The `decodeApiErrorRecord` default (`protocol/src/errors.ts:92`) is unreachable and could be made required.
8. **guard advisory 491 → 492** test-only cross-package imports (advisory, not failing); came in with the merged test files.
9. **Carry-overs unchanged:** combine-11 decisions 1–9 (Vitest-3 script timeouts, CI narrowing, error-gate refresh blocked by 25 rows — still 24 New + 1 Worse, cms-forms `package-boundary`, provider-plugins engaps J4 timeouts, …). This run improved the error gate (11 → 28 improved/gone) but did **not** run `--update` (24 New + 1 Worse still present; J-RATCHET refuses).

## Final gates (main tree; build/typecheck/ratchets at `0e66320a`, guard + catalog guard again at `44f705c8`)
| command | base `1ac1cbbd1` | final |
|---|---|---|
| `pnpm --no-bail -r build` | 0, 0 `error TS` | **0**, 0 `error TS` (main tree; also 0 in fresh worktree `jt12`) |
| `pnpm -r --no-bail --if-present run typecheck` + scripts tsc | 0 / 0 | **0 / 0** (0 `error TS`) |
| `pnpm guard` | 0 (HW3 34; HW9 env 70; advisory 491) | **0** (HW3 34, 0 new; HW9 env 70, 0 new; advisory **492**) |
| size (`SIZE_BASE_REF=1ac1cbbd1`) | 1, 3 lines | **1, same 3 lines** (BASE-RED) **+ 3 "Remove stale debt entry"** lines for `sidecar/src/json-ipc.ts createJsonIpcServer` (improvement from J5) |
| complexity (`COMPLEXITY_BASE_REF=1ac1cbbd1`) | 1, 4 | **1, 4**: `handleRpcError 12`, `readConfirmationResume 11` (line 292 → 296), `ErrorNotice 11` (BASE-RED); `drainRunFramesToAgUi 12` **gone** (jx-b5); **NEW `refusalError 11`** (jx-err1, decision 2) |
| hooks | 0 | **0** |
| why-comments `--base 1ac1cbbd1` | 0 | **1, NEW: 3 lost** (decision 3) |
| why-comments default (terra) | 1, 5 not allow-listed | **1, 7** = base 5 + `reporter.ts [5f57b7820e73]` + `load-supporting-files [03c2746c1aa4]` |
| log-safety | 1, 10 lines | **1, identical 10** (BASE-RED) |
| error gate | 0 WARN, 24 New + 1 Worse, 11 improved | **0 WARN, identical 24 New + 1 Worse** (BASE-RED), **28 improved** → `--update` not run |
| `pnpm api:check` | 0 | **0** before `api:update` (core "breaking, covered by changeset", decision 1) and after (`0e66320a`; 40 packages, 680 entries, 17204 symbols) |
| `guard:plugins` / `guard:plugins:packed` / `guard:plugins:catalog` | 0 / 0 / 0 (68/68) | **0 / 0 / 0 (68/68)** after `9818a048` + `788a945a`; red at merge 4 before them |
| `pnpm install --frozen-lockfile` | 0 | **0** (worktree; no lockfile change) |

Raw: `combine-12-jini-raw/gates-{base,m1..m4,final}/`.

## Tests
Full suites of every touched package (worktree `jt12` at `0e66320a`, `--maxWorkers=2`; `suites/_summary.txt`):
| suite | combine-12 | combine-11 | Δ |
|---|---|---|---|
| core | 2957/2957 | 2953 | +4 (J3 boundary +3, J2 reporter +1) |
| diagnostics | 1090/1090 | 1090 | = |
| provider-plugins | **4 failed** / 919 (923) | 4 failed / 914 (918) | +5 (J1). Reds = the same 4 BASE-RED engaps J4 timeouts |
| agent-runtime | 4539 + 1 skipped | same | = (O93 keeps its witnesses) |
| analytics | 226/226 | 226 | = |
| chat | 4491 + 1 skipped (4492) | 4489 + 1 | +2 (B5) |
| cms | **1 failed** / 5009 (5010) | 2 failed / 5008 (5010) | = count. Red = forms `package-boundary` (BASE-RED); combine-11's `subpath-isolation` timeout is fixed there |
| cms/forms | **1 failed** / 156 (157) | same | = (BASE-RED `package-boundary`) |
| daemon | 4854 + 1 skipped | same | = |
| desktop-host | 749 + 1 skipped | same | = |
| oauth | 824 | 824 | = |
| platform | 3354 + 6 skipped | same | = |
| protocol | 795 | 794 | +1 (J4) |
| sidecar | 408 + 3 skipped | same | = |
| user-management | 1353 | 1353 | = |
| agent-plugins (vitest) | worktree: **2 failed** / 2193 + 2 skipped (2197) → fixed in `44f705c8`, main tree re-run **2195 + 2 skipped, 0 failed** | 2188 + 2 | +7 (route) |
| agent-plugins node:test (110 plugin `*.test.mjs` files) | **1396 pass / 0 fail** (all 110 exit 0) | — | new slide-design file +1 test; kuinetic/site-import/ui-ux-design extended |
| plugin-catalog | 68/68 | 68 | = |

Every red line:
- **provider-plugins (4, BASE-RED, engaps J4, 5 s timeouts):** `observability-opentelemetry.test.ts >` "a settings card supplies no tracer name: the service name is the tracer name" · "site attribution: every exported span's resource carries the host's attributes; service.name stays the host's service" · "the factory resolves a general endpoint to /v1/traces and serves the port until disposed" · `observability-sentry.test.ts >` "a composed tracker correlates Sentry errors to the actual active OTel span only".
- **cms + cms/forms (BASE-RED):** `forms/src/__tests__/package-boundary.test.ts > forms keeps its own published root entry and CMS exposes no forms alias` (`expected '0.7.2' to be '0.7.3-next.2'`, combine-11 decision 6).
- **agent-plugins (fixed, `44f705c8`):** `src/__tests__/manifest.test.ts > ui-ux-design plugin > has a plugin.json that validates as a PluginManifest` (`'0.7.1'` vs `'0.7.0'`) and `> slide-design plugin > has a plugin.json the strict parser accepts, with its publisher id and capability` (`0.1.2` vs `0.1.1`).
- **plugin-catalog (fixed, `788a945a` + `9818a048`):** `__tests__/catalog.test.ts > standalone plugin catalog > preserves each agent manifest version independently of the npm release`; catalog drift (2 digests).
- **provider-plugins (fixed, `b7e494ae`):** `observability-sentry.test.ts > OTel operation traceIds belong to that tracker outside its active scope` (5 s timeout).
- **Ratchets (listed, not fixed):** complexity `refusalError (11)`; why-comments 3 lost (`--base`) / 2 new (default); all others BASE-RED as in the gates table.
- Not run here (unchanged since combine-11, no merged branch touches them): `vitest run scripts/__tests__`, `test:scripts:node`, examples, untouched packages, e2e/playwright, knip/sonar/depcruise, Actions.

## Exported signatures the Tovu run must consume
`pnpm api:check` before `api:update` (`api-check.txt`, `api-baseline-diff.txt`):
- **@jini-ai/chat `./core/ag-ui#drainRunFramesToAgUi`** (changed): `drainRunFramesToAgUi(ctx: AgUiFrameContext, { interruptionMessage = "The response was interrupted. Try again." }: { interruptionMessage?: string } = {})`. On a reader rejection it closes open messages and writes **one** `RUN_ERROR` whose `message` is `interruptionMessage` — never the rejection's `message` or `String(error)`; the return value still carries the original error (`{ status: 'failed', error }`, same identity). Tovu should pass its translated plain copy. (Tovu has no current caller; its AG-UI adapter is `assistant-ag-ui.ts`, CULL T1.)
- **@jini-ai/core `./contracts/observability`** (changed): `OperationTracker.traceIds?(): TraceIds | undefined`; `ErrorReport.context` adds `incidentId?: string; label?: string`.
- **@jini-ai/core `./errors/reporter`**:
  - `ErrorReporterPorts.tracker` → **`observability: Pick<ObservabilityPort, 'reportError'>`**; `IncidentTrackerReport` **removed**.
  - `describe(required: { error; step; scope; fallback: { message; action }; operation: string; tracker: OperationTracker }, optional?)` — `operation` and `tracker` now required.
  - `record(required: { error; step; operation: string; tracker?: OperationTracker }, optional?)` — `operation` now required.
  - Incident words are now `` `${fallback.message} ${fallback.action} (error ${id})` `` (action added). `describe` with `optional.errorId` writes **no** host record and **no** report. The logger record no longer receives `error` (only the redacted `meta.diagnostic`). The report is `{ error: <original>, context: { operation, level, incidentId, label, trace? } }` — no `exactSecrets`, no `attributes.errorId`.
  - Refusals: `own-message` bindings publish the **fallback** words (never `error.message`); per-call `exactSecrets` now also redact refusal sentence params.
  - **New** `runOperation<T>(required: { deps: { observability: Pick<ObservabilityPort,'trackOperation'>; reporter: ErrorReporter }; operation; scope; step; fallback; work: () => Promise<T>; attributes? }, optional: DescribeFailureOptions = {}): Promise<{ ok: true; value: T } | { ok: false; failure: DescribedFailure }>` — one tracker, `end({ outcome: 'completed' | 'failed' | 'refused', failed })`, reporter called once.
- **@jini-ai/core `./errors/catalog`** (no signature change): `callerSafeRules` no longer lists `own-message` bindings; model rules keep them.
- **@jini-ai/core `./errors/testing`**: `createRecordingTracker` **removed** → `createRecordingObservability()` (`{ observability: { reportError, trackOperation }, reports: ErrorReport[] }`, fake `traceIds`); `createRecordingReporter` now returns `reports: ErrorReport[]`.
- **@jini-ai/provider-plugins** Sentry / OTel adapters (behaviour): a report with `incidentId` exports type = `label`, value/attribute = the ID, no message (Sentry keeps frames); trackers expose `traceIds()`. **@jini-ai/diagnostics** fan-out tracker: first defined `traceIds` in live-adapter order.
- **@jini-ai/protocol** `decodeApiError` default `fallbackMessage`: `'request failed'` → "The server did not give a reason for this response. Check whether the change was saved before trying again." (Tovu's `admin-failure-channel.ts:56` reads only details/IDs from it.)
- **@jini-ai/sidecar** handler failure wire message: `"internal error"` → "The sidecar could not finish this request. Try again, and report the request ID if it keeps failing." (`HANDLER_ERROR` + `requestId` unchanged).
- **@jini-ai/agent-plugins `./lifecycle`, `./manifest`** (changed, additive): `AgentPluginManifest.companions?`, `InstalledAgentPlugin.companions?`, `AgentPluginSearchCandidate.companions?`, `readAgentPluginCompatibilityMetadata` returns `companions?` (malformed list ignored with a warning), `AutomaticAgentPluginPorts.resolve(input, options?: { allowInactiveGuidance?: boolean })`. Without a `formatPluginToolPointer`, the catalog "Load:" line now says "use the current host's plugin guidance reader" (was `search_agent_plugin_local({ query })`). Manifest key: `extensions.jini.companions: string[]`. Hosts implementing `resolve` must honour `allowInactiveGuidance` for the explicit off-plugin read (decision 4).
- **Plugin content**: kuinetic 0.1.1 (companion `ui-ux-design`, conditional fallback line), site-import 1.0.3 (staging; never moves the current homepage), slide-design 0.1.2, ui-ux-design 0.7.1 (host-neutral). Package versions are unchanged (`0.7.3-next.2`); nothing was bumped or published.

## Left / next
1. Owner: decisions 1–9 (above all 1: a core changeset for J1–J3; 4: inactive-guidance reads).
2. Not done (out of scope / owed elsewhere): the Tovu side of err-design (T1–T4; T3 needs a Jini release with J1–J3), J-HTTP / J-IPC (PARTIAL in CULL), a release (no bump, no tag, no publish).
3. Not run: scripts vitest / `test:scripts:node`, untouched packages, examples, e2e/playwright, knip/sonar/depcruise, Actions.

## Raw outputs (`cloud-results/combine-12-jini-raw/`)
- `gates-{base,m1..m4,final}/` (build, tsc, guard, size, complexity, hooks, why-base, why-default, log-safety, error-gate; plugin guards at base / m4 / final).
- `mutations.txt` (57 plants: diff + result each).
- `api-check.txt`, `api-update.txt`, `api-baseline-diff.txt`.
- `suites/` (`_summary.txt`, one file per package, `agent-plugins-node-test.txt`, `agent-plugins-after-fix.txt`).

## Pushed SHAs (`integ/merge-12-2026-11-22`, first-parent order)
- `779979bd` wip(cloud): combine-12 base gates at 1ac1cbbd1
- `5cf95b40` Merge codex/jx-err1 (ef67a1d04): err-design J1-J3 into integ/merge-12
- `b7e494ae` test(provider-plugins): 60s timeout for the new OTel traceIds case (exporter flush waits on name lookup, as its base twin)
- `773afe96` wip(cloud): combine-12 merge-1 gates and J1-J3 mutations
- `7f81e890` Merge codex/jx-err2 (943dc4467): err-design J4-J7 into integ/merge-12
- `636f678b` wip(cloud): combine-12 merge-2 gates and J4-J7 mutations
- `641ddcbb` Merge codex/jx-b5 (3e8e594ff): AG-UI interruption plain copy (B5-J1/J2) into integ/merge-12
- `21e78e98` wip(cloud): combine-12 merge-3 gates and B5 mutations
- `a2256623` Merge codex/jx-route2 (8d9c0e19c, contains codex/jx-route 96381bc48): plugin routing r62t-route J1-J3 into integ/merge-12
- `9818a048` chore(plugin-catalog): reseal Sentry/OTel server bundle digests after jx-err1 (catalog drift)
- `788a945a` test(plugin-catalog): pin ui-ux-design 0.7.1 and slide-design 0.1.2 inner versions bumped by jx-route
- `0cd39ba8` wip(cloud): combine-12 merge-4 gates
- `e58cba7b` wip(cloud): combine-12 merge-4 route mutations
- `0e66320a` chore(api): api:update after combine-12 merges (core removes IncidentTrackerReport/createRecordingTracker per err-design J2; adds runOperation/createRecordingObservability)
- `44f705c8` test(agent-plugins): pin ui-ux-design 0.7.1 and slide-design 0.1.2 inner versions bumped by jx-route
- report commit on top (this file).
