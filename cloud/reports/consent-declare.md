# consent-declare — in progress
Branch: cloud/consent-declare (both repos). Bases: Jini b0cc1371b, Tovu 5358aa594, fetched from origin/cloud/combine.

Step 1: added shared all-of consent check, declaration validation and ordered, once-only browser script lifecycle. Focused tests were run failing first (2 failures), then passed (2 tests). Typecheck caught exact-optional typing; corrected, verification in progress.

Setup: sourced /workspace/.tovu-build/env.sh. Offline install lacked cached dependencies. Online install initially hit read-only pnpm store; retry uses explicit store write permission. Full Jini rebuild and Tovu relink in progress. No PostgreSQL needed yet.

Steps 2–5 remain in progress. No legacy deletion before replacements pass.

Checkpoint: steps 1–3 replacement consumers pass. Pushed Jini da26f3248, b45a3a974, f7c3ee94b to cloud/consent-declare. Full `pnpm -r build` now passes; Tovu relinked. Core/extensions preserve the 4608-byte per-asset ceiling (core4533, extensions1773 gzip; total6306). A stale published-policy context reloads before storage/API/optional execution. Step4 diagnostics and standalone preview in progress. Legacy engine retained until replacement diagnostics pass.

Checkpoint: step5 in progress. Replacement consumers passed before removing the CMS HTML engine. Receipt/privacy/origin/rate checks retained; parse5 retained. Shared region subdivision regression fixed with failing test first. Final rebuild/relink/typechecks and report inventory in progress. No deployment, publish, tag or main push.

Checkpoint: Automatic declared assets now use ordinary delivery independently of context; optional entries remain JSON. Preview remains scriptless. Guard completed with25 unrelated findings (19 unchanged source/manifest findings,6 untracked setup directories); no consent findings. Final focused rebuild/checks in progress.
