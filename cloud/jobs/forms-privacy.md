# Job forms-privacy (owner-approved 11-05; plan approved with this trim)
Plan: cloud/plans/FP-forms-privacy-plan.md. This job file overrides it.
Base: origin/cloud/combine in both repos, at its current tip. It already has forms-left and consent-declare. Branch cloud/forms-privacy.
Do steps 1 to 4, with these cuts:
- Step 1: new delivery jobs store a reference, not answers, and a missing or purged source stops delivery. Keep the legacy reader so queued jobs still deliver. CUT compact-legacy.ts and scripts/forms-delivery-maintenance.ts: list what old copies remain in your report instead.
- Do not add a shared storage quota.
Report exactly what must be republished to Cloudflare.
Tests only for what you change; full suites run later. No skipping or weakening tests or rules. No publish, tag or main. Report at cloud/reports/forms-privacy.md and in your final message: shas, exact files, tests with commands, anything open. General wording in commits and notes.
