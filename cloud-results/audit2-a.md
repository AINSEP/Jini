# audit2-a (wave3/audit2-a) — Jini report

Base Jini `4c1892368` (origin/refactor/terra). Full report with every gate: Tovu `cloud-results/audit2-a.md` on branch `wave3/audit2-a`.

- Pushed: `fa1d2026f` `feat(agent-plugins/connect): bounded token-map and token-sign-in entry validation` (A60 slice 1): `packages/agent-plugins/src/connect/token-map.ts` + export line + 13 tests + changeset.
- Gates: package vitest 148 files / 2178 passed, 2 skipped, 0 failed; `tsc --noEmit` clean; `npm run build` ok; eslint clean on the new files; `pnpm guard` ok.
- Left: nothing else in Jini. A10/A58 STOPPED on drift (Jini core `formatByteSize` and desktop-host `electron/app-version.ts` already landed with different contracts than the sheets); see the Tovu report.
