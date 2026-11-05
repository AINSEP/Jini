# Job: combine (owner-approved 11-05)
Bring all finished cloud work together on one branch. Merge only: no new features, no refactors, no cleanup.

Base in both repos: origin/cloud/security-release at its current tip. It already has the 0.6.23 release, tag-a, tovu-deps and om-chat. Branch: cloud/combine in Tovu and Jini.

Merge these with real merge commits, in this order, in each repo where the branch exists:
1. cloud/oauth-refresh (Jini only; Tovu has none)
2. cloud/shared-oauth, then in Tovu also bring back its held desktop work: revert commit 17d8ccab7 (it set apps/desktop back to the old base). Snapshot 844135075 is the reference for what the desktop code should contain.
3. cloud/totp
4. cloud/revoke
5. cloud/card
6. cloud/forms
7. cloud/bugs
8. cloud/ci
9. cloud/mail
10. cloud/ainsep
11. cloud/admin-speed
12. cloud/mcp
13. cloud/errors (largest, so last)

Do NOT merge: cloud/commerce (separate review first), cloud/memory-skill, cloud/consent (report only), cloud-plans-1105, or any tag-b, passkeys or geo-fraud work.

Conflicts: keep the behaviour of both sides. Keep all assertions and "why" comments. Read each branch's cloud/reports file when a conflict needs intent. If a conflict truly cannot be resolved safely, leave that branch out, carry on with the rest, and report it with the files and the reason. cloud/reports files will conflict: keep them all by renaming nothing; store each branch's report at cloud/reports/<branch>.md and leave yours at cloud/reports/combine.md.

Versions: Tovu uses published Jini 0.6.23 lockfiles on the base, but this combined Jini has newer code. For this job build Jini from cloud/combine and link it into Tovu to check. Do not commit link state; lockfiles stay on registry versions. Do not bump versions.

After all merges:
- Jini: pnpm -r build; typecheck all; pnpm guard:plugins; pnpm guard:plugins:packed. If the catalog digests change, regenerate the catalog and commit it.
- Tovu: link the built Jini; typecheck root, admin, desktop, site-chat.
- Run only tests for files that had conflicts, plus tests the merges obviously broke. Fix what fails. Full suites are the next job.
- Secret scan the commit range.

Push: only cloud/combine. Owner approved --no-verify for pushes to cloud/combine in Tovu, because the local hook needs Electron and GitHub Desktop Gates run on the branch anyway. Use it for that branch only.

Report at cloud/reports/combine.md and in your final message: final shas in each repo, each branch merged or left out and why, conflicts resolved and how, checks with exact commands, anything open. General wording in commits and notes: no exploit details, no client names.
