# moves-b2 (Jini copy of the Tovu report; Tovu + Jini, branch `wave3/moves-b1`, fast-forward only; base = origin/wave3/moves-b1 = Tovu 820826ad / Jini 5ad3aa0d)

Run: PARTIAL (context budget, not wall clock: ~45 min used). Node 24.11.1; Jini `pnpm install --frozen-lockfile` + `pnpm --no-bail -r build` clean; Tovu `npm ci` (root, apps/admin); `link-jini.mjs` against the local Jini; contracts + sdk built. Jini packages touched were rebuilt (`npm run build`) so Tovu resolves the new exports.
Sheets: best-of-each from plan/w1-sheets-b..f (move-entry-refs, split-web, ui-admin-sites, split-member-login, move-kernel, split-email-templates). Decisions file: no HELD id touched (Q-WH not involved).

## Base ratchets (unmodified wave3/moves-b1, recorded first)
size 0, complexity 0, errors 0, hooks 0, **architecture 1 (red on base)**. why-comments needs `--base` (origin/refactor/terra does not exist in this clone): run as `node development/scripts/check-why-comments.mjs --base origin/wave3/moves-b1`.

## DONE (one move per commit; each compiles and passes alone)
| slice | Jini | Tovu |
|---|---|---|
| SP-entry-refs-1 (J1-J12 applied exactly; type placed above the warnRejectedMarkers doc block per the sheet's fallback) + 8 why-debt entries | 1e3af649 | 6f5cd8bc, 6498eb3e |
| SP-web-1 (web_fetch_page definition into `@jini-ai/platform/web`) + 1 debt entry | d478ab5a | 2d5db541, f8524f61 |
| UI-admin-sites-4 (useSiteListPrefs into `@jini-ai/ui/site-card`) + 2 debt entries | 6598a5cc | 53630d4d, 3239e142 |
| HD-member-login-1 (createSealerStateCodec in `@jini-ai/oauth`, RED then GREEN) | 82cddb2c | 1b89c0dd |
| MV-member-login-1 (decideMemberLogin in `@jini-ai/user-management/server`) | c0571a66 | b7993547 |
| MV-kernel-2 (sqlite-only primitives in `@jini-ai/db/kernel/sqlite`) + 2 debt entries | 70116fc0 | 5d425356, c75a6307 |
| Jini follow-up: barrel/args tests for the new exports (my regressions found by the full package runs) | 6852d351 | - |

## Sheet drift handled (judgment calls, flagged for review)
- **UI-admin-sites-4**: `AllSitesTab.tsx:10` also imported `SiteListPrefsController` from the Tovu hook file (not in the sheet's 3-line census); repointed to `@jini-ai/ui/site-card` and merged into the existing import. FILE_AFTER's `describeApiError` import path `@/lib/api` no longer exists; used the current `@/lib/admin-http/request` (read from the file being replaced). Blobs of the Tovu files differed from the sheet's (hooks-sweep merges), but every text edit applied.
- **HD-member-login-1**: the sheet's third P1 test (standard-alphabet spelling) loops forever with its fake sealer (the base64'd ciphertext can never produce `-`/`_` in the outer base64url: those need a raw `>`/`?` byte). Fixed the harness only: the fake ciphertext carries the plaintext raw (comment says why). All four sheet `it` blocks and every assertion are unchanged. Mutation proof: deleting the canonical check makes 3 of 5 tests fail; restored = 5/5.
- **MV-member-login-1**: Jini compiles with `exactOptionalPropertyTypes`; `needsInboxProof`'s param got `| undefined` on its two optional fields (internal helper; nothing else changed). `decideMemberLogin`'s optional parameter is typed `Record<string, never>` (the user-management public-args test requires typed parameters).
- **MV-kernel-2**: the Tovu file already imported `KyselyKernel` from `@jini-ai/db/kernel` (C3t landed with a rename); the Jini copy imports `KyselyKernel` from `../port.js` (the sheet's alias fallback). One extra edit: a dangling comment in `publish-backstop-row.sqlite.ts:33` ("see sqlite-only.ts") now names the Jini subpath.
- **SP-entry-refs-1 review owed**: the sheet asks for an Opus review of the SP diff (console port). NOT done here (no subagents). Review target: Jini 1e3af649 + Tovu 6f5cd8bc.
- why-comments: the cross-repo moves cannot be seen by the Tovu gate, so 13 entries were added to `development/why-comments-debt.json`, each naming where the text lives (Jini SHA) or why it is obsolete. Shared append-only file: expect a trivial merge conflict with other runs; keep both sides.

## STOPPED / not executed (with reason)
- **DL-admin-sites-1**: already done on the base (use-sites-home hook and its test do not exist).
- **UI-admin-sites-3**: premise gone. `use-site-confirm.hooks.ts` already builds on `useConfirmRequest` from `@jini-ai/admin/react`; no promise core is left to move. Needs a sheet retirement, not an execution.
- **UI-admin-sites-2**: STOPPED, drift. `AllSitesTab.tsx` now takes the preview hook as an injected prop (`useSiteCardPreviewHook = useSiteCardPreview`, the owner's hooks-sweep rule), so the sheet's `const preview = useSiteCardPreview(...)` edit does not apply. Needs the sheet to say what happens to that prop once the hook becomes the pure `resolveSiteCardPreview`. The Jini half (SiteCard failed-src fallback) is independent and ready.
- **SP-email-templates-1** (split-email-templates): NOT STARTED, budget only. Sheet is 758 lines, est. 100k tokens (new Jini module, ~60 call-site rewrites). Run it first next time, alone.
- MV-kernel-3, SP-member-login-1..3, HD-member-login-2, SP-web-2: blocked in their sheets, untouched.

## Gates (exact commands, final tree = Tovu c75a6307 + this report; Jini 6852d351 + this report)
- Tovu `npm run typecheck`: exit 0 (after every Tovu slice).
- `npm run check:size` 0, `check:complexity` 0, `check:errors` 0, `check:hooks` 0: no line beyond base.
- `npm run check:architecture`: exit 1, same 3 regressed metrics as base; diff base vs final: one NEW-edge line REMOVED (member-login/link-policy -> members), API surface 848 -> 847, edges 436 -> 435; no new line.
- `node development/scripts/check-why-comments.mjs --base origin/wave3/moves-b1`: ok.
- `npm run check:seal-aad`: OK.
- Tovu tests (`node --test` via the repo's tsx loader, `--test-concurrency=2`): entry-refs + importers + pages + widgets 385/385; web + assistant contract 92/92; member-login 155/155 after HD, 147/147 after MV (link-policy test moved to Jini); kernel + publish-content set 227 pass / 7 fail, all 7 are `*.postgres.test.ts` needing a local Postgres socket that this container lacks (environmental, unrelated). Admin `npx vitest run src/features/sites --maxWorkers=2`: 26 files, 510/510; admin `tsc --noEmit` clean.
- Jini (vitest, `--poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=1` on Jini's vitest 2): cms full 4085/4085; ui full 8588/8588; db full 865/865; oauth full 824/824; platform full 3117 pass after the barrel-test fix (1 failure on the first full run was my own, fixed in 6852d351); user-management full 1253 pass after the args fix (1 failure on first run, fixed in 6852d351). `pnpm guard` ok. eslint clean on every new/changed Jini file; Tovu admin eslint: only the pre-existing max-lines warning on `SiteCard` in AllSitesTab.tsx.
- Jini changesets added: cms-entry-refs-extractor, platform-web-fetch-page-tool, ui-site-card-list-prefs, oauth-sealer-state-codec, user-management-member-link-policy, db-kernel-sqlite-only (all minor).
- Desktop pre-push hook: no apps/desktop changes, skipped by the hook itself; no `--no-verify` used on either repo.

## Overlaps with parallel runs
- su-cms (Jini `packages/cms`): this run added `packages/cms/src/widgets/entry-refs-extractor.ts` (new file), one line to `widgets/index.ts`, and doc lines in `widgets/ports.ts`. Conflict risk is the index.ts export block only.
- Jini `packages/platform/src/web/index.ts` (+1 export line), `packages/ui/src/features/site-card/index.ts` (+1 line), `packages/oauth/src/index.ts` (+1), `packages/user-management/src/server/index.ts` (+1), `packages/db/src/kernel/sqlite/index.ts` (+1): all append-only index lines.
- Tovu hot files: `features/widgets/deps.ts`, `features/publish-content/content-references.ts` (one import line each); `development/why-comments-debt.json` (append-only); `apps/admin/src/features/sites/{Sites,AllSitesTab}.tsx` (import lines).

## Next step
1. Run split-email-templates (SP-email-templates-1) alone; re-verify its PERL counts on the new base first.
2. Refresh the ui-admin-sites sheet: retire slice 3 (already `useConfirmRequest`), re-spec slice 2's AllSitesTab edits for the injected-hook prop.
3. Owed: the Opus review of SP-entry-refs-1.
