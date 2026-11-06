# Job commerce-fix-2 (owner-approved 11-05)
Last fix round for commerce. Findings: cloud/plans/commerce-review-2.md on this plans branch. Check each against the code first; if one is wrong, say so and skip it.

Base and push: origin/cloud/commerce in Tovu and Jini. Work directly on cloud/commerce. Do not merge any other branch.

Fix with the finding's fix unless you have a smaller correct one:
N-H1, N-H2, N-M1, N-M2, N-M3, N-M4, N-M5, N-M6, N-M7, N-M8, N-M10, N-M11, N-M12. For N-M13 add only the tests that prove N-H1 (a declined card writes nothing), N-H2 and the real tool list.
List but do not fix N-M9.

Keep it small. This is the second round on how stuck payments are handled. Prefer removing a state or path over adding one. No new tables, states, tools or options, except reuse of what the findings name. If a fix would need more states or new machinery, stop on it and say why: that means the design needs rethinking, and the owner decides.

Failing test first for each bug. Commerce stays off by default. No live provider exists here: state what is proven only against a fake. No publish, no tag, no main. Report at cloud/reports/commerce-fix-2.md and in your final message: shas, each finding fixed or skipped and why, tests with exact commands, what is still open, and what must be checked with a real Stripe test account before any site turns commerce on. General wording in commits and notes.
