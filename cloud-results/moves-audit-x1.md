# moves-audit-x1 (branch moves/audit-x1, base Jini 6cfcc471 / Tovu 9ec4ad4a = integ/wave-b)

| slice | status | Jini SHA | Tovu SHA |
|---|---|---|---|
| move-A10 issued sign-ins | DONE | 885986ff | a4bed36e |
| split-A03 visitor confirmation binding | DONE (2 deviations below) | af6779fb | 022e1d5b |

## Evidence
- Env: Node 24.11.1; Jini `pnpm install --frozen-lockfile` OK; core/daemon/agent-plugins built (`pnpm -r build` has pre-existing tsc errors in http-kit/user-management test files, unrelated). Tovu `npm ci --ignore-scripts`, then `node_modules/@jini-ai/*` symlinked to the Jini checkout; `@tovu/contracts` and `@tovu/sdk` built.
- A10 Jini: vitest `admin-surfaces/__tests__/issued-sign-ins.test.ts` 2/2 green. No RED run: pure move, the sheet says no failing test first.
- A10 Tovu node:test: handlers.unit, surfaces.unit, admin-surfaces security integration all pass. `surface-adapters.security.test.ts`: 19 pass / 1 fail ("workspace: every connection-ref operation...", `Invalid URL` in `support/starting-browser.ts:34`). **The same failure occurs on the unmodified base 9ec4ad4a** (not caused by this work).
- A03 Jini: vitest `bound-confirmations.test.ts` 4/4 + `surface-exchanges*` 59 green (63 total). No RED run: pure move (sheet).
- A03 Tovu node:test: visitor-confirmations.unit, visitor-confirmation-gate.unit, visitor-executor.unit, visitor-page-confirmation.unit + mcp-ui-allowlist-completeness: 56/57 pass. The 1 failure ("every surfaceExchanges.open(...) call names a toolId constant this scan can resolve") lists `ask-choice-custom-answer.ts:153`, `cli/commands/import-local.ts:160`, `oidc-login.ts:238`, none of them touched here, and **fails identically on the base** (9 pass / 1 fail there). The sheet's T3 deletion does not add to it.
- Jini typecheck: `tsc --noEmit` on daemon/agent-plugins shows no errors in the new/edited files (other errors are from unbuilt/old deps and test files already on the base). Tovu tsc (full-project) filtered to touched files: no errors. eslint on all new/edited Jini files: clean (after the split below). Subpath isolation script printed nothing (not independently confirmed).
- Census and rule checks (no Tovu text, no express/process.env/console/dynamic import) clean.

## Deviations from the sheets (guards were written at refactor/terra, base is post-wave-B)
1. **A03 digest crypto**: wave B changed `canonicalArgumentDigest` to require `{ args, crypto }` and Tovu's gate blob changed (95964a3e -> a2bc520b: only the two digest calls gained `crypto: globalThis.crypto`). Intent unambiguous, so: Jini `createBoundConfirmationGate` takes a REQUIRED `crypto: DigestCryptoPort` (type from `@jini-ai/core/records`) and passes it to both digest calls; Tovu passes `crypto: globalThis.crypto` (same as before); the Jini test passes `globalThis.crypto`.
2. **A03 function-size split**: `createBoundConfirmations` was 55 lines (>50, COMMON rule 11, sheet gives no split). Extracted the post-claim tail of `confirm` verbatim into module-level `settleHeld({ held, allow, nowMs })`; claim (`pending.delete`) stays in `confirm` before any await. No logic change.
3. A03 test: two `approve()` calls cast `(approve as () => void)()` to satisfy TS narrowing (TS2349). Sheet's `!` note on `onConfirm` was not needed (`onConfirm?` is optional, `!` kept as no lint error).

## Sheet errors / notes
- A10 and A03 Tovu guard blobs otherwise matched; A10 guards matched exactly.
- A03 sheet code references `canonicalArgumentDigest` with the pre-wave-B signature (deviation 1).

## Reviewer checklist for A03 (Opus diff review, security-sensitive)
Files: Jini `packages/daemon/src/bound-confirmations.ts`; Tovu `assistant/site/visitor-confirmation-gate.ts`, `visitor-confirmations.ts`.
1. Claim-before-await in `confirm`: `pending.delete(challengeId)` happens synchronously before any await (including before `settleHeld`), so concurrent clicks/replays cannot deliver twice. Owner check (`sameOwner`) occurs BEFORE the claim and a mismatch must NOT consume the prompt (matches original).
2. `settleHeld`: expiry is checked before AND after `validate()`, `deliver` always runs in `finally` (even when `validate` throws), and `allow` is delivered only when `valid && allow`; return is `valid && delivered`.
3. Gate digest binding: digest of the exact input is captured at prompt time (`canonicalArgumentDigest` with `crypto` injected), re-checked after the click AND in `isApproved` immediately before the handler; single use (`approved.delete` before the await); `isApproved` returns `valid && !signal.aborted`; resume is skipped when `signal.aborted`, and a resume failure is reported not thrown.
4. Evaluation order in `validate`: `ports.isCurrent` is computed BEFORE the abort check (matches the original publication read order); snapshot is re-read each time (revision, not value hash, in Tovu's `isCurrent`: `live.revision === captured.revision`, `live.policy !== null`, publication check).
5. Tovu `decideVisitorConfirmation`: `!snapshot.policy || !ports.confirmation` -> deny; `mode==='off' || (mode!=='ask' && !forced)` -> deny, else ask. Compare to the old inline logic in b-blob 95964a3e/a2bc520b.
6. Caps/principal/channel remain Tovu values (`maxHeld: 20, perQuotaKey: 2`, `anonymous-visitor`, `visitor-tool-confirmation`); IP -> `quotaKey`; no Jini default for any of them. `atCapacity` order (run, total, per-key) and `releaseHeld` accounting.
7. `export *` from `surface-exchanges.ts` keeps that universal subpath free of `node:`; bound-confirmations imports only `@jini-ai/core`, `@jini-ai/core/records`, type-only `./tool-executor.js`.
8. Tovu behaviour: `assertApproved` still throws `VisitorPlanRefused`; confirmation copy (`confirmationCopy`) unchanged and unrelated to Jini.
