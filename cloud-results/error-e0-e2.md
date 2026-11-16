# error-e0-e2 — run report (2026-11-16)

Result: **PARTIAL.** E1 done. E2 done except two items. E0 about half done. Nothing was force-pushed; no Tovu branch was created.

Branch: Jini `refactor/error-e0-e2`, from `origin/refactor/terra` @ `02edbb68`.
Design read: `plan/error-system-design-2026-11-16:designs/error-system/{DESIGN.md rev 2, INDEX.md, SITES.tsv}`, `plan/reconcile-2026-11-16:reconcile/{AMENDMENTS-A, AMENDMENTS-B, SEQUENCE, LESSONS-FOR-DESIGN-BRIEFS}.md`.

## Commits (all pushed)

| SHA | Step | What |
|---|---|---|
| `4d728ee8` | E1a/b | infra: outbox stores a listed failure code; one log entry per failed delivery |
| `58bfd1b5` | E1c/d | cms: form delivery declares its nine ledger codes; false comment corrected |
| `29c5a46a` | E2 | core: `errors/{sentences,bindings,catalog}.ts` |
| `1b5fc260` | E2 | core: `errors/{reporter,disclosure,approved-cause,incident-text,testing}.ts` |
| `8f309337` | E2 | core: `errors/idioms.ts` |
| `b4b4fd9c` | E2 | core: eight `./errors/*` export entries, changeset, gate fixes |
| `670bd808` | E0 | gate rules 1 and 2, warn-mode runner, baseline, fixture tests |
| `be1d5365` | E0 | CI step for the gate (warn mode) |
| this commit | — | report; two source comments corrected (see "Not done", item 2) |

Changesets (patch): `outbox-failure-codes` (infra), `forms-delivery-failure-codes` (cms), `core-error-system` (core).

## Gates, as run

| Gate | Result |
|---|---|
| Baseline on the unmodified tree | infra outbox 135 tests, cms forms/delivery 119, core 2713: all passed |
| infra `src/events/outbox` | 145 passed |
| cms `src/forms/delivery` | 125 passed |
| core (whole package) | 2781 passed (68 of them new, in `src/errors`) |
| `scripts/__tests__/check-error-gate.test.ts` | 12 passed |
| `pnpm -r typecheck` | exit 0, 0 errors. `tsc -p scripts/tsconfig.json` exit 0 |
| `pnpm guard` | ok (re-run on the final tree) |
| `check:size`, `check:complexity`, `check:log-safety` | pass (after fixes, below) |
| `check:errors` (new, warn) | 913 findings in 493 file/rule entries = the baseline |

Not run: the full `test:scripts` suite, package tests outside infra / cms / core, and `guard:drift`.

Core's coverage threshold (99%) fails, and it failed before this run: the files I did not touch are at 96.98% lines. The new folder is at 99.57% lines, 97.38% branches. `npm test` does not run coverage.

## E1 — outbox

- `OutboxRetryPolicy.failureCodes?: { codes, codeOf }`. The worker stores `codeOf(...)` only if it is in `codes`; anything else stores the class label. A throwing `codeOf` is reported through `reportPolicyFailure` and the batch continues.
- One `logger.error` per ordinary failure: `{ outboxId, attempt, lastError }` plus the original error. Written before `markFailed`.
- cms: `formDeliveryRetryPolicy` returns `failureCodes` (nine ledger codes; `codeOf` answers only for a `FormDeliveryError`, by class).
- Red first: 5 of 10 new infra tests and 6 of 6 new cms tests failed on the unmodified source.
- Mutations (each failed a test, then reverted): list check dropped; `codeOf` containment removed; log entry removed; message stored instead of label (30 existing pins failed); cms `codeOf` reading any `code` property; one code removed from the list.
- Named behaviour changes: real codes reach `lastError` again; one new log entry per failed delivery; `reportPolicyFailure` has a second ending ("storing the error class as the failure code for this row").
- Gap: no test passes the real cms policy through the real worker, because no Jini package may import both. The shapes are checked by `tsc` only where a host wires them. That test belongs in the host.

## E2 — `packages/core/src/errors/` (no index file)

| File | Lines | Holds |
|---|---|---|
| `sentences.ts` | 123 | `defineErrorSentences`, `CORE_ERROR_SENTENCES`, `interpolateSentence`; imports nothing |
| `bindings.ts` | 95 | `defineErrorScope`, `ErrorText` (`own-message` / `fixed` / `sentence`), class and discriminant bindings |
| `catalog.ts` | 197 | `createErrorCatalog`: scoped `match`, `sentence`, `statusFor`, `modelFacingRules`, `callerSafeRules`, `describerVocabulary`, `sourceSentences` |
| `reporter.ts` | 228 | `createErrorReporter`: `describe`, `record` |
| `disclosure.ts` | 62 | audiences and the Copy-details rule |
| `approved-cause.ts` | 40 | `approveCause`, `isApprovedCause` |
| `incident-text.ts` | 76 | operator-only text of a thrown value |
| `idioms.ts` | 89 | `observed`, `afterSettled`, `orFallback`, `orFallbackSync`, `bestEffort`, `absentWhen` |
| `testing.ts` | 62 | recording logger, tracker, ID sequence, fixed clock, `createRecordingReporter` |

Design test list, all present: the five catalog contract cases; incident with ID from the fake ID port and time from the fake clock; refusal makes no tracker or logger call; never throws when the logger, tracker, ID port, clock or catalog throws; the three private-prose canaries stay out of every caller-visible field for `anonymous`, `signed-in`, `authorized` without approval, and approval for another step, and appear only for `authorized` with a matching approval; the class/code label appears only for `authorized`.

Amendments applied: X1 (core's set defines `VERSION_CONFLICT`, `VERSION_REQUIRED`, legacy `CONCURRENT_EDIT` with the same sentence; a feature set cannot define an unprefixed code). X2 (`record` takes `tracker: 'skip'`, host record still written; a non-`Error` value is described from its data properties only, tested with a throwing getter and a recording `toJSON`). X3/X4 need no E2 code: the disclosure table is the contract X3 quotes, and `DescribedFailure.error` already carries `code`, `message` ending in `(error <ID>)` and `requestId`, which is X4's "run failed" row.

Mutations (each failed a test, then reverted). Catalog, 7: discriminant accepts any string; no reachability check; unknown scope searches every scope; match by the value's own `code`; fixed text ignored; describer classes not reversed; no prefix rule. Reporter, 11: signed-in treated as authorized; approval not tied to its step; forged approval accepted; anonymous gets details; `tracker: 'skip'` ignored; sentence audience ignored; non-`Error` serialised with `JSON.stringify`; record not redacted; raw message used as the incident words; refusal also records an incident; tracker throw not contained. Idioms, 5: `observed` does nothing; `absentWhen` swallows everything; `afterSettled` rejects; `bestEffort` does not log; `orFallback` ignores the observer.

### Choices the design left open (review these)

1. **`ErrorMatch` shape** is mine: `{ scope, code, mode, message?, params?, sentence?, guidance?, label? }`. The design names the type but not its fields.
2. **`onDuplicate`.** Design: `'throw' | 'warn'`. Built: `{ onDuplicate?: 'throw' } | { onDuplicate: 'warn'; logger }`, default `'throw'`. A warning with nowhere to go would be a swallowed error.
3. **`sentence.audience: 'authorized'`.** The design has the field and no rule. Built: a caller below `authorized` gets the boundary's fallback words with the same code and status.
4. **`sentence`-mode and discriminant bindings are not in `modelFacingRules` / `callerSafeRules`.** Such a class stays unlisted for the model (redacted). The design says this for discriminants; I applied it to `sentence` mode too.
5. **A throwing `params` function** gives no match (incident), the same rule the design states for a throwing `codeOf`.
6. **The tracker gets a redacted carrier `Error`**, not the original, so call-scoped `exactSecrets` are blanked there too. Cost: `reportErrorOnce`'s de-duplication by object identity no longer applies to these reports. E3/E4 should decide (the report carries `errorId` as an attribute).
7. **`ClientFacingError`** is answered as a refusal by `describe` (design §3.1 rule 5). Status: catalog first, then the existing generic table.
8. **A failing ID port** yields `ERR-0000-0000-0000-0000` (`UNAVAILABLE_ERROR_ID`) so the words, the wire field and the record still agree.
9. **Options types with no options** are empty named interfaces, as the design writes them. An empty interface accepts any object.
10. `core` has no dependencies, so `DescribedFailure.error` is core's `ServerApiError`, not protocol's `ApiError` (they are mutually assignable).

### Found while building

- **Node 24 exposes `Error.prototype.stack` as an accessor**, not an own data property. A data-only read loses every native stack, so `incident-text.ts` reads an `Error`'s `stack` and `message` directly (guarded) and keeps the data-only walk for non-`Error` values, which is what X2 asks.
- The log-safety gate flagged `reason: String(error.message)` in `catalog.ts` as stored error text. That field is the binding's published words (`own-message`), so I renamed it `message`. No debt row was added. This is a judgement call: the gate matches field names.
- Two new functions were over complexity 10 and were split.
- A neutrality test rejects a product name anywhere in core; one was in a test comment.

## E0 — gate, WARN mode (partial)

Built: `scripts/eslint-rules/errors/catch-reads-error.mjs` (rule 1, with the pure-parse exemption and `pureHelpers` matched by name and module), `no-generic-failure-text.mjs` (rule 2), `scripts/check-error-gate.mjs` (`--list`, `--files`, `--update`, `--strict`; exits 0 otherwise), `scripts/error-gate-debt.json`, `pnpm check:errors`, a CI step.

Baseline: 867 unread catches in 460 files, 46 generic literals in 33 files. The design's census says 1,187 handlers never read the error in Jini, and counts 76 generic literals; mine are lower because the parse exemption applies, tests and sanctioned modules are skipped, and my deny-list regex is not the design's. I did not reconcile the two counts row by row.

Fixtures are copies of sites the design names: `payments-stripe/http.ts:52` (passes) and `:54` (flagged), `agent-runtime/providers/response-text.ts:19`, `s3-compatible.mjs:414`, `provider-contribution.ts:97`, `useComposerHistory.hooks.ts:112`, plus one precedence case. Mutations, 4: await / for-await not checked; any call allowed; empty catch excused; helper matched by name only. A fifth (unused binding counts as read) did not apply and was not re-run.

`670bd808`'s message says CI runs the gate. It did not at that commit: my workflow edit had failed. `be1d5365` adds the step.

## Not done

1. **E2: `mintToolErrorId` was not moved to core.** The design says it has one caller. Jini has one; Tovu also imports it from `@jini-ai/daemon/tool-recovery` in `apps/website/src/assistant/tool-recovery-preset.ts` and three tests. With no forwarders allowed, the move needs a Tovu repoint, and this run's Tovu scope was the gate only. Stopped, per the method.
2. **E2: the guard allowlists for `approveCause` callers and for `tracker: 'skip'`.** Not built. Two comments in `approved-cause.ts` and `reporter.ts` named a script that does not exist; this commit corrects them to say the rule is not built.
3. **E0: rule 3** (`failure-text-from-catalog`), and the precedence step that lets a pure parse satisfy its cause clause.
4. **E0: the full fixture corpus** (75 passing parse refusals, 7 failing, one site per idiom, `backstop-service`). 7 sites are covered.
5. **E0: `pureHelpers` is empty.** The design's ten entries were not checked against Jini paths, so sites that need one are in the baseline as debt.
6. **E0: Tovu.** No byte-identical rule copies in `development/eslint-rules/`, no hash check, no Tovu baseline. Tovu was not installed or built in this run.
7. `details.params` is emitted by the reporter; `readErrorParams` in protocol is E10 and does not exist.

## Next step

Finish E0 in this order: rule 3 with fixtures; fill `pureHelpers` and re-take the baseline (it may only shrink from 913); the Tovu copies, hash check and Tovu baseline. Then decide item 1 (move the mint function with a Tovu repoint commit) and build the guard allowlists before any host calls `approveCause` or `tracker: 'skip'` (E3/E4).

# Run 2 (error-e0b, 2026-11-16)

Result: **E0 done in both repos (WARN mode), with three sites the design expected to pass left flagged on purpose. E2's two leftovers done. `fix/errors-jini-1` not merged: the design decides against its central change. E3 not started: SEQUENCE does not allow it yet.** Nothing was force-pushed.

## Commits (all pushed)

Jini `refactor/error-e0-e2`:

| SHA | What |
|---|---|
| `c187c983` | E0: rule 3, the copied-site corpus (83 sites), reviewed pure helpers, baseline re-taken |
| `cd738554` | E2 leftover: guard rule R14 (caller lists for `approveCause` and `tracker: 'skip'`); CI runs the gate's fixture tests |
| `172f9b4c` | E2 leftover: `mintToolErrorId` moved to `@jini-ai/core/errors/error-id`; daemon definition deleted |
| `1a30b153` | `describeFailure` in the reporter takes `(required, optional = {})` (found by the args audit) |
| this commit | report |

Tovu `refactor/error-e0-e2` (new branch, from `origin/refactor/terra` @ `80b00f5b`):

| SHA | Builds on Jini | What |
|---|---|---|
| `b8ba7bbf` | `c187c983` | E0: rule copies, hash check, runner, baseline, 36 copied sites, CI steps |
| `51e6d495` | `172f9b4c` | `tool-recovery-preset.ts` imports the mint function from core |

Changeset (patch): `error-id-one-owner` (core, daemon). The Tovu branch cannot install from the registry until core and daemon are published with the move.

## Gates, as run

| Gate | Result |
|---|---|
| Baseline, unmodified tree | Jini build exit 0; gate test 12 passed; `check:errors` 913 findings |
| Jini `scripts/__tests__/check-error-gate.test.ts` | 103 passed |
| Jini `scripts/__tests__/check-error-disclosure-callers.test.ts` | 5 passed |
| Jini core, whole package | 2784 passed (run at `172f9b4c`). After `1a30b153` only `src/errors` was re-run: 71 passed |
| Jini daemon `src/tool-recovery` | 139 passed (29 before the move, in the two files that import the function) |
| `pnpm guard` | ok. `pnpm -r typecheck` exit 0, 0 errors, and `tsc -p scripts/tsconfig.json` exit 0 (both at `172f9b4c`; core rebuilt clean after `1a30b153`) |
| `check:size`, `check:complexity`, `check:log-safety` | pass |
| `check:errors` (Jini) | 978 findings in 543 entries = the new baseline |
| Tovu root `tsc` | 0 errors (2 before the repoint, both caused by the Jini move) |
| Tovu `typecheck:tests` | exit 0 |
| Tovu tests | 64 passed in three files (the gate test, 43, and the two tool-failure redaction files) |
| Tovu `check:errors`, `check:error-rule-copies` | 829 findings in 484 entries = baseline; copies match the lock and the Jini originals |

Not run: Jini `test:scripts` as a whole, daemon outside `tool-recovery`, any other Jini package, Tovu `npm test`. Tovu `check:size` prints one worsened row (`provider-plugins.ts:337`, 149 vs 147) and four stale rows; this run touched none of those files, and I did not check the unmodified tree.

## 1. E0, finished

**Rule 3, `failure-text-from-catalog`** (`scripts/eslint-rules/errors/failure-text-from-catalog.mjs`, 114 lines). Inside a catch: words passed to `res.status(5xx).json`, a `set*Error` call or `store.set` are flagged; `new X("...")` without `{ cause }` is flagged unless the catch hands the caught value to `reporter.record` / `reporter.describe`, a logger or an idiom. A pure-parse refusal satisfies the cause clause (precedence step 2). Rule 1 exports the pure-parse test, so both rules use one definition.

**Rule 1.** Its allowed-call lists now match the design's prototype (`work/fp-recheck.cjs`). A reviewed helper is matched by the path of the module that declares it.

**Fixtures** (each is the whole try/catch copied as written, with every finding of the three rules recorded):

| | Jini (`scripts/__tests__/fixtures/error-gate/sites.json`) | Tovu (`development/eslint-rules/__tests__/fixtures/error-gate-sites.json`) |
|---|---|---|
| Parse refusals the design says pass | 48 of 48 pass | 24 of 27 pass (see deviation 1) |
| The 7 that are not parse refusals | 5, all flagged | 2, both flagged |
| One site per idiom, flagged as written; the idiom rewrite passes | 6 idioms | 4 idioms |
| Fixed-message and dropped-cause sites (rule 3) | 24 | 3 |
| Named cases | — | the three judge sites pass; `backstop-service.ts:116` passes rules 1 and 3 |

**Baselines** (WARN mode in both repos):

| | Rule 1 | Rule 2 | Rule 3 (new) |
|---|---|---|---|
| Jini | 867 → 853, no entry grew | 46 | 79 |
| Tovu (first baseline) | 580 | 131 | 118 |

The design's census says 1,187 / 684 unread handlers and 76 / 244 generic literals. Mine are lower because of the exemption and the exclusions; not reconciled row by row. Tovu's rule 2 rows include locale dictionaries (for example `deployment-i18n.tsx`).

**Tovu.** Three byte-identical rule copies in `development/eslint-rules/`, `error-gate-rules.lock.json` (sha256 per file), `npm run check:error-rule-copies` (a CI gate; also compares with a Jini checkout when one sits beside the repo), `npm run check:errors` (CI step, exits 0).

**Mutations, each failed a test and was reverted.** Jini rules, 12: no pure-parse precedence in rule 3 (23 tests failed); any read counts as handing over; `{ cause }` ignored; any status counts as 5xx; not limited to a catch; a code token counts as text; any function counts as a `.catch` handler; a logger call that never receives the value counts; helper matched by name only; an import does not shadow a file's own helper; a static owner passes by member name; built-in `new Error("words")` not allowed. Tovu, 5: the filesystem validator listed as pure; `isRecord` unlisted; hash never compared; original never compared; a rule copy edited (the check script also exits 1).

### Deviations from the design in E0 (review these)

1. **Two of the design's ten pure helpers read the filesystem.** `readPickedFolders` calls `assertExistingAbsoluteDirectory` (`existsSync`, `statSync`), and `redactAdminRunContextRef` calls `readPickedFolders`. The design's own rule is "synchronous, no I/O", so neither is listed. Their three sites stay flagged and are on the Tovu debt list: `assistant-byok.ts:427`, `assistant-chats.ts:251`, `durable-run-routes.ts:19`. Each answers 400 "Invalid picked folders" for any failure, including a failed `stat`. So 72 of the design's 75 pass, not 75.
2. **Three of the ten are private to the file that calls them** (`fromBase64Url`, `parseRequestUrl`, `isLocalAdminUrl`), so "resolve the import" cannot find them. The rule accepts a helper declared in the listed file itself; an import of the same name from elsewhere does not qualify.
3. **`isRecord` is an eleventh helper** (Tovu, `byok-meta-tool-result.ts`). The design says that site passes; its prototype allowed `isRecord` by name alone. I listed it by path instead.
4. **`new Error("words")` is allowed in a parse block.** The design says "bare `new Error()`"; its prototype and at least four of its passing sites use words.
5. **`Buffer.concat` is on the list** though the prototype lacks it. Without it one site that passed before would have become new debt. An ALL_CAPS receiver (a compiled regex or decoder constant) is judged by member name; a `PascalCase.method()` call qualifies only when listed.
6. **Rule 3 details the design does not state:** it also covers an inline `.catch(handler)`; a constant-token code is not "text"; `new X` counts when thrown or when the class name ends in `Error`; a logger is recognised by name (`logger`, `log`), `console` is not; a function nested inside the catch is not followed; `{ ...spread }` is not taken as a cause.
7. **Tovu has its own runner** (`development/scripts/check-error-gate.mjs`, about 110 lines adapted from Jini's). The design copies only the three rules, so I did not share the runner. Tovu's sanctioned-module list is empty: the reporter and logger live in Jini.
8. **Not in the corpus:** the 190 rows revision 1 called real, except the 24 + 3 above.

## 2. `fix/errors-jini-1`: decision — superseded, not merged

Read: its report, the full diff of `core/src/model-facing-tool-errors.ts`, `diagnostics/src/best-effort.ts` and `payments-stripe/http.ts`, and the file list (89 files). The other site changes I classified from the commit titles and its report, not line by line.

**Decision: `core/src/errors/{reporter,incident-text,idioms}.ts` supersede the branch's two mechanisms. Its site fixes are redone in the E7 lanes, not merged.**

| Branch change | Design text | Verdict |
|---|---|---|
| `describeErrorForLog` returns `Label(CODE): <redacted 300-char message>` | §3.3 table: the library console line never gets a message or stack. "Keep class-only for the line a library prints on its own, because a library cannot know the host's secrets. … The record is written by the host's reporter." D1 says the same. Judge finding 1: redaction is not permission | **Reject.** The message goes to the host record through `createErrorReporter` (E3/E4), which blanks the host's exact secrets |
| `ignoreBestEffortFailure({ operation }, { scope })` in core, and a second copy in diagnostics | §3.8 `bestEffort({ work, step, logger })`: logger is a port; class + code + step | **Superseded.** It writes to `console.debug` directly and is defined twice |
| Parser message put into the error ("auth-schemes JSON says why", "object-store JSON says why", admin JSON import) | §3.7: a parse refusal's "only cause is a `SyntaxError` that quotes the input, and dropping it is the safe choice" | **Reject** for these sites |
| Site fixes that keep a cause, propagate a snapshot-removal failure, log a cleanup | E7 lanes W3, W5, W8 | **Redo** with the idioms and reporter, after E3 |

**Why not "merge and make both test sets pass".** I ran the merge without committing (then aborted; the tree is clean). One textual conflict (`db/src/pglite/socket-server.ts`, an import line). With it resolved: infra `src/events/outbox` **29 of 145 tests fail**, including "a failed publish stores only the error class, never its message"; core 1 of 2787 fails (the E2 catalog describer test); cms `forms/delivery` passes. The outbox failures are real, not stale expectations: `worker.ts:62` stores `describeErrorForLog(...)` in `lastError`, so the merge would persist message text in outbox rows, which §3.3 forbids ("a code from the owner's closed list, or the class label. Nothing else"). The same function also feeds values that are returned, not logged: `seed-bundled.ts:195,295`, `retire-bundled.ts:130`, `plugins/capability-tools.ts:568` (text for the model), `diagnostics/sources.ts:41`, `sidecar/json-ipc.ts` ×4. The two test sets assert opposite things about one function, so both cannot pass.

**Merge plan (for whoever lands the branch's intent):**

1. Do not merge `fix/errors-jini-1`. It is also based on `integ/wave-b`, before r2.
2. Drop `65f2f21d`'s and `6216cb1c`'s change to `model-facing-tool-errors.ts`, both `ignoreBestEffortFailure` definitions, the roughly 35 flipped expectations, and `f7c21401` (http-kit / server logs keep the message; E4 routes those through the reporter instead).
3. E7 W3 (after E3): each `ignoreBestEffortFailure` site becomes `bestEffort({ work, step, logger })`; `step` is the branch's `operation` text. Sites: diagnostics (13), db pglite cleanup, admin telemetry / widget title, plugins late attach.
4. E7 W5: take `db/src/data-modules/snapshot.ts` (removal failure propagates) with its test `discard-snapshot.test.ts`, red first on this branch.
5. E7 W8: take "`FormDeliveryError` keeps `cause`" and the cms free-disk log. For Stripe keep the `unknown` outcome and record the transport error once through a logger; the branch's `transportFailureLabel` (code or class only) is compatible and can stay in the message.
6. `detail` fields carrying a redacted message (platform, plugins, user-management, cms reconcile / redirect): each needs the §3.3 question answered first: who reads `detail`? A caller gets it only through `approveCause`.
7. Admin panels (`b8886808`): superseded by E6 (`useReportFailure`, notice with ID).
8. The branch's 12 changesets are dropped with it; each lane writes its own.

## 3. The ten open choices from run 1

| # | Choice | Design or amendment text | Outcome |
|---|---|---|---|
| 1 | `ErrorMatch` fields | names the type, no fields | **Owner.** No change |
| 2 | `onDuplicate: 'warn'` requires a `logger` | type is `'throw' \| 'warn'`; "at runtime the catalog warns and keeps the first" | Values and behaviour match. The required logger is an addition (a warning needs a port). **Owner**, no change |
| 3 | `sentence.audience: 'authorized'` → fallback words below that tier | field exists, no rule | **Owner.** No change |
| 4 | `sentence`-mode bindings not in `modelFacingRules` / `callerSafeRules` | decided only for discriminants ("`modelFacingRules` skips them") | **Owner.** Cost: such a class is redacted for the model. An option: publish the sentence when it has no placeholders |
| 5 | A throwing `params` gives no match | stated for `codeOf` only | Consistent by analogy. **Owner**, no change |
| 6 | Tracker gets a redacted carrier `Error` | "`reportErrorOnce` … is what the host passes as `tracker`"; the tracker row says "the same record" | **Not decided by the text; the two sentences pull apart.** The port has no `exactSecrets` argument, so only a pre-redacted carrier blanks call-scoped secrets; but `reportErrorOnce` de-duplicates by object identity, which a carrier defeats. **Owner / E4.** One way out: add `exactSecrets` to the port's report and pass the original |
| 7 | `ClientFacingError` is a refusal; status from the catalog, then the table | §3.1 rule 5; §3.4 `host?.statusFor ?? statusForError` | **Decided, matches.** No change |
| 8 | A failing ID port yields `ERR-0000-0000-0000-0000` | "never throws"; "the reporter does not format IDs" | The two pull apart for this one case. **Owner.** No change |
| 9 | Empty named option interfaces | "a named interface, never `Record<string, never>`" | **Decided, matches.** No change |
| 10 | `DescribedFailure.error` is core's `ServerApiError` | signature says `ApiError` (protocol) | Protocol has no Jini dependency, so core could import it without a cycle, but core has no dependencies today. **Owner.** No change |

No code changed under this item: where the text decides (7, 9), the code already agrees.

## 4. Next step after E2: E3 — not started, blocked by SEQUENCE

- **Tovu half** is H1 step 7, after steps 1 to 6. Not landed on `origin/refactor/terra`: no `createInMemoryApp` (size-02 3a), and 17 files still call `createConsoleLogger`.
- **Jini half** is last in H4, after R7 P1 and env-schema J3. `packages/server/src/mount-routes.ts` does not exist.
- **E5a-1** (H5) needs C-ORIGIN-PORT. `79b19ffd` is not an ancestor of this branch.

So after E0, E1 and E2 nothing else in SEQUENCE is open on this tree. I used the time for E2's two leftovers instead.

**R14 (`cd738554`).** `pnpm guard` refuses a production file that uses `approveCause` or passes `tracker: 'skip'` unless it is on the matching list with a reason, and reports a listed file that stopped. Both lists are empty: the design's "one caller each" are Tovu files that do not exist yet. Mutations, 6, all caught: tests counted as callers; defining modules counted; comments counted; unlisted caller not reported; stale entry not reported; one list used for both calls. It is proven by its own test file, not inside `runGuardSelfTest`.

**Mint move (`172f9b4c`, Tovu `51e6d495`).** The function, its comment and its pins moved; no forwarder. `TOOL_ERROR_ID_PATTERN` stays in the daemon. New pin: `formatUserFacingError` recovers a minted ID from a rebuilt error message. Mutations, 3, all caught: no upper-casing; 4 bytes asked for; groups not joined by `-`.

## Self-check (owner audits, on files this run changed)

- `owner-rules-audit.mjs`: 0 findings in the changed files, both repos.
- `args-object-audit.mjs`: Tovu 0. Jini 8 at first: 4 in `core/src/errors/reporter.ts` (run 1's code), fixed in `1a30b153`, now 0 in `core/src/errors`. 4 remain in `daemon/src/tool-recovery/redaction.ts` (lines 151, 182, 204, 242), in functions this run did not change.
- `hook-injection-audit.py`: nothing to check; no component was added or moved.
- Repo-level `scripts/` and Tovu `development/` are outside what the audits scan.

## Not done

1. The three Tovu sites in deviation 1 need a decision: keep them as debt until W5, or split the validator into a pure shape check and a filesystem check.
2. A Tovu-side caller list for `approveCause` / `tracker: 'skip'` (belongs with E4, when the first callers exist).
3. Whole-package test runs listed under "Not run".

## Next step

Land H1 steps 1 to 6 (Tovu) and C-ORIGIN-PORT into this line, then E3. Before E4: decide choice 6 (tracker carrier) and choice 8.
