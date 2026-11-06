# commerce-fix-2 — in progress

Branches: Jini `cloud/commerce` (base eb4baf982); Tovu `cloud/commerce` (base 60049a5ae).
Job authority: `origin/cloud-plans-1105:cloud/jobs/COMMON.md`, `cloud/jobs/commerce-fix-2.md`, and findings `cloud/plans/commerce-review-2.md`.
Hard cap: two hours from 2026-11-06 00:06 UTC. Commerce remains off by default. No live provider credentials used.

Implemented so far (verification continuing):
- N-H1: existing approval lifecycle, payment manage permission, authenticated confirmer, stored order/payment/amount/mode on approval description; declined card regression compares unchanged payment, evidence and audit.
- N-M1/N-M4/N-M5 browser/N-M6: catalog recovery fixes in cb6a5e3ec and 46784de35.
- N-M12: pinned Stripe request and webhook version in 4240ba19b.
- N-M5 POST response: Tovu 9023c6220 (push confirmed).

Setup: fetched plan/job branch; clean bases checked out directly; Jini `pnpm install --frozen-lockfile`, core build and `pnpm --no-bail -r build` passed; Tovu `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` passed. Initial cache write restriction corrected without repository configuration changes.

Targeted baselines: resolution 8/8; catalog/browser 35/35; reconciliation/operator 22/22; Stripe HTTP 33/33. New regression evidence and final exact command list will be recorded at completion. No full suite requested or run.

Open: remaining authorized findings and final type/complexity checks are in progress.
BUG N-M9: separate site databases sharing one Stripe account retry and dead-letter each other's events. Listed only; intentionally unchanged by owner instruction.

Before any site enables commerce: use a real Stripe test account with API/webhook version 2024-06-20 to verify checkout redirect, payment/expiry webhooks, retrieve/replay, recovery, duplicate delivery, return/cancel views and manual approval. Current provider behavior is proven only with fake transport.
