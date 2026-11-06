# Job ui-review (owner-approved 11-06): read-only review of the UI fixes branch
Base in both repos: origin/cloud/combine (Tovu 74fedc132, Jini f07ae3d6f), which already holds every merged job and the UI fixes. Create cloud/<job> from it in each repo you change. Owner approved --no-verify for that branch in Tovu. Hard cap 2 hours. Your prompt may add items that are not listed here; they count the same. General wording in commits and reports: these repos are public. List every bug you notice under "Bugs found", fixed or not.

Change no code. Review Tovu 14030521c..74fedc132 and Jini dfaf12f1f..f07ae3d6f. No separate reviewer has read most of this. Look for bugs, excess code, and memory or polling cost (frequency times size). Priority: the 3 allowlist entries in Tovu b887e8c85 and whether each is honestly justified; the desktop stop and keep-running prompts, including holding idle sleep; the Jini site-card export; the /commerce/return route; then the rest. Give each finding a file:line and a concrete failing case. Say what you did not read.

Put only general wording in cloud/reports/ui-review.md on your branch. Give full findings in your final message in this thread.
