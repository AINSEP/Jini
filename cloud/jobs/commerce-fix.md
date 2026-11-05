# Job commerce-fix (owner-approved 11-05)
Fix the review findings on the commerce branch. Findings: cloud/plans/commerce-review.md on this plans branch. Check each finding against the code first; if one is wrong, say so and skip it.

Base and push: origin/cloud/commerce in Tovu and Jini. Work directly on cloud/commerce in each repo. Read cloud/reports/commerce.md there first: the job's last step was lost when its machine died.

Fix, in this order, with the fix the finding gives unless you have a smaller correct one:
1. H1 (off commerce must never change other pages), M1.
2. M2: redo the lost move of generic worker and drain logic into Jini, with Jini tests. Do this before H2 to H4 because they change the same code. One typed status list only. Tovu keeps only the timer and owner-lock wiring.
3. H2, H3, H4, H5 (use the newest-price-replaces-older option, no new tools), H6.
4. M3, M4 (point lookup for the detail route; warn in the tool past 24, no pagination), M5, M6, M7, M8, M9 (real tests for H2, H3, H4, H6; accurate commerce_get_status), M10.

Failing test first for each bug. No live provider exists here: say which behaviour is proven only against a fake. Do not add features, tables or options beyond these. Commerce stays off by default.

Do not merge any other branch. No publish, no tag, no main. Report at cloud/reports/commerce-fix.md and in your final message: shas, each finding fixed or skipped and why, tests with exact commands, what is still open. General wording in commits and notes.
