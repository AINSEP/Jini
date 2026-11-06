# full-tests — in progress

Branch: `cloud/combine`. Started 2026-11-06 around 06:54 UTC; hard stop by 08:54 UTC.

Initial setup and independent known-failure repairs are in progress. Logs: `/workspace/work/full-tests/`. Full-suite results will be recorded from this run. `cloud/ui-fixes` remains excluded.

Checkpoint at 07:11 UTC: frozen Jini dependency restoration, complete `pnpm -r --no-bail --if-present run build`, Tovu contracts/SDK builds, and `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` passed. PostgreSQL started for disposable tests. The first stale-dependency build is not treated as a baseline.

The recursive Jini suite is in progress: `pnpm -r --workspace-concurrency=1 --no-bail --if-present run test --maxWorkers=2 --minWorkers=1`. New failures are being repaired and individually rechecked. Provider pin/identity focused checks: 37 passed; tool/approval/boot group: 40 passed; composition: 10 passed; cookie regression group: 52 passed; launch group: 62 passed. Cookie bundle is 4,563 gzip bytes, retaining the 4,608-byte budget and 32-byte headroom check. Composition complexity fixes pass strict ceilings. Media/forms final verification is in progress. Full-suite totals are pending.
