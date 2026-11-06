# consent-declare — in progress
Branch: cloud/consent-declare (both repos). Bases: Jini b0cc1371b, Tovu 5358aa594, fetched from origin/cloud/combine.

Step 1: added shared all-of consent check, declaration validation and ordered, once-only browser script lifecycle. Focused tests were run failing first (2 failures), then passed (2 tests). Typecheck caught exact-optional typing; corrected, verification in progress.

Setup: sourced /workspace/.tovu-build/env.sh. Offline install lacked cached dependencies. Online install initially hit read-only pnpm store; retry uses explicit store write permission. Full Jini rebuild and Tovu relink in progress. No PostgreSQL needed yet.

Steps 2–5 remain in progress. No legacy deletion before replacements pass.
