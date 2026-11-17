# notes-g4-g6: STOPPED at the prerequisite check, no code changed

Branch `wave2/notes-g4-g6` (Jini). Base `origin/refactor/terra` = Jini `65d73b0d`; Tovu base `232764af` (Tovu not touched).
Plan read from `origin/plan/notes-second-app-2026-11-16`; decisions from `origin/plan/owner-decisions-2026-11-17`
(NS-N8 = Rec, NS-N10 = Rec, NS-N13 = NO). Node 24.22.3; `pnpm install --frozen-lockfile` ok (13s); the `-r build` was
stopped when the prerequisite check failed (nothing to baseline).

## Result: both sheets STOPPED (rule: a prerequisite that fails for a reason other than BASE-RED stops the sheet; no redesign)

### G4 (AdminKit core + feature kits): STOP, X2/X3
Sheet prerequisites: xpkg R1c, R2a, R2b landed; OD-N8 = split; **G5 merged**; step 4 edits `examples/notes-web`.
- G5 not merged: no `renderField` port anywhere in `packages/admin` on the base (`rg renderField packages/admin/src` only hits an unrelated SEO test).
- `examples/notes-web` does not exist on terra, `wave1/notes-waveA` or `integ/wave1-merge-2026-11-17` (`git ls-tree` count 0). Step 4 (delete `unbound.ts`, bind core only, GAPS row) has nothing to edit.
- R1c not evidenced on the base: `packages/admin/src/react/shell/use-admin-theme.ts:2` still imports `@jini-ai/ui/theme` (the sheet names this as the R1c signal). R2a/R2b: `185bf2fc` (forms catalog / embed policy / comment ports) is on terra; R1c is the open one.
- OD-N8 is DECIDED = Rec, so that gate is satisfied; it is not the blocker.

### G6 (entity adapters, conformance, `Server` registrar): STOP, X2/X3
Sheet prerequisites: **N2 merged**; OD-N10 = Rec (satisfied); R1c/R2 not mid-flight.
- N2's web half was never built: `wave1/notes-waveA` report says "N2 web admin: PARTIAL, BLOCKED; the `notes-web` package could not be created" because a new workspace package needs a `pnpm-lock.yaml` importer and the `minimumReleaseAge` trap blocks it until 2026-11-19 (lockfile rule: no override, no hand-edit).
- G6's http adapter is a `git mv` from `notes-web/src/shared/gaps/entity-http-adapter.ts` (does not exist) and step 5 re-points `notes-web` (does not exist). The routes half (`notes-app/src/gaps/entity-routes.ts`) exists only on `wave1/notes-waveA` (75 lines; not on terra, which is being merged by wave1-merge).
- Doing only the memory port + conformance + routes would be an improvised partial sheet, which the plan forbids, and `GA`/`N1` (also only on `wave1/notes-waveA`) would need a cherry-pick first.

## Gates run
None beyond `pnpm install --frozen-lockfile` (exit 0). No source file changed; no baseline recorded; no tests run.

## Overlaps / held
- HELD IDs touched: none. NS-N13 = NO, G19 untouched.
- Overlap with live runs: wave1-merge (`wave1/notes-waveA` -> terra), xpkg wave1c/1d (R1c).

## Next step (unblock order)
1. Land `wave1/notes-waveA` on terra (wave1-merge).
2. After 2026-11-19 (lockfile / `minimumReleaseAge` clears): N2 steps 1-5 and 7 (`examples/notes-web`).
3. Then G6 (needs N2 + R1c/R2 not mid-flight), then G5, then G4 (needs R1c, G5 merged, notes-web).
Re-dispatch note: the owner's "G4 then G6" order conflicts with the plan order `G6 -> G5 -> G4`; G4 cannot precede G5.
