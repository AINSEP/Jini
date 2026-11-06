# Job one-card-rest (owner-approved 11-06): one-card leftovers and the approval list
Base in both repos: origin/cloud/combine (Tovu 74fedc132, Jini f07ae3d6f), which already holds every merged job and the UI fixes. Create cloud/<job> from it in each repo you change. Owner approved --no-verify for that branch in Tovu. Hard cap 2 hours. Your prompt may add items that are not listed here; they count the same. General wording in commits and reports: these repos are public. List every bug you notice under "Bugs found", fixed or not.

Read cloud/reports/one-card.md first.
1. Convert the 2 large cards one-card left unconverted. Do not change their look beyond what conversion needs; the look gets checked in Chrome afterwards.
2. Listings can advertise secret settings as writable although execution refuses. Make the listings tell the truth.
3. Add formspree to the provider catalog if it is really missing.
4. Write the list of every tool that always asks for approval, with one plain line on why, in cloud/reports/one-card-rest.md. Take it from the code, not from memory. The owner was promised this list.
5. Leave the consent cards alone. Do not add compaction for old form answer copies; the owner decided against it.

Failing test first for bugs. Report at cloud/reports/one-card-rest.md and in your final message: shas, each item, tests with exact commands.
