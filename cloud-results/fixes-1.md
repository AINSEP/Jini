# fixes-1 (three small fixes, one branch each, base origin/refactor/terra: Tovu 232764af5 / Jini 65d73b0d5)

Pushed branches and code commits:

| # | Branch | Repo | Commit |
|---|--------|------|--------|
| 1 | `fix/b07-copy-overwrite` | Jini | `b0c103a6840a4240c163153028096a668f0c9433` (code). Tovu branch of the same name carries this report only; no Tovu code change was needed. |
| 2 | `fix/hang-bugs-i18n` | Tovu | `85f6010860db4355a0a3856a25dbbd048d714c19` |
| 3 | `fix/site-share-errors-shell` | Tovu | `e4f78cbc5014b5abf6b8663b83e70dbfd3d1812a` |

This report is the tip commit of each Tovu branch above (and of the Jini branch). Nothing was merged, no PR was opened,
nothing was published to npm, main / refactor/terra / plan/* were not pushed, no force-push. The Tovu desktop pre-push hook
did not block any push (no `--no-verify` was used anywhere).

## Setup (identical for all three)
Node 24.22.3 in `~/.local/node24`; Jini `pnpm install --frozen-lockfile` then `pnpm --no-bail -r build` (exit 0).
Tovu `npm ci` (root, apps/admin, apps/site-chat), `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`
(77 links), `npm run build` in packages/contracts and packages/sdk. Tovu therefore ran against the local Jini checkout
(on `fix/b07-copy-overwrite`, i.e. base + commit 1), never the npm `@jini-ai` copies.
Baseline on the unmodified base tree before touching code: admin `posts-i18n.unit`, `page-editor-i18n.unit`,
`untranslated-copy.unit` 3 files / 128 tests pass; Tovu ratchets recorded below.
Vitest note: in `packages/platform` the repo's vitest config conflicts with `--maxWorkers=2`
("options.minThreads and options.maxThreads must not conflict"), so platform tests ran without that flag
(single file or the package's own default pool). Admin tests ran with `--maxWorkers=2`.

## 1. fix/b07-copy-overwrite (Jini)
Owner decision 11-16: the vault open-back check runs on ROTATE and COPY-OVERWRITE only.
`packages/platform/src/secrets/credential-sets/vault.service.ts`, `writeCopy`: when it replaces an existing target
row it now opens the fresh seal again with the service's own sealer (`assertOpensTo`, the same check rotate uses) and
refuses with the existing `VaultResealRefusedError` (`invalid-record`, redacted) before the repo is written. A first
copy, `put` and `prepare` add no open. Changeset: `.changeset/platform-vault-copy-overwrite-open-back.md` (patch).
Tests (`vault.reseal-verification.test.ts`, +3):
- overwrite with a seal that opens to a different value is refused (`failed` / `invalid-record`), target row byte-identical, old payload still readable;
- overwrite with a seal bound to the wrong identity: same outcome;
- open-count pin: `put`, `prepare` and a first copy add 0 opens, a copy-overwrite adds exactly 1.
RED (before the fix): `cd packages/platform && npx vitest run src/secrets/__tests__/vault.reseal-verification.test.ts` -> 3 failed | 8 passed
(first two: copy returned `status: copied`; third: expected 1 open, got 0).
GREEN (after): same command -> 11 passed.
Mutations: deleting the new line -> the same 3 fail; running the check on every copy (not only overwrite) -> the open-count pin fails.
Gates (Jini, from the repo root unless noted):
- `cd packages/platform && npx vitest run` -> 164 files, 3125 passed | 6 skipped (the package's own run; includes all 25 files under `src/secrets`, 490 tests)
- `cd packages/platform && npx tsc -p tsconfig.json --noEmit` -> 0 errors (my first draft passed a spread record whose `isDefault` was `undefined`; fixed by passing the stored row, as rotate does)
- `pnpm guard` -> ok, zero violations
Tovu pins: with the changed Jini linked, 12 vault-touching Tovu suites run with `node --test`
(`sealed-credential-discard`, `site-key-recovery.unit` = 40/40; `media-provider-credential-repo`, `vault-credential-inventory`,
`make-request-delete-confirmation`, `site-credential-store`, `execution-credential-store`, `provider-credential-store`,
`destination-store.sqlite`, `external-mcp-vault.unit`, `site-sealer.unit`, `assistant-vault.unit` = 259/259). All pass, so
the open-call-count pins stay valid; only rotate and copy-overwrite add an open. I could not identify "the 4 suites" by name
from the repo (no commit names them), so I ran every suite that counts sealer opens or touches the vault.
Left: Tovu needs no change. Not run: the Jini full `pnpm typecheck` (root) and the whole Tovu suite.

## 2. fix/hang-bugs-i18n (Tovu)
Keys fix/hang-bugs (merge 75ef868f, source cloud-results/fix-hang-bugs.md) added with English only; found from the merge diff:
1. `Could not discard the recovered draft. It is still saved and the banner is still here, so you can try Discard again or Restore it.` (Post editor `use-post-editor.hooks.ts`, Page editor `use-page-editor.hooks.ts`)
2. `Could not add {name}. Nothing was inserted. Cause: {cause}` (Post editor drop/paste upload failure)
3. `no reason was given` (fallback cause in 2)
The change feed's `event: error` text in `settings/events.ts` is server wire data, not rendered by the admin client
(`lib/settings-events.ts` ignores the payload), so it needs no translation.
Fix: new `apps/admin/src/lib/editor-failure-i18n.ts` with real translations for all 21 admin locales
(ar bn de es fa fr hi hu id it ja ko pl pt-BR ru th tr uk ur zh-CN zh-TW); `posts-i18n.ts` merges it into `POSTS_DICT`,
and `page-editor-i18n.ts` routes the discard key to the Posts translator (one sentence, one translation). The discard
sentence uses each locale's existing "Discard"/"Restore" button labels. Note for a native-speaker pass: translations are
mine; wording follows the register already used in each locale's dictionary (fr "vous", hu/de/it informal, tr formal).
Tests (+7: required keys in every locale, page translator resolves the discard key, `{name}`/`{cause}` survive in every locale,
rendered upload message in es and de). RED: `npx vitest run --maxWorkers=2 posts-i18n.unit.test.ts page-editor-i18n.unit.test.ts`
-> 5 failed. GREEN: same files + `untranslated-copy.unit.test.ts` -> 135 passed.
Mutations (all caught): a locale left in English (untranslated-copy + 3 more), `{cause}` dropped from ja, page key removed
from the routing set, the merge removed (5 fail).
Other gates: `cd apps/admin && npx vitest run --maxWorkers=2` on posts-i18n, page-editor-i18n, untranslated-copy,
`use-post-editor.hooks.unit`, `use-page-editor.unit` -> 5 files, 360 passed. `cd apps/admin && npx tsc --noEmit -p tsconfig.json` -> 0 errors
before and after. Ratchets after = base (see table).
Left: Jini `keepOnFailure` (panel-kit `clearStandingDraft`) is already on Jini refactor/terra; Tovu's pin must still be bumped
to a Jini release containing it. NOT published here: needs a Jini release, owner to cut.

## 3. fix/site-share-errors-shell (Tovu)
`site-share-errors.ts` held only `sendSiteShareFailure` + 3 private helpers. Callers: `site-shares.ts` (1 call, via its `fail`
wrapper) and `site-share-password.ts` (1 call), a tie by count. Moved into `routes/system/site-share-password.ts`, which already
holds the share routes' shared helper `requireSavedKeysOwnerSession` and is imported by `site-shares.ts`; putting it in
`site-shares.ts` instead would have made `site-share-password.ts` import `site-shares.ts` back (a cycle). Deleted
`site-share-errors.ts`; repointed `site-shares.ts` and `__tests__/site-share-failures.test.ts`; why-comments moved verbatim.
Also updated: the `shared/admin-failure.ts` header, two `development/refactor-patterns` notes, removed the deleted file's
exemption from the class guard in `unexpected-route-errors.test.ts` (the moved code passes that guard), removed the stale
`error-gate-debt.json` row. (`development/todos.md` line 35 still names the old file in a historical note; left.)
Red first: repointing `site-share-failures.test.ts` to the new path failed (no such export), then 28/28 green
(`node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks` over
`site-share-failures`, `unexpected-route-errors`, `site-shares.integration`). `npx tsc --noEmit -p tsconfig.json` -> 0 errors;
`-p tsconfig.tests.json` -> 0 errors. No new behavior, so no new test beyond the repointed one.

## Tovu ratchets (base = unmodified origin/refactor/terra, same machine and link state)
| gate (`npm run check:<x>`) | base | fix 2 | fix 3 |
|---|---|---|---|
| size | exit 1 (red) | identical | identical |
| complexity | exit 1 (red) | identical | identical |
| architecture | exit 1 (red): same 4 regressed metrics | identical | same 4 regressed metrics; all-import propagation cost 12.46 vs 12.44 on base (one fewer file; still under the 15.52 baseline) |
| boundaries | exit 16 (115 violations) | not run | 115 violations, identical (6365 modules vs 6366) |
| hooks | exit 0 | identical | identical |
| errors | exit 0 (WARN mode, 12 "new" pre-existing) | identical | identical; "17 improved or gone" -> 16 after removing the stale row |
| error-rule-copies | exit 0 | not run | not run |
| jini-registry-drift | exit 1 on base (admin tsc "two different types" from the linked Jini's React types) | not run | not run |
"identical" = the violation / regressed / improved lines diff empty against the base log.
Fix 1 touches Jini only; Tovu ratchets do not apply to it.

## Left / next step
- Owner: review translations (native-speaker pass), cut a Jini release containing `keepOnFailure` and the copy-overwrite change, bump Tovu's pin, then merge the three branches (they are independent; each cut from the same base).
- The Tovu vault suites that pin open counts were identified by behavior, not by name; if the owner means a specific four, run those against Jini `b0c103a6`.
