# xpkg-r13b: R13b revision 4 DONE (Jini half)

Branch `wave3/xpkg-r13b` (Jini and Tovu). Node 24.11.1, pnpm 10.33.2. Sheet: `R13-hosts.md` R13b revision 4 (item 4, `storage/legacy/sqlite.ts`, is VOID and was not touched).

## Bases
- Jini: `origin/refactor/terra` (`4c1892368`) + one `--no-ff` merge of `origin/wave2/xpkg-r13b-r3b` (`50309962`; it was not an ancestor).
- Tovu: `origin/refactor/terra` (`ada11733f`) + one `--no-ff` merge of `origin/wave2/xpkg-r13b-r3b` (`04748a77`).

## Commits (Jini, pushed)
| SHA | step |
|---|---|
| `4cf25233` | step 1: four pins (B1 in `backup.test.ts`, L3/L5/L6/L7 in `legacy.test.ts`, `putRaw` in `fixture.ts`); tests only |
| `7056f1f7` | fixes a TS2783 (duplicate `kind` key) in the L3 pin; **`4cf25233` alone did not typecheck** (vitest strips types, tsc fails), `7056f1f7` fixes it |
| `205ba6d9` | step 2: the move (platform `secrets/legacy-owner`, db owner-store reads, server preset = wiring), docs, changeset, baselines |
Tovu: `53bf3270` ("Checked against Jini 205ba6d9"). The Tovu branch did not typecheck against the moved Jini until this commit; it is the paired commit.

## Step 1 proof (Jini base + pins)
- `cd packages/server && npx vitest run src/owner-store`: 3 files, **57 passed** (53 + 4 pins).
- `python3 -I R13b-mutations.py.txt` after the pins: B1 `1 failed`, L3 `1 failed`, L5 `1 failed`, L6 `1 failed`, L7 `1 failed`; B2-B8, L1, L2, L4, L8 red as before. One slip first: my fold of B1 used the id `entry-2`, which the v1 fixture already has, so the duplicate-id rule rejected it and B1 stayed green (57 passed). With `entry-3` it is red. This is why the pin is verified against the mutation, not only against green.
- After the move the same mutations on the new homes (`mut2`, run by hand): platform L1 `1 failed`, L2 `2 failed`, L3 `2 failed`, L8 `1 failed`; db L4 `1 failed`, L7 `1 failed`; server L5 `1 failed`, L6 `1 failed`.

## Deviation from the sheet (needs a decision, no redesign)
Sheet step 2(b) says the db reads go in `owner-store/index.ts` with the kysely `sql` tag. Two db pins forbid that: `import-isolation.test.ts` ("kysely outside kernel/migrate") and `loads-without-driver.test.ts` ("`./owner-store` imports alone ... no peers", failed with `ERR_MODULE_NOT_FOUND kysely`). I kept both pins and wrote the same reads with the kernel's builder (`db.selectFrom`, `eb.fn.countAll`, `db.introspection.getTables()` for the `owner_revocations` presence probe) and no `kysely` import. The behaviour is covered by the new db tests (counts, workspace filter, order, 0000 store, 0001 store). If the owner wants the `sql` text kept, the pins need an allowance for that entry (a decision, not done).

## Test counts (every source-reading test of each touched package, whole suite)
| package | base | after | note |
|---|---|---|---|
| platform | 3117 passed / 6 skipped | 3170 / 6 | +45 moved decoder tests, +8 new (`legacy-owner.unit`: ownerContext, nine fields, fixed error x2, vault refuses kind/workspace x2, missing key file, assignability) |
| db | 865 | 869 | +4 (`owner-store-rows.unit`) |
| server | 508 / 1 skipped | 466 / 1 | +4 pins, -46 moved (45 backup + the `ownerContext` case); the integration cases stay |
Tovu owner-store files (`node --test`, linked to Jini `205ba6d9`): unit + integration, 22 pass, 0 fail.

## Gates (Jini, base = tree before step 1, outputs diffed)
| command | result |
|---|---|
| `pnpm guard` | exit 0, output identical to base |
| `pnpm check:hooks` | exit 1 on base (BASE-RED, 32 findings), identical after |
| `pnpm check:why-comments` | exit 0; only the counter line changes (16 -> 19 files checked, 0 blocks lost) |
| `pnpm check:errors`, `check:size`, `check:complexity` | exit 0, identical |
| `node scripts/check-error-gate.mjs --strict` | no line names legacy-owner or owner-store (the `error-gate-debt.json` row was renamed by hand) |
| `pnpm api:check` | exit 0; counts 598 -> 599 entries, 16284 -> 16289 symbols |
| `pnpm typecheck` | exit 0 |
| `npx tsc --noEmit` in `packages/server` | exit 0 |
Greps: preset `rg 'sql\`|openWithPassphrase|isCopyableKind|EnvOrFileKeyring|throw new OwnerStore'` prints nothing; `rg '\bLegacyOwnerEntry\b'` prints nothing in both repos; `rg "@jini-ai/db|from 'kysely'" legacy-owner.ts` prints only three **moved-verbatim why-comments** that name the published package `@jini-ai/db 0.6.12` (no import).
Tovu: `npm run typecheck` exit 0; `check:hooks`, `check:why-comments`, `check:errors`, `check:size`, `check:complexity` exit 0; `check:boundaries` (exit 16) and `check:architecture` (exit 1) are BASE-RED and identical to base (only the module count 6372 -> 6373).
The Tovu desktop pre-push hook ran and the push went through without `--no-verify`.

## API baselines
`pnpm api:update` rewrote 11 files. Only `jini-ai__db.json` (+4), `jini-ai__platform.json` (new subpath only) and `jini-ai__server.json` (-8 removed names) are kept. I reverted the rest, and the platform baseline's unrelated drift (`SecretsVaultService` hash, `VaultReseal*`, `SecretSealerContract*`), because they are existing drift, not this change. The server dist was stale until rebuilt.

## Not done / open
- Lockfile: unchanged (`pnpm install --frozen-lockfile` passes after the `kysely` peer removal).
- Q-R13b-1 (two platform portability rules) is untouched, as the sheet says.
- The L3 platform case uses a vault-level read; no Chrome check (no UI).
- Overlaps: touches `knip.json`, `scripts/error-gate-debt.json`, `api-baseline/jini-ai__{db,platform,server}.json`, `packages/platform/package.json`, `.changeset` (shared files).

## Next step
Owner decides the deviation above (builder vs `sql` + a db pin allowance); merge the pair together (Tovu `53bf3270` needs Jini `205ba6d9` or later).
