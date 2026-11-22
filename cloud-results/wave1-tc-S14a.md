# wave1 tc-S14a: one deadline model for page capture (Jini, `diagnostics`)

Status: **DONE** (every item of the sheet). Branch `wave1/tc-S14a` (Jini only; the sheet has no Tovu part).
Base: `origin/integ/merge-final-2026-11-16` = Jini `65d73b0d` (ancestor check printed `ok`). Tovu was not changed.
Plan: `plan/tool-call-fixes-2026-11-16`, sheet `S14a-capture-deadlines-jini.md`, with `sheets/README.md` as the contract.

## Setup and baseline (unmodified tree)
Node 24.22.3 in `~/.local/node24`; `pnpm install --frozen-lockfile` and `pnpm --no-bail -r build` clean.
Drift check on the two blobs the sheet names (`render-page.ts`, `page-work-budget.ts`): no `DRIFT`.
Baseline: `pnpm guard` ok, `pnpm typecheck` ok, diagnostics **58 files / 959 tests** green.
4.10: `Blocking decision: none`. 4.11: no prerequisite. 4.2: every symbol line of the sheet hit on the base.

## Inventory (callers of this `renderPage`)
Jini: `diagnostics/src/web-evidence/public-page.ts:232`, `playwright-browser.ts:69` (`packages/platform/src/web/web-page.ts:339` is a port named `renderPage`, not this function).
Tovu: `apps/website/src/features/web-screenshot/playwright-page-capture.ts:129` (the `newsletter-*` and `consent/service.ts` hits are unrelated). None passes the new options, so all behave as before; their test files are unchanged (`render-page.test.ts` 41, `public-page.test.ts` 9, `playwright-browser.observe.test.ts` 15, `web-evidence-deadlines.test.ts` 10 tests, same counts as the baseline).

## Commits (all pushed to `origin/wave1/tc-S14a`)
| SHA | What |
|---|---|
| `6a57eb5a` | Step 0, alone: `CaptureClock` port (`capture-clock.ts`), `PageWorkBudget` and `renderPage` read it, `FakeCaptureClock` at new public entry `./web-evidence/testing` (universal). No behaviour change |
| `5799d871` | Characterization (3 cases, fake clock, no browser). Each proven red by a mutation (hard stop 1 s early: cases 1 and 2 red; cancel reported as timeout: case 3 red) |
| `b8726f53` | `captureBudget` (pure) at new public entry `./web-evidence/capture-budget` (universal), 15 tests, test written first and seen failing (module missing) |
| `73fc5ce4` | Fix to my own step 0: block 4.16 flagged `renderPage` complexity 11 and a nested `++` in the fake clock; extracted `assertRenderable`. Step 0 (`6a57eb5a`) therefore did not pass 4.16 on its own; this commit restores it |
| `98f40732` | `renderPage` `softDeadlineMs` / `onSoftDeadline: 'consume-current'`, `RenderSession.phaseTimedOut`, `PageWorkDeadline`, budget `endWorkPhase()` / `expiredError()` |

## Red-first output (before `98f40732`; 12 of 18 failed, the 6 that passed are the cases that hold with no option)
```
× runs the fallback once at 16 s ...           → expected [] to deeply equal [ [ 16000, 4000 ] ]
× names the load wait ...                       → expected [] to deeply equal [ 16000 ]
× hands the consumer the page that committed    → Cannot read properties of undefined (reading 'session')
× fails at 16 s with PageWorkTimeout ...        → expected undefined to be 16000
× stops a fallback that is still running at 20 s → expected +0 to be 1   (consume never ran)
× cancel during the fallback, 17 s              → expected +0 to be 1
× softDeadlineMs equal / above / zero / negative / NaN / infinite → expected undefined to be an instance of RangeError  (x6)
```

## How it works
`PageWorkBudget` gets an optional `workDeadlineMs`. During the work phase its limit is the soft deadline and it throws `PageWorkDeadline` (a `PageWorkTimeout` subclass, so every existing "let page timeouts through" handler still rethrows it). `openOrFallBack` in `render-page.ts` catches only that error: no committed navigation means rethrow (fails at the soft deadline, "page work timed out after 16000ms"); committed means one `consume` on the current page with `phaseTimedOut` = `dismiss | wait | load`, after `endWorkPhase()` so `budget.remainingMs()` is the 4000 left. The final-URL origin check (`assertNavigable`) is the same function on both paths. `createRequestRouter`, origin policy and egress rules are untouched. The comment "A native total timer remains firm…" is kept on the hard stop.

## Gates (final tree)
- `pnpm guard`: ok. `pnpm typecheck`: 0 errors.
- diagnostics tests: **61 files / 997 tests** (959 baseline + 5 fake clock + 3 characterization + 15 captureBudget + 15 new deadline cases). No test removed, skipped or weakened (count only grew). The coverage thresholds are unchanged and every touched file is 100/100/100/100 (`render-page.ts`, `page-work-budget.ts`, `capture-budget.ts`, `capture-clock.ts`, `testing/fake-clock.ts`). The package as a whole is below 100 in files I did not touch (`observability/*`, type-only files); that was already so.
- Blocks 4.3 to 4.8, 4.15, 4.16, 4.17 against `65d73b0d...HEAD`: all print nothing (script run on the final tree). 4.8 printed no vanished comment.
- 4.9: `import('@jini-ai/diagnostics/web-evidence/testing')` and `.../capture-budget` resolve from the package after build; no `node:` import in either entry's source.
- 4.12 not applicable (no security gate moved).

## Mutations on the new behaviour (proof the tests bite)
Fallback also without a committed page: 1 test red. Skip `endWorkPhase()` before `consume`: 6 red. Dropping `args.signal.throwIfAborted()` in the fallback path changed nothing, because `budget.run` already refuses to start `consume` on an aborted signal, so I **removed that line** and left a comment saying so (the 15.9 s, 16 s and 17 s cancel tests cover the behaviour). Falling back on any `PageWorkTimeout` instead of `PageWorkDeadline` is an equivalent mutant today (a plain total timeout cannot occur in the work phase once a soft deadline is set); the subclass is kept so the intent is explicit.

## Deviations and judgement calls (please read)
1. **`CaptureClock` is not re-exported.** `RenderPageOptions.clock` uses it; hosts can pass an object literal and tests use `FakeCaptureClock`. A public type re-export would be a barrel (block 4.6).
2. `captureBudget`'s second argument (host limits) is required, with no defaults, because the sheet says the cap and reserve are host values. The sheet shows it that way too.
3. `captureBudget` semantics I chose: `total = min(capMs, baseMs + wait + (fullPage ? fullPageMs : 0))`, where `wait` is `waitForSeconds * 1000` when given, otherwise `settleMs` (mirrors Tovu's `waitFor ?? settleMs / 1000`). Negative, NaN or infinite request numbers add nothing. A reserve that is not above 0 and below the capped total throws a `RangeError`. S14b should confirm that reading.
4. `onSoftDeadline` has one value; setting `softDeadlineMs` alone means `consume-current`. The sheet did not say what happens with `softDeadlineMs` alone.
5. `phaseTimedOut` has a third value, `dismiss`, for the cookie-banner steps before and after the wait, so a cut in those steps is not mislabelled `wait` or `load`.
6. When the fallback fails at the hard stop, the error is `PageWorkTimeout` "after 20000ms" (the hard limit); when it fails before commit at the soft deadline it says "after 16000ms" (the real number).
7. Today `renderPage` requests the context close twice on abort (abort listener, then the final release; Playwright's close is idempotent). The tests assert "at least once", not exactly once.
8. `openContext` no longer takes `timeoutMs`; it asks the budget for `expiredError()` so a soft expiry reports the soft number.
9. Characterization case 1 and 2 of the sheet are pinned with the exact messages `page work timed out after 20000ms`.

## Changed model-facing sentences
None. New error text (callers only, not shown to a model): `softDeadlineMs must be above 0 and below timeoutMs (20000), got <n>`; `capture reserve <r>ms must be above 0 and below the capture total <t>ms`; `page work timed out after <soft>ms` (soft deadline before commit).

## New Jini exports for REL (Tovu S14b consumes them)
- `@jini-ai/diagnostics/web-evidence/capture-budget` (universal): `captureBudget`, types `CaptureRequest`, `CaptureBudgetLimits`, `CaptureBudget`.
- `@jini-ai/diagnostics/web-evidence/testing` (universal): `FakeCaptureClock`.
- Through the existing `@jini-ai/diagnostics/web-evidence/playwright` entry (it already re-exports `render-page.ts`): `RenderPageOptions.clock`, `.softDeadlineMs`, `.onSoftDeadline`, `RenderSession.phaseTimedOut`, `TimedOutPhase`. Run `pnpm --filter @jini-ai/diagnostics build` before Tovu reads it.
- The `diagnostics` version in `package.json` is not bumped (REL).

## STOPs hit
None. No lazy import, module mock, lint or type escape, barrel, UI file, skipped test, swallowed error or oversized function was added.

## Not verified
Not run against a real browser or a real clock (the sheet asks for a fake page and fake clock only). Tovu was not built or tested (no Tovu part). No other Jini package's own test suite was run besides `diagnostics`; whole-repo `pnpm typecheck` and `guard` are green.

## Next step
S14b (Tovu): compute `captureBudget(...)` per request, pass `timeoutMs: totalMs`, `softDeadlineMs`, `onSoftDeadline: 'consume-current'`, and use `totalMs` for the outer race. Its landed check (`rg -n "softDeadlineMs" ../Jini/packages/diagnostics/src/web-evidence/render-page.ts`) now passes once this branch is merged.
