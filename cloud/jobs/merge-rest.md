# Job merge-rest (owner-approved 11-05)
Bring the remaining finished work onto cloud/combine. Merge only: no new features, refactors or cleanup.

Work directly on origin/cloud/combine in Tovu and Jini. Merge with real merge commits, in this order, in each repo where the branch exists:
1. cloud/security-release (Tovu has newer release fixes)
2. cloud/om-chat-2
3. cloud/tag-b
4. cloud/passkeys
5. cloud/commerce

Conflicts: keep the behaviour of both sides, all assertions and "why" comments. Read the branch's cloud/reports file when a conflict needs intent. If a branch truly cannot be merged safely, leave it out, carry on, and report the files and the reason. Keep every report file. Commerce must stay off by default after the merge, and a commerce-off site must keep its own /products page.

Afterward:
- Jini: pnpm -r build; typecheck all; pnpm guard:plugins; pnpm guard:plugins:packed. Regenerate and commit the catalog if digests change.
- Tovu: link the built Jini; typecheck root, admin, desktop, site-chat. Do not commit link state; lockfiles stay on registry versions. No version bumps.
- Run only tests for files with conflicts. Fix what fails, smallest change. Full suites are the next job.
- Secret scan the commit range.

Push only cloud/combine. Owner approved --no-verify for pushes to cloud/combine in Tovu only. No publish, tag or main. No skipping or weakening tests or rules.

Report at cloud/reports/merge-rest.md and in your final message: final shas, each branch merged or left out and why, conflicts and how they were resolved, checks with exact commands, anything open. General wording in commits and notes.

One gap to fill after merging cloud/om-chat-2: its Tovu commit 99faf59da (site and desktop inventory metadata for item 4, model reasoning levels) was never pushed, because the local hook rejected it inside its container, so it is lost. Read cloud/reports/om-chat-2.md and redo that small wiring on cloud/combine in Tovu, using the Jini `@jini-ai/agent-runtime/model-selection` export, with its focused test. Nothing else from that job needs redoing.
