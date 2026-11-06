# fix-round — in progress

Branch: `cloud/fix-round`; base: `f4e3b18a5ea67fc7531357aae05c4495dd593bea` (`origin/cloud/combine`).
Started 2026-11-06 09:30 America/Los_Angeles; hard stop by 11:30.

Checking all 16 requested findings. Focused failing tests precede bug fixes.
Build setup is in progress; initial install hit a read-only default pnpm cache; install with a writable workspace store passed.

## Bugs found

Findings are being checked; final dispositions and exact commands will follow.

## Progress checkpoint

Baseline: `CI=true pnpm install --frozen-lockfile --store-dir /workspace/work/fix-round/pnpm-store`, core build and `pnpm --no-bail -r build` passed across 47 workspaces. Tovu contracts/SDK builds and Jini relink passed.

Pushed Jini checkpoints: `39b4c0e3b`, `2c4816fbf`. Pushed Tovu checkpoints: `fdf8257f6`, `f27ec74d6`, `4037de4f0`; all on `cloud/fix-round`.

Items 1–5 and 7–10 have fixes/corrected fixtures with passing focused checks. Item 6 approval ownership and items 11–15 cleanup remain in progress. Item 16 cannot be reproduced after the fresh install: chart dependencies are already declared; provider distribution/artifact tests pass 16/16.
