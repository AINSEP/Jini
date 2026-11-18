# audit2-b (wave3/audit2-a) — Jini report

Full report (both repos, every gate with its exact command): `origin/wave3/audit2-a:cloud-results/audit2-b.md` in Tovu.

Jini commit `f80980fa` `feat(desktop-host/app-version): version loader and update-check controllers`, on top of `6c6557ab`, same branch, fast-forward push.
- New `packages/desktop-host/src/app-version/{store,loader,update-check,index}.ts` (`createAppVersionLoader`, `createUpdateCheck`; framework-free, `useSyncExternalStore`-shaped, `(required, optional = {})`, `report` injected, no `node:`/`electron`/`react`); universal entry `./app-version` in `package.json` (`exports` + `jini.entries`); README row; changeset `desktop-host-app-version-controllers.md` (minor).
- `electron/app-version.ts`: both `_optional` parameters are plain `= {}`; its test gained the empty-tag case (characterization, green against the landed code).
- Red first (modules missing), then green; four mutations tried, all caught (one survived a weak first test, test strengthened).
- Gates: `npx vitest run` in `packages/desktop-host` -> 714 passed, 1 skipped, 0 failed; `npx tsc -p tsconfig.json --noEmit` clean; package `build` ok; eslint clean on touched files; `pnpm guard` -> ok, zero violations.
- Left: publish a snapshot containing `./app-version` (DX-OD10) before the Tovu lockfile can consume it unlinked.
