# full-tests — in progress

Branch: `cloud/combine`. Started 2026-11-06 around 06:54 UTC; hard stop by 08:54 UTC.

Initial setup and independent known-failure repairs are in progress. Logs: `/workspace/work/full-tests/`. Full-suite results will be recorded from this run. `cloud/ui-fixes` remains excluded.

Checkpoint at 07:11 UTC: frozen Jini dependency restoration, complete `pnpm -r --no-bail --if-present run build`, Tovu contracts/SDK builds, and `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` passed. PostgreSQL started for disposable tests. The first stale-dependency build is not treated as a baseline.

The recursive Jini suite is in progress: `pnpm -r --workspace-concurrency=1 --no-bail --if-present run test --maxWorkers=2 --minWorkers=1`. New failures are being repaired and individually rechecked. Provider pin/identity focused checks: 37 passed; tool/approval/boot group: 40 passed; composition: 10 passed; cookie regression group: 52 passed; launch group: 62 passed. Cookie bundle is 4,563 gzip bytes, retaining the 4,608-byte budget and 32-byte headroom check. Composition complexity fixes pass strict ceilings. Media/forms final verification is in progress. Full-suite totals are pending.

Checkpoint at 07:22 UTC: `Jini` implementation head `1a44395a0ba5fef14d31c2d5f8af90d7ab506e09`. All named initial findings have focused fresh repairs. The full recursive Jini run continues (currently UI). Newly found core/platform/database fixture drift is corrected, with 2/93/38 focused tests passing respectively. Five scratch-test failures were sandbox `/var/tmp` permissions; all six unchanged scratch tests pass with explicit disposable-directory write permission. OAuth diagnostic checks also pass.

A real CMS runtime-isolation violation was fixed by moving the shared pure collection read model and schema snapshot to existing CMS shared-core ownership, retaining public Forms re-exports and Forms-owned submission writes. Isolation/provider/schema group: 132 passed; final resolver group: 22 passed; CMS typecheck/build and Tovu relink passed. The compatibility changelog now matches its existing package version. No rule or isolation allowlist was changed.
