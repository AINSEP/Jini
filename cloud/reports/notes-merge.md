# NOTES-MERGE: notes-app merge and review fixes

Branch `cloud/notes-merge`, from `origin/main` `bb44f52d6` (published 0.7.0). Only this branch was pushed: not main, nothing published, no force-push. Raw output is in `cloud/reports/raw/notes-merge/`.

## Merge: a deviation from the brief

The brief said to run `git merge --no-ff origin/cloud/notes-app-fix` and expected 0 conflicts. `origin/main` had been force-rewritten (`8a4794ce` → `bb44f52d`) after that branch was cut, so the branch's ancestry is now the old pre-rewrite line. A direct merge:

- conflicted in **50 files**: 37 UU and 13 AA, mostly `agent-plugins` skills, `plugin-catalog/catalog.json` and `pnpm-lock.yaml`;
- would have pulled in **672 pre-rewrite commits** that main carries in rewritten form.

I aborted that merge. The branch's own work is the 14 commits `2ebbc7bc..a322a8b2`, from "feat(core): Server route contract" to "NOTES-FIX report". I cherry-picked those 14 onto `origin/main` and they applied with no conflicts, lockfile included. I then merged them into `cloud/notes-merge` with `--no-ff`: merge commit **`17ba0246`**. The branch's two earlier commits are already on main in rewritten form, so I left them out:

- `35c4961a`: db agent-notes. The same `@agent-note` text is in main's `data-module.ts` and `migration-recovery.ts`.
- `283af360`: deletes `server/src/lifecycle`. That directory is absent on main.

`pnpm install --frozen-lockfile` exit 0 (`install.txt`). `pnpm --no-bail -r build` exit 0 (`build.txt`).

## Fixes, one commit each

| # | Finding | Commit | Red → green |
|---|---|---|---|
| R1 | `create-tables.ts` imported `@jini-ai/db/kernel`, a new cross-package edge (XP1 + XP3) | `e986ec4d` | `r1-cross-package-red.txt`: `XP1` and `XP3 packages/cms/src/forms/sql/create-tables.ts: @jini-ai/db/kernel`, exit 1 → `r1-green.txt`: "XP1–XP5 clean", forms tests 812/812 |
| R2 | changesets | `873f10c3` (+ `1225dfaf` raw) | `r2-changeset-red.txt`: "no changesets were found", exit 1 → `r2-changeset-green.txt`, exit 0 |
| Ref | DDL reference comparison | `6a901698` | new test, green on the merged code (`reference-test.txt`); a mutation (`'active'` → `'live'`) fails both dialects (`reference-test-mutation.txt`) |
| Idx | Postgres 63-byte identifier truncation | `f435cc40` | `index-names-red.txt`: an 81-byte name, and pglite creates 5 of 7 indexes → `index-names-green.txt` 7/7 |
| Route | `ServerRoute` type | `2199b50a` | `server-route-red.txt`: TS2305 in core and the example → `server-route-green.txt` |
| Prec | route precedence | `44b391c7` | `precedence-red.txt`: 3 of 15 fail → `precedence-green.txt` 15/15 |
| Cookie | Set-Cookie headers | `eb64523a` | `set-cookie-red.txt`: the first cookie is lost → `set-cookie-green.txt` 16/16 |

- **R1.** `create-tables.ts` now declares its own port, `FormsTablesKernel { readonly dialect: FormsTablesDialect; execute(statement: RawBuilder<unknown>): Promise<void> }`. Those are the only two members it uses. A `@jini-ai/db` kernel satisfies the port structurally, so hosts pass their kernel unchanged. A new test passes a plain `{ dialect, execute }` object. The repos (`repo.ts`, `submission-ip-retention-repo.ts`) still import `@jini-ai/db/kernel` as they did at the base; the check does not flag those imports and they were out of scope.
- **R2.** Two minor changesets:
  - `.changeset/core-contracts-server.md`: the `@jini-ai/core/contracts/server` subpath.
  - `.changeset/cms-create-forms-tables.md`: `createFormsTables` and its port types.

  `changeset status` lists the fixed `@jini-ai/*` group at major. This is the known peer-range behavior recorded in `de6f8365` (0.x minor → computed 1.0.0, relabelled at release). Neither changeset asks for major.
- **Reference DDL.** The copy of Tovu's forms DDL (from `7a079cd2^`) is back as `__tests__/support/forms-tables.reference.ts`, marked reference-only. `create-tables.reference.test.ts` builds the reference schema and `createFormsTables` on separate fresh databases and compares what each catalog reports:
  - SQLite: `table_info`, `index_list`/`index_info` plus each partial index's `WHERE`, `foreign_key_list`.
  - PGlite: `information_schema.columns`, `pg_indexes.indexdef`, `pg_constraint` with `pg_get_constraintdef`, which covers PK, FK and NOT NULL.

  There is no Postgres server in the container, so PGlite stands in for Postgres.
- **Index names.** A derived index or constraint name longer than 63 bytes becomes its leading characters (≤ 54 bytes), then `_`, then an FNV-1a hash of the full name. Names that already fit are unchanged, so the default schema still matches the reference, and existing Tovu databases keep their index names, so `IF NOT EXISTS` still finds them. Tests:
  - SQLite: the generated names are ≤ 63 bytes and distinct.
  - PGlite: all 7 indexes exist after two runs with 59-character table names.
- **ServerRoute.** `ServerRoute { method, path, handler }` is now the argument type of `Server.route`, and its `@agent-note` shows `for (const route of routes()) app.route(route)`. It is a type only. Typecheck cases are in core `args-convention.typecheck.ts`. The adapter test mounts a `ServerRoute[]` list.
- **Precedence.** Documented on `Server`: compare the paths segment by segment from the left; at the first segment where one is literal and the other is `:name`, the literal wins. So `/x/new` beats `/x/:id`, and `/a/b/:q` beats `/a/:p/c`. Registration order never decides. Paths that differ only in param names count as the same path, which keeps the order total. The notes-app adapter now applies this; before, the first registered match won. Tests register the param routes first.
- **Set-Cookie.** The adapter called `setHeader` for each `Headers.forEach` entry. Node yields each cookie separately, so only the last cookie reached the client, which is worse than merging them. The adapter now appends each cookie from `getSetCookie()` with `appendHeader`; where `getSetCookie` is missing, it collects the values from `forEach` instead.

## Gates (final tree)

| Gate | Result | Raw |
|---|---|---|
| `pnpm install --frozen-lockfile` | exit 0 | `install.txt` |
| `pnpm --no-bail -r build` | exit 0 (after the merge); core and cms rebuilt after the fixes, exit 0 | `build.txt`, `rebuild-core.txt`, `rebuild-cms.txt` |
| core vitest `--maxWorkers=2 --minWorkers=1` | 115 files, **1857/1857**, exit 0 | `core-vitest.txt` |
| cms vitest `--maxWorkers=2 --minWorkers=1` | exit 1: 331 files, **3992/3993**. The 1 failure is **PRIOR (from main)**: `universal-entries.boundary.test.ts` › "CMS declares the used HTTP toolkit peer with an optional registry range" expects `^0.6.10` but finds `^0.7.0`. The 0.7.0 release `de6f8365` bumped `packages/cms/package.json` and left the test's pin unchanged. This branch differs from `origin/main` in neither file (`git diff origin/main HEAD` on both is empty), so I listed it rather than fixing it here. | `cms-vitest.txt` |
| notes-app typecheck + `npm test` | typecheck exit 0; **18/18** | `notes-app-test.txt` |
| notes-app restart smoke (`npm run smoke`) | 11 `ok`, `PASS`, exit 0 | `notes-app-smoke.txt` |
| `pnpm check:cross-package` | **"XP1–XP5 clean"**, exit 0 | `cross-package.txt` |
| `pnpm guard` | exit 1, **2 violations, both known**: R10-chatpane-public-surface (`ChatPane.tsx` imports `Icon`, which is not in the public barrel) and R13-model-fallback-freshness (`claude-fable-5-2` from the live picker cache) | `guard.txt` |
| `pnpm guard:plugins` | exit 0 | `guard-plugins.txt` |

XP3 baseline: as in Tovu `cloud/reports/fix-1110.md`, I took a fresh snapshot from a clean worktree at `35c4961af718f0f30591c46d2ea2756c4484a731`:

1. `pnpm install --frozen-lockfile` (exit 0).
2. Core build (exit 0), then the recursive build (exit 0).
3. `--write-baseline /home/user/xp3-baseline`: **3308 source mappings**, the same count as fix-1110 (`xp3-snapshot.txt`).

Every cross-package run used `JINI_DECLARATION_BASELINE_DIR=/home/user/xp3-baseline`. I removed the worktree and the snapshot afterwards.

No lint disables, skipped tests or baseline changes. No test, server or build process is left running.

Last green commit: **`1225dfaf`**, the last commit that changes code. All gates above ran on its tree, and every gate is green apart from the prior cms test and the two known guard violations. Later commits add only report and raw files: `b148b675` and the commit that adds this report.

NOTES-MERGE DONE
