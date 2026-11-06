# Job forms-left (owner-approved 11-05; plan approved with this trim)
Plan: cloud/plans/FL-forms-left-plan.md. This job file overrides it.
Base: origin/cloud/combine in both repos, at its current tip. Branch cloud/forms-left. Do not push to cloud/combine.
Do plan steps 1, 3 and 4. CUT step 2 (recovering old errors) entirely, including its use of scripts/forms-maintenance.ts for recovery.
Step 1 trim:
- A browser submission with a MISSING hash is accepted exactly as today. Pages already published carry no hash, and they must not all start asking people to review. Only a hash that is present and different triggers the review flow; a malformed one is treated as different.
- Repopulate the answers that still fit the current controls and show the rest as plain text to copy. Consent again, files reselected.
- Cloudflare worker: on a mismatch, return the plain 409 message and accept nothing. Do not build repopulated HTML in the worker.
Step 4 stays explicit-only, with no schedule, and uses no storage_allocations table. Proven orphans go private first, then the existing cleanup. When unsure, keep and explain.
Report exactly what must be republished to Cloudflare.
Tests only for what you change; full suites run later. No skipping or weakening tests or rules. No publish, tag or main. Report at cloud/reports/forms-left.md and in your final message: shas, exact files, tests with commands, anything open. General wording in commits and notes.
