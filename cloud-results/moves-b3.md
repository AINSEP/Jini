# moves-b3 (Tovu + Jini, branch `wave3/moves-b1`, fast-forward only; base = Tovu dcbcaf4c / Jini 944e0410)

Run: COMPLETE for the list given (one slice executed; the other two were already done by moves-b2). Node 24.11.1; Jini `pnpm install --frozen-lockfile` + `pnpm --no-bail -r build` clean; Tovu `npm ci` (root only: apps/admin NOT installed this run); `link-jini.mjs` against the local Jini; contracts + sdk built; Jini platform rebuilt (`npm run build`) so Tovu resolves the new subpath. Decisions file read; no HELD id touched. Rulebook skills in AI-Dev-Shop were skimmed (refactor/skills.md head), the owner-rule list in the dispatch was the operative text.

## DONE
| slice | Jini | Tovu |
|---|---|---|
| SP-email-templates-1 (operations.ts -> `@jini-ai/platform/mail/email-template-operations`; Tovu keeps `emailTemplateStore`) | fdcf829c | d26c9a8c (code), + why-debt commit (10 entries) |
Sheet source: split-email-templates.md from plan/w1-sheets-e (largest). Counts re-verified on this base: PERL-1 42/4/5/5/7 exactly as the sheet; all OLD import texts occurred once.

## Already done by moves-b2 (verified present on the base, NOT redone)
split-member-login HD-member-login-1 (Jini 82cddb2c / Tovu 1b89c0dd), MV-member-login-1 (Jini c0571a66 / Tovu b7993547), MV-kernel-2 (Jini 70116fc0 / Tovu 5d425356, c75a6307). Nothing left to execute for them; SP-member-login-1..3, HD-member-login-2, MV-kernel-3 stay blocked in their sheets.

## Sheet drift handled (judgment calls, flagged for review)
1. **Port type widened (behavior-preserving)**: the sheet types `EmailTemplateHtmlSession.version` as `number`, but this base's Pages store returns `number | null` from `capturedVersion()`; Tovu typecheck failed (operations.ts:96). Instead of a new throw (a behavior change) the Jini port is `version: number | null`; the operation still compares `expectedVersion !== basis`, so a null basis refuses a stated expectedVersion and writes an unstated one, exactly as the original code did. One extra Jini test pins it (6 tests in the new file, sheet had 5).
2. **Sheet's call-site PERL-1 misses `{ deps })`**: its regex needs `,`/`}` right after `deps`, so 6 `listEmailTemplates({ deps })` / `({ deps: h.deps })` test calls were skipped (its counts 42/4/5/5/7 are still met). Its verification rg (`EmailTemplate(ForSend)?\(\{ deps`) also misses `listEmailTemplates(`. Fixed with `listEmailTemplates\(\{ deps(: h\.deps)? \}\)` (n=6) and verified with `\b(create|edit|rename|list|get|preview)EmailTemplates?\(\{ deps|renderEmailTemplateForSend\(\{ deps` -> nothing under apps/. `typecheck` does not cover tests; `typecheck:tests` caught nothing further after the fix.
3. **Jini exports test**: `packages/platform/src/secrets/__tests__/exports.test.ts` lists the published subpaths and sources; added the new subpath to both lists (the sheet did not name this file; found by the full platform run).
4. Blobs of routes.ts (`sendAdminFailure` import path, `status?: number`), email-api.ts (imports) and Jini platform package.json/README differed from the sheet's, from earlier merges/b2 commits; none touches an edited line, every OLD text occurred once.
5. why-comments: 10 doc blocks moved to Jini; added 10 debt entries (development/why-comments-debt.json, append-only: expect a trivial merge conflict, keep both sides).
6. Left as is: the sheet's note that baselines 124-126 stay; `PostKind` unused import stays verbatim; admin `email-api.ts` comment-only edit.

## Gates (exact command + result)
Base (unmodified wave3/moves-b1) ratchets recorded first: size 0, complexity 0, errors 0, hooks 0, **architecture 1 (red on base)**; why-comments `--base origin/wave3/moves-b1` ok.
- Tovu `npm run typecheck`: exit 0. `npm run typecheck:tests`: exit 0.
- `npm run check:size|check:complexity|check:errors|check:hooks`: all 0. `npm run check:architecture`: exit 1, output IDENTICAL to base (diff empty: no new line).
- `node development/scripts/check-why-comments.mjs --base origin/wave3/moves-b1`: ok (10 blocks allow-listed).
- `npm run check:route-tool-parity`: exit 0.
- Tovu tests (`node --import tsx --test --test-concurrency=2`): email-templates/__tests__/*.test.ts + trash/email-template-trash-flow + routes/email-templates/__tests__/routes.test.ts: 37/37 (a RED first run, 3 fails, was the skipped `{ deps }` call sites above); assistant `tool-registrations.contracts.test.ts` 36/36.
- `npm run check:jini-registry-drift`: FAIL `spawn apps/admin/node_modules/.bin/tsc ENOENT` (environmental: apps/admin deps not installed this run; admin change is one comment line). Not re-run.
- Jini: new test file 6/6; platform full `vitest run --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=1`: 165 files, 3123 pass / 6 skipped (first full run had the 1 exports.test failure above, fixed before commit); `npm run typecheck` + `npm run build` in packages/platform clean; eslint clean on the two new files; `pnpm guard` ok; rule-5 check `rg "from ['\"]@jini-ai/" email-template-operations.ts` prints nothing; changeset `.changeset/platform-email-template-operations.md` (minor).
- ESLint on Tovu email-templates/trash/routes files: 0 errors, 6 pre-existing warnings (test files).
- Desktop pre-push hook: no apps/desktop changes, skipped by the hook itself; no `--no-verify` on either repo. Push was fast-forward only.
- Not run: runtime test where the sheet's behaviour notes (extra re-read on rename, toDetail after commit) could differ (no test observes them, as the sheet says); Postgres-backed tests (no socket in this container).

## ui-admin-sites (NOT executed, per instruction) — what the base shows
Unchanged from moves-b2's list: slice 1 (DL-admin-sites-1) done on base; slice 3 premise gone (`use-site-confirm.hooks.ts` already on `useConfirmRequest`: retire the slice); slice 4 done in b2; slice 2 needs the sheet to say what happens to the injected `useSiteCardPreviewHook` prop of `AllSitesTab.tsx` once the hook becomes the pure `resolveSiteCardPreview`. ui-admin-database untouched (Q-WH held).

## Overlaps with parallel runs
Jini `packages/platform/package.json` (exports + jini.entries + parse5 text), `packages/platform/README.md`, `src/secrets/__tests__/exports.test.ts` (list edits: any other run adding a platform subpath will conflict on those lines). Tovu: `features/email-templates/*`, `routes/email-templates/routes.ts`, `features/trash/__tests__/email-template-trash-flow.test.ts`, `development/why-comments-debt.json` (append-only).

## Next step
1. Owed from b2: Opus review of SP-entry-refs-1 (Jini 1e3af649, Tovu 6f5cd8bc) and now of this slice's port (Jini fdcf829c): confirm `version: number | null` is the wanted port shape.
2. Refresh the split-email-templates sheet's PERL-1/verification regexes (drift 2) before anyone reuses it.
3. Refresh the ui-admin-sites sheet (slices 2, 3); retire slice 3.
