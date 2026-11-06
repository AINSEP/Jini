# Job google-forms (owner-approved 11-05; plan approved with this trim)
Plan: cloud/plans/GF-google-forms-plan.md. This job file overrides it.
Base: origin/cloud/combine in both repos, at its current tip, which already has the consent contract. Branch cloud/google-forms. Do not push to cloud/combine.
Do plan steps 1 to 5. The consent field is `consent`, not `requires`; use the shared check the consent job built, with no second evaluator. Embed declares consent: ["functional"]. Do not add pre-consent header gating; only the frame origin the embed needs. Keep the visible fallback message with the validated public link. Prove a dummy fourth provider appears without editing admin or the assistant.
No live Google check here: state that a real public form still needs checking.
Tests only for what you change; full suites run later. No skipping or weakening tests or rules. No publish, tag or main. Report at cloud/reports/google-forms.md and in your final message: shas, exact files, tests with commands, anything open. General wording in commits and notes.
