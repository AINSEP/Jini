# open-fixes — in progress

Branch: `cloud/open-fixes`. Base: `origin/cloud/combine` (`f07ae3d6ff55cf4da480acac44cc6f4b7686966b`).

The requested checks are in progress. Initial inspection finds existing corrections for items 7–11 and 13; focused verification follows the clean rebuild. No completed test result is claimed yet.

Tovu work and final item dispositions will be recorded in the matching Tovu report. Public wording remains general as requested.

## Validation

Setup: `source /workspace/.tovu-build/env.sh`; `CI=true pnpm install --frozen-lockfile --store-dir /workspace/work/pnpm-store` passed. `pnpm --no-bail -r build` is running. The first install attempts encountered a read-only default store and a noninteractive purge prompt; neither is a source failure.

## Bugs found

No new Jini finding confirmed at this checkpoint.
