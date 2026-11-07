# Job more-jini-1 (owner-approved 11-07): move two generic pieces from Tovu to Jini

Read cloud/jobs/COMMON.md first. This file overrides it. T = Tovu apps/website/src/. J = Jini packages/.

Base in both repos: origin/cloud/combine (Tovu b45d2ee75, Jini 32e9c9c21). Create cloud/more-jini-1 from it in each repo. Owner approved --no-verify for that branch in Tovu. Hard cap 3 hours. On the cap: push, report, END. Unfinished work is accepted. Do item 1 fully before item 2. Do nothing else.

Another session is building cloud/portable-fin. Do not read, merge or touch it. Nothing goes to cloud/combine or main. No npm publish.

## Rules for both items
- Moves are `git mv` plus import edits, never retyped. "Why" comments move byte-exact.
- Old Tovu paths stay as thin re-exports with the same names and signatures. Every existing Tovu importer keeps working. Do not change importers.
- Tovu tests stay where they are and stay unedited, running through the shims. A test that needs editing means the move is wrong: stop that item and report.
- Tovu behaviour is byte-identical. No migration. No new option, abstraction or framework.
- New Jini public functions take (requiredObj, optionalObj). Keep the old call shape in the Tovu shim. Do not reshape anything else.
- Do not edit scripts/check-package-layers.ts or scripts/check-subpath-isolation.ts. If a layer or isolation rule refuses a move, stop that item and report it. Do not invent a way around it.
- No Tovu or TOVU_ literal enters Jini code. Any you find becomes host input; list each one.
- No new read on any hot path. No optimization.
- Add a dependency only if the move cannot build without it, and report it. Avoid lockfile changes if you can.
- Add a Jini changeset if the repo's process requires one for a new export.

## Item 1: revert commands, 382 lines
Move T contracts/core/commands/ (revert, appliers, repo.memory, index) to J cms/src/core/commands, beside the existing change-set.ts and command.ts, exported through a cms subpath that passes the isolation check. Separate universal code from anything needing a database driver: no kysely in a universal entry. Tovu's T contracts/core/commands paths become wrappers preserving today's signatures.

## Item 2: plugin dataModule engine, 1,593 lines
Move from T features/plugins: data-module, migration-journal, plugin-identity, snapshot, migration-recovery, disk-headroom, plugin-store, restore, index, to a new `@jini-ai/db/data-modules` export in J db (node entry). lipay/manifest.ts and store/manifest.ts stay in Tovu.

Keep these byte-identical, because they are saved in existing databases:
- table names _plugin_migration_journal, _plugin_identity, _plugin_migrations
- the p_{pluginId}__ prefix
- journal states and their stored text
- the sourceUrl and publisher comparison in plugin-identity. Declarations keep `publisher: "tovu-core"` where they have it today. The adoption guard fails closed on a mismatch, so Jini must not supply a neutral default that changes this.

Crash recovery and snapshot order do not change. The engine must still work on SQLite, PGlite and Postgres as its header says, and for in-memory databases.

## Proof
For each item, on code built from your branch:
1. tsc --noEmit on each touched Jini package. Run the layer and isolation checks and `pnpm guard`, comparing to the base. Report red-at-base separately from anything you caused.
2. The Jini tests you add: a small test proving the new entry imports and runs using only public @jini-ai exports, no Tovu import. For item 2 also pin the persisted names above literally.
3. Rebuild Jini, relink Tovu, then run the existing Tovu tests for that area, unedited: T features/plugins/__tests__, the commands tests, and the importers' direct tests (comments data-module-install, newsletter data-module-manifest, platform/db/migration/manifest, composition data-modules, share-database repo). Changed and affected files only. No full suites. Leave no test process running. --maxWorkers=2 --minWorkers=1.
4. Pack the touched Jini packages to a throwaway folder, install them in a throwaway consumer, and import each new entry with plain node. Delete the consumer.

## Report
cloud/reports/more-jini-1.md on the Tovu branch, and your final message: shas by branch; per item done or stopped and why; lines moved, new production lines and test lines separately; every test command with its exact result; every error by name; literals found; anything still tied to Tovu; bugs on their own lines; time used. No memory or I/O cost should change: say so, or say what did.
