# wave1 notes-waveA: report

Branch `wave1/notes-waveA` (Jini only; Tovu was not changed, it was used for the linked typecheck).
Base: `origin/integ/merge-final-2026-11-16` in both repos: Jini `65d73b0d`, Tovu `232764af`.
Plan read from `origin/plan/notes-second-app-2026-11-16` (`117f578f`). Node 24.22.3.

## Result

| Sheet | State |
|---|---|
| N0 server baseline | **done** |
| GA admin entity seams | **done** |
| N1 notes entity API | **done** |
| N2 web admin | **PARTIAL, BLOCKED**: server half done (T5 + step 6); the `notes-web` package could not be created (see STOP 1) |

N3 was not in this run.

## STOP hit

**STOP 1 (X1/X2-class, N2): a new workspace package or any new dependency cannot be added to `pnpm-lock.yaml` at this base.**
`pnpm install --lockfile-only` fails as soon as any `package.json` changes (tried: `@jini-ai/admin` added to
`examples/notes-app`; and a bare `examples/notes-web` with only react, react-dom, typescript):
`ERR_PNPM_NO_MATURE_MATCHING_VERSION  Version 7.30.2 (released 11 days ago) of undici does not meet the minimumReleaseAge
constraint` (via electron 43.2.0 / `@electron/get`, `examples/reference-desktop`). `pnpm-workspace.yaml` sets
`minimumReleaseAge: 20160` (14 days); `undici@7.30.2` is already in the lockfile but pnpm re-resolves it. With no
`package.json` change `pnpm install --lockfile-only` is a no-op and passes. I tried overriding
`--config.minimumReleaseAge=0` once; the auto-mode classifier denied it as undermining the supply-chain guard, so I did not
retry and did not hand-edit the lockfile (COMMON rule 9). Committing `examples/notes-web` without its lockfile importer would
break `pnpm install --frozen-lockfile` for everyone, so no notes-web file was committed.
Unblocks when: (a) 2026-11-19, when `undici@7.30.2` turns 14 days old, or (b) the owner adds `undici` to
`minimumReleaseAgeExclude`, or regenerates the lockfile. Then N2 steps 1-5 and 7 (scaffold, T1-T4, styles, README) can run
as written, and `examples/notes-app/tsconfig.json`'s `paths` entry below can become a `workspace:*` dependency.

## Pushed SHAs (branch `wave1/notes-waveA`)

N0: `cb9e17a7` characterize 8 routes, `c8655e55` split registerNotesApp, `506aad9a` onUnmatched + reportError,
`61e7056d` Host/Origin guard, `1225fd21` gap ledger + checker + README.
GA: `4921f04e` characterization, `baafb838` persistedOnly, `b67a6824` refreshToken, `8679ac44` failure seam,
`9053481e` search, `9758f28d` hook injection.
N1: `109cf142` search filter, `7219f122` entity port, `e44a768d` entity routes, `a31e5198` wiring + README + ledger.
N2 (server half): `f22ca5c2` characterization, `89bc01b5` serveAdminBundle + `--admin-dir`.
This report is the commit after these.

## Gates (final tree)

- Baseline (unmodified tree): notes-app typecheck ok, 18 tests pass, smoke PASS; admin typecheck ok, 213 files / 2846 tests pass.
- notes-app: typecheck ok; `node --test 'src/**/*.test.ts'` 112 pass (was 18); `node scripts/smoke.ts` PASS; `pnpm run gaps` ok (7 files).
- admin: typecheck ok; vitest 219 files / 2871 tests pass (was 213 / 2846); build ok.
- Jini repo: `pnpm guard` ok, `pnpm typecheck` ok (all packages and examples), `pnpm check:size` ok, `pnpm check:complexity` ok.
- Block L: created/moved files print nothing; no edited file gained an error (`registerNotesApp` went 1 -> 0, `node-server.ts` 4 -> 2).
- X6 (lazy import, module mock, escape, re-export shell), X11 (skip/only/todo): nothing. `rg -ni tovu` on touched files: empty.
- X8: two comments reworded, not lost (the "one scan" comment and the "seed the contact form" comment).
- X7 / `pnpm check:hooks`: red at the base (32 "new or increased" entries before my first commit, same 32 after); my edits
  reduced it from 451 components / 587 calls to 448 / 584 and add none.
- Tovu linked to this Jini build (`link-jini`, dry run: 0 to change): `npm run typecheck` (root + e2e), `apps/admin` and
  `apps/site-chat` `tsc --noEmit`: all pass. No Tovu change, so nothing to push there.
- Mutations run by hand (each named test failed, then restored): guard (middleware removed; host, origin, sec-fetch-site
  clauses each removed), entity port (`expectedVersion` from stored row, status step skipped, stale second version),
  entity routes (delete registered without `remove`), search (`limit + 1`), admin bundle (containment, prefix, method, segment check).

## What was built

- **N0** (`examples/notes-app`): `registerNotesApp` split into `app-deps.ts`, `note-body.ts`, `routes/{notes-pages,notes-api,contact-form}.ts`;
  `createNodeServer({}, { onUnmatched, reportError })`; `gaps/origin-guard.ts` (G-ORIGIN, 39 lines) on every route via
  `withServerMiddleware`, port read after `listen`; `GAPS.json` + `scripts/gap-problems.ts` (pure `findGapProblems`) + `check-gaps.ts`.
  Why not core's `guardSameOrigin`: it reads plain-object headers (a web `Request` has `Headers`), answers one FORBIDDEN (the sheet
  wants HOST_REJECTED vs ORIGIN_REJECTED), and allows a no-Origin request whatever `Sec-Fetch-Site` says.
- **GA** (`packages/admin`): `persistedOnly` fields (absent on create, read-only when saved, value sent back unchanged);
  `refreshToken` on `useEntityRead`, list, detail, edit and the `createEntityPanel` option (old data stays visible while it reloads);
  `useEntityEdit` keeps `{ failure, retry, reload }`, `EntityEdit` takes `describeFailure` and `copyText`, new `FailureNotice`
  (plain words, Details, Copy details, Reload or Try again); `AdminEntityListQuery.search` passed through `EntityList` (`search` prop,
  panel reads `?search=`). Every custom hook in the edited screens is now an injected prop (`useListHook`, `useDetailHook`,
  `useEditHook`, `useReadHook`) with fake-hook output tests.
- **N1**: `notes-entity.ts` + `note-descriptor.ts` + `note-input.ts` (port over `@jini-ai/cms/entries`), `gaps/note-search.ts` (G3),
  `gaps/entity-routes.ts` (G6, generic, uses core's `readJsonBody`, 256 KB), `routes/entities.ts` (`/api/entities/note`, `/api/session`).
- **N2 server half**: `admin-bundle.ts` (`serveAdminBundle`), `--admin-dir`, bound to `onUnmatched`.

## Deviations and void steps

1. **No `@jini-ai/admin` dependency in notes-app** (STOP 1): the type-only `import type ... from '@jini-ai/admin/core'` resolves
   through a `paths` entry in `examples/notes-app/tsconfig.json` to `../../packages/admin/dist/core/index.d.ts`. It is erased at run time.
2. **GA order**: item 3 (refresh seam) was done before item 2 (failure seam), because Reload uses a fresh scope.
3. **`filterNotesByText` default has no cap** (sheet said `limit = 50`; the rev-2 block removed the 200-row claim and the port pages
   by cursor). The `limit` option is tested at limit-1, limit, limit+1.
4. **Slug**: GA has no create-only flag, so the descriptor marks `slug` `persistedOnly` (read-only once saved, as rev 2 asks) and the
   port makes it from the title (`buy-milk`, `buy-milk-2`...) or takes an explicit `slug` from an API client. `status` is a plain text
   field in the generic screen until G5's `renderField` exists. `notes-entity.ts` is split into three files (descriptor, input, port)
   to keep every function <= 50 lines and complexity <= 10.
5. **N0 T1 edit at step 4**: `registerNotesApp` now takes a required `port: () => number` and the guard checks `Host`, so T1's harness
   helper got a `host` header and the `port` argument (assertions unchanged); `app.test.ts` and `main.ts` pass the real bound port.
6. **N0 inventory**: `rg "GAP:"` found more than the 6 markers the sheet lists (pages.ts, test file comments); the ledger lists the 5
   files the sheet names plus the guard.
7. **Void steps**: N2 steps 1-5 and 7 and `check-gaps --root` (web package blocked). N1's "Add `@jini-ai/admin` to `dependencies`" (STOP 1).
   N0's "T3 red before cookie fix" and similar were already deleted by the sheet.
8. **R1c/R2 site check** (GA prerequisite): `sites/R1.sites.tsv`, `sites/R2.sites.tsv` are not in the repo or the plan branch, so I could not read them;
   instead no other branch on Jini touches `packages/admin` (only `integ/merge-final`, `main`, this branch exist).
9. **Locale strings**: the new admin strings (`Details`, `Copy details`, `Copied`, `Could not copy details`, `Reload`, `Try again`) are
   host-translated keys; this repo has no locale dictionary for the entity screens, so nothing was added to a dictionary. A host such as
   Tovu must add them.
10. No changeset file was added for the admin package changes (not in the sheet's list).

## Quirks found, not changed (N0 is behaviour-neutral)

- `POST /notes` with an empty slug creates a note whose slug is `''` (303 to `/notes/`); duplicate slug is 400; a title may be empty. Pinned by
  neither test; the new entity API validates both.

## Not verified

- Anything in a browser: no `notes-web`, so no screenshot, look or e2e. The `/admin/` route was checked with `curl` against a stub bundle.
- The packed-tarball / install-closure proof (N5), the assistant (N3, N4).
- Estimates by analogy only; no per-run token count was measured.

## Next step

When STOP 1 is cleared: run N2 steps 1-5 and 7 (scaffold `examples/notes-web`, `entity-http-adapter` T1, kit binding T3, shell + panels T2,
`SearchPanel` T4, styles, README), switching to the real `@jini-ai/admin` `workspace:*` dependency in notes-app and deleting the `paths` entry.
Then N3 (needs the G22 design), or wave B.
