# Job om-chat-2: shared chat fixes (owner-approved 11-05)
cloud/plans/OMJ-plan-result.md: items 1, 2, 3, 4 and 8 only. Item 0 is already done. Items 5, 6, 7 stay later.
Base: origin/cloud/combine in both repos, at its current tip. Branch cloud/om-chat-2 from it. Do not push to cloud/combine.
Item 1 follows the plan's recommendation: a reported duration wins, and timestamps only fill a missing one.
Most of this is Jini shared chat code, with small Tovu wiring. Do not touch Open Marketing's repo and do not publish. Tests only for what you change; full suites run later.
