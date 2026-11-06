# Job merge-round-2 (owner-approved 11-05)
Bring finished work onto cloud/combine. Merge only, as in cloud/jobs/merge-rest.md's rules for conflicts, checks, pushes and --no-verify. Work directly on origin/cloud/combine in Tovu and Jini.
Merge in order, in each repo where the branch exists: cloud/clean-build, cloud/release-fixes, cloud/small-fixes, cloud/om-chat-3, cloud/forms-left, cloud/consent-declare, cloud/forms-privacy, cloud/one-card, each only if its report says it is complete. Say which were not ready.
A site with commerce or consent off must behave as before. If a branch truly cannot be merged safely, leave it out, carry on and report it. From a clean checkout with no existing dist, prove Jini builds. Run tests only for conflicted files. Report at cloud/reports/merge-round-2.md.
