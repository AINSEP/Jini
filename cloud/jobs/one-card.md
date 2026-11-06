# Job one-card (owner-approved 11-05; plan approved with this trim)
Plan: cloud/plans/OC-one-card-plan.md. This job file overrides it.
Base: origin/cloud/combine in both repos, at its current tip. It already has consent-declare and small-fixes, so the plan's collisions are resolved: use their current code. Branch cloud/one-card.
Do steps 1 to 7 in order. Step 2 comes first in priority: a typed confirmer proves nothing unless the click is tied to a real, active person's session. Close the silent widening in already-signed-in agent_plugin_connect.
Permanent-delete grants and mail test mode stay excluded. Credential entry and OAuth stay as they are. Add no new engine, table, poll or worker.
If absorbing a card in step 6 grows large or changes what a person can do beyond approval, leave that one card, finish the others and report it.
Tests only for what you change; full suites run later. No skipping or weakening tests or rules. No publish, tag or main. Report at cloud/reports/one-card.md and in your final message: shas, exact files, tests with commands, anything open. General wording in commits and notes.
